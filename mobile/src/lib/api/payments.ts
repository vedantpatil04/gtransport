import type { Page } from '../../types/domain';
import { apiRequest } from './client';

/**
 * The driver's own payments. The server decides whose payments these are from the session —
 * the app never sends an employee id — and hides provider internals (payout ids, keys).
 * Payments are read-only here and need the network: nothing about money is queued offline.
 */

export type PaymentType = 'SALARY' | 'ADVANCE' | 'ALLOWANCE' | 'OTHER';
export type PaymentStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PROCESSING' | 'STATUS_REVIEW_REQUIRED' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REVERSED';
export type PaymentMethod = 'UPI' | 'BANK_TRANSFER' | 'CASH' | 'OTHER';

export interface DriverPayment {
  id: string;
  type: PaymentType;
  /** Two-decimal rupee string, e.g. "23999.75". */
  amount: string;
  status: PaymentStatus;
  method: PaymentMethod;
  description: string | null;
  /** "2026-09" for a salary. */
  payPeriod: string | null;
  /** Bank reference, only once the money has arrived. */
  utr: string | null;
  /** Masked destination, e.g. "A/c XXXX9012 · SBIN0001234". */
  recipientSummary: string | null;
  createdAt: string;
  paidAt: string | null;
}

export const paymentsApi = {
  mine: (token: string, query: { cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    const qs = params.toString();
    return apiRequest<Page<DriverPayment>>(`/payments/mine${qs ? `?${qs}` : ''}`, { token });
  },
};

/**
 * What a driver needs to know, in their words. Internal steps (approved, sent, awaiting a
 * status check) are all simply "processing"; paid is "received".
 */
export type DriverPaymentState = 'received' | 'processing' | 'pending' | 'failed' | 'cancelled' | 'returned';

export function driverPaymentState(status: PaymentStatus): DriverPaymentState {
  switch (status) {
    case 'PAID':
      return 'received';
    case 'APPROVED':
    case 'PROCESSING':
    case 'STATUS_REVIEW_REQUIRED':
      return 'processing';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'REVERSED':
      return 'returned';
    case 'DRAFT':
    case 'PENDING_APPROVAL':
    default:
      return 'pending';
  }
}

/** Kept here for existing imports; the formatter itself is shared app-wide in lib/format. */
export { rupees } from '../format';
