import { LocationPermission, LocationStatus } from '@prisma/client';

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
}

/**
 * Derives the reported location status. Pure and total, so the alerting engine added in a
 * later phase can reuse it unchanged. Order matters: an explicit denial outranks staleness,
 * because "we are not allowed to know" is different from "we have not heard recently".
 */
export function deriveLocationStatus(signals: LocationSignals, now: Date, staleness: LocationStaleness = DEFAULT_STALENESS): LocationStatus {
  if (signals.permission === LocationPermission.DENIED) return LocationStatus.PERMISSION_DENIED;
  if (!signals.locationServicesEnabled) return LocationStatus.LOCATION_DISABLED;

  const age = (value: Date | null): number => (value ? now.getTime() - value.getTime() : Number.POSITIVE_INFINITY);

  if (age(signals.lastHeartbeatAt) > staleness.offlineAfterMs) return LocationStatus.OFFLINE;
  if (age(signals.recordedAt) > staleness.staleAfterMs) return LocationStatus.STALE;
  return LocationStatus.ACTIVE;
}
