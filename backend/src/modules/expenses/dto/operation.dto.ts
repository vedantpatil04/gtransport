import { Type } from 'class-transformer';
import { OperationCategory, RecordStatus } from '@prisma/client';
import {
  IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FY_CODE = /^\d{4}(-\d{2})?$/;

/** An RTO, tyre or maintenance/service expense from the driver app. The vehicle is implied. */
export class CreateOperationDto {
  @IsEnum(OperationCategory)
  category!: OperationCategory;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount must be a number with at most 2 decimal places' })
  @Min(0.01, { message: 'amount must be greater than 0' })
  @Max(10_000_000)
  amount!: number;

  @Matches(ISO_DATE, { message: 'expenseDate must be a date (YYYY-MM-DD)' })
  expenseDate!: string;

  /** Service centre, tyre dealer or RTO office. */
  @IsOptional() @IsString() @MaxLength(120) vendorName?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsUUID('7') receiptFileId?: string;
  @IsOptional() @IsString() @MaxLength(100) clientSubmissionId?: string;
}

/** The office records an expense against any company vehicle, optionally naming the driver. */
export class CreateOfficeOperationDto extends CreateOperationDto {
  @IsUUID('7')
  vehicleId!: string;

  @IsOptional()
  @IsUUID('7')
  driverId?: string;
}

export class UpdateOperationDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'amount must be greater than 0' })
  @Max(10_000_000)
  amount?: number;

  @IsOptional() @Matches(ISO_DATE, { message: 'expenseDate must be a date (YYYY-MM-DD)' }) expenseDate?: string;
  @IsOptional() @IsString() @MaxLength(120) vendorName?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsUUID('7') receiptFileId?: string;
}

export class OperationFilterQuery extends PaginationQuery {
  @IsOptional() @IsEnum(OperationCategory) category?: OperationCategory;
  @IsOptional() @Matches(FY_CODE, { message: 'fy must look like 2026-27' }) fy?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'from must be a date (YYYY-MM-DD)' }) from?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'to must be a date (YYYY-MM-DD)' }) to?: string;
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsUUID('7') driverId?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class OperationBreakdownQuery extends OperationFilterQuery {
  @IsIn(['vehicle', 'category'])
  by!: 'vehicle' | 'category';
}

export class MyOperationsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(OperationCategory) category?: OperationCategory;
  @IsOptional() @Matches(ISO_DATE, { message: 'from must be a date (YYYY-MM-DD)' }) from?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'to must be a date (YYYY-MM-DD)' }) to?: string;
}

/**
 * Tyre insurance is a policy, not a one-off expense: its expiry matters. It is stored as a
 * TYRE_INSURANCE document against the vehicle so the compliance phase can track the expiry.
 */
export class CreateTyreInsuranceDto {
  @IsString()
  @IsNotEmpty({ message: 'insurer is required' })
  @MaxLength(120)
  insurer!: string;

  @IsOptional() @IsString() @MaxLength(80) policyNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'premium cannot be negative' })
  @Max(10_000_000)
  premium?: number;

  @IsOptional() @Matches(ISO_DATE, { message: 'startDate must be a date (YYYY-MM-DD)' }) startDate?: string;

  @Matches(ISO_DATE, { message: 'expiryDate must be a date (YYYY-MM-DD)' })
  expiryDate!: string;

  @IsOptional() @IsUUID('7') receiptFileId?: string;
  @IsOptional() @IsString() @MaxLength(100) clientSubmissionId?: string;
}

export class CreateOfficeTyreInsuranceDto extends CreateTyreInsuranceDto {
  @IsUUID('7')
  vehicleId!: string;
}

export class ArchiveOperationDto {
  @IsString()
  @IsNotEmpty({ message: 'a reason is required to archive a record' })
  @MaxLength(300)
  reason!: string;
}
