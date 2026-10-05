import { Injectable } from '@nestjs/common';
import { FuelType, Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import type { FuelExportQuery, FuelRecordsQuery, FuelReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportDocument, bucketText } from '../report-document';
import { detailTake, resolveSort, searchText, skipTake, toReportPage, type DetailLimits, type ReportContext } from '../report-context';
import { fillTrend, litres, money, share, weightedRate } from '../report-maths';
import { dateWindow } from '../report-range';
import { ReportLookups } from './report-lookups';

const SORTS = ['date', 'amount', 'litres', 'vehicle', 'driver', 'station'] as const;
type FuelSort = (typeof SORTS)[number];

const ROW_VIEW = {
  id: true,
  transactionDate: true,
  fuelType: true,
  amount: true,
  litres: true,
  fuelStation: true,
  receiptFileId: true,
  vehicle: { select: { id: true, registrationNumber: true } },
  driver: { select: { id: true, driverCode: true, employee: { select: { fullName: true } } } },
} as const;
type FuelRow = Prisma.FuelEntryGetPayload<{ select: typeof ROW_VIEW }>;

/** Breakdown lists are capped: they feed charts and summary tables, not exports of every key. */
const BREAKDOWN_LIMIT = 500;
const STATION_LIMIT = 50;

/**
 * Fuel report. Source of truth: active fuel entries (archived entries are excluded everywhere,
 * exactly as on the Fuel screen). The average rate is always weighted — total amount ÷ total
 * litres — so an 80-litre fill counts for more than a 5-litre top-up.
 */
@Injectable()
export class FuelReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: ReportLookups,
  ) {}

  private where(ctx: ReportContext, query: FuelReportQuery, q?: string): Prisma.FuelEntryWhereInput {
    const station = query.station?.trim();
    const search = searchText(q);
    return {
      companyId: ctx.companyId,
      status: RecordStatus.ACTIVE,
      transactionDate: dateWindow(ctx.range),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.fuelType ? { fuelType: query.fuelType } : {}),
      ...(station ? { fuelStation: { contains: station, mode: Prisma.QueryMode.insensitive } } : {}),
      ...(search
        ? {
            OR: [
              { fuelStation: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { vehicle: { registrationNumber: { contains: search, mode: Prisma.QueryMode.insensitive } } },
              { driver: { employee: { fullName: { contains: search, mode: Prisma.QueryMode.insensitive } } } },
              { driver: { driverCode: { contains: search, mode: Prisma.QueryMode.insensitive } } },
            ],
          }
        : {}),
    };
  }

  async summary(ctx: ReportContext, query: FuelReportQuery, q?: string) {
    const where = this.where(ctx, query, q);
    const sums = { _count: { _all: true }, _sum: { amount: true, litres: true } } as const;
    const [totals, byType, byDay, byVehicle, byDriver, byStation] = await Promise.all([
      this.prisma.fuelEntry.aggregate({ where, _count: { _all: true }, _sum: { amount: true, litres: true } }),
      this.prisma.fuelEntry.groupBy({ by: ['fuelType'], where, ...sums }),
      this.prisma.fuelEntry.groupBy({ by: ['transactionDate'], where, ...sums }),
      this.prisma.fuelEntry.groupBy({ by: ['vehicleId'], where, ...sums, orderBy: { _sum: { amount: 'desc' } }, take: BREAKDOWN_LIMIT }),
      this.prisma.fuelEntry.groupBy({ by: ['driverId'], where, ...sums, orderBy: { _sum: { amount: 'desc' } }, take: BREAKDOWN_LIMIT }),
      this.prisma.fuelEntry.groupBy({ by: ['fuelStation'], where, ...sums, orderBy: { _sum: { amount: 'desc' } }, take: STATION_LIMIT }),
    ]);
    const [vehicles, drivers] = await Promise.all([
      this.lookups.vehicles(ctx.companyId, byVehicle.map((row) => row.vehicleId)),
      this.lookups.drivers(ctx.companyId, byDriver.map((row) => row.driverId)),
    ]);

    const totalAmount = totals._sum.amount;
    const figures = (row: { _count: { _all: number }; _sum: { amount: Prisma.Decimal | null; litres: Prisma.Decimal | null } }) => ({
      entries: row._count._all,
      amount: money(row._sum.amount),
      litres: litres(row._sum.litres),
      averageRate: weightedRate(row._sum.amount, row._sum.litres),
      share: share(row._sum.amount ?? 0, totalAmount ?? 0),
    });

    const fuelTypes = Object.fromEntries(
      Object.values(FuelType).map((type) => {
        const row = byType.find((r) => r.fuelType === type);
        return [type, row ? figures(row) : { entries: 0, amount: '0.00', litres: '0.000', averageRate: null, share: null }];
      }),
    ) as Record<FuelType, ReturnType<typeof figures>>;

    const vehicleRows = byVehicle.map((row) => ({ id: row.vehicleId, label: vehicles.get(row.vehicleId) ?? '—', ...figures(row) }));
    return {
      totals: {
        entries: totals._count._all,
        amount: money(totalAmount),
        litres: litres(totals._sum.litres),
        averageRate: weightedRate(totalAmount, totals._sum.litres),
      },
      byFuelType: fuelTypes,
      trend: fillTrend(
        ctx.range,
        byDay.map((row) => ({ date: row.transactionDate, amount: row._sum.amount, litres: row._sum.litres, entries: row._count._all })),
        ['amount', 'litres', 'entries'] as const,
        (value, field) => (field === 'entries' ? value.toNumber() : field === 'litres' ? value.toFixed(3) : value.toFixed(2)),
      ),
      byVehicle: vehicleRows,
      byDriver: byDriver.map((row) => ({ id: row.driverId, label: drivers.get(row.driverId) ?? '—', ...figures(row) })),
      byStation: byStation.map((row) => ({ id: row.fuelStation, label: row.fuelStation, ...figures(row) })),
      highestSpendVehicle: vehicleRows[0] ?? null,
    };
  }

  private orderBy(field: FuelSort, dir: 'asc' | 'desc'): Prisma.FuelEntryOrderByWithRelationInput[] {
    const primary: Record<FuelSort, Prisma.FuelEntryOrderByWithRelationInput> = {
      date: { transactionDate: dir },
      amount: { amount: dir },
      litres: { litres: dir },
      vehicle: { vehicle: { registrationNumber: dir } },
      driver: { driver: { employee: { fullName: dir } } },
      station: { fuelStation: dir },
    };
    return [primary[field], ...(field === 'date' ? [] : [{ transactionDate: 'desc' as const }]), { id: dir }];
  }

  private present(row: FuelRow) {
    return {
      id: row.id,
      date: toIsoDate(row.transactionDate),
      vehicle: { id: row.vehicle.id, registrationNumber: row.vehicle.registrationNumber },
      driver: { id: row.driver.id, name: row.driver.employee.fullName, code: row.driver.driverCode },
      fuelType: row.fuelType,
      litres: litres(row.litres),
      amount: money(row.amount),
      rate: weightedRate(row.amount, row.litres),
      station: row.fuelStation,
      receiptFileId: row.receiptFileId,
    };
  }

  async records(ctx: ReportContext, query: FuelRecordsQuery) {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'date', dir: 'desc' });
    const where = this.where(ctx, query, query.q);
    const [rows, total] = await Promise.all([
      this.prisma.fuelEntry.findMany({ where, select: ROW_VIEW, orderBy: this.orderBy(sort.field, sort.dir), ...skipTake(query) }),
      this.prisma.fuelEntry.count({ where }),
    ]);
    return toReportPage(rows.map((row) => this.present(row)), total, query, sort);
  }

  async document(ctx: ReportContext, query: FuelExportQuery, limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'date', dir: 'asc' });
    const where = this.where(ctx, query, query.q);
    const [summary, total] = await Promise.all([this.summary(ctx, query, query.q), this.prisma.fuelEntry.count({ where })]);
    const take = detailTake(total, limits);
    const rows = take ? await this.prisma.fuelEntry.findMany({ where, select: ROW_VIEW, orderBy: this.orderBy(sort.field, sort.dir), take }) : [];

    const breakdownColumns = [
      { header: 'Entries', kind: 'count' as const },
      { header: 'Litres', kind: 'litres' as const },
      { header: 'Average rate', kind: 'rate' as const },
      { header: 'Amount', kind: 'inr' as const },
    ];
    const breakdown = (title: string, first: string, list: { label: string; entries: number; litres: string; averageRate: string | null; amount: string }[]) => ({
      title,
      columns: [{ header: first, kind: 'text' as const, width: 2 }, ...breakdownColumns],
      rows: list.map((r) => [r.label, r.entries, r.litres, r.averageRate, r.amount]),
    });

    return {
      title: REPORT_TITLES.fuel,
      filters: [
        ...(await this.lookups.filterLabels(ctx.companyId, query)),
        ...(query.fuelType ? [{ label: 'Fuel type', value: label(LABELS.fuelType, query.fuelType) }] : []),
        ...(query.station ? [{ label: 'Station contains', value: query.station }] : []),
        ...(query.q ? [{ label: 'Search', value: query.q }] : []),
      ],
      summary: [
        { label: 'Total amount', value: summary.totals.amount, kind: 'inr' },
        { label: 'Total litres', value: summary.totals.litres, kind: 'litres' },
        { label: 'Average rate (weighted)', value: summary.totals.averageRate, kind: 'rate' },
        { label: 'Fuel entries', value: summary.totals.entries, kind: 'count' },
        { label: 'Petrol amount', value: summary.byFuelType.PETROL.amount, kind: 'inr' },
        { label: 'Diesel amount', value: summary.byFuelType.DIESEL.amount, kind: 'inr' },
      ],
      tables: [
        breakdown('Spend by fuel type', 'Fuel type', (['PETROL', 'DIESEL'] as const).map((t) => ({ label: label(LABELS.fuelType, t), ...summary.byFuelType[t] }))),
        breakdown('Vehicle-wise spend', 'Vehicle', summary.byVehicle),
        breakdown('Driver-wise spend', 'Driver', summary.byDriver),
        breakdown('Station-wise spend (top 50)', 'Fuel station', summary.byStation),
        {
          title: ctx.range.granularity === 'day' ? 'Daily trend' : 'Monthly trend',
          columns: [{ header: ctx.range.granularity === 'day' ? 'Date' : 'Month', kind: 'text' }, { header: 'Entries', kind: 'count' }, { header: 'Litres', kind: 'litres' }, { header: 'Amount', kind: 'inr' }],
          rows: summary.trend.map((b) => [bucketText(b.bucket), b.entries, b.litres, b.amount]),
        },
        {
          title: 'Fuel entries',
          detail: true,
          totalRecords: total,
          columns: [
            { header: 'Date', kind: 'date' }, { header: 'Vehicle', kind: 'text' }, { header: 'Driver', kind: 'text', width: 1.5 },
            { header: 'Fuel type', kind: 'text' }, { header: 'Litres', kind: 'litres' }, { header: 'Rate', kind: 'rate' },
            { header: 'Amount', kind: 'inr' }, { header: 'Fuel station', kind: 'text', width: 2 }, { header: 'Receipt', kind: 'text' },
          ],
          rows: rows.map((row) => {
            const r = this.present(row);
            return [r.date, r.vehicle.registrationNumber, r.driver.name, label(LABELS.fuelType, r.fuelType), r.litres, r.rate, r.amount, r.station, r.receiptFileId ? 'Attached' : 'None'];
          }),
          totals: ['Total', '', '', '', summary.totals.litres, summary.totals.averageRate, summary.totals.amount, '', ''],
        },
      ],
      definitions: [
        'Average fuel rate = total fuel amount ÷ total litres (weighted), not an average of individual rates.',
        'Archived fuel entries are excluded from every figure.',
      ],
    };
  }
}
