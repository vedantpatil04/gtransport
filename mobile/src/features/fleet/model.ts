import type { OfficeFleetLocation } from '../../lib/api/office';

/**
 * The office Fleet screen's rules, kept apart from anything that draws.
 *
 * Every value here is derived from a row of GET /locations/fleet as the server returned it. Nothing
 * invents a driver, a coordinate or a status: a row without a usable position is "location
 * unavailable" and gets no marker, and the status the server computed is the one shown.
 */

export type FleetFilter = 'all' | 'active' | 'stale' | 'offline' | 'alerting';

export const FLEET_FILTERS: FleetFilter[] = ['all', 'active', 'stale', 'offline', 'alerting'];

export type FleetTone = 'success' | 'warning' | 'danger';

export interface FleetStatus {
  key: 'alerting' | 'moving' | 'stopped' | 'stale' | 'offline' | 'unavailable';
  label: string;
  tone: FleetTone;
}

/** A reported speed at or below this is a vehicle standing still, not crawling. */
export const MOVING_SPEED_KMH = 3;

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * The row's position, if it is one worth drawing.
 *
 * Out-of-range or non-finite values are dropped, and so is (0, 0): it is where a device with no fix
 * tends to report itself — open water in the Gulf of Guinea, never a place on the network. One bad
 * row costs one marker, never the whole map.
 */
export function validPosition(row: OfficeFleetLocation): Coordinate | null {
  const position = row.position;
  if (!position) return null;
  const { latitude, longitude } = position;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

/**
 * What the office is told about a driver — the one status used by the marker, the list row, the
 * detail sheet and (through matchesFilter) the filter counts, so they can never disagree.
 *
 * Built only from the server's status, its freshness flag, the stationary alert and the reported
 * speed. An old fix's speed is not the vehicle's speed now, so a stale driver is never "moving".
 */
export function fleetStatus(row: OfficeFleetLocation): FleetStatus {
  if (row.alert?.status === 'ACTIVE') return { key: 'alerting', label: 'Alerting', tone: 'danger' };
  if (row.status === 'OFFLINE') return { key: 'offline', label: 'Offline', tone: 'danger' };
  if (row.status === 'PERMISSION_DENIED') return { key: 'unavailable', label: 'Permission denied', tone: 'danger' };
  if (row.status === 'LOCATION_DISABLED') return { key: 'unavailable', label: 'Location off', tone: 'danger' };
  if (row.status === 'STALE' || row.stale) return { key: 'stale', label: 'Stale', tone: 'warning' };
  return (row.position?.speedKmh ?? 0) > MOVING_SPEED_KMH
    ? { key: 'moving', label: 'Moving', tone: 'success' }
    : { key: 'stopped', label: 'Stopped', tone: 'warning' };
}

export const TONE_COLOR: Record<FleetTone, string> = {
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
};

/** Same buckets as the server's summary and the web console's filters. */
export function matchesFilter(row: OfficeFleetLocation, filter: FleetFilter): boolean {
  switch (filter) {
    case 'active':
      return row.status === 'ACTIVE';
    case 'stale':
      return row.status === 'STALE';
    case 'offline':
      return row.status === 'OFFLINE';
    case 'alerting':
      return row.alert?.status === 'ACTIVE';
    default:
      return true;
  }
}

/** Counts per filter, from the rows actually returned — the same predicate the list uses. */
export function countByFilter(rows: OfficeFleetLocation[]): Record<FleetFilter, number> {
  const counts: Record<FleetFilter, number> = { all: 0, active: 0, stale: 0, offline: 0, alerting: 0 };
  for (const row of rows) {
    for (const filter of FLEET_FILTERS) if (matchesFilter(row, filter)) counts[filter] += 1;
  }
  return counts;
}

/** [west, south, east, north] — MapLibre's bounds order. */
export type Bounds = [number, number, number, number];

/** Never frame vehicles tighter than this many degrees: two trucks in one yard is not a street view. */
const MIN_SPAN_DEG = 0.05;

/**
 * Where the camera should look to show these coordinates, or null when there are none.
 *
 * One vehicle is centred on; several are framed. With nothing to show the caller leaves the camera
 * alone rather than pointing it at a place nobody reported.
 */
export function cameraTarget(points: Coordinate[]): { kind: 'center'; center: [number, number] } | { kind: 'bounds'; bounds: Bounds } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { kind: 'center', center: [points[0].longitude, points[0].latitude] };

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { latitude, longitude } of points) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  if (east - west < MIN_SPAN_DEG) {
    const mid = (east + west) / 2;
    west = mid - MIN_SPAN_DEG / 2;
    east = mid + MIN_SPAN_DEG / 2;
  }
  if (north - south < MIN_SPAN_DEG) {
    const mid = (north + south) / 2;
    south = mid - MIN_SPAN_DEG / 2;
    north = mid + MIN_SPAN_DEG / 2;
  }
  return { kind: 'bounds', bounds: [west, south, east, north] };
}

/** Google Maps at exactly the coordinate the server reported. */
export function googleMapsUrl({ latitude, longitude }: Coordinate): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export function hoursAndMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
