import { MAP_BOUNDS, project, type CityId } from '@/data/geo';

/**
 * The map provider boundary.
 *
 * Gangamata already has a map: a vector map of the operating region (Maharashtra–Karnataka–Goa),
 * drawn from real coordinates, with the national highways the fleet runs on labelled. Phase 6
 * reuses it rather than introducing a second one, which is why there is no tile provider and no
 * API key to configure or leak. The built-in map also has two properties a hosted provider does
 * not: it renders with no third-party request, and it cannot start billing or rate-limiting the
 * office mid-shift.
 *
 * What this module is for is keeping that a *choice*. Everything above this line speaks latitude
 * and longitude; only the map component knows about SVG coordinates and projection. Introducing a
 * raster or hosted provider later means implementing this contract once, not editing every screen
 * that shows a marker.
 */

/** A thing to show on the map. Positions are real coordinates — never screen or SVG units. */
export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  /** Compass degrees, or null when the platform did not report a direction. */
  headingDeg: number | null;
  /** Drives the colour, and whether a direction arrow is drawn. */
  tone: MarkerTone;
  /** Short text beside the marker — a registration plate, in practice. */
  label?: string | null;
  /** Emphasised with a pulsing ring: an active alert the office needs to notice. */
  flagged?: boolean;
}

/**
 * Marker colours, named for what they mean rather than what they look like.
 *
 * These deliberately match the prototype's existing motion vocabulary so the legend, the status
 * dots and the map keep telling the same story, and the approved design is not disturbed.
 */
export type MarkerTone = 'moving' | 'stopped' | 'offline' | 'none';

export interface MapProvider {
  readonly name: string;
  /** Turns real coordinates into the map's own coordinate space. */
  project(latitude: number, longitude: number): { x: number; y: number };
  /** The extent of the map's coordinate space, for clamping zoom. */
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Roughly how many kilometres one unit of that space covers, for scale decisions. */
  readonly kmPerUnit: number;
}

/** The in-house vector map: no network request, no key, no external dependency. */
export const vectorProvider: MapProvider = {
  name: 'vector',
  project: (latitude, longitude) => project(latitude, longitude),
  bounds: MAP_BOUNDS,
  kmPerUnit: 1.11,
};

/** The production Mapbox provider for embedded fleet view. */
export const mapboxProvider: MapProvider = {
  name: 'mapbox',
  project: (latitude, longitude) => project(latitude, longitude),
  bounds: MAP_BOUNDS,
  kmPerUnit: 1.11,
};

/**
 * Which provider is in use.
 *
 * Uses Mapbox by default as the embedded fleet map provider.
 * If VITE_MAP_PROVIDER="vector" is explicitly set, uses the offline vector map.
 */
export function resolveMapProvider(): MapProvider {
  const configured = (import.meta.env.VITE_MAP_PROVIDER as string | undefined)?.trim().toLowerCase();
  if (configured === 'vector') return vectorProvider;
  return mapboxProvider;
}

/** A city id, for the nearest-place label. Re-exported so screens need not import from data/geo. */
export type { CityId };
