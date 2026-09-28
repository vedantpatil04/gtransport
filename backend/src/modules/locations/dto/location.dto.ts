import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsISO8601, IsLatitude, IsLongitude, IsNumber,
  IsOptional, IsNumberString, IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { DriverTrackingState, FleetAlertStatus, FleetAlertType, LocationPermission, LocationStatus } from '@prisma/client';
import { PaginationQuery } from '../../../common/pagination/pagination';

/**
 * Wire shapes for location ingestion and the admin fleet views.
 *
 * What is conspicuously absent from every driver-facing shape: `driverId` and `vehicleId`. The
 * server resolves both — the driver from the bearer token, the vehicle from that driver's open
 * assignment — so no request can attribute a position to someone else. A client that sends
 * either field is refused by the whitelisting validation pipe rather than quietly obeyed.
 */

/** Upper bound for the batch. The real limit comes from configuration and is checked in the service. */
const MAX_BATCH = 500;

export const DEFAULT_HISTORY_PAGE_SIZE = 100;
export const MAX_HISTORY_PAGE_SIZE = 500;

export class LocationFixDto {
  @IsLatitude()
  @Type(() => Number)
  latitude!: number;

  @IsLongitude()
  @Type(() => Number)
  longitude!: number;

  /** Device clock at capture. Preserved exactly, so a fix buffered offline keeps its real time. */
  @IsISO8601()
  capturedAt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracyMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(400)
  speedKmh?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  headingDeg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-500)
  @Max(10_000)
  altitudeMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  batteryPct?: number;

  /** "gps" | "network" | "fused", when the platform reports it. Diagnostic only. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;

  /**
   * Device-generated identifier for this fix. The same value must be sent on every retry: it is
   * what makes re-uploading a buffered fix safe.
   */
  @IsString()
  @MaxLength(64)
  clientSubmissionId!: string;
}

export class SubmitLocationsDto {
  /**
   * One or more fixes, oldest first by convention. A batch exists because a driver who has been
   * out of signal for an hour has a queue to clear, and sending it one request per fix would be
   * slow on the networks these phones are actually on.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH)
  @ValidateNested({ each: true })
  @Type(() => LocationFixDto)
  fixes!: LocationFixDto[];

  /** Fixes still held on the device after this upload, so the office can see a sync backlog. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pendingUploads?: number;

  /** What the device believes it is doing. Reconciled against the permissions it reports. */
  @IsOptional()
  @IsEnum(DriverTrackingState)
  trackingState?: DriverTrackingState;
}

/**
 * The driver app's tracking report. Extends the Phase 2 permission report rather than replacing
 * it: the existing fields keep their meaning, and a build that predates tracking still works.
 */
export class ReportTrackingStateDto {
  @IsEnum(LocationPermission)
  permission!: LocationPermission;

  /** The device-level location services toggle. */
  @IsBoolean()
  locationServicesEnabled!: boolean;

  @IsOptional()
  @IsEnum(DriverTrackingState)
  trackingState?: DriverTrackingState;

  /** Fixes waiting in the device's offline buffer. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pendingUploads?: number;

  /**
   * The newest fix the device holds, whether or not it has been uploaded. Lets the office tell
   * "the phone has nothing" from "the phone has something it cannot send".
   */
  @IsOptional()
  @IsISO8601()
  lastFixAt?: string;
}

/** Filters for the admin fleet list. */
export class FleetQuery {
  @IsOptional()
  @IsEnum(LocationStatus)
  status?: LocationStatus;

  @IsOptional()
  @IsEnum(DriverTrackingState)
  trackingState?: DriverTrackingState;

  /** 1 keeps only drivers with an active stationary alert. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  alerting?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

/**
 * History paging.
 *
 * Deliberately not an extension of the shared `PaginationQuery`: that one validates the cursor
 * as a UUIDv7, and `driver_location_pings` is keyed by a bigint precisely because it is the
 * highest-volume table in the system. The cursor here is that bigint, as a string.
 */
export class LocationHistoryQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_HISTORY_PAGE_SIZE)
  limit: number = DEFAULT_HISTORY_PAGE_SIZE;

  /** Id of the last ping from the previous page. */
  @IsOptional()
  @IsNumberString()
  @MaxLength(20)
  cursor?: string;

  /** Inclusive ISO date-time lower bound on the device capture time. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class AlertsQuery extends PaginationQuery {
  @IsOptional()
  @IsEnum(FleetAlertStatus)
  status?: FleetAlertStatus;

  @IsOptional()
  @IsEnum(FleetAlertType)
  type?: FleetAlertType;

  @IsOptional()
  @IsUUID('7')
  driverId?: string;
}

export class AcknowledgeAlertDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ResolveAlertDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
