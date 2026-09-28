import type { ServiceReceiptExtraction } from '../schema';

/**
 * Deciding whether a person has to look at an extraction.
 *
 * Confidence affects the workflow; it never decides truth (§11). Every extraction is reviewed by
 * someone before it can become the record — what these rules change is how much is already
 * checked when the reviewer arrives, and whether the office is told to look sooner rather than
 * when they get round to it.
 *
 * Pure functions, so every rule is testable without a database, a model or a server.
 */

/** Below this, the model's own confidence is not worth presenting as a set of suggestions. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** A total further than this from the sum of its parts is a contradiction, not a rounding error. */
export const TOTAL_TOLERANCE_RUPEES = 1;

export interface ExtractionContext {
  /** The registration on the record the receipt was attached to. */
  vehicleNumber?: string | null;
  /** The date the record carries, for spotting a receipt filed against the wrong job. */
  expenseDate?: Date | null;
  /** The amount already on the record, if someone typed one. */
  recordedAmount?: number | null;
  /** Now, injected so the rules are testable. */
  now?: Date;
}

/**
 * Checks the application runs over an extraction, independent of anything the model claimed about
 * its own confidence. These are the questions a careful clerk would ask, written down.
 *
 * Every issue is a plain sentence, because it is shown to the person doing the review.
 */
export function validateExtraction(extraction: ServiceReceiptExtraction, context: ExtractionContext = {}): string[] {
  const issues: string[] = [];
  const now = context.now ?? new Date();

  if (extraction.totalAmount === null) {
    issues.push('No total amount could be read from the receipt.');
  } else if (extraction.totalAmount <= 0) {
    issues.push('The total amount read from the receipt is not a positive figure.');
  }

  if (extraction.invoiceDate === null) {
    issues.push('No invoice date could be read from the receipt.');
  } else {
    const parsed = parseIsoDate(extraction.invoiceDate);
    if (!parsed) {
      issues.push(`The invoice date "${extraction.invoiceDate}" is not a date the system can read.`);
    } else if (parsed.getTime() > now.getTime() + 86_400_000) {
      issues.push('The invoice date read from the receipt is in the future.');
    }
  }

  if (extraction.vendorName === null) {
    issues.push('No service centre name could be read from the receipt.');
  }

  // A receipt for a different truck is the mistake this catches — a real one, and easy to make
  // when a driver uploads from a folder of photos.
  if (context.vehicleNumber && extraction.vehicleNumber) {
    if (normaliseRegistration(extraction.vehicleNumber) !== normaliseRegistration(context.vehicleNumber)) {
      issues.push(
        `The receipt shows vehicle ${extraction.vehicleNumber}, but this record is for ${context.vehicleNumber}.`,
      );
    }
  }

  // Does the bill add up? A total that disagrees with its own parts means one of them was misread.
  const components = [extraction.partsAmount, extraction.labourAmount, extraction.gstAmount, extraction.otherCharges];
  const known = components.filter((value): value is number => value !== null);
  if (extraction.totalAmount !== null && known.length >= 2) {
    const sum = known.reduce((total, value) => total + value, 0);
    if (Math.abs(sum - extraction.totalAmount) > TOTAL_TOLERANCE_RUPEES) {
      issues.push(
        `The parts, labour and tax read from the receipt add up to ₹${sum.toFixed(2)}, but the total reads ₹${extraction.totalAmount.toFixed(2)}.`,
      );
    }
  }

  // The line items should not exceed the parts subtotal they belong to.
  const lineTotal = extraction.parts.reduce((total, part) => total + (part.amount ?? 0), 0);
  if (extraction.partsAmount !== null && lineTotal > 0 && lineTotal - extraction.partsAmount > TOTAL_TOLERANCE_RUPEES) {
    issues.push(`The listed parts add up to more than the parts subtotal on the receipt.`);
  }

  // Disagreeing with a figure a person already typed is worth flagging in both directions.
  if (typeof context.recordedAmount === 'number' && extraction.totalAmount !== null) {
    if (Math.abs(context.recordedAmount - extraction.totalAmount) > TOTAL_TOLERANCE_RUPEES) {
      issues.push(
        `The receipt totals ₹${extraction.totalAmount.toFixed(2)}, but ₹${context.recordedAmount.toFixed(2)} was entered on this record.`,
      );
    }
  }

  return issues;
}

export type ReviewOutcome = 'COMPLETED' | 'REVIEW_REQUIRED';

/**
 * Where an extraction lands once it has been validated.
 *
 * `COMPLETED` does not mean accepted — it means the suggestions are coherent enough to present
 * as pre-filled values for a quick confirmation. `REVIEW_REQUIRED` means the office should not be
 * offered a one-click confirmation, because something needs a human eye. Neither is authoritative;
 * only a person setting CONFIRMED is.
 */
export function decideReviewOutcome(
  extraction: ServiceReceiptExtraction,
  validationIssues: string[],
  lowConfidenceThreshold = LOW_CONFIDENCE_THRESHOLD,
): ReviewOutcome {
  if (validationIssues.length > 0) return 'REVIEW_REQUIRED';
  if (extraction.confidence < lowConfidenceThreshold) return 'REVIEW_REQUIRED';
  // The model flagging its own uncertainty counts, even when it reports high confidence.
  if (extraction.warnings.length > 0) return 'REVIEW_REQUIRED';
  return 'COMPLETED';
}

/**
 * The fields the office can be offered as suggestions, with whether each was actually found.
 *
 * "Not found" is carried explicitly rather than as an empty string, because the difference
 * between "the receipt does not say" and "the receipt says nothing useful" is the difference
 * between a blank the clerk fills in and a value they would have trusted (§6).
 */
export interface SuggestedField<T> {
  value: T | null;
  /** 'found' | 'missing'. An uncertain value is still found — the issues say why to check it. */
  state: 'found' | 'missing';
}

const field = <T>(value: T | null): SuggestedField<T> => ({ value, state: value === null ? 'missing' : 'found' });

/** The subset of an extraction that can be promoted onto the maintenance record. */
export interface SuggestedRecordValues {
  totalAmount: SuggestedField<number>;
  invoiceDate: SuggestedField<string>;
  vendorName: SuggestedField<string>;
  invoiceNumber: SuggestedField<string>;
  serviceType: SuggestedField<string>;
}

export function toSuggestedValues(extraction: ServiceReceiptExtraction): SuggestedRecordValues {
  return {
    totalAmount: field(extraction.totalAmount),
    invoiceDate: field(extraction.invoiceDate),
    vendorName: field(extraction.vendorName),
    invoiceNumber: field(extraction.invoiceNumber),
    serviceType: field(extraction.serviceType),
  };
}

/** `YYYY-MM-DD` only. A model that returns anything else has not answered the question asked. */
export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Rejects 2026-02-31, which Date would otherwise roll forward into March.
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

/** Indian registrations are written with varying spacing and case; compare them without it. */
export function normaliseRegistration(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
