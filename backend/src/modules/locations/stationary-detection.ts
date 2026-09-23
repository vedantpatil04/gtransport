/**
 * Configuration for the future stationary-driver alert: a driver who stays within
 * `radiusMeters` for longer than `minDurationMs` should raise an admin alert.
 *
 * Phase 0 defines the contract and defaults only. The detection engine, alert records and
 * notification delivery belong to the location phase.
 */
export interface StationaryDetectionPolicy {
  radiusMeters: number;
  minDurationMs: number;
}

export const DEFAULT_STATIONARY_POLICY: StationaryDetectionPolicy = {
  radiusMeters: 250,
  minDurationMs: 4 * 60 * 60 * 1000,
};
