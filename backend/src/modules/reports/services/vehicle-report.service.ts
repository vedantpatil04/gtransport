import { Injectable } from '@nestjs/common';
import { DocumentState, DocumentType, InstallmentStatus, OperationCategory, Prisma, RecordStatus, VehicleOwnership } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import { REQUIRED_VEHICLE_DOCUMENTS } from '../../documents/documents.service';
import type { VehicleExportQuery, VehicleRecordsQuery, VehicleReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportColumn, type ReportDocument, bucketText } from '../report-document';
import { detailTake, resolveSort, searchText, toReportPage, type DetailLimits, type ReportContext } from '../report-context';
import { documentHealth, fillTrend, litres, money, sortRows, sum, ZERO, type Dec } from '../report-maths';
import { addDays, dateWindow } from '../report-range';
import { ReportLookups } from './report-lookups';

const SORTS = ['registration', 'fuel', 'maintenance', 'tyre', 'other', 'total', 'outstanding'] as const;
type VehicleSort = (typeof SORTS)[number];

export interface VehicleCostRow {
  id: string;
  registrationNumber: string;
  kind: string;
  ownership: VehicleOwnership;
  status: string;
  makeModel: string | null;
  driver: { id: string; name: string } | null;
  fuel: { entries: number; amount: string; litres: string };
  rto: string;
  tyre: string;
  tyreInsurance: string;
  maintenance: string;
  /** RTO + tyre + tyre insurance + maintenance. */
  otherExpenses: string;
  /** Fuel + other expenses. EMI is finance, not running cost, and is never added in. */
  operatingCost: string;
  /** Present only for a FINANCED vehicle with loan terms recorded. Never for a fully owned one. */
  finance: {
    status: string;
    lender: string | null;
    emiAmount: string | null;
    outstanding: string | null;
    nextDueDate: string | null;
    paidInPeriod: string;
    dueInPeriod: string;
    overdueCount: number;
    overdueAmount: string;
  } | null;
  /** Required vehicle documents, as of today. Absent for roles without compliance access. */
  documents?: { expired: number; expiring: number; missing: number; health: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING' };
}

/**
 * Vehicle running costs. Sources: active fuel entries and vehicle expenses, tyre-insurance
 * premiums, EMI instalments (vehicle finance records) and the vehicle's current documents.
 *
 * Costs are aggregated per vehicle in the database and joined in memory, so the whole fleet can
 * be sorted by any cost column. The working set is bounded by the number of vehicles, not by the
 * number of transactions behind them.
 */
@Injectable()
export class VehicleReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: ReportLookups,
  ) {}

  private async compute(ctx: ReportContext, query: VehicleReportQuery, q?: string): Promise<VehicleCostRow[]> {
    const search = searchText(q);
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        companyId: ctx.companyId,
        deletedAt: null,
        ...(query.vehicleId ? { id: query.vehicleId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.ownership ? { ownership: query.ownership } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(search
          ? {
              OR: [
                { registrationNumber: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { make: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { model: { contains: search, mode: Prisma.QueryMode.insensitive } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        registrationNumber: true,
        kind: true,
        ownership: true,
        status: true,
        make: true,
        model: true,
        currentAssignment: { select: { driver: { select: { id: true, employee: { select: { fullName: true } } } } } },
        financing: {
          select: { id: true, status: true, lenderName: true, emiAmount: true, outstandingAmount: true, nextDueDate: true },
        },
      },
    });
    if (!vehicles.length) return [];
    const ids = vehicles.map((v) => v.id);
    const window = dateWindow(ctx.range);
    const scope = { companyId: ctx.companyId, vehicleId: { in: ids } };

    const financingIds = vehicles.filter((v) => v.ownership === VehicleOwnership.FINANCED && v.financing).map((v) => v.financing!.id);
    const [fuel, expenses, policies, paid, due, overdue, documents] = await Promise.all([
      this.prisma.fuelEntry.groupBy({ by: ['vehicleId'], where: { ...scope, status: RecordStatus.ACTIVE, transactionDate: window }, _count: { _all: true }, _sum: { amount: true, litres: true } }),
      this.prisma.vehicleExpense.groupBy({ by: ['vehicleId', 'category'], where: { ...scope, status: RecordStatus.ACTIVE, expenseDate: window }, _sum: { amount: true } }),
      this.prisma.document.findMany({
        where: {
          ...scope,
          type: DocumentType.TYRE_INSURANCE,
          state: { not: DocumentState.ARCHIVED },
          deletedAt: null,
          amount: { gt: 0 },
          OR: [{ issueDate: window }, { issueDate: null, createdAt: { gte: ctx.range.from, lt: addDays(ctx.range.to, 1) } }],
        },
        select: { vehicleId: true, amount: true },
      }),
      financingIds.length
        ? this.prisma.vehicleFinanceInstallment.groupBy({ by: ['financingId'], where: { financingId: { in: financingIds }, status: InstallmentStatus.PAID, paidAt: window }, _sum: { amount: true } })
        : [],
      financingIds.length
        ? this.prisma.vehicleFinanceInstallment.groupBy({ by: ['financingId'], where: { financingId: { in: financingIds }, dueDate: window }, _sum: { amount: true } })
        : [],
      financingIds.length
        ? this.prisma.vehicleFinanceInstallment.groupBy({ by: ['financingId'], where: { financingId: { in: financingIds }, status: InstallmentStatus.PENDING, dueDate: { lt: ctx.today } }, _count: { _all: true }, _sum: { amount: true } })
        : [],
      ctx.visibility.compliance
        ? this.prisma.document.findMany({
            where: { ...scope, state: DocumentState.CURRENT, deletedAt: null, type: { in: REQUIRED_VEHICLE_DOCUMENTS } },
            select: { vehicleId: true, type: true, expiryDate: true },
          })
        : [],
    ]);

    const expenseOf = (vehicleId: string, category: OperationCategory): Dec =>
      expenses.find((e) => e.vehicleId === vehicleId && e.category === category)?._sum.amount ?? ZERO;

    return vehicles.map((v): VehicleCostRow => {
      const f = fuel.find((row) => row.vehicleId === v.id);
      const fuelAmount = f?._sum.amount ?? ZERO;
      const rto = expenseOf(v.id, OperationCategory.RTO);
      const tyre = expenseOf(v.id, OperationCategory.TYRE);
      const maintenance = expenseOf(v.id, OperationCategory.MAINTENANCE);
      const premiums = sum(policies.filter((p) => p.vehicleId === v.id).map((p) => p.amount));
      const other = sum([rto, tyre, maintenance, premiums]);

      const financing = v.ownership === VehicleOwnership.FINANCED ? v.financing : null;
      const overdueRow = financing ? overdue.find((o) => o.financingId === financing.id) : undefined;

      let docs: VehicleCostRow['documents'];
      if (ctx.visibility.compliance) {
        const held = documents.filter((d) => d.vehicleId === v.id);
        let expired = 0;
        let expiring = 0;
        for (const doc of held) {
          const { health } = documentHealth(doc.expiryDate, ctx.today);
          if (health === 'EXPIRED') expired += 1;
          else if (health === 'EXPIRING') expiring += 1;
        }
        const missing = REQUIRED_VEHICLE_DOCUMENTS.filter((type) => !held.some((d) => d.type === type)).length;
        docs = { expired, expiring, missing, health: expired ? 'EXPIRED' : missing ? 'MISSING' : expiring ? 'EXPIRING' : 'VALID' };
      }

      return {
        id: v.id,
        registrationNumber: v.registrationNumber,
        kind: v.kind,
        ownership: v.ownership,
        status: v.status,
        makeModel: [v.make, v.model].filter(Boolean).join(' ') || null,
        driver: v.currentAssignment ? { id: v.currentAssignment.driver.id, name: v.currentAssignment.driver.employee.fullName } : null,
        fuel: { entries: f?._count._all ?? 0, amount: money(fuelAmount), litres: litres(f?._sum.litres) },
        rto: money(rto),
        tyre: money(tyre),
        tyreInsurance: money(premiums),
        maintenance: money(maintenance),
        otherExpenses: money(other),
        operatingCost: money(fuelAmount.plus(other)),
        finance: financing
          ? {
              status: financing.status,
              lender: financing.lenderName,
              emiAmount: financing.emiAmount ? money(financing.emiAmount) : null,
              outstanding: financing.outstandingAmount ? money(financing.outstandingAmount) : null,
              nextDueDate: financing.nextDueDate ? toIsoDate(financing.nextDueDate) : null,
              paidInPeriod: money(paid.find((p) => p.financingId === financing.id)?._sum.amount),
              dueInPeriod: money(due.find((d) => d.financingId === financing.id)?._sum.amount),
              overdueCount: overdueRow?._count._all ?? 0,
              overdueAmount: money(overdueRow?._sum.amount),
            }
          : null,
        ...(docs ? { documents: docs } : {}),
      };
    });
  }

  private sorted(rows: VehicleCostRow[], field: VehicleSort, dir: 'asc' | 'desc'): VehicleCostRow[] {
    const value: Record<VehicleSort, (r: VehicleCostRow) => string | number | null> = {
      registration: (r) => r.registrationNumber,
      fuel: (r) => Number(r.fuel.amount),
      maintenance: (r) => Number(r.maintenance),
      tyre: (r) => Number(r.tyre) + Number(r.tyreInsurance),
      other: (r) => Number(r.otherExpenses),
      total: (r) => Number(r.operatingCost),
      outstanding: (r) => (r.finance?.outstanding ? Number(r.finance.outstanding) : null),
    };
    return sortRows(rows, value[field], dir, (r) => r.registrationNumber);
  }

  async summary(ctx: ReportContext, query: VehicleReportQuery) {
    return this.summarise(ctx, query, await this.compute(ctx, query));
  }

  private async summarise(ctx: ReportContext, query: VehicleReportQuery, rows: VehicleCostRow[]) {
    const total = (pick: (r: VehicleCostRow) => string) => money(sum(rows.map(pick)));
    const top = (pick: (r: VehicleCostRow) => string) => {
      const best = [...rows].sort((a, b) => Number(pick(b)) - Number(pick(a)))[0];
      return best && Number(pick(best)) > 0 ? { id: best.id, label: best.registrationNumber, amount: pick(best) } : null;
    };
    const financed = rows.filter((r) => r.finance);

    // The cost trend for one vehicle when one is chosen; otherwise for the vehicles in view.
    const trendScope = { companyId: ctx.companyId, vehicleId: { in: rows.map((r) => r.id) } };
    const [fuelByDay, opsByDay] = rows.length
      ? await Promise.all([
          this.prisma.fuelEntry.groupBy({ by: ['transactionDate'], where: { ...trendScope, status: RecordStatus.ACTIVE, transactionDate: dateWindow(ctx.range) }, _sum: { amount: true } }),
          this.prisma.vehicleExpense.groupBy({ by: ['expenseDate', 'category'], where: { ...trendScope, status: RecordStatus.ACTIVE, expenseDate: dateWindow(ctx.range) }, _sum: { amount: true } }),
        ])
      : [[], []];

    return {
      vehicles: rows.length,
      totals: {
        fuel: total((r) => r.fuel.amount),
        rto: total((r) => r.rto),
        tyre: total((r) => r.tyre),
        tyreInsurance: total((r) => r.tyreInsurance),
        maintenance: total((r) => r.maintenance),
        otherExpenses: total((r) => r.otherExpenses),
        operatingCost: total((r) => r.operatingCost),
      },
      finance: {
        financedVehicles: financed.length,
        // Only balances actually recorded on the loan; vehicles without one are not guessed at.
        outstanding: money(sum(financed.map((r) => r.finance?.outstanding ?? 0))),
        outstandingRecorded: financed.filter((r) => r.finance?.outstanding !== null).length,
        paidInPeriod: money(sum(financed.map((r) => r.finance?.paidInPeriod ?? 0))),
        overdueInstallments: financed.reduce((n, r) => n + (r.finance?.overdueCount ?? 0), 0),
      },
      highest: {
        operatingCost: top((r) => r.operatingCost),
        fuel: top((r) => r.fuel.amount),
        maintenance: top((r) => r.maintenance),
      },
      comparison: this.sorted(rows, 'total', 'desc')
        .filter((r) => Number(r.operatingCost) > 0)
        .slice(0, 10)
        .map((r) => ({ id: r.id, label: r.registrationNumber, fuel: r.fuel.amount, maintenance: r.maintenance, tyre: money(Number(r.tyre) + Number(r.tyreInsurance)), rto: r.rto, total: r.operatingCost })),
      trend: fillTrend(
        ctx.range,
        [
          ...fuelByDay.map((row) => ({ date: row.transactionDate, fuel: row._sum.amount, total: row._sum.amount })),
          ...opsByDay.map((row) => ({ date: row.expenseDate, other: row._sum.amount, total: row._sum.amount })),
        ],
        ['fuel', 'other', 'total'] as const,
      ),
      trendScope: query.vehicleId ? (rows[0]?.registrationNumber ?? null) : null,
    };
  }

  async records(ctx: ReportContext, query: VehicleRecordsQuery) {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'total', dir: 'desc' });
    const rows = this.sorted(await this.compute(ctx, query, query.q), sort.field, sort.dir);
    const start = (query.page - 1) * query.pageSize;
    return toReportPage(rows.slice(start, start + query.pageSize), rows.length, query, sort);
  }

  async document(ctx: ReportContext, query: VehicleExportQuery, limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'registration', dir: 'asc' });
    const all = await this.compute(ctx, query, query.q);
    const summary = await this.summarise(ctx, query, all);
    const rows = this.sorted(all, sort.field, sort.dir).slice(0, detailTake(all.length, limits));
    const showDocs = ctx.visibility.compliance;

    const columns: ReportColumn[] = [
      { header: 'Vehicle', kind: 'text' }, { header: 'Type', kind: 'text' }, { header: 'Ownership', kind: 'text' },
      { header: 'Status', kind: 'text' }, { header: 'Driver', kind: 'text', width: 1.5 },
      { header: 'Fuel', kind: 'inr' }, { header: 'Litres', kind: 'litres' }, { header: 'RTO', kind: 'inr' },
      { header: 'Tyre', kind: 'inr' }, { header: 'Tyre insurance', kind: 'inr' }, { header: 'Maintenance', kind: 'inr' },
      { header: 'Operating cost', kind: 'inr' }, { header: 'EMI', kind: 'inr' }, { header: 'EMI paid in period', kind: 'inr' },
      { header: 'Outstanding finance', kind: 'inr' }, { header: 'Overdue EMIs', kind: 'count' },
      ...(showDocs ? [{ header: 'Documents', kind: 'text' as const }] : []),
    ];
    const docText = (r: VehicleCostRow) => {
      if (!r.documents) return '';
      const parts = [r.documents.expired && `${r.documents.expired} expired`, r.documents.missing && `${r.documents.missing} missing`, r.documents.expiring && `${r.documents.expiring} expiring`].filter(Boolean);
      return parts.length ? parts.join(', ') : 'All valid';
    };

    return {
      title: REPORT_TITLES.vehicles,
      filters: [
        ...(await this.lookups.filterLabels(ctx.companyId, query)),
        ...(query.status ? [{ label: 'Status', value: label(LABELS.vehicleStatus, query.status) }] : []),
        ...(query.ownership ? [{ label: 'Ownership', value: label(LABELS.ownership, query.ownership) }] : []),
        ...(query.kind ? [{ label: 'Type', value: label(LABELS.vehicleKind, query.kind) }] : []),
        ...(query.q ? [{ label: 'Search', value: query.q }] : []),
      ],
      summary: [
        { label: 'Vehicles', value: summary.vehicles, kind: 'count' },
        { label: 'Fuel', value: summary.totals.fuel, kind: 'inr' },
        { label: 'Other expenses', value: summary.totals.otherExpenses, kind: 'inr' },
        { label: 'Operating cost', value: summary.totals.operatingCost, kind: 'inr' },
        { label: 'Financed vehicles', value: summary.finance.financedVehicles, kind: 'count' },
        { label: 'Outstanding finance (recorded)', value: summary.finance.outstanding, kind: 'inr' },
        { label: 'Highest operating cost', value: summary.highest.operatingCost ? `${summary.highest.operatingCost.label} · ${summary.highest.operatingCost.amount}` : null, kind: 'text' },
      ],
      tables: [
        {
          title: 'Vehicle cost summary',
          detail: true,
          totalRecords: all.length,
          columns,
          rows: rows.map((r) => [
            r.registrationNumber, label(LABELS.vehicleKind, r.kind), label(LABELS.ownership, r.ownership), label(LABELS.vehicleStatus, r.status),
            r.driver?.name ?? '', r.fuel.amount, r.fuel.litres, r.rto, r.tyre, r.tyreInsurance, r.maintenance, r.operatingCost,
            r.finance?.emiAmount ?? null, r.finance?.paidInPeriod ?? null, r.finance?.outstanding ?? null, r.finance ? r.finance.overdueCount : null,
            ...(showDocs ? [docText(r)] : []),
          ]),
          totals: [
            'Total', '', '', '', '', summary.totals.fuel, litres(sum(all.map((r) => r.fuel.litres))), summary.totals.rto,
            summary.totals.tyre, summary.totals.tyreInsurance, summary.totals.maintenance, summary.totals.operatingCost,
            null, summary.finance.paidInPeriod, summary.finance.outstanding, summary.finance.overdueInstallments, ...(showDocs ? [''] : []),
          ],
          note: 'EMI columns are blank for vehicles that are fully owned or have no loan terms recorded.',
        },
        {
          title: 'Vehicle cost trend',
          columns: [{ header: ctx.range.granularity === 'day' ? 'Date' : 'Month', kind: 'text' }, { header: 'Fuel', kind: 'inr' }, { header: 'Other expenses', kind: 'inr' }, { header: 'Total', kind: 'inr' }],
          rows: summary.trend.map((b) => [bucketText(b.bucket), b.fuel, b.other, b.total]),
          note: 'Other expenses in the trend are vehicle expense records (RTO, tyre, maintenance); tyre-insurance premiums appear in the totals above.',
        },
      ],
      definitions: [
        'Operating cost = fuel + RTO + tyre + tyre insurance + maintenance in the period. EMI is finance, shown separately, and never added to operating cost.',
        'Outstanding finance = the outstanding balance recorded on each active loan; vehicles with no recorded balance are not estimated.',
        'Overdue EMIs = unpaid instalments whose due date has passed, as of today.',
      ],
    };
  }
}
