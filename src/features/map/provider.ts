/**
 * The map boundary.
 *
 * Everything above this line speaks latitude and longitude plus a tone. Only the map component
 * knows how those become pixels. The renderer is MapLibre GL JS; what it draws is decided by a
 * *style* — a JSON document naming the tile source, the fonts and the look. The style is
 * configuration (VITE_MAP_STYLE_URL), not code: pointing a deployment at a self-hosted
 * OSM-derived tile server, or any other MapLibre-compatible provider, is an environment change
 * with no edit to the Fleet screens.
 *
 * There is deliberately no built-in fallback map. If the style is missing or will not load the
 * map says so (see FleetMap). A drawing of the region that looks live would be worse than an
 * honest error, because the list beside the map is what the office actually relies on.
 */

/** A thing to show on the map. Positions are real coordinates — never screen units. */
export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  /** Compass degrees (0 = north, clockwise), or null when the platform did not report a direction. */
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

/**
 * Whether a marker has a position worth drawing.
 *
 * 'none' is how the screens say "no fix yet": they still pass a marker so the driver stays in the
 * list, with placeholder zeroes for the coordinates. Anything else that is not a real, in-range
 * coordinate is treated the same way, so one bad row costs one pin rather than the whole map.
 * (0, 0) is excluded because it is where a device with no fix tends to report itself — open water
 * in the Gulf of Guinea, never a place on the Gangamata network.
 */
export function isPlottable(marker: MapMarker): boolean {
  const { latitude, longitude } = marker;
  return (
    marker.tone !== 'none' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

/** What a map implementation tells its host. A failure carries a reason for logs, never for the UI. */
export type MapStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; reason: 'init' | 'style' | 'timeout' };

export type MapStyleConfig =
  | { status: 'ready'; styleUrl: string }
  | { status: 'unavailable'; reason: 'missing' | 'invalid' };

/**
 * Reads the map style from VITE_MAP_STYLE_URL.
 *
 * Accepted: an absolute http(s) URL, or a root-relative path for a style served from the app's own
 * host (a reverse proxy, say). Rejected as invalid: anything else — a `mapbox://` style, which
 * MapLibre cannot read, or a scheme that has no business loading a map.
 *
 * The value is public by nature: VITE_* variables are embedded in the bundle. If a tile provider
 * needs a key, it must be that provider's browser-safe, domain-restricted kind, and a private
 * server key never belongs here.
 */
export function resolveMapStyle(raw: string | undefined = import.meta.env.VITE_MAP_STYLE_URL as string | undefined): MapStyleConfig {
  const value = raw?.trim();
  if (!value) return { status: 'unavailable', reason: 'missing' };

  let url: URL;
  try {
    const rootRelative = value.startsWith('/') && !value.startsWith('//');
    url = new URL(value, rootRelative ? window.location.origin : undefined);
  } catch {
    return { status: 'unavailable', reason: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { status: 'unavailable', reason: 'invalid' };
  return { status: 'ready', styleUrl: url.toString() };
}

/**
 * A URL as it is safe to log: origin and path only. A provider's key may ride in the query string,
 * and a key belongs in neither the console nor the UI.
 */
export function loggableUrl(url: string): string {
  try {
    const { origin, pathname } = new URL(url, window.location.origin);
    return `${origin}${pathname}`;
  } catch {
    return '[unparseable url]';
  }
}

/**
 * Free text (an error message) as it is safe to log: any query string in it is cut off. MapLibre
 * redacts a few well-known key names in its own messages, but not whatever a provider calls theirs.
 */
export function scrubQueryStrings(text: string | undefined): string | undefined {
  return text?.replace(/\?\S*/g, '?…');
}
