import type { EmailProviderName } from '@prisma/client';

/**
 * The mailbox boundary.
 *
 * Everything above this interface deals in normalised messages. Which mailbox they came from —
 * Gmail through the Gmail API, Microsoft 365 through Microsoft Graph, or another host over IMAP —
 * is a deployment decision, and no Gmail-shaped, Graph-shaped or IMAP-shaped concept is allowed
 * above this file (§23). A dedicated *company* mailbox, never anyone's personal account.
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
  /**
   * A short-lived provider handle that fetches the bytes in one call (Gmail's per-request
   * attachment id). Optional: `fetchAttachment` must work from the stable id alone.
   */
  fetchHandle?: string;
}

/** One message, in the office's vocabulary rather than the provider's. */
export interface InboundEmail {
  /** The provider's own stable identifier. The idempotency key for the whole pipeline (§19). */
  providerMessageId: string;
  /** The provider's conversation id (Gmail thread, Graph conversation). */
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
  /**
   * True when the provider has more waiting right now (another page of the initial listing, or
   * of the change feed). The sync keeps fetching, up to its per-run page limit.
   */
  hasMore?: boolean;
  /** Things worth telling the office about this page, e.g. that a history window lapsed. */
  notices?: string[];
}

export type EmailProviderErrorCode =
  | 'UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'MAILBOX_NOT_FOUND'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'PROTOCOL_ERROR'
  | 'NOT_CONNECTED'
  | 'UNKNOWN';

export class EmailProviderError extends Error {
  constructor(
    message: string,
    readonly code: EmailProviderErrorCode,
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
 * Deliberately read-only. This system files and classifies what arrives; it does not reply,
 * forward or delete, and giving the interface no way to do so is the clearest way to guarantee it
 * (§21: do not automatically send replies). The OAuth scopes requested match: read-only.
 */
export interface EmailProvider {
  readonly name: EmailProviderName;
  /**
   * The mailbox this provider reads, as a stable key for the sync cursor and the stored messages:
   * the folder for IMAP, `<account>/INBOX` for the OAuth providers — so connecting a different
   * account starts a fresh cursor rather than resuming someone else's.
   */
  readonly mailbox: string;

  /** Whether the provider is configured enough to be worth contacting at all. */
  isConfigured(): boolean;

  /**
   * Fetches messages after `cursor`, oldest first where the provider allows, at most about
   * `limit` of them.
   *
   * Implementations must tolerate being called with a cursor they have already passed: returning
   * an overlapping window is safe, because ingestion is keyed on the provider's message id.
   */
  fetchSince(cursor: string | null, limit: number): Promise<EmailSyncPage>;

  /** Fetches one attachment's bytes, for providers that do not deliver them with the message. */
  fetchAttachment(providerMessageId: string, providerAttachmentId: string, fetchHandle?: string): Promise<Uint8Array>;

  /** A cheap connectivity and credentials check, for the admin's "is this working?" question. */
  verifyConnection(): Promise<{ ok: true; mailbox: string; messageCount: number | null } | { ok: false; reason: string }>;
}
