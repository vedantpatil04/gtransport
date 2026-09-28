import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { DEFAULT_STALENESS, type LocationStaleness } from './location-status.policy';
import { DEFAULT_STATIONARY_POLICY, type StationaryDetectionPolicy } from './stationary-detection';

/**
 * Every tunable number the location layer uses, in one place.
 *
 * The thresholds that decide whether a driver is stale, or has been parked too long, are
 * operational judgements that will be adjusted once the fleet is running — so they are
 * configuration, not constants scattered through the code. The defaults below are the ones
 * documented for Gangamata: a 150 m radius over 4 continuous hours.
 */

/** What the phone is told about how often to report. Served to the app, never hardcoded in it. */
export interface TrackingStrategy {
  /** Seconds between fixes while the vehicle is moving. */
  movingIntervalSeconds: number;
  /** Seconds between fixes while the vehicle appears stationary — far apart, to spare the battery. */
  stationaryIntervalSeconds: number;
  /** Minimum metres of travel before a new fix is worth sending. */
  distanceMeters: number;
  /** Fixes the device may hold offline before the oldest are dropped. */
  bufferLimit: number;
  /** Largest number of fixes the ingestion endpoint accepts in one upload. */
  maxBatchSize: number;
}

/** Guards that decide whether an incoming fix is usable at all. */
export interface LocationIngestLimits {
  /** A fix less accurate than this is not trustworthy enough to store. */
  maxAccuracyMeters: number;
  /** A device clock this far ahead of the server is wrong; the fix is refused. */
  maxClockSkewMinutes: number;
  /** A fix older than this is refused outright: it is no longer operationally useful. */
  maxBacklogHours: number;
  /** Fixes one driver may submit per minute before being throttled. */
  maxFixesPerMinute: number;
}

/**
 * Stationary detection needs a second accuracy bar, stricter than storage. A fix with a 900 m
 * error radius is worth keeping as a rough position, but comparing it against a 150 m radius
 * would be meaningless: it would report movement that never happened, or hide movement that did.
 * Such fixes are stored and then skipped by the alert engine.
 */
export interface StationaryPolicy extends StationaryDetectionPolicy {
  /** Fixes less accurate than this take no part in the stationary decision. */
  maxAccuracyMeters: number;
}

@Injectable()
export class LocationConfigService {
  constructor(private readonly config: AppConfigService) {}

  get staleness(): LocationStaleness {
    const { staleAfterMinutes, offlineAfterMinutes } = this.config.location;
    return { staleAfterMs: staleAfterMinutes * 60_000, offlineAfterMs: offlineAfterMinutes * 60_000 };
  }

  get stationary(): StationaryPolicy {
    const { stationaryRadiusMeters, stationaryDurationMinutes, stationaryMaxAccuracyMeters } = this.config.location;
    return {
      radiusMeters: stationaryRadiusMeters,
      minDurationMs: stationaryDurationMinutes * 60_000,
      maxAccuracyMeters: stationaryMaxAccuracyMeters,
    };
  }

  get limits(): LocationIngestLimits {
    const c = this.config.location;
    return {
      maxAccuracyMeters: c.maxAccuracyMeters,
      maxClockSkewMinutes: c.maxClockSkewMinutes,
      maxBacklogHours: c.maxBacklogHours,
      maxFixesPerMinute: c.maxFixesPerMinute,
    };
  }

  get trackingStrategy(): TrackingStrategy {
    const c = this.config.location;
    return {
      movingIntervalSeconds: c.trackingIntervalSeconds,
      stationaryIntervalSeconds: c.trackingStationaryIntervalSeconds,
      distanceMeters: c.trackingDistanceMeters,
      bufferLimit: c.deviceBufferLimit,
      maxBatchSize: c.maxBatchSize,
    };
  }

  /** How often the admin Live Fleet screen should poll. Sent to the client so it is tunable. */
  get fleetRefreshSeconds(): number {
    return this.config.location.fleetRefreshSeconds;
  }
}

/** Defaults, exported so tests and documentation cannot drift from the schema. */
export const LOCATION_DEFAULTS = {
  staleAfterMinutes: DEFAULT_STALENESS.staleAfterMs / 60_000,
  offlineAfterMinutes: DEFAULT_STALENESS.offlineAfterMs / 60_000,
  stationaryRadiusMeters: 150,
  stationaryDurationMinutes: DEFAULT_STATIONARY_POLICY.minDurationMs / 60_000,
} as const;
