import type { Prisma, ServiceReceiptAIStatus } from '@prisma/client';
import { toDriverFacingState } from './receipt-state';
import type { SuggestedRecordValues } from './extraction-review';
import type { ServiceReceiptExtraction } from '../schema';

/**
 * JSON for the review screens.
 *
 * Two audiences, and the difference between them is the point. The office sees the provider, the
 * model, the confidence and every validation issue, because they are deciding whether to trust
 * the extraction. A driver sees one of five words (§33) — they uploaded a photo of a bill and want
 * to know whether anything is expected of them, not which model read it.
 */

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);
const isoDate = (value: Date | null | undefined): string | null => (value ? value.toISOString().slice(0, 10) : null);
const num = (value: Prisma.Decimal | null | undefined): number | null => (value === null || value === undefined ? null : value.toNumber());

// ───────────────────────────── Office ─────────────────────────────

export interface AIResultView {
  id: string;
  version: number;
  provider: string;
  model: string;
  confidence: number | null;
  /** What the model itself flagged. */
  warnings: string[];
  /** What the application's own checks found. These are the ones that route a record to review. */
  validationIssues: string[];
  /** How the document was prepared: "image", "image+ocr", "pdf:text", "pdf:raster+ocr", "pdf:text+raster"… */
  preparation: string | null;
  /** Characters of machine-readable text found before the model ran (PDF text layer or OCR). */
  sourceTextChars: number | null;
  durationMs: number | null;
  createdAt: string;
}

export function presentAIResult(row: {
  id: string;
  version: number;
  provider: string;
  model: string;
  confidence: Prisma.Decimal | null;
  warnings: string[];
  validationIssues: string[];
  preparation: string | null;
  sourceTextChars: number | null;
  durationMs: number | null;
  createdAt: Date;
}): AIResultView {
  return {
    id: row.id,
    version: row.version,
    provider: row.provider,
    model: row.model,
    confidence: num(row.confidence),
    warnings: row.warnings,
    validationIssues: row.validationIssues,
    preparation: row.preparation,
    sourceTextChars: row.sourceTextChars,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AIJobView {
  id: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  provider: string | null;
  model: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextAttemptAt: string | null;
  failureCode: string | null;
  /** Safe to show: a short explanation, never the prompt or the receipt's contents. */
  failureMessage: string | null;
}

export function presentAIJob(row: {
  id: string;
  status: ServiceReceiptAIStatus;
  attempt: number;
  maxAttempts: number;
  provider: string | null;
  model: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  nextAttemptAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
}): AIJobView {
  return {
    id: row.id,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    provider: row.provider,
    model: row.model,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    nextAttemptAt: iso(row.nextAttemptAt),
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
  };
}

/** The full review payload: the record, the original, the extractions, and what is suggested. */
export function presentReceiptReview(review: {
  expense: {
    id: string;
    category: string;
    amount: Prisma.Decimal;
    expenseDate: Date;
    vendorName: string | null;
    description: string | null;
    receiptFileId: string | null;
    status: string;
    aiStatus: ServiceReceiptAIStatus;
    invoiceNumber: string | null;
    serviceType: string | null;
    odometerKm: number | null;
    nextServiceDate: Date | null;
    nextServiceKm: number | null;
    labourAmount: Prisma.Decimal | null;
    partsAmount: Prisma.Decimal | null;
    taxAmount: Prisma.Decimal | null;
    serviceLineItems: Prisma.JsonValue;
    acceptedResultId: string | null;
    aiVerifiedAt: Date | null;
    aiVerifiedById: string | null;
    aiRejectedAt: Date | null;
    aiAcceptedFields: string[];
    driver: { id: string; driverCode: string; employee: { fullName: string } } | null;
    vehicle: { id: string; registrationNumber: string };
    receiptFile: { id: string; originalFilename: string; mimeType: string; sizeBytes: bigint; createdAt: Date } | null;
    aiResults: Parameters<typeof presentAIResult>[0][];
    aiJobs: Parameters<typeof presentAIJob>[0][];
  };
  latestResult: unknown;
  suggestions: SuggestedRecordValues | null;
  extraction: ServiceReceiptExtraction | null;
  canVerify: boolean;
  canRetry: boolean;
}) {
  const { expense } = review;
  return {
    record: {
      id: expense.id,
      category: expense.category,
      // The authoritative figures, as they stand on the record right now.
      amount: expense.amount.toFixed(2),
      expenseDate: isoDate(expense.expenseDate),
      vendorName: expense.vendorName,
      description: expense.description,
      status: expense.status,
      vehicle: expense.vehicle,
      driver: expense.driver
        ? { id: expense.driver.id, driverCode: expense.driver.driverCode, fullName: expense.driver.employee.fullName }
        : null,
      /**
       * The structured service details as they stand on the record. Only verification writes these,
       * so on an unverified record they are whatever the last verification left (usually nothing).
       */
      service: {
        invoiceNumber: expense.invoiceNumber,
        serviceType: expense.serviceType,
        odometerKm: expense.odometerKm,
        nextServiceDate: isoDate(expense.nextServiceDate),
        nextServiceKm: expense.nextServiceKm,
        labourAmount: expense.labourAmount?.toFixed(2) ?? null,
        partsAmount: expense.partsAmount?.toFixed(2) ?? null,
        taxAmount: expense.taxAmount?.toFixed(2) ?? null,
        lineItems: Array.isArray(expense.serviceLineItems) ? expense.serviceLineItems : [],
      },
    },
    /**
     * The original, always. Present whatever happened to processing — that is the guarantee the
     * whole workflow is built around (§5).
     */
    receipt: expense.receiptFile
      ? {
          fileId: expense.receiptFile.id,
          filename: expense.receiptFile.originalFilename,
          mimeType: expense.receiptFile.mimeType,
          sizeBytes: Number(expense.receiptFile.sizeBytes),
          uploadedAt: expense.receiptFile.createdAt.toISOString(),
        }
      : null,
    ai: {
      status: expense.aiStatus,
      verifiedAt: iso(expense.aiVerifiedAt),
      verifiedById: expense.aiVerifiedById,
      rejectedAt: iso(expense.aiRejectedAt),
      acceptedResultId: expense.acceptedResultId,
      /** Which values were taken from the extraction rather than typed. */
      acceptedFields: expense.aiAcceptedFields,
      canVerify: review.canVerify,
      canRetry: review.canRetry,
    },
    /** Every version, newest first. History is never replaced by a rerun (§29). */
    results: expense.aiResults.map(presentAIResult),
    jobs: expense.aiJobs.map(presentAIJob),
    /** The latest extraction in full, for the side-by-side comparison with the receipt. */
    extraction: review.extraction,
    /** Pre-fill values, each marked found or missing. A missing value stays missing (§6). */
    suggestions: review.suggestions,
  };
}

/** A row in the office's review queue. */
export function presentPendingReceipt(row: {
  id: string;
  amount: Prisma.Decimal;
  expenseDate: Date;
  vendorName: string | null;
  aiStatus: ServiceReceiptAIStatus;
  createdAt: Date;
  receiptFileId: string | null;
  vehicle: { id: string; registrationNumber: string };
  driver: { id: string; employee: { fullName: string } } | null;
  aiResults: { version: number; confidence: Prisma.Decimal | null; validationIssues: string[]; warnings: string[] }[];
}) {
  const latest = row.aiResults[0] ?? null;
  return {
    id: row.id,
    amount: row.amount.toFixed(2),
    expenseDate: isoDate(row.expenseDate),
    vendorName: row.vendorName,
    aiStatus: row.aiStatus,
    createdAt: row.createdAt.toISOString(),
    hasReceipt: Boolean(row.receiptFileId),
    vehicle: row.vehicle,
    driver: row.driver ? { id: row.driver.id, fullName: row.driver.employee.fullName } : null,
    latest: latest
      ? {
          version: latest.version,
          confidence: num(latest.confidence),
          issueCount: latest.validationIssues.length,
          warningCount: latest.warnings.length,
        }
      : null,
  };
}

// ───────────────────────────── Driver ─────────────────────────────

/**
 * What the driver's phone shows.
 *
 * Deliberately no provider, no model, no confidence and no job detail — a driver has no use for
 * any of it and no way to act on it (§33).
 */
export function presentDriverReceipt(row: {
  id: string;
  amount: Prisma.Decimal;
  expenseDate: Date;
  vendorName: string | null;
  aiStatus: ServiceReceiptAIStatus;
  receiptFileId: string | null;
  createdAt: Date;
  vehicle: { registrationNumber: string };
}) {
  return {
    id: row.id,
    amount: row.amount.toFixed(2),
    serviceDate: isoDate(row.expenseDate),
    vendorName: row.vendorName,
    vehicleRegistration: row.vehicle.registrationNumber,
    hasReceipt: Boolean(row.receiptFileId),
    /** One of: uploaded | processing | needsReview | verified | failed. */
    state: toDriverFacingState(row.aiStatus),
    submittedAt: row.createdAt.toISOString(),
  };
}
