import { ServiceReceiptAIStatus } from '@prisma/client';
import { backoffMs, canQueueProcessing, canTransition, isHumanSettled, NEEDS_ATTENTION, toDriverFacingState } from './receipt-state';

/**
 * The guarantee this file protects is the one Phase 7 is built around: once a person has decided,
 * no amount of automation may change their mind. Everything below is a way of asking that
 * question from a different angle.
 */

const ALL = Object.values(ServiceReceiptAIStatus);

describe('protecting a verified record', () => {
  it('lets no automatic transition out of CONFIRMED', () => {
    // The important assertion in the whole suite: a rerun against a newer model, a retry, a
    // worker picking up a stale job — none of them can move a confirmed record.
    for (const target of ALL) {
      expect(canTransition(ServiceReceiptAIStatus.CONFIRMED, target, 'system')).toBe(false);
    }
  });

  it('lets no automatic transition out of REJECTED either', () => {
    for (const target of ALL) {
      expect(canTransition(ServiceReceiptAIStatus.REJECTED, target, 'system')).toBe(false);
    }
  });

  it('treats both human decisions as settled', () => {
    expect(isHumanSettled(ServiceReceiptAIStatus.CONFIRMED)).toBe(true);
    expect(isHumanSettled(ServiceReceiptAIStatus.REJECTED)).toBe(true);
    for (const status of ALL.filter((s) => s !== 'CONFIRMED' && s !== 'REJECTED')) {
      expect(isHumanSettled(status)).toBe(false);
    }
  });

  it('never queues processing for a settled record', () => {
    expect(canQueueProcessing(ServiceReceiptAIStatus.CONFIRMED)).toBe(false);
    expect(canQueueProcessing(ServiceReceiptAIStatus.REJECTED)).toBe(false);
  });

  it('lets an administrator settle a record while a run is still queued', () => {
    // The office holds the paper original. A model job waiting in the queue is no reason to stop
    // them entering the figures — and the worker abandons the job when it finds the record settled.
    for (const from of [
      ServiceReceiptAIStatus.NOT_PROCESSED,
      ServiceReceiptAIStatus.PENDING,
      ServiceReceiptAIStatus.PROCESSING,
      ServiceReceiptAIStatus.RETRYING,
    ]) {
      expect(canTransition(from, ServiceReceiptAIStatus.CONFIRMED, 'admin')).toBe(true);
      expect(canTransition(from, ServiceReceiptAIStatus.REJECTED, 'admin')).toBe(true);
      // Automatic processing still cannot: only a person may settle a record.
      expect(canTransition(from, ServiceReceiptAIStatus.CONFIRMED, 'system')).toBe(false);
      expect(canTransition(from, ServiceReceiptAIStatus.REJECTED, 'system')).toBe(false);
    }
  });

  it('lets an administrator re-open one, because people make mistakes too', () => {
    // Allowed, but only as an explicit human act — which the service then demands a reason for.
    expect(canTransition(ServiceReceiptAIStatus.CONFIRMED, ServiceReceiptAIStatus.REVIEW_REQUIRED, 'admin')).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.REJECTED, ServiceReceiptAIStatus.CONFIRMED, 'admin')).toBe(true);
  });
});

describe('the processing lifecycle', () => {
  it('follows queue → process → outcome', () => {
    expect(canTransition(ServiceReceiptAIStatus.NOT_PROCESSED, ServiceReceiptAIStatus.PENDING)).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.PENDING, ServiceReceiptAIStatus.PROCESSING)).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.COMPLETED)).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.REVIEW_REQUIRED)).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.FAILED)).toBe(true);
  });

  it('cannot jump straight from queued to confirmed', () => {
    // There is no path to CONFIRMED that does not pass through a person looking at an extraction.
    expect(canTransition(ServiceReceiptAIStatus.PENDING, ServiceReceiptAIStatus.CONFIRMED)).toBe(false);
    expect(canTransition(ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.CONFIRMED)).toBe(false);
    expect(canTransition(ServiceReceiptAIStatus.NOT_PROCESSED, ServiceReceiptAIStatus.CONFIRMED)).toBe(false);
  });

  it('lets a failed receipt be retried or settled by hand', () => {
    expect(canTransition(ServiceReceiptAIStatus.FAILED, ServiceReceiptAIStatus.PENDING)).toBe(true);
    // Reading failed, but the office can still type the figures off the original and confirm it.
    expect(canTransition(ServiceReceiptAIStatus.FAILED, ServiceReceiptAIStatus.CONFIRMED)).toBe(true);
  });

  it('does not queue a receipt already being processed', () => {
    expect(canQueueProcessing(ServiceReceiptAIStatus.PENDING)).toBe(false);
    expect(canQueueProcessing(ServiceReceiptAIStatus.PROCESSING)).toBe(false);
    expect(canQueueProcessing(ServiceReceiptAIStatus.FAILED)).toBe(true);
    expect(canQueueProcessing(ServiceReceiptAIStatus.REVIEW_REQUIRED)).toBe(true);
  });

  it('lists exactly the states needing someone', () => {
    expect(NEEDS_ATTENTION).toEqual([
      ServiceReceiptAIStatus.COMPLETED,
      ServiceReceiptAIStatus.REVIEW_REQUIRED,
      ServiceReceiptAIStatus.FAILED,
    ]);
    // A completed extraction still needs a person: "the model finished" is not "the office agreed".
    expect(NEEDS_ATTENTION).toContain(ServiceReceiptAIStatus.COMPLETED);
  });
});

describe('what the driver is told', () => {
  it('collapses the office vocabulary into five plain states', () => {
    expect(toDriverFacingState(ServiceReceiptAIStatus.NOT_PROCESSED)).toBe('uploaded');
    expect(toDriverFacingState(ServiceReceiptAIStatus.PENDING)).toBe('processing');
    expect(toDriverFacingState(ServiceReceiptAIStatus.PROCESSING)).toBe('processing');
    expect(toDriverFacingState(ServiceReceiptAIStatus.RETRYING)).toBe('processing');
    expect(toDriverFacingState(ServiceReceiptAIStatus.CONFIRMED)).toBe('verified');
  });

  it('tells a driver nothing about confidence or review routing', () => {
    // COMPLETED and REVIEW_REQUIRED differ only in how much checking the office must do. A
    // driver has nothing to act on either way, so they see one thing.
    expect(toDriverFacingState(ServiceReceiptAIStatus.COMPLETED)).toBe('needsReview');
    expect(toDriverFacingState(ServiceReceiptAIStatus.REVIEW_REQUIRED)).toBe('needsReview');
  });

  it('does not tell a driver their expense was rejected, because it was not', () => {
    // REJECTED means the office could not use the extraction and typed the figures instead.
    // Showing a driver "rejected" would suggest their claim was refused.
    expect(toDriverFacingState(ServiceReceiptAIStatus.REJECTED)).toBe('failed');
    expect(toDriverFacingState(ServiceReceiptAIStatus.FAILED)).toBe('failed');
  });

  it('has an answer for every state, so no driver ever sees a blank', () => {
    for (const status of ALL) {
      expect(['uploaded', 'processing', 'needsReview', 'verified', 'failed']).toContain(toDriverFacingState(status));
    }
  });
});

describe('retry backoff', () => {
  it('grows with each attempt, so a provider that is down is not hammered', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
  });

  it('is capped, so a long outage does not push the next attempt out of sight', () => {
    expect(backoffMs(20)).toBe(15 * 60_000);
  });

  it('never returns a negative or zero delay', () => {
    expect(backoffMs(0)).toBeGreaterThan(0);
    expect(backoffMs(-5)).toBeGreaterThan(0);
  });
});
