import { BadRequestException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

/**
 * The payment state machine. Every status change goes through `assertTransition`; nothing
 * sets a status directly.
 *
 *   DRAFT ──submit──▶ PENDING_APPROVAL ──approve──▶ APPROVED ──record manual payment──▶ PAID
 *     │                    │                           │
 *     └──cancel──▶ CANCELLED ◀──cancel─────────────────┤
 *                                                      └──send──▶ STATUS_REVIEW_REQUIRED
 *
 *   Sending first CLAIMS the payment into STATUS_REVIEW_REQUIRED ("outcome not yet known") and
 *   stores the attempt's idempotency key, and only then calls the provider. A second click, a
 *   concurrent request or a crash mid-call therefore finds the payment already claimed and can
 *   never start another payout. The provider's answer then moves it on:
 *
 *   STATUS_REVIEW_REQUIRED ──provider──▶ PROCESSING | PAID | FAILED | CANCELLED | REVERSED
 *   (a timeout leaves it in STATUS_REVIEW_REQUIRED until a status check or a webhook resolves it)
 *
 *   PROCESSING ──provider──▶ PAID | FAILED | CANCELLED | REVERSED
 *   PAID ───────provider──▶ REVERSED            (money returned by the bank)
 *   FAILED ─────retry─────▶ STATUS_REVIEW_REQUIRED  (a NEW attempt with a NEW idempotency key)
 *   FAILED ─────cancel────▶ CANCELLED
 *
 * Who may cause a transition matters as much as the transition itself:
 *  - OFFICE transitions come from an admin action.
 *  - PROVIDER transitions come only from a verified webhook or a provider status check, never
 *    from a client. Once a real payout exists, its outcome is the provider's to decide.
 */

export type Actor = 'OFFICE' | 'PROVIDER';

const S = PaymentStatus;

const TRANSITIONS: Record<PaymentStatus, Partial<Record<PaymentStatus, Actor[]>>> = {
  [S.DRAFT]: { [S.PENDING_APPROVAL]: ['OFFICE'], [S.CANCELLED]: ['OFFICE'] },
  [S.PENDING_APPROVAL]: { [S.APPROVED]: ['OFFICE'], [S.CANCELLED]: ['OFFICE'] },
  [S.APPROVED]: {
    [S.STATUS_REVIEW_REQUIRED]: ['OFFICE'], // send: claimed before the provider is called
    [S.PAID]: ['OFFICE'], // a manual payment recorded by the office (never for RazorpayX)
    [S.CANCELLED]: ['OFFICE'],
  },
  [S.PROCESSING]: { [S.PAID]: ['PROVIDER'], [S.FAILED]: ['PROVIDER'], [S.CANCELLED]: ['PROVIDER'], [S.REVERSED]: ['PROVIDER'] },
  [S.STATUS_REVIEW_REQUIRED]: {
    [S.PROCESSING]: ['PROVIDER'],
    [S.PAID]: ['PROVIDER'],
    [S.FAILED]: ['PROVIDER'],
    [S.CANCELLED]: ['PROVIDER'],
    [S.REVERSED]: ['PROVIDER'],
  },
  [S.PAID]: { [S.REVERSED]: ['PROVIDER'] },
  [S.FAILED]: { [S.STATUS_REVIEW_REQUIRED]: ['OFFICE'], [S.CANCELLED]: ['OFFICE'] },
  [S.CANCELLED]: {},
  [S.REVERSED]: {},
};

/** A 400 at the API: the request is valid, but not for a payment in this state. */
export class InvalidTransitionError extends BadRequestException {
  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
    readonly actor: Actor,
  ) {
    super(`A payment cannot move from ${from} to ${to}${actor === 'OFFICE' ? ' by an office action' : ''}.`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: PaymentStatus, to: PaymentStatus, actor: Actor): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) throw new InvalidTransitionError(from, to, actor);
}

/** Statuses from which a provider payout may already exist. */
export const PAYOUT_MAY_EXIST: PaymentStatus[] = [S.PROCESSING, S.STATUS_REVIEW_REQUIRED, S.PAID, S.REVERSED];

export const TERMINAL: PaymentStatus[] = [S.CANCELLED, S.REVERSED];

/** Every transition, for documentation and tests. */
export const ALL_TRANSITIONS = Object.entries(TRANSITIONS).flatMap(([from, targets]) =>
  Object.entries(targets).map(([to, actors]) => ({ from: from as PaymentStatus, to: to as PaymentStatus, actors: actors as Actor[] })),
);
