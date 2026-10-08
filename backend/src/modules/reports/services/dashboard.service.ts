import { Injectable } from '@nestjs/common';
import { LedgerDirection, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { ReportContext } from '../report-context';
import { money, paymentStatusTotals } from '../report-maths';
import { dateWindow, instantWindow } from '../report-range';
import { ExpenseReportService } from './expense-report.service';

/**
 * The dashboard's cards, for whatever period each card has selected. Small aggregate queries
 * only — no rows — and the same sources and rules as the reports, so a card always equals the
 * matching report figure for the same days:
 *
 *  - operational spend comes from the expense report (fuel + vehicle expenses + tyre premiums),
 *    and "other expenses" is that total less fuel;
 *  - total expenses (payroll roles) is the ledger's expense side, where corrections net out.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpenseReportService,
  ) {}

  async spend(ctx: ReportContext) {
    const days = dateWindow(ctx.range);
    const [fuel, otherRecords, operational, ledger] = await Promise.all([
      this.prisma.fuelEntry.aggregate({
        where: { companyId: ctx.companyId, status: RecordStatus.ACTIVE, transactionDate: days },
        _count: { _all: true },
        _sum: { amount: true, litres: true },
      }),
      this.prisma.vehicleExpense.count({ where: { companyId: ctx.companyId, status: RecordStatus.ACTIVE, expenseDate: days } }),
      this.expenses.spendBetween(ctx.companyId, ctx.range.from, ctx.range.to),
      ctx.visibility.payments
        ? this.prisma.financeLedgerEntry.aggregate({ where: { companyId: ctx.companyId, direction: LedgerDirection.EXPENSE, transactionDate: days }, _sum: { amount: true } })
        : Promise.resolve(null),
    ]);
    const fuelAmount = fuel._sum.amount;
    return {
      fuel: { amount: money(fuelAmount), litres: (fuel._sum.litres ?? 0).toString(), entries: fuel._count._all },
      otherExpenses: { amount: money(fuelAmount ? operational.minus(fuelAmount) : operational), records: otherRecords },
      operationalTotal: money(operational),
      // Ledger totals include payroll, so only payroll roles get them.
      ...(ledger ? { ledgerExpenses: money(ledger._sum.amount) } : {}),
    };
  }

  /** Payments created in the period, by status group; and what was paid in the period. */
  async payments(ctx: ReportContext) {
    const instants = instantWindow(ctx.range);
    const [byStatus, paid] = await Promise.all([
      this.prisma.paymentRecord.groupBy({ by: ['status'], where: { companyId: ctx.companyId, createdAt: instants }, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.paymentRecord.aggregate({ where: { companyId: ctx.companyId, status: 'PAID', paidAt: instants }, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    return {
      created: paymentStatusTotals(byStatus.map((r) => ({ status: r.status, count: r._count._all, amount: r._sum.amount }))).byGroup,
      paidInPeriod: { count: paid._count._all, amount: money(paid._sum.amount) },
    };
  }
}
