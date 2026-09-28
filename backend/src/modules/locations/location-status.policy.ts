import { DriverTrackingState, LocationPermission, LocationStatus } from '@prisma/client';

export interface LocationStaleness {
  /** A fix older than this is STALE. */
  staleAfterMs: number;
  /** No heartbeat within this window means the device is OFFLINE. */
  offlineAfterMs: number;
}

export const DEFAULT_STALENESS: LocationStaleness = {
  staleAfterMs: 15 * 60 * 1000,
  offlineAfterMs: 30 * 60 * 1000,
};

export interface LocationSignals {
  permission: LocationPermission;
  /** Device-level location services toggle, as reported by the driver app. */
  locationServicesEnabled: boolean;
  lastHeartbeatAt: Date | null;
  recordedAt: Date | null;
  /**
   * What the device says it is doing, when it has said. Optional: a report that predates
   * tracking (or a caller that only has permission signals) behaves exactly as before.
   */
  trackingState?: DriverTrackingState | null;
}

/**
 * Derives the reported location status. Pure and total, so the ingestion path and the admin
 * read path can never disagree about what a driver's dot means.
 *
 * Order matters, and it is the order of certainty:
 *
 *  1. An explicit denial or a disabled device toggle outranks everything: "we are not allowed
 *     to know" is a different fact from "we have not heard recently", and the office needs to
 *     see the difference — one is fixed by talking to the driver, the other by waiting.
 *  2. A device that says it is paused or cannot track is not live, however recently it spoke.
 *     Otherwise a paused app that keeps checking in would show as a tracked vehicle.
 *  3. Then recency: no contact at all within the offline window, then a fix older than the
 *     stale window, and only what survives all of that is ACTIVE.
 *
 * A single missed fix therefore never marks a driver offline: that takes silence for the whole
 * offline window, which is deliberately longer than the stale window.
 */
export function deriveLocationStatus(signals: LocationSignals, now: Date, staleness: LocationStaleness = DEFAULT_STALENESS): LocationStatus {
  if (signals.permission === LocationPermission.DENIED) return LocationStatus.PERMISSION_DENIED;
  if (!signals.locationServicesEnabled) return LocationStatus.LOCATION_DISABLED;

  switch (signals.trackingState) {
    case DriverTrackingState.LOCATION_PERMISSION_DENIED:
      return LocationStatus.PERMISSION_DENIED;
    case DriverTrackingState.LOCATION_SERVICES_DISABLED:
      return LocationStatus.LOCATION_DISABLED;
    case DriverTrackingState.TRACKING_PAUSED:
    case DriverTrackingState.TRACKING_UNAVAILABLE:
      return LocationStatus.OFFLINE;
    case DriverTrackingState.LAST_LOCATION_STALE:
      return LocationStatus.STALE;
    default:
      break;
  }

  const age = (value: Date | null): number => (value ? now.getTime() - value.getTime() : Number.POSITIVE_INFINITY);

  if (age(signals.lastHeartbeatAt) > staleness.offlineAfterMs) return LocationStatus.OFFLINE;
  // Never a single fix: OFFLINE, not STALE. "Stale" promises the office a position that has gone
  // out of date, and showing that for a driver whose whereabouts have never been known would be
  // a worse lie than admitting there is nothing — a phone that checks in but cannot report a
  // position is not a tracked vehicle.
  if (!signals.recordedAt) return LocationStatus.OFFLINE;
  if (age(signals.recordedAt) > staleness.staleAfterMs) return LocationStatus.STALE;
  return LocationStatus.ACTIVE;
}

/**
 * Whether the server should believe a device that claims to be tracking.
 *
 * `BACKGROUND_PERMISSION_MISSING` and `SYNC_PENDING` both mean tracking is genuinely running,
 * so they are kept as reported — the office still needs to know about the limitation, which is
 * why they are separate states rather than folded into TRACKING_ACTIVE.
 */
export function reconcileTrackingState(reported: DriverTrackingState, permission: LocationPermission, locationServicesEnabled: boolean): DriverTrackingState {
  if (!locationServicesEnabled) return DriverTrackingState.LOCATION_SERVICES_DISABLED;
  if (permission === LocationPermission.DENIED) return DriverTrackingState.LOCATION_PERMISSION_DENIED;
  if (permission === LocationPermission.UNKNOWN) {
    // The app cannot be tracking on a permission it has never been granted.
    return reported === DriverTrackingState.TRACKING_ACTIVE ? DriverTrackingState.TRACKING_UNAVAILABLE : reported;
  }
  // Foreground-only permission cannot sustain background tracking, whatever the app reports.
  if (permission === LocationPermission.GRANTED_FOREGROUND && reported === DriverTrackingState.TRACKING_ACTIVE) {
    return DriverTrackingState.BACKGROUND_PERMISSION_MISSING;
  }
  return reported;
}

/** Statuses the admin screen treats as "we currently have a usable position". */
export const LIVE_STATUSES: LocationStatus[] = [LocationStatus.ACTIVE, LocationStatus.STALE];

/** True when the driver's newest fix is older than the configured freshness window. */
export function isStale(recordedAt: Date | null, now: Date, staleness: LocationStaleness = DEFAULT_STALENESS): boolean {
  if (!recordedAt) return true;
  return now.getTime() - recordedAt.getTime() > staleness.staleAfterMs;
}
