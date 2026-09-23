import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

/**
 * Notification foundation.
 *
 * Phase 2 provides permission handling, a stored preference and a place for device-token
 * registration. Business notifications (payments, document expiry) are later phases, and the
 * backend has no token endpoint yet — so the token is obtained and cached, not uploaded.
 */

const PREFERENCE_KEY = 'gangamata.notifications.enabled';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export async function readPermission(): Promise<NotificationPermission> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  return canAskAgain && status === 'undetermined' ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<NotificationPermission> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted' ? 'granted' : 'denied';
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
  if (enabled && (await readPermission()) === 'undetermined') {
    await requestPermission();
  }
}

/**
 * Placeholder for push registration. Returns the device token when permission allows, so the
 * phase that adds the backend endpoint only has to send it.
 */
export async function getDeviceToken(): Promise<string | null> {
  if ((await readPermission()) !== 'granted') return null;
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' ? token.data : null;
  } catch {
    return null;
  }
}
