import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';
import type { LocationPermissionState, LocationStatus } from '../../types/domain';

/**
 * Location permission state.
 *
 * Business policy requires tracking, but the operating system decides whether it is actually
 * possible. This module reports what the OS really says — the app never displays tracking as
 * active when permission is missing.
 */

export type PermissionStage = 'UNKNOWN' | 'REQUESTED' | 'GRANTED' | 'DENIED' | 'RESTRICTED' | 'LOCATION_SERVICES_OFF';

export interface LocationPermissionSnapshot {
  stage: PermissionStage;
  foreground: PermissionStage;
  background: PermissionStage;
  /** Device-level location services toggle. */
  servicesEnabled: boolean;
  /** False when Android/iOS will no longer show a prompt: the driver must use Settings. */
  canAskAgain: boolean;
  /** Same, for the separate background-location prompt Android shows after foreground is granted. */
  canAskBackgroundAgain: boolean;
}

const stageFrom = (response: Location.LocationPermissionResponse | Location.PermissionResponse): PermissionStage => {
  if (response.status === Location.PermissionStatus.GRANTED) return 'GRANTED';
  if (response.status === Location.PermissionStatus.UNDETERMINED) return 'UNKNOWN';
  // iOS reports parental/MDM limits through canAskAgain being false with no prior prompt.
  return response.canAskAgain ? 'DENIED' : 'RESTRICTED';
};

/** Reads the current state without prompting. */
export async function readPermission(): Promise<LocationPermissionSnapshot> {
  const isWeb = Platform.OS === 'web';
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
  const foreground = await Location.getForegroundPermissionsAsync().catch(() => ({
    status: Location.PermissionStatus.UNDETERMINED,
    canAskAgain: true,
  } as Location.PermissionResponse));
  const background = isWeb ? null : await Location.getBackgroundPermissionsAsync().catch(() => null);

  const foregroundStage = stageFrom(foreground);
  const backgroundStage = isWeb ? foregroundStage : (background ? stageFrom(background) : 'UNKNOWN');

  return {
    stage: !servicesEnabled ? 'LOCATION_SERVICES_OFF' : foregroundStage,
    foreground: foregroundStage,
    background: backgroundStage,
    servicesEnabled,
    canAskAgain: foreground.canAskAgain,
    canAskBackgroundAgain: isWeb ? false : (background?.canAskAgain ?? true),
  };
}

/**
 * Asks for foreground permission, then background if foreground was granted.
 *
 * The order is not a preference: Android refuses a background request outright unless foreground
 * permission is already held, so asking for background first simply fails. Background is requested
 * by default because continuous tracking is what the product needs — a driver who grants only
 * foreground is reported as such rather than being asked again on every screen.
 */
export async function requestPermission(options: { includeBackground?: boolean } = {}): Promise<LocationPermissionSnapshot> {
  const isWeb = Platform.OS === 'web';
  const includeBackground = options.includeBackground ?? true;
  const foreground = await Location.requestForegroundPermissionsAsync();

  if (stageFrom(foreground) === 'GRANTED' && includeBackground && !isWeb) {
    await Location.requestBackgroundPermissionsAsync().catch(() => null);
  }

  return readPermission();
}

/** Opens the OS settings screen, for when the prompt will no longer appear. */
export async function openLocationSettings(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'ios') {
    await Linking.openURL('app-settings:');
    return;
  }
  await Linking.openSettings();
}

/** Maps the device snapshot onto the permission vocabulary the backend stores. */
export function toApiPermission(snapshot: LocationPermissionSnapshot): LocationPermissionState {
  if (snapshot.foreground !== 'GRANTED') return snapshot.foreground === 'UNKNOWN' ? 'UNKNOWN' : 'DENIED';
  return snapshot.background === 'GRANTED' ? 'GRANTED_ALWAYS' : 'GRANTED_FOREGROUND';
}

/**
 * The status these permissions alone imply, with no knowledge of whether fixes are arriving.
 *
 * Deliberately conservative: permission is not tracking, so the best this can report is OFFLINE.
 * The authoritative status comes from the server, which knows when the last fix actually landed;
 * see deriveTrackingState in ./tracking-state.ts for what the device reports about itself.
 */
export function toDisplayStatus(snapshot: LocationPermissionSnapshot): LocationStatus {
  if (!snapshot.servicesEnabled) return 'LOCATION_DISABLED';
  if (snapshot.foreground !== 'GRANTED') return 'PERMISSION_DENIED';
  return 'OFFLINE';
}

/** True when only the OS settings screen can change the answer — the prompt will not reappear. */
export function needsSettings(snapshot: LocationPermissionSnapshot): boolean {
  if (Platform.OS === 'web') return false;
  if (!snapshot.servicesEnabled) return true;
  if (snapshot.foreground === 'RESTRICTED') return true;
  if (snapshot.foreground !== 'GRANTED') return !snapshot.canAskAgain;
  // Android asks for background permission from its settings screen, not from an in-app prompt,
  // once the one-time "Allow all the time" opportunity has passed.
  return snapshot.background !== 'GRANTED' && !snapshot.canAskBackgroundAgain;
}

/** Whether background tracking is fully permitted, which is what continuous tracking needs. */
export function isBackgroundReady(snapshot: LocationPermissionSnapshot): boolean {
  return snapshot.servicesEnabled && snapshot.foreground === 'GRANTED' && snapshot.background === 'GRANTED';
}
