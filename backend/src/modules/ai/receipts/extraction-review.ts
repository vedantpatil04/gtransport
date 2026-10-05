import type { ServiceReceiptExtraction, ServiceReceiptLineItem } from '../schema';

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
  /** The highest odometer reading on this vehicle's verified service history. */
  lastVerifiedOdometerKm?: number | null;
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

  let serviceDate: Date | null = null;
  if (extraction.invoiceDate === null) {
    issues.push('No invoice date could be read from the receipt.');
  } else {
    serviceDate = parseIsoDate(extraction.invoiceDate);
    if (!serviceDate) {
      issues.push(`The invoice date "${extraction.invoiceDate}" is not a date the system can read.`);
    } else if (serviceDate.getTime() > now.getTime() + 86_400_000) {
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

  // The itemised lines should not exceed the subtotal they belong to.
  const partLines = sumLines(extraction.lineItems, 'PART');
  if (extraction.partsAmount !== null && partLines > 0 && partLines - extraction.partsAmount > TOTAL_TOLERANCE_RUPEES) {
    issues.push('The listed parts add up to more than the parts subtotal on the receipt.');
  }
  const labourLines = sumLines(extraction.lineItems, 'LABOUR');
  if (extraction.labourAmount !== null && labourLines > 0 && labourLines - extraction.labourAmount > TOTAL_TOLERANCE_RUPEES) {
    issues.push('The listed labour lines add up to more than the labour subtotal on the receipt.');
  }

  // Next service: printed values only, and they have to make sense against this service.
  if (extraction.nextServiceDate !== null) {
    const next = parseIsoDate(extraction.nextServiceDate);
    if (!next) {
      issues.push(`The next service date "${extraction.nextServiceDate}" is not a date the system can read.`);
    } else if (serviceDate && next.getTime() <= serviceDate.getTime()) {
      issues.push('The next service date read from the receipt is not after the service date.');
    }
  }
  if (extraction.odometerKm !== null && extraction.nextServiceKm !== null && extraction.nextServiceKm <= extraction.odometerKm) {
    issues.push(
      `The next service reading (${extraction.nextServiceKm} km) is not above the odometer reading (${extraction.odometerKm} km).`,
    );
  }
  // An odometer that went backwards is a misread digit or the wrong vehicle's bill.
  if (
    extraction.odometerKm !== null &&
    typeof context.lastVerifiedOdometerKm === 'number' &&
    extraction.odometerKm < context.lastVerifiedOdometerKm
  ) {
    issues.push(
      `The odometer reads ${extraction.odometerKm} km, lower than the ${context.lastVerifiedOdometerKm} km on this vehicle's last verified service.`,
    );
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

function sumLines(lines: ServiceReceiptLineItem[], kind: ServiceReceiptLineItem['kind']): number {
  return lines.filter((line) => line.kind === kind).reduce((total, line) => total + (line.amount ?? 0), 0);
}

export type ReviewOutcome = 'SUCCEEDED' | 'NEEDS_REVIEW';

/**
 * Where an extraction lands once it has been validated.
 *
 * `SUCCEEDED` does not mean accepted — it means the suggestions are coherent enough to present
 * as pre-filled values for a quick verification. `NEEDS_REVIEW` means the office should not be
 * offered a one-click verification, because something needs a human eye: low confidence, a
 * validation issue, or the model's own warning. Neither is authoritative; only a person setting
 * VERIFIED is.
 */
export function decideReviewOutcome(
  extraction: ServiceReceiptExtraction,
  validationIssues: string[],
  lowConfidenceThreshold = LOW_CONFIDENCE_THRESHOLD,
): ReviewOutcome {
  if (validationIssues.length > 0) return 'NEEDS_REVIEW';
  if (extraction.confidence < lowConfidenceThreshold) return 'NEEDS_REVIEW';
  // The model flagging its own uncertainty counts, even when it reports high confidence.
  if (extraction.warnings.length > 0) return 'NEEDS_REVIEW';
  return 'SUCCEEDED';
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

/** Every value an extraction can offer for promotion onto the maintenance record. */
export interface SuggestedRecordValues {
  totalAmount: SuggestedField<number>;
  invoiceDate: SuggestedField<string>;
  vendorName: SuggestedField<string>;
  invoiceNumber: SuggestedField<string>;
  serviceType: SuggestedField<string>;
  odometerKm: SuggestedField<number>;
  nextServiceDate: SuggestedField<string>;
  nextServiceKm: SuggestedField<number>;
  labourAmount: SuggestedField<number>;
  partsAmount: SuggestedField<number>;
  taxAmount: SuggestedField<number>;
}

export type SuggestedFieldKey = keyof SuggestedRecordValues;

export function toSuggestedValues(extraction: ServiceReceiptExtraction): SuggestedRecordValues {
  return {
    totalAmount: field(extraction.totalAmount),
    invoiceDate: field(extraction.invoiceDate),
    vendorName: field(extraction.vendorName),
    invoiceNumber: field(extraction.invoiceNumber),
    serviceType: field(extraction.serviceType),
    odometerKm: field(extraction.odometerKm),
    nextServiceDate: field(extraction.nextServiceDate),
    nextServiceKm: field(extraction.nextServiceKm),
    labourAmount: field(extraction.labourAmount),
    partsAmount: field(extraction.partsAmount),
    taxAmount: field(extraction.gstAmount),
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

/** A verified line item as submitted by a person: money as strings, never through a float. */
export interface SubmittedLineItem {
  description: string;
  kind?: ServiceReceiptLineItem['kind'] | null;
  quantity?: string | null;
  unitPrice?: string | null;
  amount?: string | null;
}

/** The values a person submitted when verifying, keyed like the suggestions they may come from. */
export type SubmittedValues = Partial<{
  totalAmount: string;
  invoiceDate: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  serviceType: string | null;
  odometerKm: number | null;
  nextServiceDate: string | null;
  nextServiceKm: number | null;
  labourAmount: string | null;
  partsAmount: string | null;
  taxAmount: string | null;
  lineItems: SubmittedLineItem[] | null;
}>;

/**
 * Which submitted values agree with the extraction (accepted) and which a person changed
 * (corrected).
 *
 * Worked out on the server rather than taken from the client, so the audit trail's "the office
 * corrected the total" is a fact about the two values, not a claim the screen made. A field the
 * extraction did not find is neither: the person typed it, and there was nothing to accept or
 * correct. Text is compared without case or spacing differences — re-casing a workshop name is
 * not a correction of what was read.
 */
export function compareWithExtraction(
  extraction: ServiceReceiptExtraction | null,
  submitted: SubmittedValues,
): { accepted: string[]; corrected: string[] } {
  const accepted: string[] = [];
  const corrected: string[] = [];
  if (!extraction) return { accepted, corrected };

  const suggestions = toSuggestedValues(extraction);
  for (const key of Object.keys(suggestions) as SuggestedFieldKey[]) {
    if (!(key in submitted)) continue;
    const read = suggestions[key].value;
    if (read === null) continue;
    const given = submitted[key as keyof SubmittedValues];
    (sameValue(read, given) ? accepted : corrected).push(key);
  }

  if ('lineItems' in submitted && extraction.lineItems.length > 0) {
    const read = extraction.lineItems.map((line) => lineKey(line.description, line.kind, line.quantity, line.unitPrice, line.amount));
    const given = (submitted.lineItems ?? []).map((line) =>
      lineKey(line.description, line.kind ?? null, numberOrNull(line.quantity), numberOrNull(line.unitPrice), numberOrNull(line.amount)),
    );
    (JSON.stringify(read) === JSON.stringify(given) ? accepted : corrected).push('lineItems');
  }

  return { accepted, corrected };
}

function sameValue(read: string | number, given: unknown): boolean {
  if (given === null || given === undefined || given === '') return false;
  if (typeof read === 'number') {
    const value = typeof given === 'number' ? given : Number(given);
    return Number.isFinite(value) && Math.abs(value - read) < 0.005;
  }
  return normaliseText(String(given)) === normaliseText(read);
}

function lineKey(description: string | null, kind: string | null, quantity: number | null, unitPrice: number | null, amount: number | null) {
  return [normaliseText(description ?? ''), kind ?? null, quantity, unitPrice === null ? null : unitPrice.toFixed(2), amount === null ? null : amount.toFixed(2)];
}

function numberOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
