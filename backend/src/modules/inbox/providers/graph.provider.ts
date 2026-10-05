import { EmailProviderName } from '@prisma/client';
import {
  EmailProviderError, type EmailProvider, type EmailSyncPage, type InboundAttachmentDescriptor, type InboundEmail,
} from '../email-provider';
import type { FetchLike } from '../oauth/oauth-client';
import { MailApiClient, mapLimit, type AccessTokenSource } from './mail-api-client';
import { htmlToText } from './mail-text';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Only these fields are requested: nothing the office does not use leaves Microsoft. */
const MESSAGE_FIELDS = [
  'id', 'conversationId', 'internetMessageId', 'subject', 'from', 'toRecipients', 'ccRecipients',
  'receivedDateTime', 'hasAttachments', 'body', 'categories',
].join(',');

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  '@removed'?: unknown;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string | null;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  hasAttachments?: boolean;
  body?: { contentType?: 'text' | 'html'; content?: string };
  categories?: string[];
}

interface GraphAttachment {
  '@odata.type'?: string;
  id: string;
  name?: string;
  contentType?: string | null;
  size?: number;
  isInline?: boolean;
}

export interface GraphProviderOptions {
  /** The connected mailbox address, from the provider at consent time. */
  account: string;
  tokens: AccessTokenSource;
  initialSyncDays: number;
  maxBodyChars: number;
  fetch?: FetchLike;
}

/**
 * A company Microsoft 365 mailbox, through the official Microsoft Graph API.
 *
 * Synchronisation uses Graph's delta query on the Inbox. The cursor is the URL Graph hands back:
 * a `nextLink` while a round of changes is still being paged through, a `deltaLink` once it is
 * complete. Both are Graph's own opaque state and are only ever followed back to Graph — a cursor
 * pointing anywhere else is refused, so a tampered row cannot turn the sync into a request to an
 * arbitrary host.
 *
 * Read-only (delegated Mail.Read): nothing here marks, moves, sends or deletes.
 */
export class GraphEmailProvider implements EmailProvider {
  readonly name = EmailProviderName.MICROSOFT_GRAPH;
  private readonly api: MailApiClient;

  constructor(private readonly options: GraphProviderOptions) {
    this.api = new MailApiClient('Microsoft Graph', options.tokens, options.fetch);
  }

  get mailbox(): string {
    return `${this.options.account}/INBOX`;
  }

  isConfigured(): boolean {
    return true;
  }

  async verifyConnection() {
    try {
      const { body } = await this.api.json<{ totalItemCount?: number }>(`${GRAPH}/me/mailFolders/inbox?$select=totalItemCount`);
      return { ok: true as const, mailbox: this.options.account, messageCount: body.totalItemCount ?? null };
    } catch (error) {
      return { ok: false as const, reason: error instanceof EmailProviderError ? error.message : 'Microsoft Graph could not be reached.' };
    }
  }

  async fetchSince(cursor: string | null, limit: number): Promise<EmailSyncPage> {
    const url = cursor && this.isGraphUrl(cursor) ? cursor : this.initialDeltaUrl();
    const pageSize = Math.min(Math.max(limit, 1), 50);
    const { status, body } = await this.api.json<{
      value?: GraphMessage[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    }>(url, {
      headers: { Prefer: `odata.maxpagesize=${pageSize}, outlook.body-content-type="text"` },
      accept: [410],
    });

    // The delta token has expired (Graph keeps sync state for a limited time). Start a fresh
    // round; filed mail is recognised by its id and skipped.
    if (status === 410) {
      if (url === this.initialDeltaUrl()) {
        throw new EmailProviderError('Microsoft Graph refused a fresh synchronisation of the inbox.', 'PROTOCOL_ERROR', true);
      }
      const page = await this.fetchSince(null, limit);
      return {
        ...page,
        notices: ['Microsoft Graph no longer held the previous sync position, so the inbox was read again. Mail already filed was skipped.'],
      };
    }

    // Removals are reported too; this system keeps what it filed and acts on nothing, so they are skipped.
    const items = (body.value ?? []).filter((item) => !item['@removed'] && item.id);
    const messages = await mapLimit(items, 4, (item) => this.toInbound(item));

    const nextLink = body['@odata.nextLink'];
    const deltaLink = body['@odata.deltaLink'];
    const next = nextLink ?? deltaLink ?? null;
    if (next && !this.isGraphUrl(next)) {
      throw new EmailProviderError('Microsoft Graph returned a sync link to an unexpected host.', 'PROTOCOL_ERROR', false);
    }
    return {
      messages: messages.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()),
      // With neither link the round cannot be resumed; null restarts it next time, which is safe.
      nextCursor: next,
      hasMore: Boolean(nextLink),
    };
  }

  async fetchAttachment(providerMessageId: string, providerAttachmentId: string): Promise<Uint8Array> {
    return this.api.bytes(
      `${GRAPH}/me/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(providerAttachmentId)}/$value`,
    );
  }

  // ───────────────────────────── internals ─────────────────────────────

  private initialDeltaUrl(): string {
    const since = new Date(Date.now() - this.options.initialSyncDays * 86_400_000).toISOString();
    const params = new URLSearchParams({ $select: MESSAGE_FIELDS, $filter: `receivedDateTime ge ${since}` });
    return `${GRAPH}/me/mailFolders/inbox/messages/delta?${params.toString()}`;
  }

  private isGraphUrl(value: string): boolean {
    return value.startsWith(`${GRAPH}/`);
  }

  private async toInbound(message: GraphMessage): Promise<InboundEmail> {
    const content = message.body?.content ?? '';
    const isHtml = message.body?.contentType === 'html';
    // Graph converts to text on request; if it did not, the HTML is flattened here (§24).
    const bodyText = isHtml ? htmlToText(content) : content.trim();
    const received = message.receivedDateTime ? new Date(message.receivedDateTime) : null;

    return {
      providerMessageId: message.id,
      providerThreadId: message.conversationId ?? null,
      rfcMessageId: message.internetMessageId ?? null,
      fromAddress: (message.from?.emailAddress?.address ?? '').toLowerCase(),
      fromName: message.from?.emailAddress?.name || null,
      toAddresses: addresses(message.toRecipients),
      ccAddresses: addresses(message.ccRecipients),
      subject: message.subject ?? null,
      receivedAt: received && !Number.isNaN(received.getTime()) ? received : new Date(),
      bodyText: bodyText ? bodyText.slice(0, this.options.maxBodyChars + 1) : null,
      hasHtml: isHtml,
      labels: message.categories ?? [],
      sizeBytes: null,
      authenticationResults: null,
      attachments: message.hasAttachments ? await this.listAttachments(message.id) : [],
    };
  }

  /**
   * Attachment metadata only — no bytes until the policy has decided the file is worth keeping.
   * Inline images (signature logos and the like) are not documents and are left out.
   */
  private async listAttachments(messageId: string): Promise<InboundAttachmentDescriptor[]> {
    const { body } = await this.api.json<{ value?: GraphAttachment[] }>(
      `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`,
    );
    return (body.value ?? [])
      .filter((attachment) => !attachment.isInline)
      .map((attachment, index) => ({
        providerAttachmentId: attachment.id,
        filename: attachment.name || `attachment-${index + 1}`,
        // An attached email or a cloud link has no file content to keep; its type says so and the
        // attachment policy records it as unsupported rather than downloading something else.
        mimeType:
          attachment['@odata.type'] && attachment['@odata.type'] !== '#microsoft.graph.fileAttachment'
            ? 'application/x-graph-item'
            : attachment.contentType || 'application/octet-stream',
        sizeBytes: attachment.size ?? 0,
      }));
  }
}

function addresses(recipients: GraphRecipient[] | undefined): string[] {
  return (recipients ?? [])
    .map((recipient) => (recipient.emailAddress?.address ?? '').toLowerCase())
    .filter(Boolean)
    .slice(0, 25);
}
