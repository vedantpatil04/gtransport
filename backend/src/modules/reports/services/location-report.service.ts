import { Injectable } from '@nestjs/common';
import { FleetAlertStatus, LocationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import { LocationConfigService } from '../../locations/location.config';
import { LocationsService } from '../../locations/locations.service';
import type { LocationExportQuery, LocationRecordsQuery, LocationReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportDocument } from '../report-document';
import { detailTake, resolveSort, searchText, skipTake, toReportPage, type DetailLimits, type ReportContext } from '../report-context';
import { sortRows } from '../report-maths';
import { addDays, instantWindow, istDay } from '../report-range';
import { ReportLookups } from './report-lookups';

const DRIVER_SORTS = ['name', 'status', 'lastSeen', 'alerts', 'fixes'] as const;
const ALERT_SORTS = ['triggered', 'duration'] as const;
const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, STALE: 1, OFFLINE: 2, LOCATION_DISABLED: 3, PERMISSION_DENIED: 4 };

export interface DriverTrackingRow {
  driverId: string;
  name: string;
  code: string;
  vehicle: { id: string; registrationNumber: string } | null;
  status: string;
  trackingState: string;
  /** Device time of the newest fix. */
  lastUpdate: string | null;
  /** Last contact of any kind. */
  lastSeenAt: string | null;
  stale: boolean;
  stationarySince: string | null;
  /** Minutes in the current stationary period, while an alert for it is open. */
  stationaryMinutes: number | null;
  alertsInPeriod: number;
  /** Fixes received in the period, counted only within the raw-GPS retention window. */
  fixesInWindow: number;
}

/**
 * Fleet location summary. Three sources, each used for what it can honestly support:
 *  - live status and last location: the one-row-per-driver current state, re-derived "as of now"
 *    by the same policy as the Live Fleet screen (reused, not re-implemented);
 *  - stationary stops: fleet alerts, which are kept for good, so they cover any period;
 *  - activity counts: raw GPS fixes, which are kept only for the retention window — counted in
 *    the database, never shipped to the browser, and labelled with the window they cover.
 * Nothing here turns positions into a performance score.
 */
@Injectable()
export class LocationReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: ReportLookups,
    private readonly locations: LocationsService,
    private readonly config: LocationConfigService,
  ) {}

  /** The part of the period raw fixes still exist for. Null when the period is entirely older. */
  private retainedWindow(ctx: ReportContext): { gte: Date; lt: Date; from: Date } | null {
    const window = instantWindow(ctx.range);
    const retainedSince = new Date(ctx.now.getTime() - this.config.rawRetentionDays * 86_400_000);
    if (window.lt <= retainedSince) return null;
    const gte = window.gte > retainedSince ? window.gte : retainedSince;
    return { gte, lt: window.lt, from: istDay(gte) };
  }

  private alertMinutes(alert: { stationarySince: Date; movedAt: Date | null; resolvedAt: Date | null }, now: Date): number {
    const end = alert.movedAt ?? alert.resolvedAt ?? now;
    return Math.max(0, Math.round((end.getTime() - alert.stationarySince.getTime()) / 60_000));
  }

  private async drivers(ctx: ReportContext, query: LocationReportQuery, q?: string): Promise<DriverTrackingRow[]> {
    const fleet = await this.locations.fleet(ctx.companyId, ctx.role, {});
    const search = searchText(q)?.toLowerCase();
    const views = fleet.data.filter(
      (v) =>
        (!query.driverId || v.driverId === query.driverId) &&
        (!query.status || v.status === query.status) &&
        (!search || v.employee.fullName.toLowerCase().includes(search) || v.driverCode.toLowerCase().includes(search) || Boolean(v.vehicle?.registrationNumber.toLowerCase().includes(search))),
    );
    if (!views.length) return [];
    const ids = views.map((v) => v.driverId);
    const retained = this.retainedWindow(ctx);
    const [alerts, fixes] = await Promise.all([
      this.prisma.fleetLocationAlert.groupBy({ by: ['driverId'], where: { companyId: ctx.companyId, driverId: { in: ids }, triggeredAt: instantWindow(ctx.range) }, _count: { _all: true } }),
      retained
        ? this.prisma.driverLocationPing.groupBy({ by: ['driverId'], where: { companyId: ctx.companyId, driverId: { in: ids }, recordedAt: { gte: retained.gte, lt: retained.lt } }, _count: { _all: true } })
        : [],
    ]);
    return views.map((v) => ({
      driverId: v.driverId,
      name: v.employee.fullName,
      code: v.driverCode,
      vehicle: v.vehicle ? { id: v.vehicle.id, registrationNumber: v.vehicle.registrationNumber } : null,
      status: v.status,
      trackingState: v.trackingState,
      lastUpdate: v.capturedAt,
      lastSeenAt: v.lastSeenAt,
      stale: v.stale,
      stationarySince: v.stationarySince,
      stationaryMinutes: v.alert?.status === FleetAlertStatus.ACTIVE ? v.stationaryMinutes : null,
      alertsInPeriod: alerts.find((a) => a.driverId === v.driverId)?._count._all ?? 0,
      fixesInWindow: fixes.find((f) => f.driverId === v.driverId)?._count._all ?? 0,
    }));
  }

  private alertWhere(ctx: ReportContext, query: LocationReportQuery): Prisma.FleetLocationAlertWhereInput {
    return { companyId: ctx.companyId, triggeredAt: instantWindow(ctx.range), ...(query.driverId ? { driverId: query.driverId } : {}) };
  }

  async summary(ctx: ReportContext, query: LocationReportQuery) {
    const [rows, alertRows, neverReported, activity] = await Promise.all([
      this.drivers(ctx, query),
      this.prisma.fleetLocationAlert.findMany({
        where: this.alertWhere(ctx, query),
        select: { status: true, stationarySince: true, movedAt: true, resolvedAt: true },
      }),
      this.prisma.driver.count({ where: { companyId: ctx.companyId, deletedAt: null, status: 'ACTIVE', locationState: null, ...(query.driverId ? { id: query.driverId } : {}) } }),
      this.activity(ctx, query),
    ]);
    const durations = alertRows.map((a) => this.alertMinutes(a, ctx.now));
    const count = (status: LocationStatus) => rows.filter((r) => r.status === status).length;
    return {
      asOf: ctx.now.toISOString(),
      tracking: {
        drivers: rows.length,
        active: count(LocationStatus.ACTIVE),
        stale: count(LocationStatus.STALE),
        offline: count(LocationStatus.OFFLINE),
        unavailable: count(LocationStatus.PERMISSION_DENIED) + count(LocationStatus.LOCATION_DISABLED),
        stationaryNow: rows.filter((r) => r.stationaryMinutes !== null).length,
        neverReported,
      },
      staleDrivers: rows
        .filter((r) => r.status === LocationStatus.STALE || r.status === LocationStatus.OFFLINE)
        .sort((a, b) => (a.lastSeenAt ?? '').localeCompare(b.lastSeenAt ?? ''))
        .slice(0, 20)
        .map((r) => ({ driverId: r.driverId, name: r.name, vehicle: r.vehicle?.registrationNumber ?? null, status: r.status, lastSeenAt: r.lastSeenAt })),
      alerts: {
        total: alertRows.length,
        active: alertRows.filter((a) => a.status === FleetAlertStatus.ACTIVE).length,
        acknowledged: alertRows.filter((a) => a.status === FleetAlertStatus.ACKNOWLEDGED).length,
        resolved: alertRows.filter((a) => a.status === FleetAlertStatus.RESOLVED).length,
        totalMinutes: durations.reduce((a, b) => a + b, 0),
        longestMinutes: durations.length ? Math.max(...durations) : null,
      },
      activity,
    };
  }

  /** Fixes per India day, inside the retention window only. Aggregated in SQL; no points leave the database. */
  private async activity(ctx: ReportContext, query: LocationReportQuery) {
    const retained = this.retainedWindow(ctx);
    if (!retained) return { retentionDays: this.config.rawRetentionDays, coveredFrom: null, days: [] as { date: string; fixes: number; drivers: number }[] };
    const rows = await this.prisma.$queryRaw<{ day: Date; fixes: number; drivers: number }[]>`
      SELECT (recorded_at AT TIME ZONE 'Asia/Kolkata')::date AS day, COUNT(*)::int AS fixes, COUNT(DISTINCT driver_id)::int AS drivers
      FROM driver_location_pings
      WHERE company_id = ${ctx.companyId}::uuid AND recorded_at >= ${retained.gte} AND recorded_at < ${retained.lt}
      ${query.driverId ? Prisma.sql`AND driver_id = ${query.driverId}::uuid` : Prisma.empty}
      GROUP BY 1 ORDER BY 1`;
    const byDay = new Map(rows.map((r) => [toIsoDate(r.day), r]));
    const days: { date: string; fixes: number; drivers: number }[] = [];
    for (let day = retained.from; day <= ctx.range.to; day = addDays(day, 1)) {
      const row = byDay.get(toIsoDate(day));
      days.push({ date: toIsoDate(day), fixes: row?.fixes ?? 0, drivers: row?.drivers ?? 0 });
    }
    return { retentionDays: this.config.rawRetentionDays, coveredFrom: toIsoDate(retained.from), days };
  }

  private sortDrivers(rows: DriverTrackingRow[], field: (typeof DRIVER_SORTS)[number], dir: 'asc' | 'desc') {
    const value: Record<(typeof DRIVER_SORTS)[number], (r: DriverTrackingRow) => string | number | null> = {
      name: (r) => r.name,
      status: (r) => STATUS_ORDER[r.status] ?? 9,
      lastSeen: (r) => (r.lastSeenAt ? Date.parse(r.lastSeenAt) : null),
      alerts: (r) => r.alertsInPeriod,
      fixes: (r) => r.fixesInWindow,
    };
    return sortRows(rows, value[field], dir, (r) => r.name);
  }

  private async alertRows(ctx: ReportContext, query: LocationReportQuery, sort: { field: (typeof ALERT_SORTS)[number]; dir: 'asc' | 'desc' }, window: { skip?: number; take: number }) {
    const rows = await this.prisma.fleetLocationAlert.findMany({
      where: this.alertWhere(ctx, query),
      select: {
        id: true, status: true, triggeredAt: true, stationarySince: true, movedAt: true, resolvedAt: true, latitude: true, longitude: true,
        radiusMeters: true, vehicleId: true, driver: { select: { id: true, employee: { select: { fullName: true } } } },
      },
      orderBy: sort.field === 'duration' ? [{ stationarySince: sort.dir === 'desc' ? 'asc' : 'desc' }, { id: 'desc' }] : [{ triggeredAt: sort.dir }, { id: 'desc' }],
      ...window,
    });
    const vehicles = await this.lookups.vehicles(ctx.companyId, rows.map((r) => r.vehicleId));
    return rows.map((r) => ({
      id: r.id,
      driver: { id: r.driver.id, name: r.driver.employee.fullName },
      vehicle: r.vehicleId ? { id: r.vehicleId, registrationNumber: vehicles.get(r.vehicleId) ?? '—' } : null,
      status: r.status,
      triggeredAt: r.triggeredAt.toISOString(),
      stationarySince: r.stationarySince.toISOString(),
      endedAt: (r.movedAt ?? r.resolvedAt)?.toISOString() ?? null,
      durationMinutes: this.alertMinutes(r, ctx.now),
      latitude: r.latitude.toNumber(),
      longitude: r.longitude.toNumber(),
      radiusMeters: r.radiusMeters,
    }));
  }

  async records(ctx: ReportContext, query: LocationRecordsQuery) {
    if (query.section === 'alerts') {
      const sort = resolveSort(query.sort, query.dir, ALERT_SORTS, { field: 'triggered', dir: 'desc' });
      const [rows, total] = await Promise.all([this.alertRows(ctx, query, sort, skipTake(query)), this.prisma.fleetLocationAlert.count({ where: this.alertWhere(ctx, query) })]);
      return { section: 'alerts' as const, ...toReportPage(rows, total, query, sort) };
    }
    const sort = resolveSort(query.sort, query.dir, DRIVER_SORTS, { field: 'status', dir: 'asc' });
    const rows = this.sortDrivers(await this.drivers(ctx, query, query.q), sort.field, sort.dir);
    const start = (query.page - 1) * query.pageSize;
    return { section: 'drivers' as const, ...toReportPage(rows.slice(start, start + query.pageSize), rows.length, query, sort) };
  }

  async document(ctx: ReportContext, query: LocationExportQuery, limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const [s, drivers, alertTotal] = await Promise.all([
      this.summary(ctx, query),
      this.drivers(ctx, query, query.q),
      this.prisma.fleetLocationAlert.count({ where: this.alertWhere(ctx, query) }),
    ]);
    const driverRows = this.sortDrivers(drivers, 'name', 'asc').slice(0, detailTake(drivers.length, limits));
    const alertTake = detailTake(alertTotal, limits);
    const alerts = alertTake ? await this.alertRows(ctx, query, { field: 'triggered', dir: 'asc' }, { take: alertTake }) : [];
    const hours = (minutes: number | null) => (minutes === null ? null : Math.round((minutes / 60) * 10) / 10);

    return {
      title: REPORT_TITLES.location,
      filters: [
        ...(await this.lookups.filterLabels(ctx.companyId, query)),
        ...(query.status ? [{ label: 'Tracking status', value: label(LABELS.locationStatus, query.status) }] : []),
        ...(query.q ? [{ label: 'Search', value: query.q }] : []),
      ],
      summary: [
        { label: 'Drivers reporting', value: s.tracking.drivers, kind: 'count' },
        { label: 'Active now', value: s.tracking.active, kind: 'count' },
        { label: 'Stale / offline now', value: s.tracking.stale + s.tracking.offline, kind: 'count' },
        { label: 'Active drivers never reported', value: s.tracking.neverReported, kind: 'count' },
        { label: 'Stationary alerts in period', value: s.alerts.total, kind: 'count' },
        { label: 'Longest stop (hours)', value: hours(s.alerts.longestMinutes), kind: 'number' },
      ],
      tables: [
        {
          title: 'Drivers — tracking status',
          detail: true,
          totalRecords: drivers.length,
          columns: [
            { header: 'Driver', kind: 'text', width: 1.5 }, { header: 'Vehicle', kind: 'text' }, { header: 'Status (now)', kind: 'text' },
            { header: 'Last location update', kind: 'datetime', width: 1.5 }, { header: 'Last seen', kind: 'datetime', width: 1.5 },
            { header: 'Stationary for (h)', kind: 'number' }, { header: 'Alerts in period', kind: 'count' }, { header: `Fixes (last ${s.activity.retentionDays} days)`, kind: 'count' },
          ],
          rows: driverRows.map((r) => [r.name, r.vehicle?.registrationNumber ?? '', label(LABELS.locationStatus, r.status), r.lastUpdate, r.lastSeenAt, hours(r.stationaryMinutes), r.alertsInPeriod, r.fixesInWindow]),
        },
        {
          title: 'Stationary alerts',
          detail: true,
          totalRecords: alertTotal,
          columns: [
            { header: 'Driver', kind: 'text', width: 1.5 }, { header: 'Vehicle', kind: 'text' }, { header: 'Stopped since', kind: 'datetime', width: 1.5 },
            { header: 'Alert raised', kind: 'datetime', width: 1.5 }, { header: 'Moved / closed', kind: 'datetime', width: 1.5 },
            { header: 'Duration (h)', kind: 'number' }, { header: 'Status', kind: 'text' }, { header: 'Latitude', kind: 'number' }, { header: 'Longitude', kind: 'number' },
          ],
          rows: alerts.map((a) => [a.driver.name, a.vehicle?.registrationNumber ?? '', a.stationarySince, a.triggeredAt, a.endedAt, hours(a.durationMinutes), label(LABELS.alertStatus, a.status), a.latitude, a.longitude]),
        },
        {
          title: `GPS activity by day (raw fixes are kept ${s.activity.retentionDays} days)`,
          columns: [{ header: 'Date', kind: 'date' }, { header: 'Fixes received', kind: 'count' }, { header: 'Drivers reporting', kind: 'count' }],
          rows: s.activity.days.map((d) => [d.date, d.fixes, d.drivers]),
          note: s.activity.coveredFrom ? undefined : 'The whole period is older than the raw-GPS retention window, so no fix counts exist for it.',
        },
      ],
      definitions: [
        'Tracking status, last update and "stationary for" are as of the moment the report was generated.',
        'Stop duration runs from when the driver stopped until they moved or the alert was closed (or until now, for an open alert).',
        `Raw GPS fixes are kept for ${s.activity.retentionDays} days, so fix counts cover only that part of the period. Stationary alerts are kept permanently.`,
        'No driving-performance score is derived from location data.',
      ],
    };
  }
}
