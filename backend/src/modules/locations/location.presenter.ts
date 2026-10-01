import type { Prisma } from '@prisma/client';
import { canSeePayroll } from '../auth/roles';
import { deriveLocationStatus, type LocationStaleness } from './location-status.policy';
import type { UserRole } from '@prisma/client';

/**
 * JSON shapes for the fleet screens.
 *
 * Coordinates go out as numbers, not Prisma `Decimal` objects, because a map consumes numbers;
 * timestamps go out as ISO strings. Presenters are the only place that converts, so no screen
 * ever has to guess which it is holding.
 */

const num = (value: Prisma.Decimal | null): number | null => (value === null ? null : value.toNumber());
const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export const FLEET_LOCATION_VIEW = {
  driverId: true,
  status: true,
  trackingState: true,
  permission: true,
  locationServicesEnabled: true,
  pendingUploads: true,
  latitude: true,
  longitude: true,
  accuracyMeters: true,
  speedKmh: true,
  headingDeg: true,
  altitudeMeters: true,
  batteryPct: true,
  recordedAt: true,
  receivedAt: true,
  lastHeartbeatAt: true,
  stationarySince: true,
  stationaryAlertId: true,
  vehicleId: true,
  driver: {
    select: {
      id: true,
      driverCode: true,
      status: true,
      employee: { select: { id: true, employeeCode: true, fullName: true, phone: true } },
      currentAssignment: { select: { id: true, vehicle: { select: { id: true, registrationNumber: true, kind: true } } } },
    },
  },
  stationaryAlert: {
    select: { id: true, status: true, triggeredAt: true, stationarySince: true, durationMinutes: true },
  },
} as const;

export type FleetLocationRow = Prisma.DriverLocationStateGetPayload<{ select: typeof FLEET_LOCATION_VIEW }>;

export interface FleetLocationView {
  driverId: string;
  driverCode: string;
  driverStatus: string;
  employee: { id: string; employeeCode: string; fullName: string; phone: string | null };
  vehicle: { id: string; registrationNumber: string; kind: string } | null;
  /** Null until the driver's first accepted fix; the row still exists to carry the tracking state. */
  position: { latitude: number; longitude: number; accuracyMeters: number | null; speedKmh: number | null; headingDeg: number | null; altitudeMeters: number | null } | null;
  /**
   * What the driver's signals say as of this request, not as of their last report: a driver who has
   * gone quiet turns from ACTIVE to STALE to OFFLINE with the clock, using the same policy (and the
   * same thresholds) that classified them when they last reported.
   */
  status: string;
  trackingState: string;
  permission: string;
  locationServicesEnabled: boolean;
  pendingUploads: number;
  batteryPct: number | null;
  /** Device capture time of the newest fix. */
  capturedAt: string | null;
  /** Server time that fix was stored. */
  receivedAt: string | null;
  /** Last contact of any kind — a fix or a tracking report. */
  lastSeenAt: string | null;
  /** True when the newest fix is older than the configured freshness window. */
  stale: boolean;
  stationarySince: string | null;
  /** Whole minutes the driver has been inside the current stationary region. */
  stationaryMinutes: number | null;
  alert: { id: string; status: string; triggeredAt: string; stationarySince: string; durationMinutes: number } | null;
}

export function presentFleetLocation(row: FleetLocationRow, now: Date, staleness: LocationStaleness): FleetLocationView {
  const latitude = num(row.latitude);
  const longitude = num(row.longitude);
  const capturedAt = row.recordedAt;

  return {
    driverId: row.driverId,
    driverCode: row.driver.driverCode,
    driverStatus: row.driver.status,
    employee: {
      id: row.driver.employee.id,
      employeeCode: row.driver.employee.employeeCode,
      fullName: row.driver.employee.fullName,
      phone: row.driver.employee.phone,
    },
    // The live assignment is authoritative for the label; the denormalised vehicle on the state
    // row describes where the last fix happened and may legitimately be a previous truck.
    vehicle: row.driver.currentAssignment?.vehicle ?? null,
    position:
      latitude === null || longitude === null
        ? null
        : {
            latitude,
            longitude,
            accuracyMeters: num(row.accuracyMeters),
            speedKmh: num(row.speedKmh),
            headingDeg: num(row.headingDeg),
            altitudeMeters: num(row.altitudeMeters),
          },
    // The stored column is what the last report concluded; time has passed since. The policy is a
    // pure function of the same signals, so asking it again now can only differ by the clock.
    status: deriveLocationStatus(
      {
        permission: row.permission,
        locationServicesEnabled: row.locationServicesEnabled,
        lastHeartbeatAt: row.lastHeartbeatAt,
        recordedAt: capturedAt,
        trackingState: row.trackingState,
      },
      now,
      staleness,
    ),
    trackingState: row.trackingState,
    permission: row.permission,
    locationServicesEnabled: row.locationServicesEnabled,
    pendingUploads: row.pendingUploads,
    batteryPct: row.batteryPct,
    capturedAt: iso(capturedAt),
    receivedAt: iso(row.receivedAt),
    lastSeenAt: iso(row.lastHeartbeatAt),
    stale: !capturedAt || now.getTime() - capturedAt.getTime() > staleness.staleAfterMs,
    stationarySince: iso(row.stationarySince),
    stationaryMinutes: row.stationarySince ? Math.max(0, Math.floor((now.getTime() - row.stationarySince.getTime()) / 60_000)) : null,
    alert: row.stationaryAlert
      ? {
          id: row.stationaryAlert.id,
          status: row.stationaryAlert.status,
          triggeredAt: row.stationaryAlert.triggeredAt.toISOString(),
          stationarySince: row.stationaryAlert.stationarySince.toISOString(),
          durationMinutes: row.stationaryAlert.durationMinutes,
        }
      : null,
  };
}

// ───────────────────────────── History ─────────────────────────────

export const PING_VIEW = {
  id: true,
  latitude: true,
  longitude: true,
  accuracyMeters: true,
  speedKmh: true,
  headingDeg: true,
  altitudeMeters: true,
  batteryPct: true,
  provider: true,
  recordedAt: true,
  receivedAt: true,
  vehicleId: true,
} as const;

export type PingRow = Prisma.DriverLocationPingGetPayload<{ select: typeof PING_VIEW }>;

export interface LocationPingView {
  id: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  altitudeMeters: number | null;
  batteryPct: number | null;
  provider: string | null;
  capturedAt: string;
  receivedAt: string;
  /** The vehicle assigned when this fix was captured, not the driver's vehicle today. */
  vehicleId: string | null;
}

export function presentPing(row: PingRow): LocationPingView {
  return {
    // A bigint cannot survive JSON.stringify, and JavaScript clients lose precision past 2^53,
    // so the id crosses the wire as a string.
    id: row.id.toString(),
    latitude: row.latitude.toNumber(),
    longitude: row.longitude.toNumber(),
    accuracyMeters: num(row.accuracyMeters),
    speedKmh: num(row.speedKmh),
    headingDeg: num(row.headingDeg),
    altitudeMeters: num(row.altitudeMeters),
    batteryPct: row.batteryPct,
    provider: row.provider,
    capturedAt: row.recordedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    vehicleId: row.vehicleId,
  };
}

// ───────────────────────────── Alerts ─────────────────────────────

export const ALERT_VIEW = {
  id: true,
  type: true,
  status: true,
  triggeredAt: true,
  stationarySince: true,
  latitude: true,
  longitude: true,
  durationMinutes: true,
  radiusMeters: true,
  acknowledgedAt: true,
  acknowledgedById: true,
  acknowledgeNote: true,
  resolvedAt: true,
  resolvedById: true,
  resolvedReason: true,
  movedAt: true,
  createdAt: true,
  vehicleId: true,
  driver: {
    select: {
      id: true,
      driverCode: true,
      employee: { select: { id: true, employeeCode: true, fullName: true, phone: true } },
      currentAssignment: { select: { vehicle: { select: { id: true, registrationNumber: true } } } },
    },
  },
} as const;

export type AlertRow = Prisma.FleetLocationAlertGetPayload<{ select: typeof ALERT_VIEW }>;

export interface FleetAlertView {
  id: string;
  type: string;
  status: string;
  driver: { id: string; driverCode: string; fullName: string; employeeCode: string; phone: string | null };
  /** The vehicle held when the alert fired; the driver may hold a different one now. */
  vehicleId: string | null;
  vehicleRegistration: string | null;
  triggeredAt: string;
  stationarySince: string;
  latitude: number;
  longitude: number;
  durationMinutes: number;
  radiusMeters: number;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  acknowledgeNote: string | null;
  resolvedAt: string | null;
  resolvedReason: string | null;
  movedAt: string | null;
}

export function presentAlert(row: AlertRow, viewerRole: UserRole): FleetAlertView {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    driver: {
      id: row.driver.id,
      driverCode: row.driver.driverCode,
      fullName: row.driver.employee.fullName,
      employeeCode: row.driver.employee.employeeCode,
      // A phone number is contact data, not payroll; it is here because acting on a stationary
      // alert means calling the driver. Withheld from roles that see no personnel detail.
      phone: canSeePayroll(viewerRole) || viewerRole === 'MANAGER' ? row.driver.employee.phone : null,
    },
    vehicleId: row.vehicleId,
    vehicleRegistration: row.driver.currentAssignment?.vehicle.registrationNumber ?? null,
    triggeredAt: row.triggeredAt.toISOString(),
    stationarySince: row.stationarySince.toISOString(),
    latitude: row.latitude.toNumber(),
    longitude: row.longitude.toNumber(),
    durationMinutes: row.durationMinutes,
    radiusMeters: row.radiusMeters,
    acknowledgedAt: iso(row.acknowledgedAt),
    acknowledgedById: row.acknowledgedById,
    acknowledgeNote: row.acknowledgeNote,
    resolvedAt: iso(row.resolvedAt),
    resolvedReason: row.resolvedReason,
    movedAt: iso(row.movedAt),
  };
}
