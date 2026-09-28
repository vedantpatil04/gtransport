import { Type } from 'class-transformer';
import { FuelType, RecordStatus } from '@prisma/client';
import {
  IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FY_CODE = /^\d{4}(-\d{2})?$/;

/**
 * What a driver sends for a fill-up — and nothing more. Driver and vehicle are deliberately
 * absent: the server takes them from the session and the current assignment.
 */
export class CreateFuelEntryDto {
  @IsEnum(FuelType)
  fuelType!: FuelType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount must be a number with at most 2 decimal places' })
  @Min(0.01, { message: 'amount must be greater than 0' })
  @Max(10_000_000)
  amount!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'litres must be a number with at most 3 decimal places' })
  @Min(0.001, { message: 'litres must be greater than 0' })
  @Max(100_000)
  litres!: number;

  @IsString()
  @IsNotEmpty({ message: 'fuelStation is required' })
  @MaxLength(120)
  fuelStation!: string;

  @Matches(ISO_DATE, { message: 'transactionDate must be a date (YYYY-MM-DD)' })
  transactionDate!: string;

  @IsOptional()
  @IsUUID('7')
  receiptFileId?: string;

  /** Device-generated key that makes a retried submission safe. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientSubmissionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** Office corrections. Driver and vehicle stay as recorded; everything else may be fixed. */
export class UpdateFuelEntryDto {
  @IsOptional() @IsEnum(FuelType) fuelType?: FuelType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'amount must be greater than 0' })
  @Max(10_000_000)
  amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001, { message: 'litres must be greater than 0' })
  @Max(100_000)
  litres?: number;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) fuelStation?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'transactionDate must be a date (YYYY-MM-DD)' }) transactionDate?: string;
  @IsOptional() @IsUUID('7') receiptFileId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ArchiveDto {
  @IsString()
  @IsNotEmpty({ message: 'a reason is required to archive a record' })
  @MaxLength(300)
  reason!: string;
}

/** Filters shared by the admin list, the statement and the breakdowns. */
export class FuelFilterQuery extends PaginationQuery {
  /** Financial year, e.g. 2026-27. Ignored when from/to are given. */
  @IsOptional() @Matches(FY_CODE, { message: 'fy must look like 2026-27' }) fy?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'from must be a date (YYYY-MM-DD)' }) from?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'to must be a date (YYYY-MM-DD)' }) to?: string;
  @IsOptional() @IsUUID('7') driverId?: string;
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsEnum(FuelType) fuelType?: FuelType;
  /** Matches any station whose name contains this text. */
  @IsOptional() @IsString() @MaxLength(120) station?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class FuelBreakdownQuery extends FuelFilterQuery {
  @IsIn(['vehicle', 'driver', 'day', 'station'])
  by!: 'vehicle' | 'driver' | 'day' | 'station';
}

/** A driver's own history: a date range, newest first. */
export class MyFuelQuery extends PaginationQuery {
  @IsOptional() @Matches(ISO_DATE, { message: 'from must be a date (YYYY-MM-DD)' }) from?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'to must be a date (YYYY-MM-DD)' }) to?: string;
}
