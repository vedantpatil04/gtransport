import { readFileSync } from 'fs';
import { join } from 'path';
import type { OfficeFleetLocation } from '../../../lib/api/office';
import { cameraTarget, countByFilter, fleetStatus, googleMapsUrl, hoursAndMinutes, matchesFilter, validPosition } from '../model';

function row(overrides: Partial<OfficeFleetLocation> = {}): OfficeFleetLocation {
  return {
    driverId: 'd1',
    driverCode: 'DRV-1',
    employee: { fullName: 'Driver One', employeeCode: 'E1', phone: null },
    vehicle: null,
    status: 'ACTIVE',
    trackingState: 'TRACKING_ACTIVE',
    position: { latitude: 16.5, longitude: 74.5, accuracyMeters: 5, speedKmh: 40, headingDeg: null },
    capturedAt: '2026-10-01T12:00:00.000Z',
    lastSeenAt: '2026-10-01T12:00:00.000Z',
    stale: false,
    alert: null,
    ...overrides,
  };
}

const at = (latitude: number, longitude: number) => ({ latitude, longitude, accuracyMeters: null, speedKmh: null, headingDeg: null });
const alert = { id: 'a1', type: 'STATIONARY_OVERDUE', status: 'ACTIVE', triggeredAt: '', stationarySince: '', durationMinutes: 250 };

describe('validPosition', () => {
  it('returns the coordinate exactly as reported', () => {
    expect(validPosition(row({ position: at(15.849951, 74.497612) }))).toEqual({ latitude: 15.849951, longitude: 74.497612 });
  });

  it('has nothing for a missing, out-of-range, non-finite or (0, 0) position', () => {
    expect(validPosition(row({ position: null }))).toBeNull();
    expect(validPosition(row({ position: at(91, 74) }))).toBeNull();
    expect(validPosition(row({ position: at(16, -181) }))).toBeNull();
    expect(validPosition(row({ position: at(Number.NaN, 74) }))).toBeNull();
    expect(validPosition(row({ position: at(16, Number.POSITIVE_INFINITY) }))).toBeNull();
    expect(validPosition(row({ position: at(0, 0) }))).toBeNull();
  });
});

describe('fleetStatus', () => {
  it('puts an active alert above everything else', () => {
    expect(fleetStatus(row({ status: 'STALE', stale: true, alert })).key).toBe('alerting');
  });

  it('follows the server status for offline, permission and disabled-location drivers', () => {
    expect(fleetStatus(row({ status: 'OFFLINE' })).label).toBe('Offline');
    expect(fleetStatus(row({ status: 'PERMISSION_DENIED' })).label).toBe('Permission denied');
    expect(fleetStatus(row({ status: 'LOCATION_DISABLED' })).label).toBe('Location off');
  });

  it('never calls a stale fix moving, whatever its old speed', () => {
    expect(fleetStatus(row({ status: 'STALE', stale: true })).key).toBe('stale');
    expect(fleetStatus(row({ status: 'ACTIVE', stale: true })).key).toBe('stale');
  });

  it('splits a reporting driver into moving and stopped on the reported speed', () => {
    expect(fleetStatus(row()).key).toBe('moving');
    expect(fleetStatus(row({ position: { ...at(16, 74), speedKmh: 2 } })).key).toBe('stopped');
    expect(fleetStatus(row({ position: { ...at(16, 74), speedKmh: null } })).key).toBe('stopped');
  });
});

describe('filters and counts', () => {
  const rows = [
    row({ driverId: 'a' }),
    row({ driverId: 'b', status: 'STALE', stale: true, alert }),
    row({ driverId: 'c', status: 'OFFLINE', stale: true }),
    row({ driverId: 'd', status: 'PERMISSION_DENIED' }),
  ];

  it('counts with the same predicate the list filters on', () => {
    const counts = countByFilter(rows);
    expect(counts).toEqual({ all: 4, active: 1, stale: 1, offline: 1, alerting: 1 });
    for (const filter of ['all', 'active', 'stale', 'offline', 'alerting'] as const) {
      expect(rows.filter((r) => matchesFilter(r, filter))).toHaveLength(counts[filter]);
    }
  });

  it('keeps an offline driver whose last fix is old out of Stale, as the server summary does', () => {
    expect(matchesFilter(rows[2], 'stale')).toBe(false);
  });

  it('counts nothing for an empty fleet', () => {
    expect(countByFilter([])).toEqual({ all: 0, active: 0, stale: 0, offline: 0, alerting: 0 });
  });
});

describe('cameraTarget', () => {
  it('has no target without positions — the camera is not pointed anywhere invented', () => {
    expect(cameraTarget([])).toBeNull();
  });

  it('centres on a single position', () => {
    expect(cameraTarget([{ latitude: 15.85, longitude: 74.5 }])).toEqual({ kind: 'center', center: [74.5, 15.85] });
  });

  it('bounds several positions west, south, east, north', () => {
    expect(
      cameraTarget([
        { latitude: 18.52, longitude: 73.85 },
        { latitude: 12.97, longitude: 77.59 },
      ]),
    ).toEqual({ kind: 'bounds', bounds: [73.85, 12.97, 77.59, 18.52] });
  });

  it('keeps vehicles parked together from zooming the map to street level', () => {
    const target = cameraTarget([
      { latitude: 16.7, longitude: 74.24 },
      { latitude: 16.7001, longitude: 74.2401 },
    ]);
    expect(target?.kind).toBe('bounds');
    if (target?.kind !== 'bounds') return;
    const [west, south, east, north] = target.bounds;
    expect(east - west).toBeCloseTo(0.05);
    expect(north - south).toBeCloseTo(0.05);
    expect(west).toBeLessThan(74.24);
    expect(east).toBeGreaterThan(74.2401);
  });
});

describe('formatting', () => {
  it('links Google Maps to the exact coordinate', () => {
    expect(googleMapsUrl({ latitude: 15.849951, longitude: 74.497612 })).toBe('https://www.google.com/maps/search/?api=1&query=15.849951,74.497612');
  });

  it('writes durations as hours and minutes', () => {
    expect(hoursAndMinutes(305)).toBe('5h 5m');
    expect(hoursAndMinutes(0)).toBe('0h 0m');
  });
});

describe('no invented geography', () => {
  const sources = ['../model.ts', '../FleetMap.tsx', '../map-style.ts', '../../../app/office/fleet.tsx'].map((file) =>
    readFileSync(join(__dirname, file), 'utf8'),
  );

  it('contains no hardcoded place names, corridor list or projection', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/Pune|Satara|Kolhapur|Belagavi|Hubballi|Bengaluru|CORRIDOR|projectPoint/);
    }
  });

  it('contains no hardcoded latitude/longitude pairs', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/-?\d{1,3}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}/);
    }
  });
});
