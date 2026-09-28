import { ServiceReceiptAIStatus } from '@prisma/client';

/**
 * What may follow what, for a service receipt.
 *
 * The table below is the whole of the rule, and the two entries that matter most are the empty
 * ones. `CONFIRMED` and `REJECTED` are terminal for the *machine*: no worker, no retry and no
 * later model run can move a record out of a state a person put it in. Only another human action
 * can (see `ADMIN_TRANSITIONS`), and that is a deliberate, audited re-opening rather than an AI
 * rerun quietly changing its mind (§14, §29).
 *
 * Keeping this as data rather than scattered `if` statements means the guarantee can be read in
 * one place, and tested exhaustively.
 */
const TRANSITIONS: Record<ServiceReceiptAIStatus, ServiceReceiptAIStatus[]> = {
  // Nothing has been attempted. A receipt arriving queues a job.
  NOT_PROCESSED: [ServiceReceiptAIStatus.PENDING],
  // Queued, waiting for a worker.
  PENDING: [ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.FAILED],
  // A worker holds it. Either it produces an extraction or it does not.
  PROCESSING: [
    ServiceReceiptAIStatus.COMPLETED,
    ServiceReceiptAIStatus.REVIEW_REQUIRED,
    ServiceReceiptAIStatus.FAILED,
    ServiceReceiptAIStatus.RETRYING,
  ],
  // Extraction succeeded. A person confirms, rejects, or asks for another run.
  COMPLETED: [ServiceReceiptAIStatus.CONFIRMED, ServiceReceiptAIStatus.REJECTED, ServiceReceiptAIStatus.PENDING],
  REVIEW_REQUIRED: [ServiceReceiptAIStatus.CONFIRMED, ServiceReceiptAIStatus.REJECTED, ServiceReceiptAIStatus.PENDING],
  // Failed. A retry re-queues it; a person may also give up and confirm the record by hand.
  FAILED: [ServiceReceiptAIStatus.PENDING, ServiceReceiptAIStatus.CONFIRMED, ServiceReceiptAIStatus.REJECTED],
  // Waiting for an automatic retry.
  RETRYING: [ServiceReceiptAIStatus.PENDING, ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.FAILED],
  // A person confirmed this record. Nothing automatic may touch it again.
  CONFIRMED: [],
  // A person judged the extraction unusable. Likewise.
  REJECTED: [],
};

/**
 * What an administrator may do that the machine may not.
 *
 * Re-opening a confirmed record is allowed — people do make mistakes, and refusing to ever
 * re-examine one would be worse than allowing it — but it is an explicit, audited act by a named
 * person, not a side effect of a model running again.
 */
/**
 * What a person may additionally do.
 *
 * Two things are true here that are not true of automatic processing. An administrator may
 * re-open a settled record — deliberately, with a reason, on the record — and an administrator may
 * settle a record while a run is queued or in flight. The second matters on an ordinary working
 * day: the office is holding the paper original, and a model job sitting in the queue is no reason
 * to stop them entering the figures. Nothing is weakened by allowing it, because the worker checks
 * `isHumanSettled` before it writes anything, so a job that lands afterwards is abandoned.
 */
const ADMIN_TRANSITIONS: Record<ServiceReceiptAIStatus, ServiceReceiptAIStatus[]> = {
  ...TRANSITIONS,
  NOT_PROCESSED: [...TRANSITIONS.NOT_PROCESSED, ServiceReceiptAIStatus.CONFIRMED, ServiceReceiptAIStatus.REJECTED],
  PENDING: [...TRANSITIONS.PENDING, ServiceReceiptAIStatus.CONFIRMED, ServiceReceiptAIStatus.REJECTED],
  PROCESSING: [...TRANSITIONS.PROCESSING, ServiceReceiptAIStatus.CONFIRMED, ServiceReceiptAIStatus.REJECTED],
  RETRYING: [...TRANSITIONS.RETRYING, ServiceReceiptAIStatus.CONFIRMED, ServiceReceiptAIStatus.REJECTED],
  CONFIRMED: [ServiceReceiptAIStatus.REVIEW_REQUIRED, ServiceReceiptAIStatus.REJECTED],
  REJECTED: [ServiceReceiptAIStatus.REVIEW_REQUIRED, ServiceReceiptAIStatus.CONFIRMED],
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
  return status === ServiceReceiptAIStatus.CONFIRMED || status === ServiceReceiptAIStatus.REJECTED;
}

/** States from which queueing a new AI run is meaningful. */
export function canQueueProcessing(status: ServiceReceiptAIStatus): boolean {
  return !isHumanSettled(status) && status !== ServiceReceiptAIStatus.PENDING && status !== ServiceReceiptAIStatus.PROCESSING;
}

/** States the office should be shown as needing attention. */
export const NEEDS_ATTENTION: ServiceReceiptAIStatus[] = [
  ServiceReceiptAIStatus.COMPLETED,
  ServiceReceiptAIStatus.REVIEW_REQUIRED,
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
    case ServiceReceiptAIStatus.PENDING:
    case ServiceReceiptAIStatus.PROCESSING:
    case ServiceReceiptAIStatus.RETRYING:
      return 'processing';
    case ServiceReceiptAIStatus.COMPLETED:
    case ServiceReceiptAIStatus.REVIEW_REQUIRED:
      // Both mean "with the office". A driver has nothing to do either way.
      return 'needsReview';
    case ServiceReceiptAIStatus.CONFIRMED:
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
