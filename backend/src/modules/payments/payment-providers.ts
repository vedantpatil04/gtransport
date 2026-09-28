import type { Prisma } from '@prisma/client';

/**
 * Payment provider boundaries. Two different jobs, deliberately kept apart:
 *
 *  - PayoutProvider:          Gangamata → driver / employee (salaries, advances). RazorpayX.
 *  - PaymentGatewayProvider:  customer → Gangamata (online collection). Razorpay Payment Gateway.
 *
 * Business logic depends only on these interfaces, never on a provider SDK or URL, so another
 * provider can be added without touching the finance domain. Fees are never assumed here:
 * provider pricing is a commercial term of the merchant account, not a constant in code.
 */

/** A payout's state as reported by the provider, in our vocabulary. */
export type ProviderPayoutStatus = 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REVERSED';

export interface PayoutRequest {
  /** Stable per attempt; the provider uses it to recognise retries of the same payout. */
  idempotencyKey: string;
  amount: Prisma.Decimal;
  fundAccountId: string;
  mode: 'IMPS' | 'NEFT' | 'UPI';
  purpose: 'salary' | 'payout';
  /** Our payment id, echoed back by the provider for reconciliation. */
  referenceId: string;
  narration: string;
}

export interface PayoutResult {
  providerReference: string;
  status: ProviderPayoutStatus;
  /** The provider's own status word, kept for audit. */
  rawStatus: string;
  utr: string | null;
  failureReason: string | null;
}

export interface FundAccountRequest {
  name: string;
  /** Our employee id, stored by the provider on the contact. */
  referenceId: string;
  bankAccount?: { ifsc: string; accountNumber: string };
  upi?: { address: string };
}

export interface ParsedWebhookEvent {
  eventType: string;
  providerReference: string;
  /** Our payment id, echoed back — finds the payment even if we never stored the reference. */
  referenceId: string | null;
  status: ProviderPayoutStatus;
  rawStatus: string;
  utr: string | null;
  failureReason: string | null;
}

/**
 * The request may have reached the provider, but we could not learn the result (timeout,
 * dropped connection, 5xx). A payout may or may not exist. Never retried with a new key and
 * never assumed failed: the payment waits for a status check or a webhook.
 */
export class PayoutOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutOutcomeUnknownError';
  }
}

/** The provider definitively refused the request; no payout was created. */
export class PayoutRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutRejectedError';
  }
}

export interface PayoutProvider {
  readonly name: 'RAZORPAYX' | 'NONE';
  /** False when no credentials are configured: only manual payments are possible. */
  readonly enabled: boolean;
  createFundAccount(request: FundAccountRequest): Promise<{ contactId: string; fundAccountId: string }>;
  createPayout(request: PayoutRequest): Promise<PayoutResult>;
  getPayout(providerReference: string): Promise<PayoutResult>;
  /** Checks a webhook against the exact raw bytes the provider signed. */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  /** Extracts a payout update from a webhook body, or null for events we do not handle. */
  parseWebhook(body: unknown): ParsedWebhookEvent | null;
}

/** Customer collection. Not used yet: Gangamata does not currently take online payments. */
export interface PaymentGatewayProvider {
  readonly name: string;
  createPaymentLink(input: { amount: Prisma.Decimal; reference: string; description: string }): Promise<{ url: string; providerReference: string }>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
}

export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');
