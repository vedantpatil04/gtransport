import { Injectable } from '@nestjs/common';
import { LedgerDirection, LedgerEntryType, LedgerSourceType, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { toPage, type Page } from '../../common/pagination/pagination';
import { todayInIndia, financialYearOf, toIsoDate } from '../../common/dates/financial-year';
import { dateRangeFilter } from '../../common/dates/request-dates';

type Tx = Prisma.TransactionClient;

/** What a source record should look like in the ledger right now; null if it should not appear. */
export interface DesiredPosting {
  transactionDate: Date;
  type: LedgerEntryType;
  direction: LedgerDirection;
  amount: Prisma.Decimal | number | string;
  description?: string | null;
  employeeId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
}

export interface LedgerQuery {
  fy?: string;
  from?: string;
  to?: string;
  type?: LedgerEntryType;
  direction?: LedgerDirection;
  vehicleId?: string;
  employeeId?: string;
  q?: string;
  limit: number;
  cursor?: string;
}

export const LEDGER_VIEW = {
  id: true,
  transactionDate: true,
  type: true,
  direction: true,
  amount: true,
  description: true,
  employeeId: true,
  driverId: true,
  vehicleId: true,
  sourceType: true,
  sourceId: true,
  sequence: true,
  reversalOfId: true,
  createdAt: true,
  paymentRecord: { select: { id: true, status: true, method: true, provider: true } },
  reversedBy: { select: { id: true } },
} as const;

export type LedgerRow = Prisma.FinanceLedgerEntryGetPayload<{ select: typeof LEDGER_VIEW }>;

const ZERO = new Prisma.Decimal(0);

/**
 * The operational finance ledger.
 *
 * Lines are only ever added. `syncSource` makes the ledger agree with a source record: it does
 * nothing when they already agree, and otherwise reverses the previous line (a negative line of
 * the same type) and posts a new one. Every create, edit, archive or restore of a source goes
 * through it, so the ledger can never silently drift from — or double-count — its sources.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async syncSource(
    tx: Tx,
    source: { companyId: string; sourceType: LedgerSourceType; sourceId: string; actorId: string | null },
    desired: DesiredPosting | null,
  ): Promise<void> {
    const postings = await tx.financeLedgerEntry.findMany({
      where: { companyId: source.companyId, sourceType: source.sourceType, sourceId: source.sourceId },
      select: { id: true, sequence: true, reversalOfId: true, amount: true, transactionDate: true, type: true, direction: true, vehicleId: true, driverId: true, employeeId: true, paymentRecordId: true, reversedBy: { select: { id: true } } },
      orderBy: { sequence: 'asc' },
    });
    const active = postings.find((p) => p.reversalOfId === null && p.reversedBy === null) ?? null;
    let nextSequence = (postings.at(-1)?.sequence ?? 0) + 1;

    const unchanged =
      active &&
      desired &&
      new Prisma.Decimal(desired.amount).equals(active.amount) &&
      toIsoDate(desired.transactionDate) === toIsoDate(active.transactionDate) &&
      desired.type === active.type &&
      desired.direction === active.direction &&
      (desired.vehicleId ?? null) === active.vehicleId &&
      (desired.driverId ?? null) === active.driverId &&
      (desired.employeeId ?? null) === active.employeeId;
    if (unchanged || (!active && !desired)) return;

    if (active) {
      await tx.financeLedgerEntry.create({
        data: {
          companyId: source.companyId,
          transactionDate: todayInIndia(),
          type: active.type,
          direction: active.direction,
          amount: active.amount.negated(),
          description: 'Reversal',
          employeeId: active.employeeId,
          driverId: active.driverId,
          vehicleId: active.vehicleId,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sequence: nextSequence,
          paymentRecordId: active.paymentRecordId,
          reversalOfId: active.id,
          createdById: source.actorId,
          updatedById: source.actorId,
        },
      });
      nextSequence += 1;
    }

    if (desired) {
      const amount = new Prisma.Decimal(desired.amount);
      if (amount.lte(0)) return; // Nothing to post (e.g. a zero premium).
      await tx.financeLedgerEntry.create({
        data: {
          companyId: source.companyId,
          transactionDate: desired.transactionDate,
          type: desired.type,
          direction: desired.direction,
          amount,
          description: desired.description ?? null,
          employeeId: desired.employeeId ?? null,
          driverId: desired.driverId ?? null,
          vehicleId: desired.vehicleId ?? null,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sequence: nextSequence,
          // A re-post keeps its link to the payment that settles it.
          paymentRecordId: active?.paymentRecordId ?? null,
          createdById: source.actorId,
          updatedById: source.actorId,
        },
      });
    }
  }

  /** Links the active line of a salary/advance to the payment that settles it. */
  async linkPayment(tx: Tx, companyId: string, sourceType: LedgerSourceType, sourceId: string, paymentRecordId: string): Promise<void> {
    await tx.financeLedgerEntry.updateMany({
      where: { companyId, sourceType, sourceId, reversalOfId: null, reversedBy: null },
      data: { paymentRecordId },
    });
  }

  async list(companyId: string, query: LedgerQuery): Promise<Page<LedgerRow> & { totals: { income: string; expense: string; net: string } }> {
    const where = this.where(companyId, query);
    const [rows, byDirection] = await Promise.all([
      this.prisma.financeLedgerEntry.findMany({
        where,
        select: LEDGER_VIEW,
        orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.financeLedgerEntry.groupBy({ by: ['direction'], where, _sum: { amount: true } }),
    ]);
    const sum = (d: LedgerDirection) => byDirection.find((r) => r.direction === d)?._sum.amount ?? ZERO;
    const income = sum(LedgerDirection.INCOME);
    const expense = sum(LedgerDirection.EXPENSE);
    return { ...toPage(rows, query.limit), totals: { income: income.toFixed(2), expense: expense.toFixed(2), net: income.minus(expense).toFixed(2) } };
  }

  /**
   * The Finance dashboard for one financial year: totals per type (reversals net out because
   * they are negative), plus payments not yet completed. Deliberately small — management
   * reporting is a later phase.
   */
  async summary(companyId: string, fy?: string) {
    const year = fy ? dateRangeFilter({ fy }) : (() => {
      const current = financialYearOf(todayInIndia());
      return { gte: current.start, lte: current.end };
    })();
    const label = fy ? `FY ${fy.replace('-', '–')}` : financialYearOf(todayInIndia()).label;

    const [byType, pending] = await Promise.all([
      this.prisma.financeLedgerEntry.groupBy({
        by: ['type', 'direction'],
        where: { companyId, transactionDate: year },
        _sum: { amount: true },
      }),
      this.prisma.paymentRecord.aggregate({
        where: { companyId, status: { in: [PaymentStatus.DRAFT, PaymentStatus.PENDING_APPROVAL, PaymentStatus.APPROVED, PaymentStatus.PROCESSING, PaymentStatus.STATUS_REVIEW_REQUIRED] } },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    const total = (predicate: (row: (typeof byType)[number]) => boolean) =>
      byType.filter(predicate).reduce((acc, row) => acc.plus(row._sum.amount ?? ZERO), ZERO).toFixed(2);
    const ofType = (...types: LedgerEntryType[]) => total((r) => types.includes(r.type) && r.direction === LedgerDirection.EXPENSE);

    return {
      financialYear: label,
      totalIncome: total((r) => r.direction === LedgerDirection.INCOME),
      totalExpenses: total((r) => r.direction === LedgerDirection.EXPENSE),
      salaries: ofType(LedgerEntryType.SALARY),
      advances: ofType(LedgerEntryType.ADVANCE),
      fuel: ofType(LedgerEntryType.FUEL),
      maintenance: ofType(LedgerEntryType.MAINTENANCE),
      tyres: ofType(LedgerEntryType.TYRE, LedgerEntryType.TYRE_INSURANCE),
      rto: ofType(LedgerEntryType.RTO),
      vehicleFinance: ofType(LedgerEntryType.EMI),
      pendingPayments: { count: pending._count, amount: (pending._sum.amount ?? ZERO).toFixed(2) },
    };
  }

  private where(companyId: string, query: LedgerQuery): Prisma.FinanceLedgerEntryWhereInput {
    const range = dateRangeFilter(query);
    const q = query.q?.trim();
    return {
      companyId,
      ...(range ? { transactionDate: range } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(q ? { description: { contains: q, mode: Prisma.QueryMode.insensitive } } : {}),
    };
  }
}
