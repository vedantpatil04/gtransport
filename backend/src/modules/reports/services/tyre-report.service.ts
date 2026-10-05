import { Injectable } from '@nestjs/common';
import { DocumentState, DocumentType, OperationCategory, Prisma, RecordStatus, VehicleStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import type { TyreExportQuery, TyreRecordsQuery, TyreReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportDocument } from '../report-document';
import { detailTake, resolveSort, searchText, skipTake, toReportPage, type DetailLimits, type ReportContext } from '../report-context';
import { documentHealth, fillTrend, money, sum, ZERO, type Dec } from '../report-maths';
import { addDays, dateWindow } from '../report-range';
import { ReportLookups } from './report-lookups';

const EXPENSE_SORTS = ['date', 'amount', 'vehicle'] as const;
const POLICY_SORTS = ['date', 'amount', 'vehicle', 'expiry'] as const;

const EXPENSE_ROW = {
  id: true,
  expenseDate: true,
  amount: true,
  vendorName: true,
  description: true,
  receiptFileId: true,
  vehicle: { select: { id: true, registrationNumber: true } },
  driver: { select: { id: true, employee: { select: { fullName: true } } } },
} as const;

const POLICY_ROW = {
  id: true,
  issuer: true,
  documentNumber: true,
  amount: true,
  issueDate: true,
  expiryDate: true,
  createdAt: true,
  state: true,
  verificationStatus: true,
  fileId: true,
  vehicle: { select: { id: true, registrationNumber: true } },
} as const;
type PolicyRow = Prisma.DocumentGetPayload<{ select: typeof POLICY_ROW }>;

/**
 * Tyres, in the two forms the data model records them:
 *  - tyre purchases and replacements: active vehicle expense records in the Tyre category;
 *  - tyre insurance: tyre-insurance policies (a premium and an expiry) stored as documents.
 *
 * Tyre brand, size, serial number, position and warranty are not captured by the current data
 * model, so this report shows none of them rather than inventing values for older records.
 * Tyre-related workshop jobs recorded as maintenance appear in the Maintenance report.
 */
@Injectable()
export class TyreReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: ReportLookups,
  ) {}

  private expenseWhere(ctx: ReportContext, query: TyreReportQuery, q?: string): Prisma.VehicleExpenseWhereInput {
    const search = searchText(q);
    return {
      companyId: ctx.companyId,
      category: OperationCategory.TYRE,
      status: RecordStatus.ACTIVE,
      expenseDate: dateWindow(ctx.range),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(search
        ? {
            OR: [
              { vendorName: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { description: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { vehicle: { registrationNumber: { contains: search, mode: Prisma.QueryMode.insensitive } } },
            ],
          }
        : {}),
    };
  }

  /** Policies whose premium falls in the period: the same dating rule as the expense report and ledger. */
  private policyWhere(ctx: ReportContext, query: TyreReportQuery, q?: string): Prisma.DocumentWhereInput {
    const search = searchText(q);
    return {
      companyId: ctx.companyId,
      type: DocumentType.TYRE_INSURANCE,
      state: { not: DocumentState.ARCHIVED },
      deletedAt: null,
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      AND: [
        { OR: [{ issueDate: dateWindow(ctx.range) }, { issueDate: null, createdAt: { gte: ctx.range.from, lt: addDays(ctx.range.to, 1) } }] },
        ...(search
          ? [{ OR: [
              { issuer: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { documentNumber: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { vehicle: { registrationNumber: { contains: search, mode: Prisma.QueryMode.insensitive } } },
            ] }]
          : []),
      ],
    };
  }

  private policyDate(p: { issueDate: Date | null; createdAt: Date }): Date {
    return p.issueDate ?? new Date(`${p.createdAt.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }

  async summary(ctx: ReportContext, query: TyreReportQuery, q?: string) {
    const expenseWhere = this.expenseWhere(ctx, query, q);
    const [totals, byDay, byVehicle, policies, current, activeVehicles] = await Promise.all([
      this.prisma.vehicleExpense.aggregate({ where: expenseWhere, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.vehicleExpense.groupBy({ by: ['expenseDate'], where: expenseWhere, _sum: { amount: true } }),
      this.prisma.vehicleExpense.groupBy({ by: ['vehicleId'], where: expenseWhere, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.document.findMany({ where: this.policyWhere(ctx, query, q), select: { vehicleId: true, amount: true, issueDate: true, createdAt: true } }),
      // Cover as of today: each active vehicle's current tyre-insurance policy.
      this.prisma.document.findMany({
        where: {
          companyId: ctx.companyId,
          type: DocumentType.TYRE_INSURANCE,
          state: DocumentState.CURRENT,
          deletedAt: null,
          vehicle: { deletedAt: null, status: { not: VehicleStatus.RETIRED } },
          ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
        },
        select: { vehicleId: true, expiryDate: true },
      }),
      this.prisma.vehicle.count({ where: { companyId: ctx.companyId, deletedAt: null, status: { not: VehicleStatus.RETIRED }, ...(query.vehicleId ? { id: query.vehicleId } : {}) } }),
    ]);

    const premiums = sum(policies.map((p) => p.amount));
    const perVehicle = new Map<string, { tyre: Dec; tyreEntries: number; premium: Dec; policies: number }>();
    const slot = (id: string) => perVehicle.get(id) ?? { tyre: ZERO, tyreEntries: 0, premium: ZERO, policies: 0 };
    for (const row of byVehicle) perVehicle.set(row.vehicleId, { ...slot(row.vehicleId), tyre: row._sum.amount ?? ZERO, tyreEntries: row._count._all });
    for (const p of policies) {
      if (!p.vehicleId) continue;
      const s = slot(p.vehicleId);
      perVehicle.set(p.vehicleId, { ...s, premium: s.premium.plus(p.amount ?? ZERO), policies: s.policies + 1 });
    }
    const names = await this.lookups.vehicles(ctx.companyId, [...perVehicle.keys()]);

    const cover = { valid: 0, expiring: 0, expired: 0 };
    for (const doc of current) {
      const { health } = documentHealth(doc.expiryDate, ctx.today);
      if (health === 'VALID') cover.valid += 1;
      else if (health === 'EXPIRING') cover.expiring += 1;
      else cover.expired += 1;
    }
    const covered = new Set(current.map((d) => d.vehicleId));

    return {
      expenses: { entries: totals._count._all, amount: money(totals._sum.amount) },
      insurance: { policies: policies.length, premiums: money(premiums) },
      total: money((totals._sum.amount ?? ZERO).plus(premiums)),
      cover: { ...cover, missing: Math.max(0, activeVehicles - covered.size), vehicles: activeVehicles },
      byVehicle: [...perVehicle.entries()]
        .map(([id, v]) => ({ id, label: names.get(id) ?? '—', tyre: money(v.tyre), tyreEntries: v.tyreEntries, premium: money(v.premium), policies: v.policies, total: money(v.tyre.plus(v.premium)) }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
      trend: fillTrend(
        ctx.range,
        [...byDay.map((r) => ({ date: r.expenseDate, tyre: r._sum.amount })), ...policies.map((p) => ({ date: this.policyDate(p), premium: p.amount }))],
        ['tyre', 'premium'] as const,
      ),
      /** The data model records no tyre brand, size, serial, position or warranty. */
      tyreDetailsRecorded: false,
    };
  }

  // ───────────────────────────── Records ─────────────────────────────

  private async expenseRows(ctx: ReportContext, query: TyreReportQuery, q: string | undefined, sort: { field: (typeof EXPENSE_SORTS)[number]; dir: 'asc' | 'desc' }, window: { skip?: number; take: number }) {
    const order: Record<(typeof EXPENSE_SORTS)[number], Prisma.VehicleExpenseOrderByWithRelationInput> = {
      date: { expenseDate: sort.dir }, amount: { amount: sort.dir }, vehicle: { vehicle: { registrationNumber: sort.dir } },
    };
    const rows = await this.prisma.vehicleExpense.findMany({ where: this.expenseWhere(ctx, query, q), select: EXPENSE_ROW, orderBy: [order[sort.field], { expenseDate: 'desc' }, { id: sort.dir }], ...window });
    return rows.map((r) => ({
      id: r.id,
      date: toIsoDate(r.expenseDate),
      vehicle: r.vehicle,
      driver: r.driver ? { id: r.driver.id, name: r.driver.employee.fullName } : null,
      vendor: r.vendorName,
      description: r.description,
      amount: money(r.amount),
      receiptFileId: r.receiptFileId,
    }));
  }

  private presentPolicy(ctx: ReportContext, p: PolicyRow) {
    const { health, daysRemaining } = documentHealth(p.expiryDate, ctx.today);
    return {
      id: p.id,
      vehicle: p.vehicle,
      insurer: p.issuer,
      policyNumber: p.documentNumber,
      premium: p.amount ? money(p.amount) : null,
      startDate: p.issueDate ? toIsoDate(p.issueDate) : null,
      recordedOn: toIsoDate(this.policyDate(p)),
      expiryDate: p.expiryDate ? toIsoDate(p.expiryDate) : null,
      daysRemaining,
      health: p.state === DocumentState.SUPERSEDED ? 'SUPERSEDED' : health,
      verification: p.verificationStatus,
      fileId: p.fileId,
    };
  }

  private async policyRows(ctx: ReportContext, query: TyreReportQuery, q: string | undefined, sort: { field: (typeof POLICY_SORTS)[number]; dir: 'asc' | 'desc' }, window: { skip?: number; take: number }) {
    const order: Record<(typeof POLICY_SORTS)[number], Prisma.DocumentOrderByWithRelationInput> = {
      date: { issueDate: { sort: sort.dir, nulls: 'last' } },
      amount: { amount: { sort: sort.dir, nulls: 'last' } },
      vehicle: { vehicle: { registrationNumber: sort.dir } },
      expiry: { expiryDate: { sort: sort.dir, nulls: 'last' } },
    };
    const rows = await this.prisma.document.findMany({ where: this.policyWhere(ctx, query, q), select: POLICY_ROW, orderBy: [order[sort.field], { createdAt: 'desc' }, { id: sort.dir }], ...window });
    return rows.map((p) => this.presentPolicy(ctx, p));
  }

  async records(ctx: ReportContext, query: TyreRecordsQuery) {
    if (query.section === 'policies') {
      const sort = resolveSort(query.sort, query.dir, POLICY_SORTS, { field: 'date', dir: 'desc' });
      const [rows, total] = await Promise.all([this.policyRows(ctx, query, query.q, sort, skipTake(query)), this.prisma.document.count({ where: this.policyWhere(ctx, query, query.q) })]);
      return { section: 'policies' as const, ...toReportPage(rows, total, query, sort) };
    }
    const sort = resolveSort(query.sort, query.dir, EXPENSE_SORTS, { field: 'date', dir: 'desc' });
    const [rows, total] = await Promise.all([this.expenseRows(ctx, query, query.q, sort, skipTake(query)), this.prisma.vehicleExpense.count({ where: this.expenseWhere(ctx, query, query.q) })]);
    return { section: 'expenses' as const, ...toReportPage(rows, total, query, sort) };
  }

  async document(ctx: ReportContext, query: TyreExportQuery, limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const [s, expenseTotal, policyTotal] = await Promise.all([
      this.summary(ctx, query, query.q),
      this.prisma.vehicleExpense.count({ where: this.expenseWhere(ctx, query, query.q) }),
      this.prisma.document.count({ where: this.policyWhere(ctx, query, query.q) }),
    ]);
    const expenseTake = detailTake(expenseTotal, limits);
    const policyTake = detailTake(policyTotal, limits);
    const [expenses, policies] = await Promise.all([
      expenseTake ? this.expenseRows(ctx, query, query.q, { field: 'date', dir: 'asc' }, { take: expenseTake }) : [],
      policyTake ? this.policyRows(ctx, query, query.q, { field: 'date', dir: 'asc' }, { take: policyTake }) : [],
    ]);

    return {
      title: REPORT_TITLES.tyres,
      filters: [
        ...(await this.lookups.filterLabels(ctx.companyId, query)).map((f) => (f.label === 'Driver' ? { ...f, label: 'Driver (tyre expenses only)' } : f)),
        ...(query.q ? [{ label: 'Search', value: query.q }] : []),
      ],
      summary: [
        { label: 'Tyre purchases & replacements', value: s.expenses.amount, kind: 'inr' },
        { label: 'Tyre expense records', value: s.expenses.entries, kind: 'count' },
        { label: 'Tyre insurance premiums', value: s.insurance.premiums, kind: 'inr' },
        { label: 'Total tyre cost', value: s.total, kind: 'inr' },
        { label: 'Vehicles with valid tyre insurance (today)', value: s.cover.valid, kind: 'count' },
        { label: 'Tyre insurance expiring / expired / missing', value: `${s.cover.expiring} / ${s.cover.expired} / ${s.cover.missing}`, kind: 'text' },
      ],
      tables: [
        {
          title: 'Vehicle-wise tyre cost',
          columns: [{ header: 'Vehicle', kind: 'text' }, { header: 'Tyre records', kind: 'count' }, { header: 'Tyre purchases', kind: 'inr' }, { header: 'Policies', kind: 'count' }, { header: 'Premiums', kind: 'inr' }, { header: 'Total', kind: 'inr' }],
          rows: s.byVehicle.map((v) => [v.label, v.tyreEntries, v.tyre, v.policies, v.premium, v.total]),
        },
        {
          title: 'Tyre purchases and replacements',
          detail: true,
          totalRecords: expenseTotal,
          columns: [
            { header: 'Date', kind: 'date' }, { header: 'Vehicle', kind: 'text' }, { header: 'Driver', kind: 'text', width: 1.5 },
            { header: 'Vendor', kind: 'text', width: 1.5 }, { header: 'Description', kind: 'text', width: 2 }, { header: 'Amount', kind: 'inr' }, { header: 'Receipt', kind: 'text' },
          ],
          rows: expenses.map((e) => [e.date, e.vehicle.registrationNumber, e.driver?.name ?? '', e.vendor, e.description, e.amount, e.receiptFileId ? 'Attached' : 'None']),
          totals: ['Total', '', '', '', '', s.expenses.amount, ''],
          note: 'Tyre brand, size, serial number, position and warranty are not recorded by the system and are therefore not shown.',
        },
        {
          title: 'Tyre insurance policies',
          detail: true,
          totalRecords: policyTotal,
          columns: [
            { header: 'Vehicle', kind: 'text' }, { header: 'Insurer', kind: 'text', width: 1.5 }, { header: 'Policy no.', kind: 'text' },
            { header: 'Start', kind: 'date' }, { header: 'Expiry', kind: 'date' }, { header: 'Status', kind: 'text' },
            { header: 'Verification', kind: 'text' }, { header: 'Premium', kind: 'inr' },
          ],
          rows: policies.map((p) => [p.vehicle?.registrationNumber ?? '', p.insurer, p.policyNumber, p.startDate, p.expiryDate, p.health === 'SUPERSEDED' ? 'Replaced' : label(LABELS.documentHealth, p.health), label(LABELS.verification, p.verification), p.premium]),
          totals: ['Total', '', '', '', '', '', '', s.insurance.premiums],
        },
      ],
      definitions: [
        'Tyre purchases & replacements: active tyre expense records. Tyre insurance: premiums on tyre-insurance policies dated in the period (start date, or the day recorded when no start date was given).',
        'Tyre insurance status is as of today; "expiring" means within 30 days.',
      ],
    };
  }
}
