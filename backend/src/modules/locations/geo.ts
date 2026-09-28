/**
 * Geographic primitives for location handling. Pure functions with no dependencies, so the
 * ingestion path and the alert engine agree on what "150 metres away" means.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METRES = 6_371_008.8;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than a flat-earth approximation: at the distances that matter here the
 * difference is small, but the formula is stable everywhere — including across the 180th
 * meridian and at the poles, where subtracting longitudes gives nonsense.
 */
export function distanceMetres(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rejects the coordinates a GPS chip produces when it has no fix, and anything off-planet. */
export function isValidCoordinate(value: Coordinates): boolean {
  const { latitude, longitude } = value;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  // Exactly (0, 0) is in the Gulf of Guinea. No Gangamata vehicle is there, and it is the
  // classic "no fix" value, so it is refused rather than plotted on the map.
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/** Decimal(9,6) in the database: six decimal places, about 0.1 m — beyond any GPS accuracy. */
export const COORDINATE_DECIMALS = 6;

export function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}
