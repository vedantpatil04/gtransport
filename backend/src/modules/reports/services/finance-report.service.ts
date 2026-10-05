import { Injectable } from '@nestjs/common';
import {
  AdvanceStatus, InstallmentStatus, LedgerDirection, LedgerEntryType, PaymentStatus, Prisma, SalaryStatus, VehicleOwnership,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { monthStart, toIsoDate } from '../../../common/dates/financial-year';
import type { FinanceExportQuery, FinanceRecordsQuery, FinanceReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportDocument, bucketText } from '../report-document';
import { detailTake, resolveSort, searchText, skipTake, toReportPage, type DetailLimits, type ReportContext } from '../report-context';
import { fillTrend, money, PAYMENT_GROUPS, paymentStatusTotals, sum, ZERO } from '../report-maths';
import { dateWindow, instantWindow } from '../report-range';
import { ReportLookups } from './report-lookups';

const SORTS = ['date', 'amount', 'type'] as const;
type LedgerSort = (typeof SORTS)[number];

const LEDGER_ROW = {
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
  reversalOfId: true,
  paymentRecord: { select: { status: true } },
} as const;
type LedgerRow = Prisma.FinanceLedgerEntryGetPayload<{ select: typeof LEDGER_ROW }>;

/**
 * Financial summary — an operational view of money committed and paid, not statutory accounts.
 * There is deliberately no balance sheet, profit and loss or GST figure here: the ledger is an
 * operational timeline, and labelling it as accounts it cannot support would mislead.
 *
 * Each section names its own source of truth:
 *  - movement and category totals: the finance ledger (reversal lines are negative and dated on
 *    the day of the correction, so a period's totals reflect corrections made in that period);
 *  - salaries: salary records whose pay month falls in the period;
 *  - advances: advance records dated in the period;
 *  - payments: payment records created in the period, each status reported on its own;
 *  - EMI: vehicle finance instalments (due, paid and overdue) and the recorded loan balances.
 */
@Injectable()
export class FinanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: ReportLookups,
  ) {}

  private ledgerWhere(ctx: ReportContext, query: FinanceReportQuery, q?: string): Prisma.FinanceLedgerEntryWhereInput {
    const search = searchText(q);
    return {
      companyId: ctx.companyId,
      transactionDate: dateWindow(ctx.range),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(search ? { description: { contains: search, mode: Prisma.QueryMode.insensitive } } : {}),
    };
  }

  async summary(ctx: ReportContext, query: FinanceReportQuery) {
    const ledgerWhere = this.ledgerWhere(ctx, query);
    const instants = instantWindow(ctx.range);
    // A salary is "in the period" when its pay month overlaps it.
    const payPeriods = { gte: monthStart(ctx.range.from), lte: ctx.range.to };
    const employee = query.employeeId ? { employeeId: query.employeeId } : {};

    const [byType, byDayDirection, byVehicleType, salaries, advances, paymentsByStatus, paymentsByType, paidInPeriod, salaryByEmployee, advanceByEmployee] = await Promise.all([
      this.prisma.financeLedgerEntry.groupBy({ by: ['type', 'direction'], where: ledgerWhere, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.financeLedgerEntry.groupBy({ by: ['transactionDate', 'direction'], where: ledgerWhere, _sum: { amount: true } }),
      this.prisma.financeLedgerEntry.groupBy({ by: ['vehicleId', 'type'], where: { ...ledgerWhere, vehicleId: query.vehicleId ?? { not: null }, direction: LedgerDirection.EXPENSE }, _sum: { amount: true } }),
      this.prisma.salaryRecord.groupBy({
        by: ['status'],
        where: { companyId: ctx.companyId, payPeriod: payPeriods, ...employee },
        _count: { _all: true },
        _sum: { baseSalary: true, allowances: true, advanceRecovery: true, deductions: true, netPayable: true },
      }),
      this.prisma.advance.groupBy({ by: ['status', 'type'], where: { companyId: ctx.companyId, advanceDate: dateWindow(ctx.range), ...employee }, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.paymentRecord.groupBy({
        by: ['status'],
        where: { companyId: ctx.companyId, createdAt: instants, ...employee, ...(query.paymentStatus ? { status: query.paymentStatus } : {}) },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.paymentRecord.groupBy({ by: ['type', 'status'], where: { companyId: ctx.companyId, createdAt: instants, ...employee }, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.paymentRecord.aggregate({ where: { companyId: ctx.companyId, status: PaymentStatus.PAID, paidAt: instants, ...employee }, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.salaryRecord.groupBy({ by: ['employeeId'], where: { companyId: ctx.companyId, payPeriod: payPeriods, status: { not: SalaryStatus.CANCELLED }, ...employee }, _count: { _all: true }, _sum: { netPayable: true, allowances: true } }),
      this.prisma.advance.groupBy({ by: ['employeeId'], where: { companyId: ctx.companyId, advanceDate: dateWindow(ctx.range), status: { not: AdvanceStatus.CANCELLED }, ...employee }, _count: { _all: true }, _sum: { amount: true } }),
    ]);

    // ── Ledger movement ──
    const direction = (d: LedgerDirection) => sum(byType.filter((r) => r.direction === d).map((r) => r._sum.amount));
    const inflow = direction(LedgerDirection.INCOME);
    const outflow = direction(LedgerDirection.EXPENSE);
    const categories = byType
      .map((r) => ({ type: r.type, direction: r.direction, entries: r._count._all, amount: money(r._sum.amount) }))
      .sort((a, b) => Number(b.amount) - Number(a.amount));

    // ── Salaries (non-cancelled in totals; cancelled reported on its own) ──
    const live = salaries.filter((s) => s.status !== SalaryStatus.CANCELLED);
    const salaryPart = (pick: (s: (typeof salaries)[number]) => Prisma.Decimal | null) => money(sum(live.map(pick)));
    const salaryStatus = (status: SalaryStatus) => {
      const row = salaries.find((s) => s.status === status);
      return { count: row?._count._all ?? 0, netPayable: money(row?._sum.netPayable) };
    };

    // ── Advances ──
    const liveAdvances = advances.filter((a) => a.status !== AdvanceStatus.CANCELLED);
    const advanceStatus = (status: AdvanceStatus) => {
      const rows = advances.filter((a) => a.status === status);
      return { count: rows.reduce((n, r) => n + r._count._all, 0), amount: money(sum(rows.map((r) => r._sum.amount))) };
    };

    // ── Payments ──
    const payments = paymentStatusTotals(paymentsByStatus.map((r) => ({ status: r.status, count: r._count._all, amount: r._sum.amount })));
    const byPaymentType = Object.values(paymentsByType.reduce<Record<string, { type: string; paid: Prisma.Decimal; open: Prisma.Decimal; count: number }>>((acc, r) => {
      const slot = (acc[r.type] ??= { type: r.type, paid: ZERO, open: ZERO, count: 0 });
      slot.count += r._count._all;
      if (r.status === PaymentStatus.PAID) slot.paid = slot.paid.plus(r._sum.amount ?? ZERO);
      if ((PAYMENT_GROUPS.pending as readonly PaymentStatus[]).includes(r.status) || (PAYMENT_GROUPS.processing as readonly PaymentStatus[]).includes(r.status)) slot.open = slot.open.plus(r._sum.amount ?? ZERO);
      return acc;
    }, {})).map((r) => ({ type: r.type, count: r.count, paid: money(r.paid), open: money(r.open) }));

    // ── Vehicle finance ──
    const vehicleFinance = await this.vehicleFinance(ctx, query);

    // ── Per vehicle (ledger outflow by vehicle, EMI split out) ──
    const vehicleIds = [...new Set(byVehicleType.map((r) => r.vehicleId).filter((id): id is string => Boolean(id)))];
    const employeeIds = [...new Set([...salaryByEmployee.map((r) => r.employeeId), ...advanceByEmployee.map((r) => r.employeeId)])];
    const [vehicleNames, employeeNames] = await Promise.all([
      this.lookups.vehicles(ctx.companyId, vehicleIds),
      this.lookups.employees(ctx.companyId, employeeIds),
    ]);
    const byVehicle = vehicleIds
      .map((id) => {
        const rows = byVehicleType.filter((r) => r.vehicleId === id);
        const emi = sum(rows.filter((r) => r.type === LedgerEntryType.EMI).map((r) => r._sum.amount));
        const total = sum(rows.map((r) => r._sum.amount));
        return { id, label: vehicleNames.get(id) ?? '—', emi: money(emi), operating: money(total.minus(emi)), total: money(total) };
      })
      .sort((a, b) => Number(b.total) - Number(a.total));

    const byEmployee = employeeIds
      .map((id) => {
        const s = salaryByEmployee.find((r) => r.employeeId === id);
        const a = advanceByEmployee.find((r) => r.employeeId === id);
        const salaryNet = s?._sum.netPayable ?? ZERO;
        const advance = a?._sum.amount ?? ZERO;
        return {
          id,
          label: employeeNames.get(id)?.name ?? '—',
          code: employeeNames.get(id)?.code ?? '',
          salaries: s?._count._all ?? 0,
          salaryNet: money(salaryNet),
          allowances: money(s?._sum.allowances),
          advances: money(advance),
          advanceCount: a?._count._all ?? 0,
          total: money(salaryNet.plus(advance)),
        };
      })
      .sort((a, b) => Number(b.total) - Number(a.total));

    return {
      ledger: {
        inflow: money(inflow),
        outflow: money(outflow),
        net: money(inflow.minus(outflow)),
        categories,
        trend: fillTrend(
          ctx.range,
          byDayDirection.map((r) => ({ date: r.transactionDate, [r.direction === LedgerDirection.INCOME ? 'inflow' : 'outflow']: r._sum.amount })),
          ['inflow', 'outflow'] as const,
        ),
      },
      salaries: {
        count: live.reduce((n, s) => n + s._count._all, 0),
        baseSalary: salaryPart((s) => s._sum.baseSalary),
        allowances: salaryPart((s) => s._sum.allowances),
        advanceRecovery: salaryPart((s) => s._sum.advanceRecovery),
        deductions: salaryPart((s) => s._sum.deductions),
        netPayable: salaryPart((s) => s._sum.netPayable),
        pending: salaryStatus(SalaryStatus.PENDING),
        paid: salaryStatus(SalaryStatus.PAID),
        cancelled: salaryStatus(SalaryStatus.CANCELLED),
      },
      advances: {
        count: liveAdvances.reduce((n, a) => n + a._count._all, 0),
        amount: money(sum(liveAdvances.map((a) => a._sum.amount))),
        pending: advanceStatus(AdvanceStatus.PENDING),
        paid: advanceStatus(AdvanceStatus.PAID),
        cancelled: advanceStatus(AdvanceStatus.CANCELLED),
        byType: Object.values(liveAdvances.reduce<Record<string, { type: string; count: number; amount: Prisma.Decimal }>>((acc, a) => {
          const slot = (acc[a.type] ??= { type: a.type, count: 0, amount: ZERO });
          slot.count += a._count._all;
          slot.amount = slot.amount.plus(a._sum.amount ?? ZERO);
          return acc;
        }, {})).map((r) => ({ type: r.type, count: r.count, amount: money(r.amount) })),
      },
      payments: {
        ...payments,
        byType: byPaymentType,
        paidInPeriod: { count: paidInPeriod._count._all, amount: money(paidInPeriod._sum.amount) },
      },
      vehicleFinance,
      byVehicle,
      byEmployee,
    };
  }

  private async vehicleFinance(ctx: ReportContext, query: FinanceReportQuery) {
    const financings = await this.prisma.vehicleFinancing.findMany({
      where: { vehicle: { companyId: ctx.companyId, deletedAt: null, ownership: VehicleOwnership.FINANCED, ...(query.vehicleId ? { id: query.vehicleId } : {}) } },
      select: { id: true, status: true, lenderName: true, emiAmount: true, outstandingAmount: true, nextDueDate: true, vehicle: { select: { id: true, registrationNumber: true } } },
    });
    const ids = financings.map((f) => f.id);
    const window = dateWindow(ctx.range);
    const [due, paid, overdue] = ids.length
      ? await Promise.all([
          this.prisma.vehicleFinanceInstallment.groupBy({ by: ['financingId', 'status'], where: { financingId: { in: ids }, dueDate: window }, _count: { _all: true }, _sum: { amount: true } }),
          this.prisma.vehicleFinanceInstallment.groupBy({ by: ['financingId'], where: { financingId: { in: ids }, status: InstallmentStatus.PAID, paidAt: window }, _count: { _all: true }, _sum: { amount: true } }),
          this.prisma.vehicleFinanceInstallment.groupBy({ by: ['financingId'], where: { financingId: { in: ids }, status: InstallmentStatus.PENDING, dueDate: { lt: ctx.today } }, _count: { _all: true }, _sum: { amount: true } }),
        ])
      : [[], [], []];

    const loans = financings
      .map((f) => {
        const dueRows = due.filter((d) => d.financingId === f.id);
        const p = paid.find((r) => r.financingId === f.id);
        const o = overdue.find((r) => r.financingId === f.id);
        return {
          vehicle: f.vehicle,
          status: f.status,
          lender: f.lenderName,
          emiAmount: f.emiAmount ? money(f.emiAmount) : null,
          outstanding: f.outstandingAmount ? money(f.outstandingAmount) : null,
          nextDueDate: f.nextDueDate ? toIsoDate(f.nextDueDate) : null,
          dueInPeriod: { count: dueRows.reduce((n, r) => n + r._count._all, 0), amount: money(sum(dueRows.map((r) => r._sum.amount))) },
          paidInPeriod: { count: p?._count._all ?? 0, amount: money(p?._sum.amount) },
          overdue: { count: o?._count._all ?? 0, amount: money(o?._sum.amount) },
        };
      })
      .sort((a, b) => a.vehicle.registrationNumber.localeCompare(b.vehicle.registrationNumber));

    const active = loans.filter((l) => l.status === 'ACTIVE');
    return {
      loans,
      activeLoans: active.length,
      outstanding: money(sum(active.map((l) => l.outstanding ?? 0))),
      outstandingRecorded: active.filter((l) => l.outstanding !== null).length,
      dueInPeriod: money(sum(loans.map((l) => l.dueInPeriod.amount))),
      paidInPeriod: money(sum(loans.map((l) => l.paidInPeriod.amount))),
      overdue: { count: loans.reduce((n, l) => n + l.overdue.count, 0), amount: money(sum(loans.map((l) => l.overdue.amount))) },
    };
  }

  // ───────────────────────────── Ledger lines ─────────────────────────────

  private orderBy(field: LedgerSort, dir: 'asc' | 'desc'): Prisma.FinanceLedgerEntryOrderByWithRelationInput[] {
    const primary: Record<LedgerSort, Prisma.FinanceLedgerEntryOrderByWithRelationInput> = { date: { transactionDate: dir }, amount: { amount: dir }, type: { type: dir } };
    return [primary[field], ...(field === 'date' ? [] : [{ transactionDate: 'desc' as const }]), { id: dir }];
  }

  private async present(ctx: ReportContext, rows: LedgerRow[]) {
    const [employees, drivers, vehicles] = await Promise.all([
      this.lookups.employees(ctx.companyId, rows.map((r) => r.employeeId)),
      this.lookups.drivers(ctx.companyId, rows.map((r) => (r.employeeId ? null : r.driverId))),
      this.lookups.vehicles(ctx.companyId, rows.map((r) => r.vehicleId)),
    ]);
    return rows.map((r) => ({
      id: r.id,
      date: toIsoDate(r.transactionDate),
      type: r.type,
      direction: r.direction,
      amount: money(r.amount),
      description: r.description,
      employee: r.employeeId ? { id: r.employeeId, name: employees.get(r.employeeId)?.name ?? '—' } : null,
      // Fuel and expense lines name the driver rather than an employee record.
      driver: !r.employeeId && r.driverId ? { id: r.driverId, name: drivers.get(r.driverId) ?? '—' } : null,
      vehicle: r.vehicleId ? { id: r.vehicleId, registrationNumber: vehicles.get(r.vehicleId) ?? '—' } : null,
      sourceType: r.sourceType,
      isReversal: r.reversalOfId !== null,
      paymentStatus: r.paymentRecord?.status ?? null,
    }));
  }

  async records(ctx: ReportContext, query: FinanceRecordsQuery) {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'date', dir: 'desc' });
    const where = this.ledgerWhere(ctx, query, query.q);
    const [rows, total] = await Promise.all([
      this.prisma.financeLedgerEntry.findMany({ where, select: LEDGER_ROW, orderBy: this.orderBy(sort.field, sort.dir), ...skipTake(query) }),
      this.prisma.financeLedgerEntry.count({ where }),
    ]);
    return toReportPage(await this.present(ctx, rows), total, query, sort);
  }

  async document(ctx: ReportContext, query: FinanceExportQuery, limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'date', dir: 'asc' });
    const where = this.ledgerWhere(ctx, query, query.q);
    const [s, total] = await Promise.all([this.summary(ctx, query), this.prisma.financeLedgerEntry.count({ where })]);
    const take = detailTake(total, limits);
    const lines = take ? await this.present(ctx, await this.prisma.financeLedgerEntry.findMany({ where, select: LEDGER_ROW, orderBy: this.orderBy(sort.field, sort.dir), take })) : [];

    return {
      title: REPORT_TITLES.finance,
      filters: [
        ...(await this.lookups.filterLabels(ctx.companyId, query)),
        ...(query.type ? [{ label: 'Ledger type', value: label(LABELS.ledgerType, query.type) }] : []),
        ...(query.paymentStatus ? [{ label: 'Payment status', value: label(LABELS.paymentStatus, query.paymentStatus) }] : []),
        ...(query.q ? [{ label: 'Search', value: query.q }] : []),
      ],
      summary: [
        { label: 'Recorded inflow', value: s.ledger.inflow, kind: 'inr' },
        { label: 'Recorded outflow', value: s.ledger.outflow, kind: 'inr' },
        { label: 'Net movement', value: s.ledger.net, kind: 'inr' },
        { label: 'Salaries (net payable)', value: s.salaries.netPayable, kind: 'inr' },
        { label: 'Advances', value: s.advances.amount, kind: 'inr' },
        { label: 'Payments paid in period', value: s.payments.paidInPeriod.amount, kind: 'inr' },
        { label: 'EMI paid in period', value: s.vehicleFinance.paidInPeriod, kind: 'inr' },
        { label: 'Outstanding finance (recorded)', value: s.vehicleFinance.outstanding, kind: 'inr' },
      ],
      tables: [
        {
          title: 'Category-wise totals (ledger)',
          columns: [{ header: 'Type', kind: 'text', width: 2 }, { header: 'Direction', kind: 'text' }, { header: 'Lines', kind: 'count' }, { header: 'Amount', kind: 'inr' }],
          rows: s.ledger.categories.map((c) => [label(LABELS.ledgerType, c.type), c.direction === 'INCOME' ? 'Inflow' : 'Outflow', c.entries, c.amount]),
        },
        {
          title: ctx.range.granularity === 'day' ? 'Date-wise movement' : 'Month-wise movement',
          columns: [{ header: ctx.range.granularity === 'day' ? 'Date' : 'Month', kind: 'text' }, { header: 'Inflow', kind: 'inr' }, { header: 'Outflow', kind: 'inr' }],
          rows: s.ledger.trend.map((b) => [bucketText(b.bucket), b.inflow, b.outflow]),
        },
        {
          title: 'Salaries (pay months in period)',
          columns: [{ header: 'Figure', kind: 'text', width: 2 }, { header: 'Amount', kind: 'inr' }],
          rows: [
            ['Base salary', s.salaries.baseSalary], ['Allowances', s.salaries.allowances], ['Advance recovery', s.salaries.advanceRecovery],
            ['Deductions', s.salaries.deductions], ['Net payable', s.salaries.netPayable],
            [`Pending (${s.salaries.pending.count})`, s.salaries.pending.netPayable], [`Paid (${s.salaries.paid.count})`, s.salaries.paid.netPayable],
            [`Cancelled (${s.salaries.cancelled.count}) — excluded`, s.salaries.cancelled.netPayable],
          ],
        },
        {
          title: 'Payments created in period, by status',
          columns: [{ header: 'Status', kind: 'text', width: 2 }, { header: 'Count', kind: 'count' }, { header: 'Amount', kind: 'inr' }],
          rows: Object.entries(s.payments.byStatus).filter(([, v]) => v.count > 0).map(([status, v]) => [label(LABELS.paymentStatus, status), v.count, v.amount]),
        },
        {
          title: 'Vehicle finance (EMI)',
          columns: [
            { header: 'Vehicle', kind: 'text' }, { header: 'Lender', kind: 'text', width: 1.5 }, { header: 'Loan status', kind: 'text' },
            { header: 'EMI', kind: 'inr' }, { header: 'Due in period', kind: 'inr' }, { header: 'Paid in period', kind: 'inr' },
            { header: 'Overdue', kind: 'inr' }, { header: 'Outstanding', kind: 'inr' },
          ],
          rows: s.vehicleFinance.loans.map((l) => [l.vehicle.registrationNumber, l.lender, label(LABELS.financeStatus, l.status), l.emiAmount, l.dueInPeriod.amount, l.paidInPeriod.amount, l.overdue.amount, l.outstanding]),
        },
        {
          title: 'Employee-wise salary and advances',
          columns: [{ header: 'Employee', kind: 'text', width: 1.5 }, { header: 'Code', kind: 'text' }, { header: 'Salary (net)', kind: 'inr' }, { header: 'Advances', kind: 'inr' }, { header: 'Total', kind: 'inr' }],
          rows: s.byEmployee.map((e) => [e.label, e.code, e.salaryNet, e.advances, e.total]),
        },
        {
          title: 'Ledger lines',
          detail: true,
          totalRecords: total,
          columns: [
            { header: 'Date', kind: 'date' }, { header: 'Type', kind: 'text' }, { header: 'Direction', kind: 'text' },
            { header: 'Employee / driver', kind: 'text', width: 1.5 }, { header: 'Vehicle', kind: 'text' }, { header: 'Description', kind: 'text', width: 2 },
            { header: 'Reversal', kind: 'text' }, { header: 'Payment status', kind: 'text' }, { header: 'Amount', kind: 'inr' },
          ],
          rows: lines.map((l) => [l.date, label(LABELS.ledgerType, l.type), l.direction === 'INCOME' ? 'Inflow' : 'Outflow', l.employee?.name ?? l.driver?.name ?? '', l.vehicle?.registrationNumber ?? '', l.description, l.isReversal ? 'Yes' : '', label(LABELS.paymentStatus, l.paymentStatus), l.amount]),
        },
      ],
      definitions: [
        'This is an operational financial summary of recorded movements, not statutory accounts (no balance sheet, profit and loss or GST return).',
        'Ledger corrections are reversal lines with a negative amount, dated on the day of the correction.',
        'Salaries are included when their pay month falls in the period; cancelled salaries and advances are excluded from totals.',
        '"Paid" means payment status Paid only. Reversed, failed, cancelled and in-progress payments are reported separately.',
        'Outstanding finance = the outstanding balance recorded on each active loan; loans with no recorded balance are not estimated.',
      ],
    };
  }
}
