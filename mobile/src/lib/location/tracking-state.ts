import type { DriverTrackingState } from '../../types/domain';
import type { LocationPermissionSnapshot } from './permission';

/**
 * What this device should honestly say about its own tracking.
 *
 * The one rule that matters: the app never claims to be tracking because it asked for permission.
 * It claims to be tracking when the OS granted permission, the device toggle is on, and the
 * background task is actually registered. Everything else is reported as the specific thing that
 * is wrong, so the office sees "background permission missing" rather than a driver who merely
 * looks offline for no stated reason.
 *
 * Pure, so every combination is tested without a device.
 */

export interface TrackingSignals {
  permission: LocationPermissionSnapshot;
  /** Whether the background location task is registered with the OS right now. */
  taskRegistered: boolean;
  /** True when the driver, or the app, has deliberately stopped tracking (off duty, no vehicle). */
  paused: boolean;
  /** Fixes waiting in the on-device buffer. */
  pendingUploads: number;
  /** Device capture time of the newest fix this device holds, uploaded or not. */
  lastFixAt: string | null;
  /** Freshness window from the server's policy. */
  staleAfterMinutes: number;
}

export function deriveTrackingState(signals: TrackingSignals, now: number = Date.now()): DriverTrackingState {
  const { permission } = signals;

  // The OS's refusals come first and in order of how the driver would fix them: turn the device
  // toggle on, then grant the app permission, then grant it in the background.
  if (!permission.servicesEnabled) return 'LOCATION_SERVICES_DISABLED';
  if (permission.foreground === 'DENIED' || permission.foreground === 'RESTRICTED') return 'LOCATION_PERMISSION_DENIED';
  if (permission.foreground === 'UNKNOWN') return 'TRACKING_UNAVAILABLE';

  // A deliberate stop is not a fault, and must not be reported as one.
  if (signals.paused) return 'TRACKING_PAUSED';

  // Foreground-only permission cannot sustain background tracking. Reported even while the task
  // is running, because fixes will stop the moment the driver leaves the screen.
  if (permission.background !== 'GRANTED') return 'BACKGROUND_PERMISSION_MISSING';

  // Permission is in place but the OS has not accepted the task: something the app cannot fix.
  if (!signals.taskRegistered) return 'TRACKING_UNAVAILABLE';

  // Tracking works. What remains is whether its output is getting through.
  if (signals.pendingUploads > 0) return 'SYNC_PENDING';

  if (isFixStale(signals.lastFixAt, signals.staleAfterMinutes, now)) return 'LAST_LOCATION_STALE';

  return 'TRACKING_ACTIVE';
}

/** A device with no fix yet is not "stale" — it is newly started, and TRACKING_ACTIVE says so. */
export function isFixStale(lastFixAt: string | null, staleAfterMinutes: number, now: number = Date.now()): boolean {
  if (!lastFixAt) return false;
  const captured = Date.parse(lastFixAt);
  if (Number.isNaN(captured)) return false;
  return now - captured > staleAfterMinutes * 60_000;
}

/** The four things the driver's screen distinguishes. Any detail beyond this is office business. */
export type DriverFacingState = 'active' | 'needsPermission' | 'servicesOff' | 'syncPending' | 'paused' | 'unavailable';

/**
 * Collapses the tracking state into what the driver is shown.
 *
 * A driver is not an administrator: they need to know whether tracking is working and, if not,
 * which single action fixes it. The full state still reaches the office.
 */
export function toDriverFacingState(state: DriverTrackingState): DriverFacingState {
  switch (state) {
    case 'TRACKING_ACTIVE':
      return 'active';
    case 'LOCATION_SERVICES_DISABLED':
      return 'servicesOff';
    case 'LOCATION_PERMISSION_DENIED':
    case 'BACKGROUND_PERMISSION_MISSING':
      return 'needsPermission';
    case 'SYNC_PENDING':
      return 'syncPending';
    case 'TRACKING_PAUSED':
      return 'paused';
    case 'TRACKING_UNAVAILABLE':
    case 'LAST_LOCATION_STALE':
    default:
      return 'unavailable';
  }
}

/** Whether tracking is genuinely delivering positions, for the indicator's colour. */
export function isTrackingHealthy(state: DriverTrackingState): boolean {
  return state === 'TRACKING_ACTIVE' || state === 'SYNC_PENDING';
}
