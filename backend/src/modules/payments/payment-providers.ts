/**
 * Payment execution contracts. Kept behind interfaces so RazorpayX (payouts to drivers) and
 * Razorpay (inbound customer payments) can be added without business modules importing a
 * vendor SDK. No Razorpay integration exists in Phase 0.
 */
export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';

export interface PayoutRequest {
  /** Caller-generated idempotency key; retries must never pay twice. */
  idempotencyKey: string;
  amount: string;
  currency: 'INR';
  beneficiaryRef: string;
  narration?: string;
}

export interface PayoutResult {
  providerReference: string;
  status: PayoutStatus;
}

/** Outbound money: salaries, advances and reimbursements paid to employees. */
export interface PayoutProvider {
  readonly name: string;
  createPayout(request: PayoutRequest): Promise<PayoutResult>;
  getPayout(providerReference: string): Promise<PayoutResult>;
}

/** Inbound money: customer payments against invoices. */
export interface PaymentGateway {
  readonly name: string;
  createPaymentLink(input: { amount: string; currency: 'INR'; reference: string }): Promise<{ url: string; providerReference: string }>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}
