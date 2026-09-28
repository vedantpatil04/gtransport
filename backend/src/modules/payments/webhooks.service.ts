import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PaymentProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PAYOUT_PROVIDER, type PayoutProvider } from './payment-providers';
import { PaymentsService } from './payments.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENSITIVE_KEYS = new Set(['fund_account', 'bank_account', 'vpa', 'account_number', 'card', 'contact']);

/** Keeps the webhook for audit without the payee's account details. */
function sanitise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEYS.has(key)).map(([key, v]) => [key, sanitise(v)]));
  }
  return value;
}

/**
 * RazorpayX payout webhooks.
 *
 *  1. The signature is checked against the raw bytes before anything is trusted.
 *  2. The event id makes processing idempotent: a redelivered event is recognised and skipped.
 *     An event that was stored but failed mid-processing is processed again on redelivery.
 *  3. The payment moves only along transitions the state machine allows the provider, so an
 *     event arriving out of order can never move a payment backwards.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('PayoutWebhooks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {}

  async handleRazorpayX(rawBody: Buffer | undefined, signature: string | undefined, eventId: string | undefined): Promise<{ status: string }> {
    if (!rawBody || !this.provider.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Rejected a payout webhook with a missing or invalid signature');
      throw new UnauthorizedException('Invalid signature.');
    }
    if (!eventId) throw new BadRequestException('Missing x-razorpay-event-id.');

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid JSON.');
    }
    const parsed = this.provider.parseWebhook(body);
    const eventType = (body as { event?: string })?.event ?? 'unknown';

    let event = await this.prisma.paymentProviderEvent.findUnique({ where: { provider_eventId: { provider: PaymentProvider.RAZORPAYX, eventId } } });
    if (event?.processedAt) return { status: 'duplicate' };
    if (!event) {
      try {
        event = await this.prisma.paymentProviderEvent.create({
          data: { provider: PaymentProvider.RAZORPAYX, eventId, eventType, providerReference: parsed?.providerReference ?? null, payload: sanitise(body) as Prisma.InputJsonValue },
        });
      } catch (error) {
        // A concurrent delivery of the same event got there first.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { status: 'duplicate' };
        throw error;
      }
    }

    if (!parsed) return this.finish(event.id, null, 'ignored');

    const payment = await this.prisma.paymentRecord.findFirst({
      where: {
        OR: [
          { providerReference: parsed.providerReference },
          ...(parsed.referenceId && UUID.test(parsed.referenceId) ? [{ id: parsed.referenceId, provider: PaymentProvider.RAZORPAYX }] : []),
        ],
      },
      select: { id: true, status: true },
    });
    if (!payment) return this.finish(event.id, null, 'unknown_payout');

    const before = payment.status;
    const after = await this.payments.applyProviderResult(
      payment.id,
      { providerReference: parsed.providerReference, status: parsed.status, rawStatus: parsed.rawStatus, utr: parsed.utr, failureReason: parsed.failureReason },
      `webhook:${eventId}`,
    );
    return this.finish(event.id, payment.id, after.status === before && parsed.status !== 'PROCESSING' ? `ignored:${before}` : `applied:${after.status}`);
  }

  private async finish(eventId: string, paymentRecordId: string | null, outcome: string) {
    await this.prisma.paymentProviderEvent.update({ where: { id: eventId }, data: { paymentRecordId, outcome, processedAt: new Date() } });
    return { status: outcome };
  }
}
