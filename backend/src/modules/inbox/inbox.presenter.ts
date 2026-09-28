import type { Prisma } from '@prisma/client';

/**
 * JSON for the Inbox screens.
 *
 * Two things are deliberately shaped here rather than left to the UI. A classification always
 * travels with whether a *person* set it, because "the office decided this is an invoice" and
 * "a model thinks this is an invoice" are different facts and must not look alike. And an
 * attachment that was refused is still listed, with its reason — the office needs to know
 * something arrived and was not kept (§20).
 */

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);
const num = (value: Prisma.Decimal | null | undefined): number | null => (value === null || value === undefined ? null : value.toNumber());

export function presentInboxRow(row: {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  receivedAt: Date;
  status: string;
  classification: string;
  classifiedById: string | null;
  aiStatus: string;
  hasHtml: boolean;
  provider: string;
  _count: { attachments: number };
  aiResults: { summary: string | null; confidence: Prisma.Decimal | null; classification: string }[];
}) {
  const latest = row.aiResults[0] ?? null;
  return {
    id: row.id,
    from: { address: row.fromAddress, name: row.fromName },
    subject: row.subject,
    receivedAt: row.receivedAt.toISOString(),
    status: row.status,
    classification: row.classification,
    /** True when a person chose the category; false when it is still the model's suggestion. */
    classificationConfirmed: row.classifiedById !== null,
    aiStatus: row.aiStatus,
    attachmentCount: row._count.attachments,
    hasHtml: row.hasHtml,
    provider: row.provider,
    /** A line the office can scan without opening the mail. Always a suggestion. */
    aiSummary: latest?.summary ?? null,
    aiConfidence: num(latest?.confidence),
  };
}

export function presentInboxDetail(message: {
  id: string;
  provider: string;
  mailbox: string;
  providerMessageId: string;
  providerThreadId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  receivedAt: Date;
  bodyText: string | null;
  bodyTruncated: boolean;
  hasHtml: boolean;
  labels: string[];
  status: string;
  classification: string;
  classifiedById: string | null;
  classifiedAt: Date | null;
  aiStatus: string;
  aiAttempts: number;
  aiFailureCode: string | null;
  aiFailureMessage: string | null;
  authenticationResults: string | null;
  sizeBytes: number | null;
  createdAt: Date;
  attachments: { id: string; filename: string; mimeType: string; sizeBytes: number; fileId: string | null; skipReason: string | null }[];
  aiResults: {
    id: string; version: number; provider: string; model: string; classification: string;
    confidence: Prisma.Decimal | null; summary: string | null; extraction: Prisma.JsonValue;
    warnings: string[]; durationMs: number | null; createdAt: Date;
  }[];
}) {
  return {
    id: message.id,
    provider: message.provider,
    mailbox: message.mailbox,
    threadId: message.providerThreadId,
    from: { address: message.fromAddress, name: message.fromName },
    to: message.toAddresses,
    cc: message.ccAddresses,
    subject: message.subject,
    receivedAt: message.receivedAt.toISOString(),
    filedAt: message.createdAt.toISOString(),
    /**
     * Plain text only. An HTML message was flattened to text on the way in and is never returned
     * as markup, so nothing downstream can render or execute it (§24).
     */
    bodyText: message.bodyText,
    bodyTruncated: message.bodyTruncated,
    hasHtml: message.hasHtml,
    labels: message.labels,
    sizeBytes: message.sizeBytes,
    /** What the receiving server said about SPF/DKIM/DMARC. Shown for judgement, never acted on. */
    authenticationResults: message.authenticationResults,
    status: message.status,
    classification: message.classification,
    classificationConfirmed: message.classifiedById !== null,
    classifiedAt: iso(message.classifiedAt),
    ai: {
      status: message.aiStatus,
      attempts: message.aiAttempts,
      failureCode: message.aiFailureCode,
      failureMessage: message.aiFailureMessage,
    },
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      /** False when the file was refused; `skipReason` says why, and it stays in the mailbox. */
      stored: attachment.fileId !== null,
      skipReason: attachment.skipReason,
    })),
    /** Every reading, newest first. A rerun adds a version; it never replaces one (§29). */
    aiResults: message.aiResults.map((result) => ({
      id: result.id,
      version: result.version,
      provider: result.provider,
      model: result.model,
      classification: result.classification,
      confidence: num(result.confidence),
      summary: result.summary,
      /** References the model read out of the text. Never written into a business record. */
      references: extractReferences(result.extraction),
      warnings: result.warnings,
      durationMs: result.durationMs,
      createdAt: result.createdAt.toISOString(),
    })),
  };
}

function extractReferences(value: Prisma.JsonValue): { type: string; value: string }[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const references = (value as { references?: unknown }).references;
  if (!Array.isArray(references)) return [];
  return references
    .filter((entry): entry is { type: string; value: string } =>
      typeof entry === 'object' && entry !== null && typeof (entry as { type?: unknown }).type === 'string' && typeof (entry as { value?: unknown }).value === 'string')
    .slice(0, 25);
}
