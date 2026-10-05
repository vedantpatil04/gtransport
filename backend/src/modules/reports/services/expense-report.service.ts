import { Injectable } from '@nestjs/common';
import { DocumentState, DocumentType, OperationCategory, Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import { EXPENSE_CATEGORIES, type ExpenseCategory, type ExpenseExportQuery, type ExpenseRecordsQuery, type ExpenseReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportDocument, bucketText } from '../report-document';
import { detailTake, resolveSort, searchText, skipTake, toReportPage, type DetailLimits, type ReportContext } from '../report-context';
import { fillTrend, money, share, sum, ZERO, type Dec } from '../report-maths';
import { addDays, dateWindow } from '../report-range';
import { ReportLookups } from './report-lookups';

const SORTS = ['date', 'amount', 'category', 'vehicle', 'driver'] as const;
type ExpenseSort = (typeof SORTS)[number];

/** Fixed SQL fragments for each sortable column. Only these strings ever reach ORDER BY. */
const ORDER_SQL: Record<ExpenseSort, string> = {
  date: 'x.date',
  amount: 'x.amount',
  category: 'x.category',
  vehicle: 'v.registration_number',
  driver: 'em.full_name',
};

const OPERATION_CATEGORIES: Record<Exclude<ExpenseCategory, 'FUEL' | 'TYRE_INSURANCE'>, OperationCategory> = {
  RTO: OperationCategory.RTO,
  TYRE: OperationCategory.TYRE,
  MAINTENANCE: OperationCategory.MAINTENANCE,
};

const TREND_KEYS = ['FUEL', 'RTO', 'TYRE', 'TYRE_INSURANCE', 'MAINTENANCE', 'total'] as const;

export interface ExpenseRegisterRow {
  id: string;
  category: ExpenseCategory;
  date: string;
  amount: string;
  vehicle: { id: string; registrationNumber: string } | null;
  driver: { id: string; name: string } | null;
  vendor: string | null;
  description: string | null;
  receiptFileId: string | null;
}

interface RawRegisterRow {
  id: string;
  category: string;
  date: Date;
  amount: Prisma.Decimal;
  vehicle_id: string | null;
  registration_number: string | null;
  driver_id: string | null;
  full_name: string | null;
  vendor: string | null;
  description: string | null;
  receipt_file_id: string | null;
}

/**
 * Operational expenses by category. Sources of truth, one per category:
 *  - Fuel: active fuel entries;
 *  - RTO, Tyre, Maintenance/service: active vehicle expense records;
 *  - Tyre insurance: the premium on each non-archived tyre-insurance policy, dated by the policy
 *    start date (or the day it was recorded, when no start date was given) — the same rule the
 *    finance ledger posts it with.
 *
 * The categories are the production ones only. Parking, food and repair existed in the prototype
 * and are not production categories; they cannot appear here because no source holds them.
 */
@Injectable()
export class ExpenseReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: ReportLookups,
  ) {}

  private categories(query: ExpenseReportQuery): ExpenseCategory[] {
    const all = query.category ? [query.category] : [...EXPENSE_CATEGORIES];
    // Tyre insurance belongs to a vehicle, never to a driver.
    return query.driverId ? all.filter((c) => c !== 'TYRE_INSURANCE') : all;
  }

  private policyWhere(ctx: ReportContext, query: ExpenseReportQuery): Prisma.DocumentWhereInput {
    const { from, to } = ctx.range;
    return {
      companyId: ctx.companyId,
      type: DocumentType.TYRE_INSURANCE,
      state: { not: DocumentState.ARCHIVED },
      deletedAt: null,
      amount: { gt: 0 },
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      OR: [
        { issueDate: { gte: from, lte: to } },
        { issueDate: null, createdAt: { gte: from, lt: addDays(to, 1) } },
      ],
    };
  }

  async summary(ctx: ReportContext, query: ExpenseReportQuery) {
    const categories = this.categories(query);
    const operationCats = categories.filter((c): c is keyof typeof OPERATION_CATEGORIES => c in OPERATION_CATEGORIES).map((c) => OPERATION_CATEGORIES[c]);
    const want = (c: ExpenseCategory) => categories.includes(c);

    const fuelWhere: Prisma.FuelEntryWhereInput = {
      companyId: ctx.companyId,
      status: RecordStatus.ACTIVE,
      transactionDate: dateWindow(ctx.range),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
    };
    const opWhere: Prisma.VehicleExpenseWhereInput = {
      companyId: ctx.companyId,
      status: RecordStatus.ACTIVE,
      expenseDate: dateWindow(ctx.range),
      category: { in: operationCats },
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
    };
    const sums = { _count: { _all: true }, _sum: { amount: true } } as const;

    const [fuelByDay, fuelByVehicle, fuelByDriver, opsByDay, opsByVehicle, opsByDriver, policies] = await Promise.all([
      want('FUEL') ? this.prisma.fuelEntry.groupBy({ by: ['transactionDate'], where: fuelWhere, ...sums }) : [],
      want('FUEL') ? this.prisma.fuelEntry.groupBy({ by: ['vehicleId'], where: fuelWhere, ...sums }) : [],
      want('FUEL') ? this.prisma.fuelEntry.groupBy({ by: ['driverId'], where: fuelWhere, ...sums }) : [],
      operationCats.length ? this.prisma.vehicleExpense.groupBy({ by: ['category', 'expenseDate'], where: opWhere, ...sums }) : [],
      operationCats.length ? this.prisma.vehicleExpense.groupBy({ by: ['category', 'vehicleId'], where: opWhere, ...sums }) : [],
      operationCats.length ? this.prisma.vehicleExpense.groupBy({ by: ['category', 'driverId'], where: opWhere, ...sums }) : [],
      want('TYRE_INSURANCE')
        ? this.prisma.document.findMany({ where: this.policyWhere(ctx, query), select: { amount: true, issueDate: true, createdAt: true, vehicleId: true } })
        : [],
    ]);

    // Normalised dated amounts per category: one shape for the trend, totals and breakdowns.
    const dated: { category: ExpenseCategory; date: Date; amount: Dec; entries: number; vehicleId: string | null; driverId: string | null }[] = [];
    for (const row of fuelByDay) dated.push({ category: 'FUEL', date: row.transactionDate, amount: row._sum.amount ?? ZERO, entries: row._count._all, vehicleId: null, driverId: null });
    for (const row of opsByDay) dated.push({ category: row.category, date: row.expenseDate, amount: row._sum.amount ?? ZERO, entries: row._count._all, vehicleId: null, driverId: null });
    const policyDate = (p: { issueDate: Date | null; createdAt: Date }) => p.issueDate ?? new Date(`${p.createdAt.toISOString().slice(0, 10)}T00:00:00.000Z`);
    for (const p of policies) dated.push({ category: 'TYRE_INSURANCE', date: policyDate(p), amount: p.amount ?? ZERO, entries: 1, vehicleId: p.vehicleId, driverId: null });

    const total = sum(dated.map((d) => d.amount));
    const byCategory = categories.map((category) => {
      const rows = dated.filter((d) => d.category === category);
      const amount = sum(rows.map((r) => r.amount));
      return { category, entries: rows.reduce((n, r) => n + r.entries, 0), amount: money(amount), share: share(amount, total) };
    });

    // Per-vehicle and per-driver totals, split by category so the chart can stack them.
    const accumulate = (target: Map<string, Record<ExpenseCategory, Dec>>, key: string | null, category: ExpenseCategory, amount: Dec | null) => {
      const id = key ?? '';
      const slot = target.get(id) ?? (Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, ZERO])) as Record<ExpenseCategory, Dec>);
      slot[category] = slot[category].plus(amount ?? ZERO);
      target.set(id, slot);
    };
    const vehicleTotals = new Map<string, Record<ExpenseCategory, Dec>>();
    for (const row of fuelByVehicle) accumulate(vehicleTotals, row.vehicleId, 'FUEL', row._sum.amount);
    for (const row of opsByVehicle) accumulate(vehicleTotals, row.vehicleId, row.category, row._sum.amount);
    for (const p of policies) accumulate(vehicleTotals, p.vehicleId, 'TYRE_INSURANCE', p.amount);
    const driverTotals = new Map<string, Record<ExpenseCategory, Dec>>();
    for (const row of fuelByDriver) accumulate(driverTotals, row.driverId, 'FUEL', row._sum.amount);
    for (const row of opsByDriver) accumulate(driverTotals, row.driverId, row.category, row._sum.amount);

    const [vehicleNames, driverNames] = await Promise.all([
      this.lookups.vehicles(ctx.companyId, [...vehicleTotals.keys()]),
      this.lookups.drivers(ctx.companyId, [...driverTotals.keys()]),
    ]);
    const breakdown = (totals: Map<string, Record<ExpenseCategory, Dec>>, names: Map<string, string>) =>
      [...totals.entries()]
        .map(([id, split]) => {
          const amount = sum(Object.values(split));
          return {
            id: id || null,
            label: id ? (names.get(id) ?? '—') : null,
            amount: money(amount),
            byCategory: Object.fromEntries(categories.map((c) => [c, money(split[c])])) as Record<ExpenseCategory, string>,
          };
        })
        .sort((a, b) => Number(b.amount) - Number(a.amount));

    const trend = fillTrend(
      ctx.range,
      dated.map((d) => ({ date: d.date, [d.category]: d.amount, total: d.amount })),
      TREND_KEYS,
    );

    return {
      categories,
      total: money(total),
      entries: byCategory.reduce((n, c) => n + c.entries, 0),
      byCategory,
      trend,
      byVehicle: breakdown(vehicleTotals, vehicleNames),
      // Records with no driver (office-recorded, tyre insurance) are kept as their own row rather than dropped.
      byDriver: breakdown(driverTotals, driverNames),
    };
  }

  /**
   * Total operational spend (all five categories) between two days, inclusive — the figure the
   * overview compares month on month and year on year. Same sources and rules as the summary.
   */
  async spendBetween(companyId: string, from: Date, to: Date): Promise<Dec> {
    const window = { gte: from, lte: to };
    const [fuel, ops, premiums] = await Promise.all([
      this.prisma.fuelEntry.aggregate({ where: { companyId, status: RecordStatus.ACTIVE, transactionDate: window }, _sum: { amount: true } }),
      this.prisma.vehicleExpense.aggregate({ where: { companyId, status: RecordStatus.ACTIVE, expenseDate: window }, _sum: { amount: true } }),
      this.prisma.document.aggregate({
        where: {
          companyId,
          type: DocumentType.TYRE_INSURANCE,
          state: { not: DocumentState.ARCHIVED },
          deletedAt: null,
          amount: { gt: 0 },
          OR: [{ issueDate: window }, { issueDate: null, createdAt: { gte: from, lt: addDays(to, 1) } }],
        },
        _sum: { amount: true },
      }),
    ]);
    return sum([fuel._sum.amount, ops._sum.amount, premiums._sum.amount]);
  }

  // ───────────────────────────── Register ─────────────────────────────

  private registerSql(ctx: ReportContext, query: ExpenseReportQuery, q: string | undefined): Prisma.Sql {
    const categories = this.categories(query);
    const from = toIsoDate(ctx.range.from);
    const to = toIsoDate(ctx.range.to);
    const parts: Prisma.Sql[] = [];
    const vehicle = (column: string) => (query.vehicleId ? Prisma.sql` AND ${Prisma.raw(column)} = ${query.vehicleId}::uuid` : Prisma.empty);
    const driver = (column: string) => (query.driverId ? Prisma.sql` AND ${Prisma.raw(column)} = ${query.driverId}::uuid` : Prisma.empty);

    if (categories.includes('FUEL')) {
      parts.push(Prisma.sql`
        SELECT f.id, 'FUEL' AS category, f.transaction_date AS date, f.amount, f.vehicle_id, f.driver_id,
               f.fuel_station AS vendor, NULL::text AS description, f.receipt_file_id
        FROM fuel_entries f
        WHERE f.company_id = ${ctx.companyId}::uuid AND f.status = 'ACTIVE'
          AND f.transaction_date BETWEEN ${from}::date AND ${to}::date${vehicle('f.vehicle_id')}${driver('f.driver_id')}`);
    }
    const operationCats = categories.filter((c) => c in OPERATION_CATEGORIES);
    if (operationCats.length) {
      parts.push(Prisma.sql`
        SELECT e.id, e.category::text AS category, e.expense_date AS date, e.amount, e.vehicle_id, e.driver_id,
               e.vendor_name AS vendor, e.description, e.receipt_file_id
        FROM vehicle_expenses e
        WHERE e.company_id = ${ctx.companyId}::uuid AND e.status = 'ACTIVE'
          AND e.category::text IN (${Prisma.join(operationCats)})
          AND e.expense_date BETWEEN ${from}::date AND ${to}::date${vehicle('e.vehicle_id')}${driver('e.driver_id')}`);
    }
    if (categories.includes('TYRE_INSURANCE')) {
      parts.push(Prisma.sql`
        SELECT d.id, 'TYRE_INSURANCE' AS category, COALESCE(d.issue_date, (d.created_at AT TIME ZONE 'UTC')::date) AS date,
               d.amount, d.vehicle_id, NULL::uuid AS driver_id, d.issuer AS vendor, d.document_number AS description, d.file_id AS receipt_file_id
        FROM documents d
        WHERE d.company_id = ${ctx.companyId}::uuid AND d.type = 'TYRE_INSURANCE' AND d.state <> 'ARCHIVED'
          AND d.deleted_at IS NULL AND d.amount > 0
          AND COALESCE(d.issue_date, (d.created_at AT TIME ZONE 'UTC')::date) BETWEEN ${from}::date AND ${to}::date${vehicle('d.vehicle_id')}`);
    }
    if (!parts.length) parts.push(Prisma.sql`SELECT NULL::uuid AS id, NULL::text AS category, NULL::date AS date, NULL::numeric AS amount, NULL::uuid AS vehicle_id, NULL::uuid AS driver_id, NULL::text AS vendor, NULL::text AS description, NULL::uuid AS receipt_file_id WHERE false`);

    const search = searchText(q);
    const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    return Prisma.sql`
      FROM (${Prisma.join(parts, ' UNION ALL ')}) x
      LEFT JOIN vehicles v ON v.id = x.vehicle_id
      LEFT JOIN drivers dr ON dr.id = x.driver_id
      LEFT JOIN employees em ON em.id = dr.employee_id
      ${pattern ? Prisma.sql`WHERE (x.vendor ILIKE ${pattern} OR x.description ILIKE ${pattern} OR v.registration_number ILIKE ${pattern} OR em.full_name ILIKE ${pattern})` : Prisma.empty}`;
  }

  private async register(ctx: ReportContext, query: ExpenseReportQuery, q: string | undefined, sort: { field: ExpenseSort; dir: 'asc' | 'desc' }, window: { skip: number; take: number }) {
    const body = this.registerSql(ctx, query, q);
    const direction = sort.dir === 'asc' ? 'ASC' : 'DESC';
    const rows = await this.prisma.$queryRaw<RawRegisterRow[]>`
      SELECT x.id, x.category, x.date, x.amount, x.vehicle_id, v.registration_number, x.driver_id, em.full_name,
             x.vendor, x.description, x.receipt_file_id
      ${body}
      ORDER BY ${Prisma.raw(`${ORDER_SQL[sort.field]} ${direction} NULLS LAST`)}, x.date DESC, x.id DESC
      LIMIT ${window.take} OFFSET ${window.skip}`;
    return rows.map(
      (row): ExpenseRegisterRow => ({
        id: row.id,
        category: row.category as ExpenseCategory,
        date: toIsoDate(row.date),
        amount: money(row.amount),
        vehicle: row.vehicle_id ? { id: row.vehicle_id, registrationNumber: row.registration_number ?? '—' } : null,
        driver: row.driver_id ? { id: row.driver_id, name: row.full_name ?? '—' } : null,
        vendor: row.vendor,
        description: row.description,
        receiptFileId: row.receipt_file_id,
      }),
    );
  }

  private async count(ctx: ReportContext, query: ExpenseReportQuery, q: string | undefined): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${this.registerSql(ctx, query, q)}`;
    return row?.total ?? 0;
  }

  async records(ctx: ReportContext, query: ExpenseRecordsQuery) {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'date', dir: 'desc' });
    const [rows, total] = await Promise.all([this.register(ctx, query, query.q, sort, skipTake(query)), this.count(ctx, query, query.q)]);
    return toReportPage(rows, total, query, sort);
  }

  async document(ctx: ReportContext, query: ExpenseExportQuery, limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'date', dir: 'asc' });
    const [summary, total] = await Promise.all([this.summary(ctx, query), this.count(ctx, query, query.q)]);
    const take = detailTake(total, limits);
    const rows = take ? await this.register(ctx, query, query.q, sort, { skip: 0, take }) : [];
    const searchedTotal = query.q ? money(sum(rows.map((r) => r.amount))) : summary.total;
    const categoryHeaders = summary.categories.map((c) => ({ header: label(LABELS.expenseCategory, c), kind: 'inr' as const }));

    return {
      title: REPORT_TITLES.expenses,
      filters: [
        ...(await this.lookups.filterLabels(ctx.companyId, query)),
        ...(query.category ? [{ label: 'Category', value: label(LABELS.expenseCategory, query.category) }] : []),
        ...(query.q ? [{ label: 'Search', value: query.q }] : []),
      ],
      summary: [
        { label: 'Total expenses', value: summary.total, kind: 'inr' },
        { label: 'Records', value: summary.entries, kind: 'count' },
        ...summary.byCategory.map((c) => ({ label: label(LABELS.expenseCategory, c.category), value: c.amount, kind: 'inr' as const })),
      ],
      tables: [
        {
          title: 'Category totals',
          columns: [{ header: 'Category', kind: 'text', width: 2 }, { header: 'Records', kind: 'count' }, { header: 'Share', kind: 'percent' }, { header: 'Amount', kind: 'inr' }],
          rows: summary.byCategory.map((c) => [label(LABELS.expenseCategory, c.category), c.entries, c.share, c.amount]),
          totals: ['Total', summary.entries, summary.total === '0.00' ? null : '100.0', summary.total],
        },
        {
          title: ctx.range.granularity === 'day' ? 'Daily trend' : 'Monthly trend',
          columns: [{ header: ctx.range.granularity === 'day' ? 'Date' : 'Month', kind: 'text' }, ...categoryHeaders, { header: 'Total', kind: 'inr' }],
          rows: summary.trend.map((b) => [bucketText(b.bucket), ...summary.categories.map((c) => b[c]), b.total]),
        },
        {
          title: 'Vehicle breakdown',
          columns: [{ header: 'Vehicle', kind: 'text' }, ...categoryHeaders, { header: 'Total', kind: 'inr' }],
          rows: summary.byVehicle.map((v) => [v.label ?? '—', ...summary.categories.map((c) => v.byCategory[c]), v.amount]),
        },
        {
          title: 'Driver breakdown',
          columns: [{ header: 'Driver', kind: 'text', width: 1.5 }, ...categoryHeaders.filter((h) => h.header !== 'Tyre insurance'), { header: 'Total', kind: 'inr' }],
          rows: summary.byDriver.map((d) => [d.label ?? 'No driver recorded', ...summary.categories.filter((c) => c !== 'TYRE_INSURANCE').map((c) => d.byCategory[c]), d.amount]),
        },
        {
          title: 'Expense records',
          detail: true,
          totalRecords: total,
          columns: [
            { header: 'Date', kind: 'date' }, { header: 'Category', kind: 'text' }, { header: 'Vehicle', kind: 'text' },
            { header: 'Driver', kind: 'text', width: 1.5 }, { header: 'Vendor / station', kind: 'text', width: 2 },
            { header: 'Description', kind: 'text', width: 2 }, { header: 'Amount', kind: 'inr' }, { header: 'Receipt', kind: 'text' },
          ],
          rows: rows.map((r) => [r.date, label(LABELS.expenseCategory, r.category), r.vehicle?.registrationNumber ?? '', r.driver?.name ?? '', r.vendor, r.description, r.amount, r.receiptFileId ? 'Attached' : 'None']),
          totals: query.q && take < total ? undefined : ['Total', '', '', '', '', '', searchedTotal, ''],
        },
      ],
      definitions: [
        'Fuel: active fuel entries. RTO, Tyre and Maintenance/service: active vehicle expense records.',
        'Tyre insurance: the premium on each non-archived tyre-insurance policy, dated by the policy start date (or the day it was recorded when no start date was given).',
        'Archived records are excluded from every figure.',
      ],
    };
  }
}
