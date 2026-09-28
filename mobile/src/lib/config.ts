import Constants from 'expo-constants';

export type AppEnvironment = 'development' | 'staging' | 'production';

interface Extra {
  apiUrl?: string;
  appEnv?: AppEnvironment;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

function resolveDefaultApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (extra.apiUrl) {
    return extra.apiUrl;
  }
  return '';
}

export const API_URL: string = resolveDefaultApiUrl().replace(/\/+$/, '');

export const APP_ENV: AppEnvironment = extra.appEnv ?? 'development';

export const isProduction = APP_ENV === 'production';

/** Requests give up at this point so a dead network cannot hang the UI forever. */
export const REQUEST_TIMEOUT_MS = 15_000;
