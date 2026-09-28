import type { PaymentRow } from './payments.service';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Office view: full status detail, masked destination, provider reference for reconciliation. */
export function presentPayment(p: PaymentRow) {
  return {
    id: p.id,
    employee: p.employee,
    type: p.type,
    amount: p.amount.toFixed(2),
    status: p.status,
    method: p.method,
    provider: p.provider,
    description: p.description,
    salary: p.salaryRecord ? { id: p.salaryRecord.id, payPeriod: p.salaryRecord.payPeriod.toISOString().slice(0, 7) } : null,
    advance: p.advance ? { id: p.advance.id, type: p.advance.type, advanceDate: p.advance.advanceDate.toISOString().slice(0, 10) } : null,
    attempt: p.attempt,
    providerReference: p.providerReference,
    providerStatus: p.providerStatus,
    paymentReference: p.paymentReference,
    recipientSummary: p.recipientSummary,
    failureReason: p.failureReason,
    submittedAt: iso(p.submittedAt),
    approvedAt: iso(p.approvedAt),
    sentAt: iso(p.sentAt),
    paidAt: iso(p.paidAt),
    failedAt: iso(p.failedAt),
    cancelledAt: iso(p.cancelledAt),
    reversedAt: iso(p.reversedAt),
    createdAt: iso(p.createdAt),
  };
}

/**
 * Driver view: their own payment and nothing about the machinery behind it — no provider ids,
 * idempotency keys or internal failure detail. The UTR is kept: it is their proof of payment.
 */
export function presentDriverPayment(p: PaymentRow) {
  return {
    id: p.id,
    type: p.type,
    amount: p.amount.toFixed(2),
    status: p.status,
    method: p.method,
    description: p.description,
    payPeriod: p.salaryRecord ? p.salaryRecord.payPeriod.toISOString().slice(0, 7) : null,
    utr: p.status === 'PAID' ? p.paymentReference : null,
    recipientSummary: p.recipientSummary,
    createdAt: iso(p.createdAt),
    paidAt: iso(p.paidAt),
  };
}
