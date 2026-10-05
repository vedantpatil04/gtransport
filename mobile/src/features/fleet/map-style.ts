import { mapStyleUrlSetting } from '../../lib/config';

/**
 * Which map the office Fleet screen draws.
 *
 * The renderer is native MapLibre; what it draws is a MapLibre *style* — a JSON document naming
 * the tile source, fonts and look. The style is configuration (EXPO_PUBLIC_MAP_STYLE_URL), never
 * code, so a production build can point at a self-hosted OSM-derived tile server or a contracted
 * provider without touching the Fleet screen. Same contract as the web console's
 * VITE_MAP_STYLE_URL.
 *
 * There is deliberately no built-in fallback. A missing or unusable style is reported as such, and
 * the driver list, details and Open in Google Maps keep working beside it.
 */
export type MapStyleConfig =
  | { status: 'ready'; styleUrl: string }
  | { status: 'unavailable'; reason: 'missing' | 'invalid' };

/**
 * Accepts an absolute http(s) URL and nothing else. A `mapbox://` style (which MapLibre cannot
 * read without Mapbox's SDK and billing) or any other scheme is rejected as invalid.
 *
 * The value is public by nature — EXPO_PUBLIC_* is embedded in the bundle — so if a tile provider
 * needs a key it must be that provider's client-safe, restricted kind.
 */
export function resolveMapStyle(raw: string | undefined = mapStyleUrlSetting()): MapStyleConfig {
  const value = raw?.trim();
  if (!value) return { status: 'unavailable', reason: 'missing' };
  if (!/^https?:\/\/[^/\s]+/i.test(value) || /\s/.test(value)) return { status: 'unavailable', reason: 'invalid' };
  return { status: 'ready', styleUrl: value };
}

/** A URL as it is safe to log: scheme, host and path. A provider key may ride in the query string. */
export function loggableUrl(url: string): string {
  return url.replace(/[?#].*$/, '');
}
