import { EmailProviderName } from '@prisma/client';
import {
  EmailProviderError, type EmailProvider, type EmailSyncPage, type InboundAttachmentDescriptor, type InboundEmail,
} from '../email-provider';
import type { FetchLike } from '../oauth/oauth-client';
import { MailApiClient, mapLimit, type AccessTokenSource } from './mail-api-client';
import { base64UrlToBytes, htmlToText, parseAddressList } from './mail-text';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPart;
}

/**
 * Where synchronisation stands, opaque to everything outside this file.
 *
 * `initial`: the first listing of the inbox (bounded to the last EMAIL_INITIAL_SYNC_DAYS), page by
 * page. The history id was taken *before* listing began, so anything that arrives during a long
 * first sync is picked up by the change feed afterwards — and anything seen twice is a duplicate
 * the database refuses.
 *
 * `history`: the change feed from `historyId`, page by page.
 */
type GmailCursor =
  | { v: 1; mode: 'initial'; historyId: string; pageToken?: string }
  | { v: 1; mode: 'history'; historyId: string; pageToken?: string };

export interface GmailProviderOptions {
  /** The connected mailbox address, from the provider at consent time. */
  account: string;
  tokens: AccessTokenSource;
  initialSyncDays: number;
  maxBodyChars: number;
  fetch?: FetchLike;
}

/**
 * A company Gmail / Google Workspace mailbox, through the official Gmail API.
 *
 * Read-only (`gmail.readonly`): this adapter lists, reads and downloads. It never modifies a label,
 * marks anything read, sends or deletes — the scope would refuse it, and the interface offers no
 * way to ask.
 */
export class GmailEmailProvider implements EmailProvider {
  readonly name = EmailProviderName.GMAIL;
  private readonly api: MailApiClient;

  constructor(private readonly options: GmailProviderOptions) {
    this.api = new MailApiClient('Gmail', options.tokens, options.fetch);
  }

  get mailbox(): string {
    return `${this.options.account}/INBOX`;
  }

  isConfigured(): boolean {
    return true;
  }

  async verifyConnection() {
    try {
      const { body } = await this.api.json<{ emailAddress?: string; messagesTotal?: number }>(`${API}/profile`);
      return { ok: true as const, mailbox: body.emailAddress ?? this.options.account, messageCount: body.messagesTotal ?? null };
    } catch (error) {
      return { ok: false as const, reason: error instanceof EmailProviderError ? error.message : 'Gmail could not be reached.' };
    }
  }

  async fetchSince(cursor: string | null, limit: number): Promise<EmailSyncPage> {
    const state = this.parseCursor(cursor);
    if (!state) return this.listInitial(await this.startHistoryId(), undefined, limit);
    if (state.mode === 'initial') return this.listInitial(state.historyId, state.pageToken, limit);
    return this.listHistory(state.historyId, state.pageToken, limit);
  }

  async fetchAttachment(providerMessageId: string, providerAttachmentId: string, fetchHandle?: string): Promise<Uint8Array> {
    // Gmail's attachment ids are not stable between reads of a message, so the stored id is the
    // part id. The handle from the read that filed the message usually still works; when it does
    // not, the message is read again to find the part's current id.
    if (fetchHandle) {
      try {
        return await this.downloadAttachment(providerMessageId, fetchHandle);
      } catch (error) {
        if (error instanceof EmailProviderError && error.retryable) throw error;
      }
    }
    const message = await this.getMessage(providerMessageId);
    if (!message) throw new EmailProviderError('The message is no longer in the mailbox.', 'MAILBOX_NOT_FOUND', false);
    const part = flattenParts(message.payload).find((candidate) => candidate.partId === providerAttachmentId);
    if (!part) throw new EmailProviderError('That attachment is no longer on the message.', 'PROTOCOL_ERROR', false);
    if (part.body?.data) return base64UrlToBytes(part.body.data);
    if (!part.body?.attachmentId) throw new EmailProviderError('The attachment has no downloadable content.', 'PROTOCOL_ERROR', false);
    return this.downloadAttachment(providerMessageId, part.body.attachmentId);
  }

  // ───────────────────────────── listing ─────────────────────────────

  private async startHistoryId(): Promise<string> {
    const { body } = await this.api.json<{ historyId?: string }>(`${API}/profile`);
    if (!body.historyId) throw new EmailProviderError('Gmail did not report a history position for the mailbox.', 'PROTOCOL_ERROR', true);
    return body.historyId;
  }

  private async listInitial(historyId: string, pageToken: string | undefined, limit: number): Promise<EmailSyncPage> {
    const params = new URLSearchParams({
      labelIds: 'INBOX',
      maxResults: String(Math.min(Math.max(limit, 1), 100)),
      q: `newer_than:${this.options.initialSyncDays}d`,
      ...(pageToken ? { pageToken } : {}),
    });
    const { body } = await this.api.json<{ messages?: { id: string }[]; nextPageToken?: string }>(`${API}/messages?${params.toString()}`);
    const messages = await this.readMessages((body.messages ?? []).map((m) => m.id));

    const next: GmailCursor = body.nextPageToken
      ? { v: 1, mode: 'initial', historyId, pageToken: body.nextPageToken }
      : { v: 1, mode: 'history', historyId };
    return { messages, nextCursor: JSON.stringify(next), hasMore: Boolean(body.nextPageToken) };
  }

  private async listHistory(historyId: string, pageToken: string | undefined, limit: number): Promise<EmailSyncPage> {
    const params = new URLSearchParams({
      startHistoryId: historyId,
      historyTypes: 'messageAdded',
      labelId: 'INBOX',
      maxResults: String(Math.min(Math.max(limit, 1), 500)),
      ...(pageToken ? { pageToken } : {}),
    });
    const { status, body } = await this.api.json<{
      history?: { messagesAdded?: { message?: { id: string; labelIds?: string[] } }[] }[];
      historyId?: string;
      nextPageToken?: string;
    }>(`${API}/history?${params.toString()}`, { accept: [404] });

    // Gmail keeps about a week of history. Past that the id is refused, and the only correct
    // move is to list the inbox again: already-filed mail is recognised by its id and skipped.
    if (status === 404) {
      const page = await this.listInitial(await this.startHistoryId(), undefined, limit);
      return {
        ...page,
        notices: ['Gmail no longer held changes back to the last sync, so the inbox was listed again. Mail already filed was skipped.'],
      };
    }

    const ids = new Set<string>();
    for (const entry of body.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const message = added.message;
        if (message?.id && (!message.labelIds || message.labelIds.includes('INBOX'))) ids.add(message.id);
      }
    }
    const messages = await this.readMessages([...ids]);

    const next: GmailCursor = body.nextPageToken
      ? { v: 1, mode: 'history', historyId, pageToken: body.nextPageToken }
      : { v: 1, mode: 'history', historyId: body.historyId ?? historyId };
    return { messages, nextCursor: JSON.stringify(next), hasMore: Boolean(body.nextPageToken) };
  }

  /** Reads messages in full, a few at a time. One deleted since listing is simply not there. */
  private async readMessages(ids: string[]): Promise<InboundEmail[]> {
    const read = await mapLimit(ids, 4, (id) => this.getMessage(id));
    return read
      .filter((message): message is GmailMessage => message !== null)
      .map((message) => this.toInbound(message))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  private async getMessage(id: string): Promise<GmailMessage | null> {
    const { status, body } = await this.api.json<GmailMessage>(`${API}/messages/${encodeURIComponent(id)}?format=full`, { accept: [404] });
    return status === 404 ? null : body;
  }

  private async downloadAttachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
    const { body } = await this.api.json<{ data?: string }>(
      `${API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (!body.data) throw new EmailProviderError('Gmail returned an empty attachment.', 'PROTOCOL_ERROR', true);
    return base64UrlToBytes(body.data);
  }

  // ───────────────────────────── normalising ─────────────────────────────

  private toInbound(message: GmailMessage): InboundEmail {
    const headers = new Map<string, string>();
    for (const header of message.payload?.headers ?? []) {
      const key = header.name.toLowerCase();
      if (!headers.has(key)) headers.set(key, header.value);
    }

    const parts = flattenParts(message.payload);
    const isAttachment = (part: GmailPart) => Boolean(part.filename) && Boolean(part.body?.attachmentId || part.body?.data);
    const textPart = parts.find((part) => part.mimeType === 'text/plain' && !isAttachment(part) && part.body?.data);
    const htmlPart = parts.find((part) => part.mimeType === 'text/html' && !isAttachment(part) && part.body?.data);
    const decode = (part: GmailPart) => Buffer.from(base64UrlToBytes(part.body!.data!)).toString('utf8');
    // Only text is kept. An HTML-only message is flattened here, at the edge (§24).
    const bodyText = textPart ? decode(textPart) : htmlPart ? htmlToText(decode(htmlPart)) : '';

    const from = parseAddressList(headers.get('from'))[0];
    const received = message.internalDate ? new Date(Number(message.internalDate)) : null;

    return {
      providerMessageId: message.id,
      providerThreadId: message.threadId ?? null,
      rfcMessageId: headers.get('message-id') ?? null,
      fromAddress: from?.address ?? '',
      fromName: from?.name ?? null,
      toAddresses: parseAddressList(headers.get('to')).map((a) => a.address).slice(0, 25),
      ccAddresses: parseAddressList(headers.get('cc')).map((a) => a.address).slice(0, 25),
      subject: headers.get('subject') ?? null,
      receivedAt: received && !Number.isNaN(received.getTime()) ? received : new Date(),
      bodyText: bodyText ? bodyText.slice(0, this.options.maxBodyChars + 1) : null,
      hasHtml: Boolean(htmlPart),
      labels: message.labelIds ?? [],
      sizeBytes: message.sizeEstimate ?? null,
      authenticationResults: headers.get('authentication-results')?.slice(0, 2_000) ?? null,
      attachments: parts.filter(isAttachment).map(
        (part, index): InboundAttachmentDescriptor => ({
          // The part id is stable for the life of the message; Gmail's attachment id is not.
          providerAttachmentId: part.partId ?? `part-${index + 1}`,
          filename: part.filename || `attachment-${index + 1}`,
          mimeType: part.mimeType || 'application/octet-stream',
          sizeBytes: part.body?.size ?? 0,
          content: part.body?.data ? base64UrlToBytes(part.body.data) : undefined,
          fetchHandle: part.body?.attachmentId,
        }),
      ),
    };
  }

  private parseCursor(cursor: string | null): GmailCursor | null {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(cursor) as Partial<GmailCursor>;
      if (parsed.v === 1 && (parsed.mode === 'initial' || parsed.mode === 'history') && typeof parsed.historyId === 'string') {
        return parsed as GmailCursor;
      }
    } catch {
      // Not ours (a cursor from another provider, or corrupted): start again rather than guess.
    }
    return null;
  }
}

function flattenParts(part: GmailPart | undefined): GmailPart[] {
  if (!part) return [];
  return [part, ...(part.parts ?? []).flatMap((child) => flattenParts(child))];
}
