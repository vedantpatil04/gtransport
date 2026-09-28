import { PaymentStatus } from '@prisma/client';
import { ALL_TRANSITIONS, assertTransition, canTransition, InvalidTransitionError, TERMINAL } from './payment-state';

const S = PaymentStatus;

describe('payment state machine', () => {
  it('follows the happy path for a RazorpayX payout', () => {
    for (const [from, to, actor] of [
      [S.DRAFT, S.PENDING_APPROVAL, 'OFFICE'],
      [S.PENDING_APPROVAL, S.APPROVED, 'OFFICE'],
      [S.APPROVED, S.STATUS_REVIEW_REQUIRED, 'OFFICE'],
      [S.STATUS_REVIEW_REQUIRED, S.PROCESSING, 'PROVIDER'],
      [S.PROCESSING, S.PAID, 'PROVIDER'],
    ] as const) {
      expect(canTransition(from, to, actor)).toBe(true);
    }
  });

  it('never lets the office mark an in-flight payout as paid, failed or reversed', () => {
    for (const to of [S.PAID, S.FAILED, S.REVERSED, S.CANCELLED]) {
      expect(canTransition(S.PROCESSING, to, 'OFFICE')).toBe(false);
    }
    expect(canTransition(S.PAID, S.REVERSED, 'OFFICE')).toBe(false);
  });

  it('never lets a provider event approve or send a payment', () => {
    expect(canTransition(S.PENDING_APPROVAL, S.APPROVED, 'PROVIDER')).toBe(false);
    expect(canTransition(S.APPROVED, S.STATUS_REVIEW_REQUIRED, 'PROVIDER')).toBe(false);
  });

  it('cannot skip approval', () => {
    expect(canTransition(S.DRAFT, S.PROCESSING, 'OFFICE')).toBe(false);
    expect(canTransition(S.DRAFT, S.PAID, 'OFFICE')).toBe(false);
    expect(canTransition(S.PENDING_APPROVAL, S.PROCESSING, 'OFFICE')).toBe(false);
  });

  it('only retries after a definitive failure, never from an unknown outcome', () => {
    expect(canTransition(S.FAILED, S.STATUS_REVIEW_REQUIRED, 'OFFICE')).toBe(true);
    // A claimed or unknown payment can never be claimed again by the office.
    expect(canTransition(S.STATUS_REVIEW_REQUIRED, S.STATUS_REVIEW_REQUIRED, 'OFFICE')).toBe(false);
    expect(canTransition(S.STATUS_REVIEW_REQUIRED, S.PROCESSING, 'OFFICE')).toBe(false);
    expect(canTransition(S.PROCESSING, S.STATUS_REVIEW_REQUIRED, 'OFFICE')).toBe(false);
  });

  it('resolves an unknown outcome only from the provider', () => {
    expect(canTransition(S.STATUS_REVIEW_REQUIRED, S.PAID, 'PROVIDER')).toBe(true);
    expect(canTransition(S.STATUS_REVIEW_REQUIRED, S.PAID, 'OFFICE')).toBe(false);
    expect(canTransition(S.STATUS_REVIEW_REQUIRED, S.FAILED, 'OFFICE')).toBe(false);
  });

  it('treats cancelled and reversed as final', () => {
    for (const from of TERMINAL) {
      expect(ALL_TRANSITIONS.filter((t) => t.from === from)).toEqual([]);
    }
  });

  it('names the illegal move in the error', () => {
    expect(() => assertTransition(S.PAID, S.DRAFT, 'OFFICE')).toThrow(InvalidTransitionError);
    expect(() => assertTransition(S.PAID, S.DRAFT, 'OFFICE')).toThrow(/PAID to DRAFT/);
  });
});
