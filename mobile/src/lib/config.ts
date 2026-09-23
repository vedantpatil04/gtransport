import Constants from 'expo-constants';

export type AppEnvironment = 'development' | 'staging' | 'production';

interface Extra {
  apiUrl?: string;
  appEnv?: AppEnvironment;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/**
 * Base URL of the Gangamata API. Supplied per environment through EXPO_PUBLIC_API_URL, so no
 * host is hardcoded into a production build. The development default is the Android emulator's
 * alias for the host machine's localhost.
 */
export const API_URL: string = (extra.apiUrl ?? 'http://10.0.2.2:3000').replace(/\/+$/, '');

export const APP_ENV: AppEnvironment = extra.appEnv ?? 'development';

export const isProduction = APP_ENV === 'production';

/** Requests give up at this point so a dead network cannot hang the UI forever. */
export const REQUEST_TIMEOUT_MS = 15_000;
