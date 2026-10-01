import { DriverTrackingState, LocationPermission, LocationStatus, Prisma } from '@prisma/client';
import { presentFleetLocation, type FleetLocationRow } from './location.presenter';

/**
 * What the fleet screen is told about a driver, as of the moment it asks.
 *
 * The status stored on a driver's row is the one derived when the phone last reported. Time keeps
 * passing after that, so the screen must be told what the same signals say *now*: a driver who
 * has gone quiet has to turn from reporting to falling behind to not reporting without anyone
 * having to report it.
 */

const STALENESS = { staleAfterMs: 15 * 60_000, offlineAfterMs: 30 * 60_000 };
const NOW = new Date('2026-10-01T12:00:00.000Z');
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/** A row exactly as the database would hand it back, with `status` as it was stored at the last report. */
function row(overrides: Partial<FleetLocationRow> = {}): FleetLocationRow {
  return {
    driverId: 'driver-1',
    status: LocationStatus.ACTIVE,
    trackingState: DriverTrackingState.TRACKING_ACTIVE,
    permission: LocationPermission.GRANTED_ALWAYS,
    locationServicesEnabled: true,
    pendingUploads: 0,
    latitude: new Prisma.Decimal(15.85),
    longitude: new Prisma.Decimal(74.498),
    accuracyMeters: new Prisma.Decimal(8),
    speedKmh: new Prisma.Decimal(40),
    headingDeg: null,
    altitudeMeters: null,
    batteryPct: 80,
    recordedAt: minutesBefore(1),
    receivedAt: minutesBefore(1),
    lastHeartbeatAt: minutesBefore(1),
    stationarySince: null,
    stationaryAlertId: null,
    vehicleId: null,
    driver: {
      id: 'driver-1',
      driverCode: 'GR-D-101',
      status: 'ACTIVE',
      employee: { id: 'emp-1', employeeCode: 'GR-E-001', fullName: 'Ramesh Kumar', phone: null },
      currentAssignment: null,
    },
    stationaryAlert: null,
    ...overrides,
  } as FleetLocationRow;
}

const statusOf = (r: FleetLocationRow, staleness = STALENESS) => presentFleetLocation(r, NOW, staleness).status;

describe('presentFleetLocation: status as of now', () => {
  it('is ACTIVE while both the newest fix and the last contact are inside the windows', () => {
    expect(statusOf(row())).toBe(LocationStatus.ACTIVE);
    expect(statusOf(row({ recordedAt: minutesBefore(14), lastHeartbeatAt: minutesBefore(2) }))).toBe(LocationStatus.ACTIVE);
  });

  it('turns a driver whose newest fix has gone stale into STALE, though the stored status still says ACTIVE', () => {
    const view = presentFleetLocation(row({ status: LocationStatus.ACTIVE, recordedAt: minutesBefore(16), lastHeartbeatAt: minutesBefore(1) }), NOW, STALENESS);
    expect(view.status).toBe(LocationStatus.STALE);
    // The existing freshness flag and the status agree about the same fix.
    expect(view.stale).toBe(true);
  });

  it('turns a driver nobody has heard from for the offline window into OFFLINE', () => {
    expect(statusOf(row({ recordedAt: minutesBefore(31), lastHeartbeatAt: minutesBefore(31) }))).toBe(LocationStatus.OFFLINE);
  });

  it('does not call a driver offline while their phone is still checking in, however old the last fix', () => {
    expect(statusOf(row({ recordedAt: minutesBefore(120), lastHeartbeatAt: minutesBefore(3) }))).toBe(LocationStatus.STALE);
  });

  it('uses the thresholds it is given, not its own', () => {
    const strict = { staleAfterMs: 2 * 60_000, offlineAfterMs: 4 * 60_000 };
    const quiet = row({ recordedAt: minutesBefore(3), lastHeartbeatAt: minutesBefore(3) });
    expect(statusOf(quiet, strict)).toBe(LocationStatus.STALE);
    expect(statusOf(quiet, STALENESS)).toBe(LocationStatus.ACTIVE);
  });

  it('keeps an explicit denial or a disabled device above how recent the contact was', () => {
    expect(statusOf(row({ permission: LocationPermission.DENIED }))).toBe(LocationStatus.PERMISSION_DENIED);
    expect(statusOf(row({ locationServicesEnabled: false }))).toBe(LocationStatus.LOCATION_DISABLED);
  });

  it('honours what the device says about its own tracking, as at ingestion', () => {
    expect(statusOf(row({ trackingState: DriverTrackingState.TRACKING_PAUSED }))).toBe(LocationStatus.OFFLINE);
    expect(statusOf(row({ trackingState: DriverTrackingState.LAST_LOCATION_STALE }))).toBe(LocationStatus.STALE);
  });

  it('calls a driver with a position never recorded OFFLINE rather than stale', () => {
    expect(statusOf(row({ recordedAt: null, latitude: null, longitude: null, lastHeartbeatAt: minutesBefore(1) }))).toBe(LocationStatus.OFFLINE);
  });

  it('leaves every other field as the row has it', () => {
    const view = presentFleetLocation(row(), NOW, STALENESS);
    expect(view).toMatchObject({
      driverId: 'driver-1',
      position: { latitude: 15.85, longitude: 74.498 },
      capturedAt: minutesBefore(1).toISOString(),
      lastSeenAt: minutesBefore(1).toISOString(),
      stale: false,
    });
  });
});
