import { ServiceReceiptAIStatus } from '@prisma/client';
import { backoffMs, canQueueProcessing, canTransition, isHumanSettled, NEEDS_ATTENTION, toDriverFacingState } from './receipt-state';

/**
 * The guarantee this file protects is the one Phase 7 is built around: once a person has decided,
 * no amount of automation may change their mind. Everything below is a way of asking that
 * question from a different angle.
 */

const ALL = Object.values(ServiceReceiptAIStatus);

describe('protecting a verified record', () => {
  it('lets no automatic transition out of VERIFIED', () => {
    // The important assertion in the whole suite: a rerun against a newer model, a retry, a
    // worker picking up a stale job — none of them can move a confirmed record.
    for (const target of ALL) {
      expect(canTransition(ServiceReceiptAIStatus.VERIFIED, target, 'system')).toBe(false);
    }
  });

  it('lets no automatic transition out of REJECTED either', () => {
    for (const target of ALL) {
      expect(canTransition(ServiceReceiptAIStatus.REJECTED, target, 'system')).toBe(false);
    }
  });

  it('treats both human decisions as settled', () => {
    expect(isHumanSettled(ServiceReceiptAIStatus.VERIFIED)).toBe(true);
    expect(isHumanSettled(ServiceReceiptAIStatus.REJECTED)).toBe(true);
    for (const status of ALL.filter((s) => s !== 'VERIFIED' && s !== 'REJECTED')) {
      expect(isHumanSettled(status)).toBe(false);
    }
  });

  it('never queues processing for a settled record', () => {
    expect(canQueueProcessing(ServiceReceiptAIStatus.VERIFIED)).toBe(false);
    expect(canQueueProcessing(ServiceReceiptAIStatus.REJECTED)).toBe(false);
  });

  it('lets an administrator settle a record while a run is still queued', () => {
    // The office holds the paper original. A model job waiting in the queue is no reason to stop
    // them entering the figures — and the worker abandons the job when it finds the record settled.
    for (const from of [
      ServiceReceiptAIStatus.NOT_PROCESSED,
      ServiceReceiptAIStatus.QUEUED,
      ServiceReceiptAIStatus.PROCESSING,
      ServiceReceiptAIStatus.RETRYING,
    ]) {
      expect(canTransition(from, ServiceReceiptAIStatus.VERIFIED, 'admin')).toBe(true);
      expect(canTransition(from, ServiceReceiptAIStatus.REJECTED, 'admin')).toBe(true);
      // Automatic processing still cannot: only a person may settle a record.
      expect(canTransition(from, ServiceReceiptAIStatus.VERIFIED, 'system')).toBe(false);
      expect(canTransition(from, ServiceReceiptAIStatus.REJECTED, 'system')).toBe(false);
    }
  });

  it('lets an administrator re-open one, because people make mistakes too', () => {
    // Allowed, but only as an explicit human act — which the service then demands a reason for.
    expect(canTransition(ServiceReceiptAIStatus.VERIFIED, ServiceReceiptAIStatus.NEEDS_REVIEW, 'admin')).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.REJECTED, ServiceReceiptAIStatus.VERIFIED, 'admin')).toBe(true);
  });
});

describe('the processing lifecycle', () => {
  it('follows queue → process → outcome', () => {
    expect(canTransition(ServiceReceiptAIStatus.NOT_PROCESSED, ServiceReceiptAIStatus.QUEUED)).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.QUEUED, ServiceReceiptAIStatus.PROCESSING)).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.SUCCEEDED)).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.NEEDS_REVIEW)).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.FAILED)).toBe(true);
  });

  it('cannot jump straight from queued to confirmed', () => {
    // There is no path to VERIFIED that does not pass through a person looking at an extraction.
    expect(canTransition(ServiceReceiptAIStatus.QUEUED, ServiceReceiptAIStatus.VERIFIED)).toBe(false);
    expect(canTransition(ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.VERIFIED)).toBe(false);
    expect(canTransition(ServiceReceiptAIStatus.NOT_PROCESSED, ServiceReceiptAIStatus.VERIFIED)).toBe(false);
  });

  it('lets a failed receipt be retried or settled by hand', () => {
    expect(canTransition(ServiceReceiptAIStatus.FAILED, ServiceReceiptAIStatus.QUEUED)).toBe(true);
    // Reading failed, but the office can still type the figures off the original and verify it.
    expect(canTransition(ServiceReceiptAIStatus.FAILED, ServiceReceiptAIStatus.VERIFIED, 'admin')).toBe(true);
    expect(canTransition(ServiceReceiptAIStatus.FAILED, ServiceReceiptAIStatus.VERIFIED, 'system')).toBe(false);
  });

  it('does not queue a receipt already being processed', () => {
    expect(canQueueProcessing(ServiceReceiptAIStatus.QUEUED)).toBe(false);
    expect(canQueueProcessing(ServiceReceiptAIStatus.PROCESSING)).toBe(false);
    expect(canQueueProcessing(ServiceReceiptAIStatus.FAILED)).toBe(true);
    expect(canQueueProcessing(ServiceReceiptAIStatus.NEEDS_REVIEW)).toBe(true);
  });

  it('lists exactly the states needing someone', () => {
    expect(NEEDS_ATTENTION).toEqual([
      ServiceReceiptAIStatus.SUCCEEDED,
      ServiceReceiptAIStatus.NEEDS_REVIEW,
      ServiceReceiptAIStatus.FAILED,
    ]);
    // A completed extraction still needs a person: "the model finished" is not "the office agreed".
    expect(NEEDS_ATTENTION).toContain(ServiceReceiptAIStatus.SUCCEEDED);
  });
});

describe('what the driver is told', () => {
  it('collapses the office vocabulary into five plain states', () => {
    expect(toDriverFacingState(ServiceReceiptAIStatus.NOT_PROCESSED)).toBe('uploaded');
    expect(toDriverFacingState(ServiceReceiptAIStatus.QUEUED)).toBe('processing');
    expect(toDriverFacingState(ServiceReceiptAIStatus.PROCESSING)).toBe('processing');
    expect(toDriverFacingState(ServiceReceiptAIStatus.RETRYING)).toBe('processing');
    expect(toDriverFacingState(ServiceReceiptAIStatus.VERIFIED)).toBe('verified');
  });

  it('tells a driver nothing about confidence or review routing', () => {
    // SUCCEEDED and NEEDS_REVIEW differ only in how much checking the office must do. A
    // driver has nothing to act on either way, so they see one thing.
    expect(toDriverFacingState(ServiceReceiptAIStatus.SUCCEEDED)).toBe('needsReview');
    expect(toDriverFacingState(ServiceReceiptAIStatus.NEEDS_REVIEW)).toBe('needsReview');
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

describe('the explicit Phase 7 states', () => {
  it('is exactly the agreed vocabulary, no more and no fewer', () => {
    expect([...ALL].sort()).toEqual([
      'FAILED', 'NEEDS_REVIEW', 'NOT_PROCESSED', 'PROCESSING', 'QUEUED', 'REJECTED', 'RETRYING', 'SUCCEEDED', 'VERIFIED',
    ]);
  });

  it('reaches VERIFIED only through a person', () => {
    for (const from of ALL) expect(canTransition(from, ServiceReceiptAIStatus.VERIFIED, 'system')).toBe(false);
  });
});
