import type { EmailProviderName } from '@prisma/client';

/**
 * The mailbox boundary.
 *
 * Everything above this interface deals in normalised messages. Which mailbox they came from —
 * a company IMAP account today, Gmail or Microsoft Graph later — is a deployment decision, and
 * no Gmail-shaped or IMAP-shaped concept is allowed above this file (§23).
 *
 * Phase 0 defined a narrower version of this contract in `inbound-email.ts`; Phase 7 replaces it
 * with one that can actually be implemented, and keeps the same intent: a dedicated *company*
 * mailbox, never anyone's personal account.
 */

/** An attachment as the provider describes it, before any decision about keeping it. */
export interface InboundAttachmentDescriptor {
  /** Stable within its message, so re-syncing cannot duplicate the row. */
  providerAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * Present when the provider handed over the bytes with the message, as IMAP does. Absent when
   * they must be fetched separately, as the Gmail and Graph APIs require.
   */
  content?: Uint8Array;
}

/** One message, in the office's vocabulary rather than the provider's. */
export interface InboundEmail {
  /** The provider's own stable identifier. The idempotency key for the whole pipeline (§19). */
  providerMessageId: string;
  providerThreadId?: string | null;
  /** RFC 5322 Message-ID, so the same mail seen through a second provider is recognisable. */
  rfcMessageId?: string | null;

  fromAddress: string;
  fromName?: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject?: string | null;
  receivedAt: Date;

  /** Plain text. An HTML-only message is converted to text by the provider adapter. */
  bodyText?: string | null;
  hasHtml: boolean;
  labels: string[];
  sizeBytes?: number | null;
  /**
   * What the provider said about SPF/DKIM/DMARC, when it says anything. Displayed so a person can
   * weigh a message; never acted on automatically (§24).
   */
  authenticationResults?: string | null;

  attachments: InboundAttachmentDescriptor[];
}

export interface EmailSyncPage {
  messages: InboundEmail[];
  /** Opaque provider state to resume from. Stored as-is; nothing above interprets it. */
  nextCursor: string | null;
}

export class EmailProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'UNAVAILABLE' | 'AUTHENTICATION_FAILED' | 'MAILBOX_NOT_FOUND' | 'TIMEOUT' | 'PROTOCOL_ERROR' | 'UNKNOWN',
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EmailProviderError';
  }
}

/**
 * What a mailbox integration must be able to do.
 *
 * Deliberately read-only apart from the read/unread flag. This system files and classifies what
 * arrives; it does not reply, forward or delete, and giving the interface no way to do so is the
 * clearest way to guarantee it (§21: do not automatically send replies).
 */
export interface EmailProvider {
  readonly name: EmailProviderName;

  /** Whether the provider is configured enough to be worth contacting at all. */
  isConfigured(): boolean;

  /**
   * Fetches messages after `cursor`, oldest first, at most `limit` of them.
   *
   * Implementations must tolerate being called with a cursor they have already passed: returning
   * an overlapping window is safe, because ingestion is keyed on the provider's message id.
   */
  fetchSince(cursor: string | null, limit: number): Promise<EmailSyncPage>;

  /** Fetches one attachment's bytes, for providers that do not deliver them with the message. */
  fetchAttachment(providerMessageId: string, providerAttachmentId: string): Promise<Uint8Array>;

  /** Marks a message read in the mailbox itself, where the provider supports it. Optional. */
  markRead?(providerMessageId: string): Promise<void>;

  /** A cheap connectivity and credentials check, for the admin's "is this working?" question. */
  verifyConnection(): Promise<{ ok: true; mailbox: string; messageCount: number } | { ok: false; reason: string }>;
}
