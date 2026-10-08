import Constants from 'expo-constants';

export type AppEnvironment = 'development' | 'staging' | 'production';

interface Extra {
  apiUrl?: string;
  adminWebUrl?: string;
  appEnv?: AppEnvironment;
  mapStyleUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/**
 * The production Gangamata Transport API on Render — the one backend the app and the office
 * console share. Mirrors the default in app.config.ts. Metro only serves the JavaScript bundle
 * during development; it is never the API, so there is no emulator or LAN fallback.
 */
export const PRODUCTION_API_URL = 'https://gtransport-7vgf.onrender.com';

/** EXPO_PUBLIC_API_URL when a build sets one, else the value baked in by app.config.ts, else production. */
function resolveApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || PRODUCTION_API_URL;
}

export const API_URL: string = resolveApiUrl().replace(/\/+$/, '');

/**
 * The production office console on Vercel. Office roles see exactly this site inside the app (see
 * features/console): the same console, sign-in and reports as in Chrome — never a second copy.
 */
export const PRODUCTION_ADMIN_WEB_URL = 'https://gtransportt.vercel.app';

/** An override is honoured only over HTTPS; anything else falls back to production. */
function resolveAdminWebUrl(): string {
  const configured = (process.env.EXPO_PUBLIC_ADMIN_WEB_URL || extra.adminWebUrl || '').trim();
  return (configured.startsWith('https://') ? configured : PRODUCTION_ADMIN_WEB_URL).replace(/\/+$/, '');
}

export const ADMIN_WEB_URL: string = resolveAdminWebUrl();

export const APP_ENV: AppEnvironment = extra.appEnv ?? 'development';

export const isProduction = APP_ENV === 'production';

/**
 * The raw MapLibre style URL for the office Fleet map, or undefined when the build has none.
 * Read on each call (not frozen at import) so the value the bundle was built with is the one used,
 * and validated by features/fleet/map-style before anything is drawn.
 */
export function mapStyleUrlSetting(): string | undefined {
  return process.env.EXPO_PUBLIC_MAP_STYLE_URL || extra.mapStyleUrl;
}

/** Requests give up at this point so a dead network cannot hang the UI forever. */
export const REQUEST_TIMEOUT_MS = 15_000;
