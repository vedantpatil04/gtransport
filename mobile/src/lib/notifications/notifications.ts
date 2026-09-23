import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Notification foundation.
 *
 * Phase 2 provides permission handling, a stored preference and a place for device-token
 * registration. Business notifications (payments, document expiry) are later phases, and the
 * backend has no token endpoint yet — so the token is obtained and cached, not uploaded.
 *
 * In Expo SDK 53+, remote push notifications were removed from Expo Go on Android. Merely importing
 * expo-notifications at top level in Expo Go executes a side-effect auto-registration listener that
 * throws an unhandled crash. We lazily load expo-notifications only in development and production builds,
 * gracefully returning an unsupported state in Expo Go.
 */

const PREFERENCE_KEY = 'gangamata.notifications.enabled';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

type NotificationsModule = typeof import('expo-notifications');

let cachedNotifications: NotificationsModule | null = null;

/**
 * Returns true if currently running within the Expo Go client app.
 */
export function isExpoGo(): boolean {
  try {
    if (typeof isRunningInExpoGo === 'function' && isRunningInExpoGo()) {
      return true;
    }
    const executionEnvironment = Constants.executionEnvironment as string | undefined;
    const isStoreClient =
      executionEnvironment === 'storeClient' ||
      (typeof ExecutionEnvironment !== 'undefined' &&
        executionEnvironment === ExecutionEnvironment.StoreClient);
    const isExpoApp = (Constants as unknown as { appOwnership?: string }).appOwnership === 'expo';
    return Boolean(isStoreClient || isExpoApp);
  } catch {
    return false;
  }
}

/**
 * Remote push notification support is unavailable in Expo Go (SDK 53+ on Android).
 */
export function isPushSupported(): boolean {
  return !isExpoGo();
}

function getNotifications(): NotificationsModule | null {
  if (isExpoGo()) {
    return null;
  }
  if (!cachedNotifications) {
    try {
      // Dynamic require ensures expo-notifications is never evaluated when running inside Expo Go,
      // avoiding the SDK 53+ crash where top-level push listener registration throws on Android Expo Go.
      cachedNotifications = require('expo-notifications') as NotificationsModule;
    } catch {
      return null;
    }
  }
  return cachedNotifications;
}

export async function readPermission(): Promise<NotificationPermission> {
  if (isExpoGo()) {
    return 'unsupported';
  }
  try {
    const notifications = getNotifications();
    if (!notifications) return 'unsupported';
    const { status, canAskAgain } = await notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    return canAskAgain && status === 'undetermined' ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (isExpoGo()) {
    return 'unsupported';
  }
  try {
    const notifications = getNotifications();
    if (!notifications) return 'unsupported';
    const { status } = await notifications.requestPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function isEnabled(): Promise<boolean> {
  try {
    const saved = await AsyncStorage.getItem(PREFERENCE_KEY);
    // Alerts are useful by default; the driver can turn them off in Profile.
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

export async function setEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFERENCE_KEY, String(enabled));
  } catch {
    /* preference is best-effort */
  }
  if (isExpoGo()) {
    return;
  }
  if (enabled && (await readPermission()) === 'undetermined') {
    await requestPermission();
  }
}

/**
 * Placeholder for push registration. Returns the device token when permission allows, so the
 * phase that adds the backend endpoint only has to send it.
 *
 * In Expo Go, returns null to indicate push registration is unsupported without faking registration.
 */
export async function getDeviceToken(): Promise<string | null> {
  if (isExpoGo()) return null;
  if ((await readPermission()) !== 'granted') return null;
  try {
    const notifications = getNotifications();
    if (!notifications) return null;
    const token = await notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' ? token.data : null;
  } catch {
    return null;
  }
}
