import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PayoutOutcomeUnknownError, PayoutRejectedError,
  type FundAccountRequest, type ParsedWebhookEvent, type PayoutProvider, type PayoutRequest, type PayoutResult, type ProviderPayoutStatus,
} from '../payment-providers';

export interface RazorpayXConfig {
  baseUrl: string;
  keyId: string;
  keySecret: string;
  /** Our RazorpayX business account number — the account money leaves from. */
  accountNumber: string;
  webhookSecret: string;
  timeoutMs?: number;
}

/**
 * RazorpayX payouts over its REST API (server-to-server only; the keys never leave the backend).
 *
 * Idempotency: every payout request carries X-Payout-Idempotency. RazorpayX maps repeats of the
 * same key to one payout and returns its latest state, so a retry after a timeout is safe — as
 * long as it uses the SAME key and the SAME body, which the payments service guarantees.
 */
export class RazorpayXPayoutProvider implements PayoutProvider {
  readonly name = 'RAZORPAYX' as const;
  readonly enabled = true;
  private readonly logger = new Logger('RazorpayX');

  constructor(private readonly config: RazorpayXConfig) {}

  async createFundAccount(request: FundAccountRequest): Promise<{ contactId: string; fundAccountId: string }> {
    const contact = await this.call<{ id: string }>('POST', '/v1/contacts', {
      name: request.name,
      type: 'employee',
      reference_id: request.referenceId,
    });
    const fundAccount = await this.call<{ id: string }>(
      'POST',
      '/v1/fund_accounts',
      request.upi
        ? { contact_id: contact.id, account_type: 'vpa', vpa: { address: request.upi.address } }
        : {
            contact_id: contact.id,
            account_type: 'bank_account',
            bank_account: { name: request.name, ifsc: request.bankAccount?.ifsc, account_number: request.bankAccount?.accountNumber },
          },
    );
    return { contactId: contact.id, fundAccountId: fundAccount.id };
  }

  async createPayout(request: PayoutRequest): Promise<PayoutResult> {
    const body = {
      account_number: this.config.accountNumber,
      fund_account_id: request.fundAccountId,
      amount: toPaise(request.amount),
      currency: 'INR',
      mode: request.mode,
      purpose: request.purpose,
      queue_if_low_balance: true,
      reference_id: request.referenceId,
      narration: request.narration.slice(0, 30),
    };
    const payout = await this.call<RazorpayXPayout>('POST', '/v1/payouts', body, { 'X-Payout-Idempotency': request.idempotencyKey });
    return mapPayout(payout);
  }

  async getPayout(providerReference: string): Promise<PayoutResult> {
    return mapPayout(await this.call<RazorpayXPayout>('GET', `/v1/payouts/${encodeURIComponent(providerReference)}`));
  }

  /** HMAC-SHA256 of the raw body with the webhook secret, hex-encoded; compared in constant time. */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature || !this.config.webhookSecret) return false;
    const expected = createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(body: unknown): ParsedWebhookEvent | null {
    const event = body as { event?: string; payload?: { payout?: { entity?: RazorpayXPayout } } };
    const payout = event?.payload?.payout?.entity;
    if (typeof event?.event !== 'string' || !event.event.startsWith('payout.') || !payout?.id) return null;
    const mapped = mapPayout(payout);
    return {
      eventType: event.event,
      providerReference: mapped.providerReference,
      referenceId: payout.reference_id ?? null,
      status: mapped.status,
      rawStatus: mapped.rawStatus,
      utr: mapped.utr,
      failureReason: mapped.failureReason,
    };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 20_000);
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      // The request may have been received and acted on. We cannot know, so we do not guess.
      this.logger.warn(`${method} ${path}: no response (${(error as Error).name})`);
      throw new PayoutOutcomeUnknownError('RazorpayX did not respond; the payout status must be checked before anything else is done.');
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const parsed = safeJson(text) as T & { error?: { description?: string; code?: string } };

    if (response.status >= 500) {
      throw new PayoutOutcomeUnknownError(`RazorpayX returned ${response.status}; the payout status must be checked.`);
    }
    if (!response.ok) {
      // Never log the body: it can echo account details.
      this.logger.warn(`${method} ${path}: ${response.status} ${parsed?.error?.code ?? ''}`);
      if (response.status === 401) throw new ServiceUnavailableException('RazorpayX rejected the credentials.');
      throw new PayoutRejectedError(parsed?.error?.description ?? `RazorpayX refused the request (${response.status}).`);
    }
    return parsed;
  }
}

interface RazorpayXPayout {
  id: string;
  status: string;
  reference_id?: string | null;
  utr?: string | null;
  failure_reason?: string | null;
  status_details?: { description?: string | null; reason?: string | null } | null;
}

/**
 * RazorpayX statuses → ours. queued / pending / scheduled / processing are all "in flight";
 * rejected is a failure. Only `processed` means the money arrived.
 */
const STATUS: Record<string, ProviderPayoutStatus> = {
  queued: 'PROCESSING',
  pending: 'PROCESSING',
  scheduled: 'PROCESSING',
  processing: 'PROCESSING',
  processed: 'PAID',
  failed: 'FAILED',
  rejected: 'FAILED',
  cancelled: 'CANCELLED',
  reversed: 'REVERSED',
};

function mapPayout(payout: RazorpayXPayout): PayoutResult {
  const status = STATUS[payout.status];
  if (!status) {
    // An unrecognised status must never be treated as success or failure.
    throw new PayoutOutcomeUnknownError(`RazorpayX reported an unrecognised status "${payout.status}".`);
  }
  return {
    providerReference: payout.id,
    status,
    rawStatus: payout.status,
    utr: payout.utr ?? null,
    failureReason: payout.failure_reason ?? payout.status_details?.description ?? payout.status_details?.reason ?? null,
  };
}

/** Rupees (Decimal) → integer paise. Exact: rejects anything with more than 2 decimal places. */
export function toPaise(amount: Prisma.Decimal): number {
  const paise = amount.mul(100);
  if (!paise.isInteger()) throw new PayoutRejectedError('The amount has more than two decimal places.');
  if (paise.lt(100)) throw new PayoutRejectedError('RazorpayX payouts must be at least ₹1.');
  return paise.toNumber();
}

function safeJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** Used when no provider is configured: manual payments still work; payouts refuse clearly. */
export class DisabledPayoutProvider implements PayoutProvider {
  readonly name = 'NONE' as const;
  readonly enabled = false;
  private refuse(): never {
    throw new ServiceUnavailableException('Online payouts are not configured. Record the payment manually, or configure RazorpayX.');
  }
  createFundAccount(): Promise<{ contactId: string; fundAccountId: string }> {
    return this.refuse();
  }
  createPayout(): Promise<PayoutResult> {
    return this.refuse();
  }
  getPayout(): Promise<PayoutResult> {
    return this.refuse();
  }
  verifyWebhookSignature(): boolean {
    return false;
  }
  parseWebhook(): null {
    return null;
  }
}

