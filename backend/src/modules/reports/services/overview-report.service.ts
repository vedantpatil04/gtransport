import { Injectable } from '@nestjs/common';
import { DriverStatus, FleetAlertStatus, InstallmentStatus, LedgerDirection, PaymentStatus, VehicleStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import { LocationsService } from '../../locations/locations.service';
import type { OverviewExportQuery, OverviewReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportDocument, bucketText } from '../report-document';
import type { DetailLimits, ReportContext } from '../report-context';
import { money, OPEN_PAYMENT_STATUSES, paymentStatusTotals, percentChange, sum } from '../report-maths';
import { dateWindow, financialYearOverYear, formatDay, instantWindow, monthOverMonth, type ComparisonPeriods } from '../report-range';
import { ComplianceReportService } from './compliance-report.service';
import { ExpenseReportService } from './expense-report.service';

/**
 * The management overview: the headline figures from each report, for the selected period.
 *
 * It owns no arithmetic of its own — spend comes from the expense report, document health from
 * the compliance report, live tracking from the fleet service — so a figure here always equals
 * the same figure on its own report. Sections the viewer's role may not see are left out of the
 * response entirely, and the screen shows nothing for them rather than a zero.
 */
@Injectable()
export class OverviewReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpenseReportService,
    private readonly compliance: ComplianceReportService,
    private readonly locations: LocationsService,
  ) {}

  private async comparison(companyId: string, periods: ComparisonPeriods) {
    const [current, previous] = await Promise.all([
      this.expenses.spendBetween(companyId, periods.current.from, periods.current.to),
      this.expenses.spendBetween(companyId, periods.previous.from, periods.previous.to),
    ]);
    return {
      current: { from: toIsoDate(periods.current.from), to: toIsoDate(periods.current.to), amount: money(current) },
      previous: { from: toIsoDate(periods.previous.from), to: toIsoDate(periods.previous.to), amount: money(previous) },
      changePct: percentChange(current, previous),
    };
  }

  async summary(ctx: ReportContext, _query: OverviewReportQuery) {
    const spend = await this.expenses.summary(ctx, {});
    const category = (c: string) => spend.byCategory.find((row) => row.category === c)?.amount ?? '0.00';
    const otherExpenses = money(sum(['RTO', 'TYRE', 'TYRE_INSURANCE', 'MAINTENANCE'].map(category)));
    const topBy = (c: 'FUEL' | 'MAINTENANCE' | null) => {
      const ranked = [...spend.byVehicle]
        .map((v) => ({ id: v.id, label: v.label, amount: c ? v.byCategory[c] : v.amount }))
        .filter((v) => v.id && Number(v.amount) > 0)
        .sort((a, b) => Number(b.amount) - Number(a.amount));
      return ranked[0] ?? null;
    };

    const [monthComparison, yearComparison, activeVehicles, fleetVehicles, activeDrivers] = await Promise.all([
      this.comparison(ctx.companyId, monthOverMonth(ctx.now)),
      this.comparison(ctx.companyId, financialYearOverYear(ctx.now)),
      this.prisma.vehicle.count({ where: { companyId: ctx.companyId, deletedAt: null, status: VehicleStatus.ACTIVE } }),
      this.prisma.vehicle.count({ where: { companyId: ctx.companyId, deletedAt: null, status: { not: VehicleStatus.RETIRED } } }),
      this.prisma.driver.count({ where: { companyId: ctx.companyId, deletedAt: null, status: DriverStatus.ACTIVE } }),
    ]);

    return {
      spend: {
        total: spend.total,
        fuel: category('FUEL'),
        otherExpenses,
        maintenance: category('MAINTENANCE'),
        tyre: category('TYRE'),
        tyreInsurance: category('TYRE_INSURANCE'),
        rto: category('RTO'),
        byCategory: spend.byCategory,
        trend: spend.trend,
        vehicleComparison: spend.byVehicle.filter((v) => v.id).slice(0, 10),
      },
      highlights: {
        topExpenseVehicle: topBy(null),
        highestFuelVehicle: topBy('FUEL'),
        highestMaintenanceVehicle: topBy('MAINTENANCE'),
      },
      comparisons: { monthOverMonth: monthComparison, financialYearOverYear: yearComparison },
      fleet: { activeVehicles, vehicles: fleetVehicles, activeDrivers },
      ...(ctx.visibility.payments ? { finance: await this.finance(ctx) } : {}),
      ...(ctx.visibility.compliance ? { compliance: (await this.compliance.summary(ctx, {})).totals } : {}),
      ...(ctx.visibility.location ? { location: await this.location(ctx) } : {}),
    };
  }

  private async finance(ctx: ReportContext) {
    const instants = instantWindow(ctx.range);
    const [paid, open, byStatus, emiPaid, outflow] = await Promise.all([
      this.prisma.paymentRecord.aggregate({ where: { companyId: ctx.companyId, status: PaymentStatus.PAID, paidAt: instants }, _count: { _all: true }, _sum: { amount: true } }),
      // Point in time: what is waiting right now, whenever it was created.
      this.prisma.paymentRecord.aggregate({ where: { companyId: ctx.companyId, status: { in: OPEN_PAYMENT_STATUSES } }, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.paymentRecord.groupBy({ by: ['status'], where: { companyId: ctx.companyId, createdAt: instants }, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.vehicleFinanceInstallment.aggregate({
        where: { financing: { vehicle: { companyId: ctx.companyId } }, status: InstallmentStatus.PAID, paidAt: dateWindow(ctx.range) },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.financeLedgerEntry.aggregate({ where: { companyId: ctx.companyId, direction: LedgerDirection.EXPENSE, transactionDate: dateWindow(ctx.range) }, _sum: { amount: true } }),
    ]);
    return {
      paymentsPaid: { count: paid._count._all, amount: money(paid._sum.amount) },
      pendingPayments: { count: open._count._all, amount: money(open._sum.amount) },
      paymentStatus: paymentStatusTotals(byStatus.map((r) => ({ status: r.status, count: r._count._all, amount: r._sum.amount }))).byGroup,
      emiPaid: { count: emiPaid._count._all, amount: money(emiPaid._sum.amount) },
      ledgerOutflow: money(outflow._sum.amount),
    };
  }

  private async location(ctx: ReportContext) {
    const [fleet, activeAlerts] = await Promise.all([
      this.locations.fleet(ctx.companyId, ctx.role, {}),
      this.prisma.fleetLocationAlert.count({ where: { companyId: ctx.companyId, status: FleetAlertStatus.ACTIVE } }),
    ]);
    return { tracked: fleet.summary.total, active: fleet.summary.active, stale: fleet.summary.stale, offline: fleet.summary.offline, activeAlerts };
  }

  async document(ctx: ReportContext, query: OverviewExportQuery, _limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const s = await this.summary(ctx, query);
    const cmp = (title: string, c: typeof s.comparisons.monthOverMonth) => [
      title,
      `${formatDay(new Date(`${c.current.from}T00:00:00Z`))} – ${formatDay(new Date(`${c.current.to}T00:00:00Z`))}`,
      c.current.amount,
      `${formatDay(new Date(`${c.previous.from}T00:00:00Z`))} – ${formatDay(new Date(`${c.previous.to}T00:00:00Z`))}`,
      c.previous.amount,
      c.changePct === null ? null : c.changePct,
    ];

    return {
      title: REPORT_TITLES.overview,
      summary: [
        { label: 'Total operational spend', value: s.spend.total, kind: 'inr' },
        { label: 'Fuel', value: s.spend.fuel, kind: 'inr' },
        { label: 'Other expenses', value: s.spend.otherExpenses, kind: 'inr' },
        { label: 'Maintenance', value: s.spend.maintenance, kind: 'inr' },
        { label: 'Tyres (purchases)', value: s.spend.tyre, kind: 'inr' },
        { label: 'Active vehicles', value: s.fleet.activeVehicles, kind: 'count' },
        { label: 'Active drivers', value: s.fleet.activeDrivers, kind: 'count' },
        ...(s.finance
          ? [
              { label: 'Payments paid in period', value: s.finance.paymentsPaid.amount, kind: 'inr' as const },
              { label: 'Payments pending (now)', value: s.finance.pendingPayments.amount, kind: 'inr' as const },
              { label: 'EMI paid in period', value: s.finance.emiPaid.amount, kind: 'inr' as const },
            ]
          : []),
        ...(s.compliance
          ? [
              { label: 'Documents expired', value: s.compliance.expired, kind: 'count' as const },
              { label: 'Documents expiring (30 days)', value: s.compliance.expiring, kind: 'count' as const },
              { label: 'Documents missing', value: s.compliance.missing, kind: 'count' as const },
            ]
          : []),
      ],
      tables: [
        {
          title: 'Spend by category',
          columns: [{ header: 'Category', kind: 'text', width: 2 }, { header: 'Records', kind: 'count' }, { header: 'Share', kind: 'percent' }, { header: 'Amount', kind: 'inr' }],
          rows: s.spend.byCategory.map((c) => [label(LABELS.expenseCategory, c.category), c.entries, c.share, c.amount]),
          totals: ['Total', s.spend.byCategory.reduce((n, c) => n + c.entries, 0), null, s.spend.total],
        },
        {
          title: 'Comparisons (operational spend)',
          columns: [{ header: 'Comparison', kind: 'text', width: 1.5 }, { header: 'Current period', kind: 'text', width: 1.5 }, { header: 'Current', kind: 'inr' }, { header: 'Previous period', kind: 'text', width: 1.5 }, { header: 'Previous', kind: 'inr' }, { header: 'Change', kind: 'percent' }],
          rows: [cmp('Month to date vs same days last month', s.comparisons.monthOverMonth), cmp('Financial year to date vs same span last year', s.comparisons.financialYearOverYear)],
        },
        {
          title: 'Highest-cost vehicles',
          columns: [{ header: 'Measure', kind: 'text', width: 2 }, { header: 'Vehicle', kind: 'text' }, { header: 'Amount', kind: 'inr' }],
          rows: [
            ['Top expense vehicle', s.highlights.topExpenseVehicle?.label ?? null, s.highlights.topExpenseVehicle?.amount ?? null],
            ['Highest fuel spend', s.highlights.highestFuelVehicle?.label ?? null, s.highlights.highestFuelVehicle?.amount ?? null],
            ['Highest maintenance spend', s.highlights.highestMaintenanceVehicle?.label ?? null, s.highlights.highestMaintenanceVehicle?.amount ?? null],
          ],
        },
        {
          title: ctx.range.granularity === 'day' ? 'Daily spend' : 'Monthly spend',
          columns: [
            { header: ctx.range.granularity === 'day' ? 'Date' : 'Month', kind: 'text' }, { header: 'Fuel', kind: 'inr' }, { header: 'RTO', kind: 'inr' },
            { header: 'Tyre', kind: 'inr' }, { header: 'Tyre insurance', kind: 'inr' }, { header: 'Maintenance', kind: 'inr' }, { header: 'Total', kind: 'inr' },
          ],
          rows: s.spend.trend.map((b) => [bucketText(b.bucket), b.FUEL, b.RTO, b.TYRE, b.TYRE_INSURANCE, b.MAINTENANCE, b.total]),
        },
        ...(s.finance
          ? [{
              title: 'Payments created in period, by status',
              columns: [{ header: 'Status', kind: 'text' as const, width: 2 }, { header: 'Count', kind: 'count' as const }, { header: 'Amount', kind: 'inr' as const }],
              rows: Object.entries(s.finance.paymentStatus).map(([group, v]) => [label(LABELS.paymentGroup, group), v.count, v.amount]),
            }]
          : []),
      ],
      definitions: [
        'Operational spend = fuel + RTO + tyre + tyre insurance + maintenance/service, from their own records (archived records excluded).',
        'Comparisons use like-for-like spans: month to date against the same days of last month, and financial year to date against the same span of the previous financial year (1 April – 31 March).',
        ...(s.finance ? ['"Paid" counts only payments with status Paid. Pending payments are those awaiting approval, approved, processing or awaiting a status check, as of now.'] : []),
      ],
    };
  }
}
