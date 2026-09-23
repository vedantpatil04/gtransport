/**
 * Inbound email contracts for the Admin inbox.
 *
 * The provider stays behind this interface so a dedicated company mailbox can be added via
 * Gmail API, Microsoft Graph or IMAP without the inbox domain knowing which. Phase 0 does
 * not connect to any mailbox.
 */
export type InboundEmailProviderName = 'gmail' | 'microsoft_graph' | 'imap_mailbox';

export interface InboundEmailAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Provider-side id; attachments are fetched separately and stored via FileStorage. */
  providerAttachmentId: string;
}

export interface InboundEmailMessage {
  providerMessageId: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: Date;
  bodyText?: string;
  attachments: InboundEmailAttachment[];
}

export interface InboundEmailProvider {
  readonly name: InboundEmailProviderName;
  /** Incremental fetch; `cursor` is an opaque provider sync token (history id, delta link, UID). */
  fetchSince(cursor: string | null, limit: number): Promise<{ messages: InboundEmailMessage[]; nextCursor: string | null }>;
  fetchAttachment(providerMessageId: string, providerAttachmentId: string): Promise<Uint8Array>;
}
