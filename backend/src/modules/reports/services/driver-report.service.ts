import { Injectable } from '@nestjs/common';
import { OperationCategory, Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { LocationsService } from '../../locations/locations.service';
import type { DriverExportQuery, DriverRecordsQuery, DriverReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportColumn, type ReportDocument } from '../report-document';
import { detailTake, resolveSort, searchText, toReportPage, type DetailLimits, type ReportContext } from '../report-context';
import { litres, money, OPEN_PAYMENT_STATUSES, sortRows, sum, ZERO } from '../report-maths';
import { dateWindow, instantWindow } from '../report-range';
import { ReportLookups } from './report-lookups';

const SORTS = ['name', 'fuel', 'fuelEntries', 'expenses', 'services', 'uploads'] as const;
type DriverSort = (typeof SORTS)[number];

export interface DriverActivityRow {
  id: string;
  name: string;
  code: string;
  status: string;
  vehicle: { id: string; registrationNumber: string } | null;
  /** Fuel entries recorded against the driver, and their total. */
  fuel: { entries: number; amount: string; litres: string };
  /** RTO, tyre and maintenance records naming the driver. */
  expenses: { entries: number; amount: string };
  /** Maintenance/service records naming the driver. */
  services: number;
  /** Documents the driver uploaded themselves in the period. */
  documentUploads: number;
  /** Payroll roles only: payments to this driver created in the period, by outcome. */
  payments?: { paid: string; paidCount: number; open: string; openCount: number; failedCount: number };
  /** Fleet roles only: tracking as of now, and stationary alerts raised in the period. */
  location?: { status: string | null; lastSeenAt: string | null; stationaryAlerts: number };
}

/**
 * What each driver did, from the records they appear on. These are counts and totals — there is
 * deliberately no score, rank or "efficiency" figure: the data does not support a defensible one
 * (fuel cannot be tied to distance without trip records), and an invented metric would be worse
 * than none.
 */
@Injectable()
export class DriverReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: ReportLookups,
    private readonly locations: LocationsService,
  ) {}

  private async compute(ctx: ReportContext, query: DriverReportQuery, q?: string): Promise<DriverActivityRow[]> {
    const search = searchText(q);
    const drivers = await this.prisma.driver.findMany({
      where: {
        companyId: ctx.companyId,
        deletedAt: null,
        ...(query.driverId ? { id: query.driverId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { driverCode: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { employee: { fullName: { contains: search, mode: Prisma.QueryMode.insensitive } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        driverCode: true,
        status: true,
        employee: { select: { id: true, fullName: true, user: { select: { id: true } } } },
        currentAssignment: { select: { vehicle: { select: { id: true, registrationNumber: true } } } },
      },
    });
    if (!drivers.length) return [];

    const ids = drivers.map((d) => d.id);
    const userIds = drivers.map((d) => d.employee.user?.id).filter((id): id is string => Boolean(id));
    const employeeIds = drivers.map((d) => d.employee.id);
    const window = dateWindow(ctx.range);
    const instants = instantWindow(ctx.range);

    const [fuel, expenses, uploads, payments, alerts, fleet] = await Promise.all([
      this.prisma.fuelEntry.groupBy({ by: ['driverId'], where: { companyId: ctx.companyId, driverId: { in: ids }, status: RecordStatus.ACTIVE, transactionDate: window }, _count: { _all: true }, _sum: { amount: true, litres: true } }),
      this.prisma.vehicleExpense.groupBy({ by: ['driverId', 'category'], where: { companyId: ctx.companyId, driverId: { in: ids }, status: RecordStatus.ACTIVE, expenseDate: window }, _count: { _all: true }, _sum: { amount: true } }),
      userIds.length
        ? this.prisma.document.groupBy({ by: ['createdById'], where: { companyId: ctx.companyId, createdById: { in: userIds }, createdAt: instants, deletedAt: null }, _count: { _all: true } })
        : [],
      ctx.visibility.payments
        ? this.prisma.paymentRecord.groupBy({ by: ['employeeId', 'status'], where: { companyId: ctx.companyId, employeeId: { in: employeeIds }, createdAt: instants }, _count: { _all: true }, _sum: { amount: true } })
        : [],
      ctx.visibility.location
        ? this.prisma.fleetLocationAlert.groupBy({ by: ['driverId'], where: { companyId: ctx.companyId, driverId: { in: ids }, triggeredAt: instants }, _count: { _all: true } })
        : [],
      ctx.visibility.location ? this.locations.fleet(ctx.companyId, ctx.role, {}) : null,
    ]);

    return drivers.map((d): DriverActivityRow => {
      const f = fuel.find((row) => row.driverId === d.id);
      const own = expenses.filter((row) => row.driverId === d.id);
      const userId = d.employee.user?.id;
      const row: DriverActivityRow = {
        id: d.id,
        name: d.employee.fullName,
        code: d.driverCode,
        status: d.status,
        vehicle: d.currentAssignment?.vehicle ?? null,
        fuel: { entries: f?._count._all ?? 0, amount: money(f?._sum.amount), litres: litres(f?._sum.litres) },
        expenses: { entries: own.reduce((n, r) => n + r._count._all, 0), amount: money(sum(own.map((r) => r._sum.amount))) },
        services: own.find((r) => r.category === OperationCategory.MAINTENANCE)?._count._all ?? 0,
        documentUploads: userId ? (uploads.find((u) => u.createdById === userId)?._count._all ?? 0) : 0,
      };
      if (ctx.visibility.payments) {
        const mine = payments.filter((p) => p.employeeId === d.employee.id);
        const paid = mine.filter((p) => p.status === 'PAID');
        const open = mine.filter((p) => OPEN_PAYMENT_STATUSES.includes(p.status));
        row.payments = {
          paid: money(sum(paid.map((p) => p._sum.amount ?? ZERO))),
          paidCount: paid.reduce((n, p) => n + p._count._all, 0),
          open: money(sum(open.map((p) => p._sum.amount ?? ZERO))),
          openCount: open.reduce((n, p) => n + p._count._all, 0),
          failedCount: mine.filter((p) => p.status === 'FAILED').reduce((n, p) => n + p._count._all, 0),
        };
      }
      if (ctx.visibility.location && fleet) {
        const live = fleet.data.find((l) => l.driverId === d.id);
        row.location = { status: live?.status ?? null, lastSeenAt: live?.lastSeenAt ?? null, stationaryAlerts: alerts.find((a) => a.driverId === d.id)?._count._all ?? 0 };
      }
      return row;
    });
  }

  private sorted(rows: DriverActivityRow[], field: DriverSort, dir: 'asc' | 'desc') {
    const value: Record<DriverSort, (r: DriverActivityRow) => string | number> = {
      name: (r) => r.name,
      fuel: (r) => Number(r.fuel.amount),
      fuelEntries: (r) => r.fuel.entries,
      expenses: (r) => Number(r.expenses.amount),
      services: (r) => r.services,
      uploads: (r) => r.documentUploads,
    };
    return sortRows(rows, value[field], dir, (r) => r.name);
  }

  private summarise(rows: DriverActivityRow[]) {
    return {
      drivers: rows.length,
      activeDrivers: rows.filter((r) => r.status === 'ACTIVE').length,
      withFuelEntries: rows.filter((r) => r.fuel.entries > 0).length,
      totals: {
        fuelEntries: rows.reduce((n, r) => n + r.fuel.entries, 0),
        fuel: money(sum(rows.map((r) => r.fuel.amount))),
        expenseEntries: rows.reduce((n, r) => n + r.expenses.entries, 0),
        expenses: money(sum(rows.map((r) => r.expenses.amount))),
        services: rows.reduce((n, r) => n + r.services, 0),
        documentUploads: rows.reduce((n, r) => n + r.documentUploads, 0),
      },
      /** Factual ranking by recorded fuel spend — not a performance judgement. */
      fuelByDriver: this.sorted(rows, 'fuel', 'desc')
        .filter((r) => r.fuel.entries > 0)
        .slice(0, 10)
        .map((r) => ({ id: r.id, label: r.name, amount: r.fuel.amount, entries: r.fuel.entries })),
    };
  }

  async summary(ctx: ReportContext, query: DriverReportQuery) {
    return this.summarise(await this.compute(ctx, query));
  }

  async records(ctx: ReportContext, query: DriverRecordsQuery) {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'fuel', dir: 'desc' });
    const rows = this.sorted(await this.compute(ctx, query, query.q), sort.field, sort.dir);
    const start = (query.page - 1) * query.pageSize;
    return toReportPage(rows.slice(start, start + query.pageSize), rows.length, query, sort);
  }

  async document(ctx: ReportContext, query: DriverExportQuery, limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'name', dir: 'asc' });
    const all = await this.compute(ctx, query, query.q);
    const summary = this.summarise(all);
    const rows = this.sorted(all, sort.field, sort.dir).slice(0, detailTake(all.length, limits));
    const { payments, location } = ctx.visibility;

    const columns: ReportColumn[] = [
      { header: 'Driver', kind: 'text', width: 1.5 }, { header: 'Code', kind: 'text' }, { header: 'Status', kind: 'text' },
      { header: 'Vehicle', kind: 'text' }, { header: 'Fuel entries', kind: 'count' }, { header: 'Fuel litres', kind: 'litres' },
      { header: 'Fuel spend', kind: 'inr' }, { header: 'Other expense records', kind: 'count' }, { header: 'Other expenses', kind: 'inr' },
      { header: 'Service submissions', kind: 'count' }, { header: 'Document uploads', kind: 'count' },
      ...(payments ? [{ header: 'Paid to driver', kind: 'inr' as const }, { header: 'Payments open', kind: 'inr' as const }, { header: 'Failed payments', kind: 'count' as const }] : []),
      ...(location ? [{ header: 'Tracking status (now)', kind: 'text' as const }, { header: 'Last seen', kind: 'datetime' as const }, { header: 'Stationary alerts', kind: 'count' as const }] : []),
    ];

    return {
      title: REPORT_TITLES.drivers,
      filters: [
        ...(await this.lookups.filterLabels(ctx.companyId, query)),
        ...(query.status ? [{ label: 'Status', value: label(LABELS.driverStatus, query.status) }] : []),
        ...(query.q ? [{ label: 'Search', value: query.q }] : []),
      ],
      summary: [
        { label: 'Drivers', value: summary.drivers, kind: 'count' },
        { label: 'Active drivers', value: summary.activeDrivers, kind: 'count' },
        { label: 'Fuel entries', value: summary.totals.fuelEntries, kind: 'count' },
        { label: 'Fuel spend', value: summary.totals.fuel, kind: 'inr' },
        { label: 'Other expenses', value: summary.totals.expenses, kind: 'inr' },
        { label: 'Service submissions', value: summary.totals.services, kind: 'count' },
      ],
      tables: [
        {
          title: 'Driver activity',
          detail: true,
          totalRecords: all.length,
          columns,
          rows: rows.map((r) => [
            r.name, r.code, label(LABELS.driverStatus, r.status), r.vehicle?.registrationNumber ?? '', r.fuel.entries, r.fuel.litres, r.fuel.amount,
            r.expenses.entries, r.expenses.amount, r.services, r.documentUploads,
            ...(payments && r.payments ? [r.payments.paid, r.payments.open, r.payments.failedCount] : []),
            ...(location && r.location ? [label(LABELS.locationStatus, r.location.status), r.location.lastSeenAt, r.location.stationaryAlerts] : []),
          ]),
        },
      ],
      definitions: [
        'Counts and totals come from the records each driver appears on in the period. No performance score is calculated.',
        'Service submissions = maintenance/service records naming the driver. Document uploads = documents the driver uploaded themselves.',
        ...(payments ? ['Payments: payments to the driver created in the period. "Paid" counts only payments with status Paid; open = pending approval, approved or processing.'] : []),
        ...(location ? ['Tracking status is as of the moment the report was generated.'] : []),
      ],
    };
  }
}
