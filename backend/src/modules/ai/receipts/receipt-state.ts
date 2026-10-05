import { ServiceReceiptAIStatus } from '@prisma/client';

/**
 * What may follow what, for a service receipt.
 *
 * The table below is the whole of the rule, and the two entries that matter most are the empty
 * ones. `VERIFIED` and `REJECTED` are terminal for the *machine*: no worker, no retry and no
 * later model run can move a record out of a state a person put it in. Only another human action
 * can (see `ADMIN_TRANSITIONS`), and that is a deliberate, audited re-opening rather than an AI
 * rerun quietly changing its mind (§14, §29).
 *
 * Keeping this as data rather than scattered `if` statements means the guarantee can be read in
 * one place, and tested exhaustively.
 */
const TRANSITIONS: Record<ServiceReceiptAIStatus, ServiceReceiptAIStatus[]> = {
  // Nothing has been attempted. A receipt arriving queues a job.
  NOT_PROCESSED: [ServiceReceiptAIStatus.QUEUED],
  // Queued, waiting for a worker.
  QUEUED: [ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.FAILED],
  // A worker holds it. Either it produces an extraction or it does not.
  PROCESSING: [
    ServiceReceiptAIStatus.SUCCEEDED,
    ServiceReceiptAIStatus.NEEDS_REVIEW,
    ServiceReceiptAIStatus.FAILED,
    ServiceReceiptAIStatus.RETRYING,
  ],
  // Extraction succeeded. Automation may only run it again; verifying or rejecting is a person's
  // act, and lives in ADMIN_TRANSITIONS below.
  SUCCEEDED: [ServiceReceiptAIStatus.QUEUED],
  NEEDS_REVIEW: [ServiceReceiptAIStatus.QUEUED],
  // Failed. A retry re-queues it.
  FAILED: [ServiceReceiptAIStatus.QUEUED],
  // Waiting for an automatic retry.
  RETRYING: [ServiceReceiptAIStatus.QUEUED, ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.FAILED],
  // A person verified this record. Nothing automatic may touch it again.
  VERIFIED: [],
  // A person judged the extraction unusable. Likewise.
  REJECTED: [],
};

/**
 * What a person may additionally do.
 *
 * Verifying and rejecting are only ever a person's acts — no automatic transition reaches either.
 * Beyond that, two things are true here that are not true of automatic processing. An administrator may
 * re-open a settled record — deliberately, with a reason, on the record — and an administrator may
 * settle a record while a run is queued or in flight. The second matters on an ordinary working
 * day: the office is holding the paper original, and a model job sitting in the queue is no reason
 * to stop them entering the figures. Nothing is weakened by allowing it, because the worker checks
 * `isHumanSettled` before it writes anything, so a job that lands afterwards is abandoned.
 */
const ADMIN_TRANSITIONS: Record<ServiceReceiptAIStatus, ServiceReceiptAIStatus[]> = {
  NOT_PROCESSED: [...TRANSITIONS.NOT_PROCESSED, ServiceReceiptAIStatus.VERIFIED, ServiceReceiptAIStatus.REJECTED],
  QUEUED: [...TRANSITIONS.QUEUED, ServiceReceiptAIStatus.VERIFIED, ServiceReceiptAIStatus.REJECTED],
  PROCESSING: [...TRANSITIONS.PROCESSING, ServiceReceiptAIStatus.VERIFIED, ServiceReceiptAIStatus.REJECTED],
  SUCCEEDED: [...TRANSITIONS.SUCCEEDED, ServiceReceiptAIStatus.VERIFIED, ServiceReceiptAIStatus.REJECTED],
  NEEDS_REVIEW: [...TRANSITIONS.NEEDS_REVIEW, ServiceReceiptAIStatus.VERIFIED, ServiceReceiptAIStatus.REJECTED],
  // Reading failed, but the office can still type the figures off the original and verify it.
  FAILED: [...TRANSITIONS.FAILED, ServiceReceiptAIStatus.VERIFIED, ServiceReceiptAIStatus.REJECTED],
  RETRYING: [...TRANSITIONS.RETRYING, ServiceReceiptAIStatus.VERIFIED, ServiceReceiptAIStatus.REJECTED],
  VERIFIED: [ServiceReceiptAIStatus.NEEDS_REVIEW, ServiceReceiptAIStatus.REJECTED],
  REJECTED: [ServiceReceiptAIStatus.NEEDS_REVIEW, ServiceReceiptAIStatus.VERIFIED],
};

export type TransitionActor = 'system' | 'admin';

export function canTransition(from: ServiceReceiptAIStatus, to: ServiceReceiptAIStatus, actor: TransitionActor = 'system'): boolean {
  const allowed = actor === 'admin' ? ADMIN_TRANSITIONS[from] : TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Whether a record is settled by a person, and therefore off limits to automatic processing.
 *
 * This is the single predicate the worker and the queue both consult before touching anything.
 */
export function isHumanSettled(status: ServiceReceiptAIStatus): boolean {
  return status === ServiceReceiptAIStatus.VERIFIED || status === ServiceReceiptAIStatus.REJECTED;
}

/** States from which queueing a new AI run is meaningful. */
export function canQueueProcessing(status: ServiceReceiptAIStatus): boolean {
  return !isHumanSettled(status) && status !== ServiceReceiptAIStatus.QUEUED && status !== ServiceReceiptAIStatus.PROCESSING;
}

/** States the office should be shown as needing attention. */
export const NEEDS_ATTENTION: ServiceReceiptAIStatus[] = [
  ServiceReceiptAIStatus.SUCCEEDED,
  ServiceReceiptAIStatus.NEEDS_REVIEW,
  ServiceReceiptAIStatus.FAILED,
];

/**
 * What a driver is told. Five plain states, none of which mention OCR, models or confidence (§33).
 *
 * The mapping is deliberately lossy: a driver who uploaded a photo needs to know whether the
 * office has it and whether anything is expected of them, not how it was read.
 */
export type DriverFacingReceiptState = 'uploaded' | 'processing' | 'needsReview' | 'verified' | 'failed';

export function toDriverFacingState(status: ServiceReceiptAIStatus): DriverFacingReceiptState {
  switch (status) {
    case ServiceReceiptAIStatus.NOT_PROCESSED:
      return 'uploaded';
    case ServiceReceiptAIStatus.QUEUED:
    case ServiceReceiptAIStatus.PROCESSING:
    case ServiceReceiptAIStatus.RETRYING:
      return 'processing';
    case ServiceReceiptAIStatus.SUCCEEDED:
    case ServiceReceiptAIStatus.NEEDS_REVIEW:
      // Both mean "with the office". A driver has nothing to do either way.
      return 'needsReview';
    case ServiceReceiptAIStatus.VERIFIED:
      return 'verified';
    case ServiceReceiptAIStatus.FAILED:
    case ServiceReceiptAIStatus.REJECTED:
      // Rejected extraction is not a rejected expense — the office simply entered it by hand.
      return 'failed';
  }
}

/**
 * Exponential backoff before a failed job is tried again.
 *
 * A provider that is down stays down for a while, so retrying every few seconds achieves nothing
 * except load. Capped, so a long-running outage does not push the next attempt past the point of
 * being useful.
 */
export function backoffMs(attempt: number, baseMs = 30_000, capMs = 15 * 60_000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
}
