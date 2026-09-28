import { EmailProviderName } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import {
  EmailProviderError, type EmailProvider, type EmailSyncPage, type InboundAttachmentDescriptor, type InboundEmail,
} from '../email-provider';

export interface ImapProviderOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  /** Characters of body text kept. The whole message always stays in the mailbox itself. */
  maxBodyChars: number;
  timeoutMs?: number;
}

/**
 * A dedicated company mailbox over IMAP.
 *
 * ── Why IMAP ──
 *
 * The alternatives — the Gmail API or Microsoft Graph — need an OAuth application, a consent
 * flow, and somewhere to keep and refresh tokens. That is a large amount of machinery, and it ties
 * a transport company to one vendor's account model. A dedicated mailbox with an app password
 * works against Gmail, Microsoft 365, Zoho and any hosting provider's mail, needs one set of
 * credentials in the server's environment, and suits how this application is actually deployed.
 * The abstraction above is what makes swapping it a contained job.
 *
 * ── The cursor ──
 *
 * IMAP identifies messages by UID within a folder, and those UIDs are only meaningful alongside
 * the folder's UIDVALIDITY — which the server changes when it can no longer guarantee them. The
 * cursor is therefore `"<uidValidity>:<lastUid>"`, and a change in UIDVALIDITY resets the sync
 * rather than silently skipping mail. Nothing outside this file knows that shape.
 *
 * ── Trust ──
 *
 * Everything this returns is untrusted input (§24). HTML is never rendered here, attachments are
 * never opened, and nothing is executed. The adapter's job is to hand over inert data.
 */
export class ImapEmailProvider implements EmailProvider {
  readonly name = EmailProviderName.IMAP_MAILBOX;

  constructor(private readonly options: ImapProviderOptions) {}

  isConfigured(): boolean {
    return Boolean(this.options.host && this.options.user && this.options.password);
  }

  async verifyConnection(): Promise<{ ok: true; mailbox: string; messageCount: number } | { ok: false; reason: string }> {
    if (!this.isConfigured()) return { ok: false, reason: 'The mailbox is not configured on this server.' };
    try {
      return await this.withConnection(async (client) => {
        const status = await client.status(this.options.mailbox, { messages: true });
        return { ok: true as const, mailbox: this.options.mailbox, messageCount: status.messages ?? 0 };
      });
    } catch (error) {
      return { ok: false, reason: error instanceof EmailProviderError ? error.message : 'The mailbox could not be reached.' };
    }
  }

  async fetchSince(cursor: string | null, limit: number): Promise<EmailSyncPage> {
    if (!this.isConfigured()) {
      throw new EmailProviderError('The mailbox is not configured on this server.', 'UNAVAILABLE', false);
    }

    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(this.options.mailbox);
      try {
        const mailbox = client.mailbox;
        if (!mailbox || typeof mailbox === 'boolean') {
          throw new EmailProviderError(`Mailbox "${this.options.mailbox}" could not be opened.`, 'MAILBOX_NOT_FOUND', false);
        }

        const uidValidity = String(mailbox.uidValidity ?? '0');
        const parsed = this.parseCursor(cursor);

        // The server has renumbered the folder, so previous UIDs mean nothing. Starting again is
        // safe: ingestion is keyed on the message id, so nothing is duplicated — whereas trusting
        // the old UIDs would quietly skip mail.
        const restart = parsed !== null && parsed.uidValidity !== uidValidity;
        const startUid = restart ? 1 : (parsed?.lastUid ?? 0) + 1;

        const messages: InboundEmail[] = [];
        let highestUid = restart ? 0 : (parsed?.lastUid ?? 0);

        // `uid: true` makes the range a UID range rather than a sequence range — the difference
        // between resuming correctly and re-reading the whole folder.
        for await (const message of client.fetch(
          { uid: `${startUid}:*` },
          { uid: true, source: true, flags: true, internalDate: true, size: true },
          { uid: true },
        )) {
          // The `n:*` form always returns at least one message even when none match.
          if (message.uid < startUid) continue;
          if (messages.length >= limit) break;

          try {
            messages.push(await this.toInboundEmail(message, uidValidity));
            highestUid = Math.max(highestUid, message.uid);
          } catch (error) {
            // One unparseable message must not stall the mailbox forever. The UID still advances,
            // so the sync moves past it; a malformed MIME part is the mail's problem, not ours.
            highestUid = Math.max(highestUid, message.uid);
            throw error instanceof EmailProviderError
              ? error
              : new EmailProviderError(`Message ${message.uid} could not be parsed and was skipped.`, 'PROTOCOL_ERROR', false, { cause: error });
          }
        }

        return { messages, nextCursor: `${uidValidity}:${highestUid}` };
      } finally {
        lock.release();
      }
    });
  }

  /**
   * IMAP delivers attachments inside the message body, so they are already in hand by the time
   * anything asks. This exists for the interface's sake and for providers that work differently.
   */
  async fetchAttachment(providerMessageId: string, providerAttachmentId: string): Promise<Uint8Array> {
    const parsed = this.parseMessageId(providerMessageId);
    if (!parsed) throw new EmailProviderError('That message identifier is not valid for this mailbox.', 'PROTOCOL_ERROR', false);

    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(this.options.mailbox);
      try {
        const downloaded = await client.download(String(parsed.uid), undefined, { uid: true });
        if (!downloaded?.content) throw new EmailProviderError('The message could not be downloaded.', 'PROTOCOL_ERROR', true);

        const mail = await simpleParser(downloaded.content);
        const attachment = mail.attachments.find((candidate, index) => this.attachmentId(candidate, index) === providerAttachmentId);
        if (!attachment) throw new EmailProviderError('That attachment is no longer on the message.', 'PROTOCOL_ERROR', false);
        return new Uint8Array(attachment.content);
      } finally {
        lock.release();
      }
    });
  }

  async markRead(providerMessageId: string): Promise<void> {
    const parsed = this.parseMessageId(providerMessageId);
    if (!parsed) return;
    await this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(this.options.mailbox);
      try {
        await client.messageFlagsAdd(String(parsed.uid), ['\\Seen'], { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async toInboundEmail(
    // imapflow types internalDate loosely; normalised below rather than trusted as a Date.
    message: { uid: number; source?: Buffer; flags?: Set<string>; internalDate?: Date | string; size?: number },
    uidValidity: string,
  ): Promise<InboundEmail> {
    if (!message.source) throw new EmailProviderError('The message body was not returned by the server.', 'PROTOCOL_ERROR', true);

    const mail: ParsedMail = await simpleParser(message.source);
    const from = mail.from?.value?.[0];

    // Only the text is kept. An HTML-only message is flattened to text here, so nothing
    // downstream ever holds markup that could be rendered by accident (§24).
    const bodyText = (mail.text ?? (mail.html ? this.htmlToText(String(mail.html)) : '')) || null;

    return {
      providerMessageId: this.messageId(uidValidity, message.uid),
      providerThreadId: mail.references ? this.firstReference(mail.references) : null,
      rfcMessageId: mail.messageId ?? null,
      fromAddress: (from?.address ?? '').toLowerCase(),
      fromName: from?.name || null,
      toAddresses: this.addresses(mail.to),
      ccAddresses: this.addresses(mail.cc),
      subject: mail.subject ?? null,
      receivedAt: mail.date ?? this.toDate(message.internalDate) ?? new Date(),
      bodyText: bodyText ? bodyText.slice(0, this.options.maxBodyChars) : null,
      hasHtml: Boolean(mail.html),
      labels: [...(message.flags ?? [])],
      sizeBytes: message.size ?? message.source.byteLength,
      // Passed through exactly as the receiving server wrote it; never parsed into a verdict here.
      authenticationResults: this.headerValue(mail, 'authentication-results'),
      attachments: mail.attachments.map((attachment, index): InboundAttachmentDescriptor => ({
        providerAttachmentId: this.attachmentId(attachment, index),
        filename: attachment.filename || `attachment-${index + 1}`,
        mimeType: attachment.contentType || 'application/octet-stream',
        sizeBytes: attachment.size ?? attachment.content?.byteLength ?? 0,
        // IMAP hands the bytes over with the message, so no second round trip is needed.
        content: attachment.content ? new Uint8Array(attachment.content) : undefined,
      })),
    };
  }

  /**
   * A stable id for an attachment within its message.
   *
   * Content-ID when the message provides one; otherwise the part's position, which is stable for
   * a message that does not change — and an IMAP message cannot change.
   */
  private attachmentId(attachment: { cid?: string; checksum?: string }, index: number): string {
    return attachment.cid || attachment.checksum || `part-${index + 1}`;
  }

  private messageId(uidValidity: string, uid: number): string {
    return `${uidValidity}:${uid}`;
  }

  private parseMessageId(value: string): { uidValidity: string; uid: number } | null {
    const match = /^(\d+):(\d+)$/.exec(value);
    if (!match) return null;
    return { uidValidity: match[1]!, uid: Number(match[2]) };
  }

  private parseCursor(cursor: string | null): { uidValidity: string; lastUid: number } | null {
    if (!cursor) return null;
    const match = /^(\d+):(\d+)$/.exec(cursor);
    if (!match) return null;
    return { uidValidity: match[1]!, lastUid: Number(match[2]) };
  }

  /** The server's internal date, whichever way the library hands it over. */
  private toDate(value: Date | string | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private addresses(value: ParsedMail['to']): string[] {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.flatMap((entry) => entry.value.map((address) => (address.address ?? '').toLowerCase()).filter(Boolean)).slice(0, 25);
  }

  private firstReference(references: string | string[]): string | null {
    const first = Array.isArray(references) ? references[0] : references.split(/\s+/)[0];
    return first || null;
  }

  private headerValue(mail: ParsedMail, header: string): string | null {
    const value = mail.headers.get(header);
    if (!value) return null;
    return (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 2_000);
  }

  /** Flattens HTML to readable text. Nothing is rendered, and no script survives. */
  private htmlToText(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Opens a connection, runs the work, and closes it — even when the work throws. */
  private async withConnection<T>(work: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      auth: { user: this.options.user, pass: this.options.password },
      // The library logs message metadata at info level; the office's mail is not ours to log.
      logger: false,
      greetingTimeout: this.options.timeoutMs ?? 15_000,
      socketTimeout: this.options.timeoutMs ?? 60_000,
    });

    try {
      await client.connect();
    } catch (error) {
      throw this.toProviderError(error);
    }

    try {
      return await work(client);
    } catch (error) {
      throw error instanceof EmailProviderError ? error : this.toProviderError(error);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private toProviderError(error: unknown): EmailProviderError {
    const details = error as { message?: string; responseText?: string; authenticationFailed?: boolean };
    // imapflow reports a failed login as a generic "Command failed" with a flag alongside it, so
    // the flag and the server's own response text are both consulted — checking the message alone
    // would tell an administrator "the mailbox could not be read" when the password is simply wrong.
    const message = [details?.message, details?.responseText].filter(Boolean).join(' ') || String(error);

    // Credentials are never echoed back into an error the office will read.
    if (details?.authenticationFailed || /AUTHENTICATIONFAILED|Authentication failed|Invalid credentials|LOGIN failed|AUTHENTICATE/i.test(message)) {
      return new EmailProviderError(
        'The mailbox rejected the configured credentials. Check IMAP_USER and IMAP_PASSWORD on the server.',
        'AUTHENTICATION_FAILED',
        // A wrong password will still be wrong in five minutes; retrying achieves nothing.
        false,
        { cause: error },
      );
    }
    if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(message)) {
      return new EmailProviderError('The mail server could not be reached.', 'UNAVAILABLE', true, { cause: error });
    }
    if (/timed? ?out|ETIMEDOUT/i.test(message)) {
      return new EmailProviderError('The mail server did not respond in time.', 'TIMEOUT', true, { cause: error });
    }
    if (/NONEXISTENT|Mailbox doesn't exist|TRYCREATE/i.test(message)) {
      return new EmailProviderError(`Mailbox "${this.options.mailbox}" does not exist on the server.`, 'MAILBOX_NOT_FOUND', false, { cause: error });
    }
    return new EmailProviderError('The mailbox could not be read.', 'UNKNOWN', true, { cause: error });
  }
}
