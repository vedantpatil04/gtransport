import { Injectable } from '@nestjs/common';
import { OperationCategory, Prisma, RecordStatus, ServiceReceiptAIStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import type { MaintenanceExportQuery, MaintenanceRecordsQuery, MaintenanceReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportDocument, bucketText } from '../report-document';
import { detailTake, resolveSort, searchText, skipTake, toReportPage, type DetailLimits, type ReportContext } from '../report-context';
import { fillTrend, money, share, sum } from '../report-maths';
import { dateWindow } from '../report-range';
import { ReportLookups } from './report-lookups';

const SORTS = ['date', 'amount', 'vehicle', 'status'] as const;
type MaintenanceSort = (typeof SORTS)[number];

const S = ServiceReceiptAIStatus;

/**
 * Where each AI status stands for management. Only VERIFIED is a person's confirmation of the
 * figures; an AI reading, however confident, is "awaiting verification" until someone checks it.
 */
export const VERIFICATION_GROUPS = {
  verified: [S.VERIFIED],
  awaitingVerification: [S.SUCCEEDED, S.NEEDS_REVIEW],
  inProgress: [S.QUEUED, S.PROCESSING, S.RETRYING],
  failed: [S.FAILED],
  rejected: [S.REJECTED],
  notProcessed: [S.NOT_PROCESSED],
} as const satisfies Record<string, readonly ServiceReceiptAIStatus[]>;
type VerificationGroup = keyof typeof VERIFICATION_GROUPS;

/** Has a receipt that no person has settled yet. */
const PENDING_VERIFICATION: ServiceReceiptAIStatus[] = [...VERIFICATION_GROUPS.awaitingVerification, ...VERIFICATION_GROUPS.inProgress, ...VERIFICATION_GROUPS.failed];

const ROW_VIEW = {
  id: true,
  expenseDate: true,
  amount: true,
  vendorName: true,
  description: true,
  receiptFileId: true,
  aiStatus: true,
  aiVerifiedAt: true,
  serviceType: true,
  invoiceNumber: true,
  odometerKm: true,
  vehicle: { select: { id: true, registrationNumber: true } },
  driver: { select: { id: true, employee: { select: { fullName: true } } } },
} as const;
type ServiceRow = Prisma.VehicleExpenseGetPayload<{ select: typeof ROW_VIEW }>;

/**
 * Maintenance and service spend. Source of truth: active maintenance/service expense records.
 *
 * Amounts are the record's own figures throughout. AI status is reported as information about
 * the receipt — never as a property of the money — and service details (type, invoice, odometer)
 * appear only on records a person verified, because only verification writes them.
 */
@Injectable()
export class MaintenanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: ReportLookups,
  ) {}

  private where(ctx: ReportContext, query: MaintenanceReportQuery, q?: string): Prisma.VehicleExpenseWhereInput {
    const search = searchText(q);
    return {
      companyId: ctx.companyId,
      category: OperationCategory.MAINTENANCE,
      status: RecordStatus.ACTIVE,
      expenseDate: dateWindow(ctx.range),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.aiStatus ? { aiStatus: query.aiStatus } : {}),
      ...(search
        ? {
            OR: [
              { vendorName: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { description: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { invoiceNumber: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { vehicle: { registrationNumber: { contains: search, mode: Prisma.QueryMode.insensitive } } },
            ],
          }
        : {}),
    };
  }

  async summary(ctx: ReportContext, query: MaintenanceReportQuery, q?: string) {
    const where = this.where(ctx, query, q);
    const sums = { _count: { _all: true }, _sum: { amount: true } } as const;
    const [totals, byStatus, byDay, byVehicleDay, repeated] = await Promise.all([
      this.prisma.vehicleExpense.aggregate({ where, ...sums }),
      this.prisma.vehicleExpense.groupBy({ by: ['aiStatus'], where, ...sums }),
      this.prisma.vehicleExpense.groupBy({ by: ['expenseDate'], where, ...sums }),
      this.prisma.vehicleExpense.groupBy({ by: ['vehicleId', 'expenseDate'], where, ...sums }),
      // Recurring work, from verified records only: the same service type more than once.
      this.prisma.vehicleExpense.groupBy({
        by: ['vehicleId', 'serviceType'],
        where: { ...where, aiStatus: S.VERIFIED, serviceType: { not: null } },
        _count: { _all: true },
        _sum: { amount: true },
        _max: { expenseDate: true },
      }),
    ]);

    const vehicleIds = [...new Set([...byVehicleDay.map((r) => r.vehicleId), ...repeated.map((r) => r.vehicleId)])];
    const names = await this.lookups.vehicles(ctx.companyId, vehicleIds);
    const total = totals._sum.amount;

    const groups = Object.fromEntries(
      (Object.keys(VERIFICATION_GROUPS) as VerificationGroup[]).map((group) => {
        const rows = byStatus.filter((r) => (VERIFICATION_GROUPS[group] as readonly ServiceReceiptAIStatus[]).includes(r.aiStatus));
        return [group, { count: rows.reduce((n, r) => n + r._count._all, 0), amount: money(sum(rows.map((r) => r._sum.amount))) }];
      }),
    ) as Record<VerificationGroup, { count: number; amount: string }>;
    const pending = byStatus.filter((r) => PENDING_VERIFICATION.includes(r.aiStatus));

    // Service frequency per vehicle: visits, spend, and the average gap between service days.
    const byVehicle = vehicleIds
      .filter((id) => byVehicleDay.some((r) => r.vehicleId === id))
      .map((id) => {
        const days = byVehicleDay.filter((r) => r.vehicleId === id).sort((a, b) => a.expenseDate.getTime() - b.expenseDate.getTime());
        const amount = sum(days.map((d) => d._sum.amount));
        const gaps = days.slice(1).map((d, i) => (d.expenseDate.getTime() - days[i]!.expenseDate.getTime()) / 86_400_000);
        return {
          id,
          label: names.get(id) ?? '—',
          services: days.reduce((n, d) => n + d._count._all, 0),
          amount: money(amount),
          share: share(amount, total ?? 0),
          averageDaysBetween: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
          lastServiceDate: days.length ? toIsoDate(days[days.length - 1]!.expenseDate) : null,
        };
      })
      .sort((a, b) => Number(b.amount) - Number(a.amount));

    return {
      totals: { services: totals._count._all, amount: money(total) },
      verification: groups,
      pendingVerification: { count: pending.reduce((n, r) => n + r._count._all, 0), amount: money(sum(pending.map((r) => r._sum.amount))) },
      byStatus: byStatus.map((r) => ({ status: r.aiStatus, count: r._count._all, amount: money(r._sum.amount) })),
      trend: fillTrend(ctx.range, byDay.map((r) => ({ date: r.expenseDate, amount: r._sum.amount, services: r._count._all })), ['amount', 'services'] as const, (v, f) => (f === 'services' ? v.toNumber() : v.toFixed(2))),
      byVehicle,
      highestVehicle: byVehicle[0] ?? null,
      recurring: repeated
        .filter((r) => r._count._all >= 2)
        .map((r) => ({ vehicle: { id: r.vehicleId, registrationNumber: names.get(r.vehicleId) ?? '—' }, serviceType: r.serviceType as string, count: r._count._all, amount: money(r._sum.amount), lastDate: r._max.expenseDate ? toIsoDate(r._max.expenseDate) : null }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private orderBy(field: MaintenanceSort, dir: 'asc' | 'desc'): Prisma.VehicleExpenseOrderByWithRelationInput[] {
    const primary: Record<MaintenanceSort, Prisma.VehicleExpenseOrderByWithRelationInput> = {
      date: { expenseDate: dir },
      amount: { amount: dir },
      vehicle: { vehicle: { registrationNumber: dir } },
      status: { aiStatus: dir },
    };
    return [primary[field], ...(field === 'date' ? [] : [{ expenseDate: 'desc' as const }]), { id: dir }];
  }

  private present(row: ServiceRow) {
    const verified = row.aiStatus === S.VERIFIED;
    return {
      id: row.id,
      date: toIsoDate(row.expenseDate),
      vehicle: row.vehicle,
      driver: row.driver ? { id: row.driver.id, name: row.driver.employee.fullName } : null,
      vendor: row.vendorName,
      description: row.description,
      amount: money(row.amount),
      receiptFileId: row.receiptFileId,
      aiStatus: row.aiStatus,
      verified,
      verifiedAt: verified && row.aiVerifiedAt ? row.aiVerifiedAt.toISOString() : null,
      // Written only by a person's verification; never shown from an unverified AI reading.
      serviceType: verified ? row.serviceType : null,
      invoiceNumber: verified ? row.invoiceNumber : null,
      odometerKm: verified ? row.odometerKm : null,
    };
  }

  async records(ctx: ReportContext, query: MaintenanceRecordsQuery) {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'date', dir: 'desc' });
    const where = this.where(ctx, query, query.q);
    const [rows, total] = await Promise.all([
      this.prisma.vehicleExpense.findMany({ where, select: ROW_VIEW, orderBy: this.orderBy(sort.field, sort.dir), ...skipTake(query) }),
      this.prisma.vehicleExpense.count({ where }),
    ]);
    return toReportPage(rows.map((r) => this.present(r)), total, query, sort);
  }

  async document(ctx: ReportContext, query: MaintenanceExportQuery, limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'date', dir: 'asc' });
    const where = this.where(ctx, query, query.q);
    const [s, total] = await Promise.all([this.summary(ctx, query, query.q), this.prisma.vehicleExpense.count({ where })]);
    const take = detailTake(total, limits);
    const rows = take ? (await this.prisma.vehicleExpense.findMany({ where, select: ROW_VIEW, orderBy: this.orderBy(sort.field, sort.dir), take })).map((r) => this.present(r)) : [];

    return {
      title: REPORT_TITLES.maintenance,
      filters: [
        ...(await this.lookups.filterLabels(ctx.companyId, query)),
        ...(query.aiStatus ? [{ label: 'Receipt status', value: label(LABELS.aiStatus, query.aiStatus) }] : []),
        ...(query.q ? [{ label: 'Search', value: query.q }] : []),
      ],
      summary: [
        { label: 'Maintenance spend', value: s.totals.amount, kind: 'inr' },
        { label: 'Service records', value: s.totals.services, kind: 'count' },
        { label: 'Verified by office', value: s.verification.verified.count, kind: 'count' },
        { label: 'Pending verification', value: s.pendingVerification.count, kind: 'count' },
        { label: 'AI read, awaiting verification', value: s.verification.awaitingVerification.count, kind: 'count' },
        { label: 'Highest maintenance vehicle', value: s.highestVehicle ? `${s.highestVehicle.label} · ${s.highestVehicle.amount}` : null, kind: 'text' },
      ],
      tables: [
        {
          title: 'Vehicle maintenance spend and frequency',
          columns: [{ header: 'Vehicle', kind: 'text' }, { header: 'Services', kind: 'count' }, { header: 'Avg. days between', kind: 'count' }, { header: 'Last service', kind: 'date' }, { header: 'Amount', kind: 'inr' }],
          rows: s.byVehicle.map((v) => [v.label, v.services, v.averageDaysBetween, v.lastServiceDate, v.amount]),
        },
        {
          title: 'Receipt verification status',
          columns: [{ header: 'Status', kind: 'text', width: 2 }, { header: 'Records', kind: 'count' }, { header: 'Amount', kind: 'inr' }],
          rows: s.byStatus.map((b) => [label(LABELS.aiStatus, b.status), b.count, b.amount]),
        },
        {
          title: 'Recurring service types (verified records)',
          columns: [{ header: 'Vehicle', kind: 'text' }, { header: 'Service type', kind: 'text', width: 2 }, { header: 'Times', kind: 'count' }, { header: 'Last', kind: 'date' }, { header: 'Amount', kind: 'inr' }],
          rows: s.recurring.map((r) => [r.vehicle.registrationNumber, r.serviceType, r.count, r.lastDate, r.amount]),
        },
        {
          title: ctx.range.granularity === 'day' ? 'Daily trend' : 'Monthly trend',
          columns: [{ header: ctx.range.granularity === 'day' ? 'Date' : 'Month', kind: 'text' }, { header: 'Services', kind: 'count' }, { header: 'Amount', kind: 'inr' }],
          rows: s.trend.map((b) => [bucketText(b.bucket), b.services, b.amount]),
        },
        {
          title: 'Service records',
          detail: true,
          totalRecords: total,
          columns: [
            { header: 'Date', kind: 'date' }, { header: 'Vehicle', kind: 'text' }, { header: 'Driver', kind: 'text', width: 1.5 },
            { header: 'Service type (verified)', kind: 'text', width: 1.5 }, { header: 'Vendor', kind: 'text', width: 1.5 },
            { header: 'Invoice no. (verified)', kind: 'text' }, { header: 'Amount', kind: 'inr' }, { header: 'Receipt', kind: 'text' },
            { header: 'Receipt / AI status', kind: 'text', width: 1.5 },
          ],
          rows: rows.map((r) => [r.date, r.vehicle.registrationNumber, r.driver?.name ?? '', r.serviceType, r.vendor, r.invoiceNumber, r.amount, r.receiptFileId ? 'Attached' : 'None', label(LABELS.aiStatus, r.aiStatus)]),
          totals: ['Total', '', '', '', '', '', s.totals.amount, '', ''],
        },
      ],
      definitions: [
        'Amounts are the maintenance records\' own figures. AI readings never change them.',
        '"Verified by office" means a person checked the receipt and verified the record. AI status is information about the receipt, not verification.',
        'Pending verification = records with a receipt that AI has read, is reading, or failed to read, and no person has verified or rejected yet.',
        'Service type and invoice number appear only on verified records. Recurring service types count verified records only.',
      ],
    };
  }
}
