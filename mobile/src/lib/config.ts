import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type AppEnvironment = 'development' | 'staging' | 'production';

interface Extra {
  apiUrl?: string;
  appEnv?: AppEnvironment;
  mapStyleUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

function resolveDefaultApiUrl(): string {
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ) {
    return 'http://localhost:3000';
  }
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (extra.apiUrl) {
    return extra.apiUrl;
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000';
  }
  return 'http://localhost:3000';
}

export const API_URL: string = resolveDefaultApiUrl().replace(/\/+$/, '');

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
