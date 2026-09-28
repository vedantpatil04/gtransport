import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AdvanceStatus, FinanceEventType, LedgerSourceType, PaymentMethod, PaymentProvider, PaymentStatus, PaymentType, Prisma, SalaryStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { toPage, type Page } from '../../common/pagination/pagination';
import { requireDriverScope } from '../auth/access-scope';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { LedgerService } from '../finance/ledger.service';
import { monthStart, todayInIndia } from '../../common/dates/financial-year';
import { pastOrTodayDate } from '../../common/dates/request-dates';
import {
  PAYOUT_PROVIDER, PayoutOutcomeUnknownError, PayoutRejectedError,
  type PayoutProvider, type PayoutResult, type ProviderPayoutStatus,
} from './payment-providers';
import { assertTransition, canTransition } from './payment-state';

type Tx = Prisma.TransactionClient;

export const PAYMENT_VIEW = {
  id: true,
  employeeId: true,
  type: true,
  amount: true,
  status: true,
  method: true,
  provider: true,
  salaryRecordId: true,
  advanceId: true,
  description: true,
  attempt: true,
  providerReference: true,
  providerStatus: true,
  paymentReference: true,
  recipientSummary: true,
  failureReason: true,
  submittedAt: true,
  approvedAt: true,
  sentAt: true,
  paidAt: true,
  failedAt: true,
  cancelledAt: true,
  reversedAt: true,
  createdAt: true,
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  salaryRecord: { select: { id: true, payPeriod: true } },
  advance: { select: { id: true, type: true, advanceDate: true } },
} as const;

export type PaymentRow = Prisma.PaymentRecordGetPayload<{ select: typeof PAYMENT_VIEW }>;

const PROVIDER_TO_STATUS: Record<ProviderPayoutStatus, PaymentStatus> = {
  PROCESSING: PaymentStatus.PROCESSING,
  PAID: PaymentStatus.PAID,
  FAILED: PaymentStatus.FAILED,
  CANCELLED: PaymentStatus.CANCELLED,
  REVERSED: PaymentStatus.REVERSED,
};

const EVENT_FOR: Partial<Record<PaymentStatus, FinanceEventType>> = {
  PROCESSING: FinanceEventType.PAYMENT_PROCESSING,
  PAID: FinanceEventType.PAYMENT_PAID,
  FAILED: FinanceEventType.PAYMENT_FAILED,
  REVERSED: FinanceEventType.PAYMENT_REVERSED,
};

export interface CreatePaymentInput {
  employeeId: string;
  type: PaymentType;
  method: PaymentMethod;
  provider: PaymentProvider;
  salaryRecordId?: string;
  advanceId?: string;
  amount?: number;
  description?: string;
}

/**
 * Payments: the movement of money to employees and drivers.
 *
 * Every status change goes through the state machine (payment-state.ts). Office actions may
 * create, approve, send, cancel or record a manual payment; only the provider — through a
 * verified webhook or a status check — decides what happened to a real payout.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {}

  get payoutsEnabled(): boolean {
    return this.provider.enabled;
  }

  // ───────────────────────────── Create & approve ─────────────────────────────

  /**
   * Creates a payment awaiting approval. For a salary or an advance the amount is taken from
   * that record — never from the request — and the record's ledger line is linked to it.
   */
  async create(user: AuthenticatedUser, input: CreatePaymentInput): Promise<PaymentRow> {
    if (input.provider === PaymentProvider.RAZORPAY) throw new BadRequestException('Razorpay collects customer payments; use RazorpayX for payouts.');
    if (input.provider === PaymentProvider.RAZORPAYX && input.method === PaymentMethod.CASH) {
      throw new BadRequestException('Cash payments are recorded manually, not sent through RazorpayX.');
    }

    const employee = await this.prisma.employee.findFirst({ where: { id: input.employeeId, companyId: user.companyId, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found.');

    const source = await this.resolveSource(user.companyId, input);

    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.paymentRecord.create({
          data: {
            companyId: user.companyId,
            employeeId: employee.id,
            type: input.type,
            amount: source.amount,
            status: PaymentStatus.PENDING_APPROVAL,
            method: input.method,
            provider: input.provider,
            salaryRecordId: input.salaryRecordId ?? null,
            advanceId: input.advanceId ?? null,
            description: input.description?.trim() || source.description,
            submittedAt: new Date(),
            createdById: user.id,
            updatedById: user.id,
          },
          select: PAYMENT_VIEW,
        });

        // Standalone payments are their own ledger source; salaries and advances already have a
        // line, which is linked rather than duplicated.
        if (source.ledgerSource) {
          await this.ledger.linkPayment(tx, user.companyId, source.ledgerSource.type, source.ledgerSource.id, created.id);
        } else {
          await this.ledger.syncSource(
            tx,
            { companyId: user.companyId, sourceType: LedgerSourceType.PAYMENT, sourceId: created.id, actorId: user.id },
            { transactionDate: dateOnly(new Date()), type: input.type === PaymentType.ALLOWANCE ? 'ALLOWANCE' : 'OTHER_PAYMENT', direction: 'EXPENSE', amount: created.amount, description: created.description, employeeId: employee.id },
          );
          await this.ledger.linkPayment(tx, user.companyId, LedgerSourceType.PAYMENT, created.id, created.id);
        }
        await this.event(tx, created, FinanceEventType.PAYMENT_CREATED);
        return created;
      });
      await this.record(user, 'payment.created', payment, { amount: payment.amount.toFixed(2), method: payment.method, provider: payment.provider });
      return payment;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This salary or advance already has an active payment.');
      }
      throw error;
    }
  }

  async approve(user: AuthenticatedUser, id: string): Promise<PaymentRow> {
    return this.officeTransition(user, id, PaymentStatus.APPROVED, 'payment.approved', { approvedAt: new Date(), approvedById: user.id });
  }

  async cancel(user: AuthenticatedUser, id: string, reason: string): Promise<PaymentRow> {
    const payment = await this.officeTransition(user, id, PaymentStatus.CANCELLED, 'payment.cancelled', { cancelledAt: new Date(), failureReason: reason.trim() });
    // A standalone payment was its own obligation: cancelling it reverses its ledger line.
    if (!payment.salaryRecordId && !payment.advanceId) {
      await this.prisma.$transaction((tx) =>
        this.ledger.syncSource(tx, { companyId: user.companyId, sourceType: LedgerSourceType.PAYMENT, sourceId: payment.id, actorId: user.id }, null),
      );
    }
    return payment;
  }

  /** The office paid outside the system (cash, its own bank). Never used for RazorpayX payments. */
  async recordManual(user: AuthenticatedUser, id: string, input: { reference?: string; paidOn?: string }): Promise<PaymentRow> {
    const existing = await this.find(user.companyId, id);
    if (existing.provider !== PaymentProvider.MANUAL) throw new BadRequestException('RazorpayX payments are confirmed by RazorpayX, not recorded by hand.');
    // A business date, not in the future; noon UTC keeps it on the same calendar day in IST.
    const paidAt = input.paidOn ? new Date(pastOrTodayDate(input.paidOn).getTime() + 12 * 60 * 60 * 1000) : new Date();
    return this.officeTransition(user, id, PaymentStatus.PAID, 'payment.paid_manually', { paidAt, paymentReference: input.reference?.trim() || null }, true);
  }

  // ───────────────────────────── Send (RazorpayX) ─────────────────────────────

  /**
   * Sends an approved (or definitively failed) RazorpayX payment.
   *
   *  1. CLAIM, atomically: move to STATUS_REVIEW_REQUIRED, bump the attempt, and store the
   *     attempt's idempotency key and destination. The conditional update is the lock — a
   *     second click or concurrent request finds nothing to claim.
   *  2. CALL the provider, outside any database transaction.
   *  3. APPLY the answer. If it is unknown (timeout, 5xx), leave the payment claimed: it is not
   *     failed, not retried, and waits for a status check or a webhook.
   */
  async send(user: AuthenticatedUser, id: string): Promise<{ payment: PaymentRow; outcome: 'accepted' | 'rejected' | 'unknown' }> {
    const existing = await this.find(user.companyId, id);
    if (existing.provider !== PaymentProvider.RAZORPAYX) throw new BadRequestException('Only RazorpayX payments are sent; record manual payments instead.');
    if (!this.provider.enabled) throw new BadRequestException('Online payouts are not configured. Record the payment manually, or configure RazorpayX.');
    assertTransition(existing.status, PaymentStatus.STATUS_REVIEW_REQUIRED, 'OFFICE');

    const account = await this.prisma.employeePayoutAccount.findUnique({ where: { employeeId: existing.employeeId } });
    if (!account?.providerFundAccountId) throw new BadRequestException("Add the employee's bank account or UPI ID before sending a payout.");

    const attempt = existing.attempt + 1;
    const idempotencyKey = `gm-${existing.id}-${attempt}`; // stable for this attempt; 4–36 chars not exceeded
    const claimed = await this.prisma.paymentRecord.updateMany({
      where: { id: existing.id, companyId: user.companyId, status: existing.status, attempt: existing.attempt },
      data: {
        status: PaymentStatus.STATUS_REVIEW_REQUIRED,
        attempt,
        idempotencyKey,
        providerReference: null,
        providerStatus: null,
        failureReason: null,
        providerFundAccountId: account.providerFundAccountId,
        recipientSummary: summarise(account),
        sentAt: new Date(),
        updatedById: user.id,
      },
    });
    if (claimed.count === 0) throw new ConflictException('This payment is already being sent.');
    await this.record(user, 'payment.payout_requested', existing, { attempt, idempotencyKey });

    return this.callProvider(user, existing.id);
  }

  /**
   * Resolves a payment whose outcome is unknown or still in flight, by asking the provider.
   * With a reference, it fetches the payout; without one (the send never got an answer), it
   * repeats the identical request with the SAME idempotency key — which RazorpayX maps to the
   * original payout instead of creating another.
   */
  async checkStatus(user: AuthenticatedUser, id: string): Promise<{ payment: PaymentRow; outcome: 'accepted' | 'rejected' | 'unknown' }> {
    const existing = await this.find(user.companyId, id);
    if (existing.status !== PaymentStatus.STATUS_REVIEW_REQUIRED && existing.status !== PaymentStatus.PROCESSING) {
      throw new BadRequestException('Only payments that are in progress or awaiting review can be checked.');
    }
    if (existing.providerReference) {
      try {
        const result = await this.provider.getPayout(existing.providerReference);
        return { payment: await this.applyProviderResult(existing.id, result, `status-check:${user.id}`), outcome: 'accepted' };
      } catch (error) {
        if (error instanceof PayoutOutcomeUnknownError) return { payment: await this.find(user.companyId, id), outcome: 'unknown' };
        throw error;
      }
    }
    return this.callProvider(user, existing.id);
  }

  private async callProvider(user: AuthenticatedUser, id: string): Promise<{ payment: PaymentRow; outcome: 'accepted' | 'rejected' | 'unknown' }> {
    const payment = await this.prisma.paymentRecord.findUniqueOrThrow({ where: { id } });
    try {
      const result = await this.provider.createPayout({
        idempotencyKey: payment.idempotencyKey!,
        amount: payment.amount,
        fundAccountId: payment.providerFundAccountId!,
        mode: payment.method === PaymentMethod.UPI ? 'UPI' : 'IMPS',
        purpose: payment.type === PaymentType.SALARY ? 'salary' : 'payout',
        referenceId: payment.id,
        narration: `Gangamata ${payment.type.toLowerCase()}`,
      });
      return { payment: await this.applyProviderResult(id, result, `send:${user.id}`), outcome: 'accepted' };
    } catch (error) {
      if (error instanceof PayoutRejectedError) {
        // Definitive: no payout exists. FAILED allows a fresh attempt with a new key.
        const failed = await this.applyProviderResult(id, { providerReference: '', status: 'FAILED', rawStatus: 'rejected', utr: null, failureReason: error.message }, `send:${user.id}`);
        return { payment: failed, outcome: 'rejected' };
      }
      if (error instanceof PayoutOutcomeUnknownError) {
        this.logger.warn(`Payment ${id}: outcome unknown after attempt ${payment.attempt}; left in STATUS_REVIEW_REQUIRED`);
        await this.record(user, 'payment.outcome_unknown', await this.find(user.companyId, id), { attempt: payment.attempt, reason: error.message });
        return { payment: await this.find(user.companyId, id), outcome: 'unknown' };
      }
      throw error;
    }
  }

  // ───────────────────────────── Provider updates ─────────────────────────────

  /**
   * Applies a provider-reported state. Moves only along transitions the state machine allows
   * for the PROVIDER; anything else (a late "queued" after "processed", a repeat) is ignored,
   * so out-of-order or duplicate updates can never move a payment backwards.
   */
  async applyProviderResult(id: string, result: PayoutResult, via: string): Promise<PaymentRow> {
    const next = PROVIDER_TO_STATUS[result.status];
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.paymentRecord.findUniqueOrThrow({ where: { id }, select: PAYMENT_VIEW });
      const sameState = current.status === next;
      if (!sameState && !canTransition(current.status, next, 'PROVIDER')) {
        this.logger.log(`Payment ${id}: ignoring provider status ${result.status} while ${current.status}`);
        return { row: current, changed: false };
      }
      const now = new Date();
      const row = await tx.paymentRecord.update({
        where: { id },
        data: {
          status: next,
          providerStatus: result.rawStatus,
          ...(result.providerReference ? { providerReference: result.providerReference } : {}),
          ...(result.utr ? { paymentReference: result.utr } : {}),
          ...(next === PaymentStatus.PAID ? { paidAt: current.paidAt ?? now } : {}),
          ...(next === PaymentStatus.FAILED ? { failedAt: now, failureReason: result.failureReason } : {}),
          ...(next === PaymentStatus.CANCELLED ? { cancelledAt: now, failureReason: result.failureReason } : {}),
          ...(next === PaymentStatus.REVERSED ? { reversedAt: now, failureReason: result.failureReason } : {}),
        },
        select: PAYMENT_VIEW,
      });
      if (!sameState) {
        await this.settleSource(tx, row);
        const eventType = EVENT_FOR[next];
        if (eventType) await this.event(tx, row, eventType);
      }
      return { row, changed: !sameState };
    });

    if (updated.changed) {
      await this.audit.record({
        action: `payment.${next.toLowerCase()}`,
        entityType: 'PaymentRecord',
        entityId: id,
        companyId: updated.row.employee ? (await this.prisma.paymentRecord.findUniqueOrThrow({ where: { id }, select: { companyId: true } })).companyId : null,
        actorUserId: null,
        changes: { via, providerStatus: result.rawStatus, providerReference: result.providerReference || null },
      });
    }
    return updated.row;
  }

  /** Keeps the salary/advance in step with its payment. */
  private async settleSource(tx: Tx, payment: PaymentRow): Promise<void> {
    if (payment.status === PaymentStatus.PAID) {
      if (payment.salaryRecordId) await tx.salaryRecord.update({ where: { id: payment.salaryRecordId }, data: { status: SalaryStatus.PAID, paidAt: payment.paidAt } });
      if (payment.advanceId) await tx.advance.update({ where: { id: payment.advanceId }, data: { status: AdvanceStatus.PAID } });
    }
    if (payment.status === PaymentStatus.REVERSED) {
      // The money came back: the salary/advance is owed again.
      if (payment.salaryRecordId) await tx.salaryRecord.update({ where: { id: payment.salaryRecordId }, data: { status: SalaryStatus.PENDING, paidAt: null } });
      if (payment.advanceId) await tx.advance.update({ where: { id: payment.advanceId }, data: { status: AdvanceStatus.PENDING } });
    }
  }

  // ───────────────────────────── Reading ─────────────────────────────

  async list(companyId: string, query: { status?: PaymentStatus; employeeId?: string; type?: PaymentType; limit: number; cursor?: string }): Promise<Page<PaymentRow>> {
    const rows = await this.prisma.paymentRecord.findMany({
      where: { companyId, ...(query.status ? { status: query.status } : {}), ...(query.employeeId ? { employeeId: query.employeeId } : {}), ...(query.type ? { type: query.type } : {}) },
      select: PAYMENT_VIEW,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, query.limit);
  }

  /** A driver's own payments only — the employee comes from the session, never the request. */
  async listForDriver(user: AuthenticatedUser, query: { limit: number; cursor?: string }): Promise<Page<PaymentRow>> {
    const { employeeId } = requireDriverScope(user);
    const rows = await this.prisma.paymentRecord.findMany({
      where: { companyId: user.companyId, employeeId, status: { not: PaymentStatus.DRAFT } },
      select: PAYMENT_VIEW,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, query.limit);
  }

  /** Count and total per status, plus what was paid this month (IST) — for the Payments header. */
  async summary(companyId: string) {
    // paidAt is an instant; the month starts at 00:00 IST, which is 18:30 UTC the day before.
    const since = new Date(monthStart(todayInIndia()).getTime() - 5.5 * 60 * 60 * 1000);
    const [byStatus, paidMonth] = await Promise.all([
      this.prisma.paymentRecord.groupBy({ by: ['status'], where: { companyId }, _count: true, _sum: { amount: true } }),
      this.prisma.paymentRecord.aggregate({ where: { companyId, status: PaymentStatus.PAID, paidAt: { gte: since } }, _count: true, _sum: { amount: true } }),
    ]);
    const zero = new Prisma.Decimal(0);
    return {
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, { count: row._count, amount: (row._sum.amount ?? zero).toFixed(2) }])),
      paidThisMonth: { count: paidMonth._count, amount: (paidMonth._sum.amount ?? zero).toFixed(2) },
    };
  }

  async history(companyId: string, id: string) {
    await this.find(companyId, id);
    const [audit, events] = await Promise.all([
      this.prisma.auditLog.findMany({ where: { companyId, entityType: 'PaymentRecord', entityId: id }, orderBy: { occurredAt: 'asc' }, select: { action: true, occurredAt: true, actorUserId: true, changes: true } }),
      this.prisma.paymentProviderEvent.findMany({ where: { paymentRecordId: id }, orderBy: { receivedAt: 'asc' }, select: { eventType: true, receivedAt: true, outcome: true } }),
    ]);
    return { audit, providerEvents: events };
  }

  async find(companyId: string, id: string): Promise<PaymentRow> {
    const payment = await this.prisma.paymentRecord.findFirst({ where: { id, companyId }, select: PAYMENT_VIEW });
    if (!payment) throw new NotFoundException('Payment not found.');
    return payment;
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private async officeTransition(
    user: AuthenticatedUser,
    id: string,
    to: PaymentStatus,
    action: string,
    data: Prisma.PaymentRecordUpdateInput,
    settle = false,
  ): Promise<PaymentRow> {
    const existing = await this.find(user.companyId, id);
    assertTransition(existing.status, to, 'OFFICE');
    const payment = await this.prisma.$transaction(async (tx) => {
      // Conditional on the status we checked, so a concurrent change cannot be overwritten.
      const result = await tx.paymentRecord.updateMany({ where: { id, companyId: user.companyId, status: existing.status }, data: { ...(data as Prisma.PaymentRecordUpdateManyMutationInput), status: to, updatedById: user.id } });
      if (result.count === 0) throw new ConflictException('This payment changed while you were working on it. Reload and try again.');
      const row = await tx.paymentRecord.findUniqueOrThrow({ where: { id }, select: PAYMENT_VIEW });
      if (settle) await this.settleSource(tx, row);
      const eventType = EVENT_FOR[to];
      if (eventType) await this.event(tx, row, eventType);
      return row;
    });
    await this.record(user, action, payment, { from: existing.status, to });
    return payment;
  }

  private async resolveSource(companyId: string, input: CreatePaymentInput) {
    if (input.type === PaymentType.SALARY) {
      if (!input.salaryRecordId) throw new BadRequestException('Choose the salary this payment is for.');
      const salary = await this.prisma.salaryRecord.findFirst({ where: { id: input.salaryRecordId, companyId, employeeId: input.employeeId } });
      if (!salary) throw new NotFoundException('Salary not found for this employee.');
      if (salary.status !== SalaryStatus.PENDING) throw new BadRequestException(`This salary is ${salary.status.toLowerCase()}.`);
      if (salary.netPayable.lte(0)) throw new BadRequestException('Nothing is payable on this salary.');
      return { amount: salary.netPayable, description: `Salary ${salary.payPeriod.toISOString().slice(0, 7)}`, ledgerSource: { type: LedgerSourceType.SALARY, id: salary.id } };
    }
    if (input.type === PaymentType.ADVANCE) {
      if (!input.advanceId) throw new BadRequestException('Choose the advance this payment is for.');
      const advance = await this.prisma.advance.findFirst({ where: { id: input.advanceId, companyId, employeeId: input.employeeId } });
      if (!advance) throw new NotFoundException('Advance not found for this employee.');
      if (advance.status !== AdvanceStatus.PENDING) throw new BadRequestException(`This advance is ${advance.status.toLowerCase()}.`);
      return { amount: advance.amount, description: advance.reason ?? advance.type.replace('_', ' ').toLowerCase(), ledgerSource: { type: LedgerSourceType.ADVANCE, id: advance.id } };
    }
    if (input.amount === undefined || !(input.amount > 0)) throw new BadRequestException('Enter an amount greater than zero.');
    return { amount: new Prisma.Decimal(input.amount), description: input.description ?? null, ledgerSource: null };
  }

  private async event(tx: Tx, payment: PaymentRow, type: FinanceEventType) {
    const companyId = (await tx.paymentRecord.findUniqueOrThrow({ where: { id: payment.id }, select: { companyId: true } })).companyId;
    await tx.financeEvent.createMany({ data: [{ companyId, type, paymentRecordId: payment.id, employeeId: payment.employeeId }], skipDuplicates: true });
  }

  private async record(user: AuthenticatedUser, action: string, payment: PaymentRow, changes: Record<string, unknown>) {
    await this.audit.record({
      action,
      entityType: 'PaymentRecord',
      entityId: payment.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { type: payment.type, employeeId: payment.employeeId, ...changes },
    });
  }
}

/** "UPI ra****@upi" or "A/c XXXX4417 · SBIN0001234". Never the full number. */
export function summarise(account: { method: PaymentMethod; accountNumberLast4: string | null; ifsc: string | null; upiIdMasked: string | null }): string {
  if (account.method === PaymentMethod.UPI) return `UPI ${account.upiIdMasked ?? ''}`.trim();
  return `A/c XXXX${account.accountNumberLast4 ?? '????'}${account.ifsc ? ` · ${account.ifsc}` : ''}`;
}

const dateOnly = (d: Date) => new Date(d.toISOString().slice(0, 10) + 'T00:00:00.000Z');
