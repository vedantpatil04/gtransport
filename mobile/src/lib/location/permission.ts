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
}

const stageFrom = (response: Location.LocationPermissionResponse | Location.PermissionResponse): PermissionStage => {
  if (response.status === Location.PermissionStatus.GRANTED) return 'GRANTED';
  if (response.status === Location.PermissionStatus.UNDETERMINED) return 'UNKNOWN';
  // iOS reports parental/MDM limits through canAskAgain being false with no prior prompt.
  return response.canAskAgain ? 'DENIED' : 'RESTRICTED';
};

/** Reads the current state without prompting. */
export async function readPermission(): Promise<LocationPermissionSnapshot> {
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => false);
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync().catch(() => null);

  const foregroundStage = stageFrom(foreground);
  const backgroundStage = background ? stageFrom(background) : 'UNKNOWN';

  return {
    stage: !servicesEnabled ? 'LOCATION_SERVICES_OFF' : foregroundStage,
    foreground: foregroundStage,
    background: backgroundStage,
    servicesEnabled,
    canAskAgain: foreground.canAskAgain,
  };
}

/**
 * Asks for foreground permission, then background if foreground was granted. Android requires
 * that order, and asking for background first simply fails.
 */
export async function requestPermission(options: { includeBackground?: boolean } = {}): Promise<LocationPermissionSnapshot> {
  const foreground = await Location.requestForegroundPermissionsAsync();

  if (stageFrom(foreground) === 'GRANTED' && options.includeBackground) {
    await Location.requestBackgroundPermissionsAsync().catch(() => null);
  }

  return readPermission();
}

/** Opens the OS settings screen, for when the prompt will no longer appear. */
export async function openLocationSettings(): Promise<void> {
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
 * What the driver is told. Phase 2 never reports ACTIVE, because nothing is being tracked yet:
 * the app has permission at best, so it reports OFFLINE rather than pretending.
 */
export function toDisplayStatus(snapshot: LocationPermissionSnapshot): LocationStatus {
  if (!snapshot.servicesEnabled) return 'LOCATION_DISABLED';
  if (snapshot.foreground !== 'GRANTED') return 'PERMISSION_DENIED';
  return 'OFFLINE';
}
