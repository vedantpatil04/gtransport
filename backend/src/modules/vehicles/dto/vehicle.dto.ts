import { Type } from 'class-transformer';
import { FinanceStatus, FuelType, VehicleKind, VehicleOwnership, VehicleStatus } from '@prisma/client';
import {
  IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';

/** Indian registration plates, e.g. "KA 22 AB 1234" or "KA22AB1234" (normalised on save). */
export const REGISTRATION_PATTERN = /^[A-Za-z]{2}\s?[0-9]{1,2}\s?[A-Za-z]{0,3}\s?[0-9]{1,4}$/;

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  @Matches(REGISTRATION_PATTERN, { message: 'registrationNumber must look like KA 22 AB 1234' })
  registrationNumber!: string;

  @IsEnum(VehicleKind)
  kind!: VehicleKind;

  @IsEnum(FuelType)
  fuelType!: FuelType;

  @IsOptional() @IsString() @MaxLength(60) make?: string;
  @IsOptional() @IsString() @MaxLength(80) model?: string;
  @IsOptional() @IsString() @MaxLength(60) variant?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  manufactureYear?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999) capacityTonnes?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999) mileageKmpl?: number;

  @IsOptional() @IsEnum(VehicleStatus) status?: VehicleStatus;
  @IsOptional() @IsEnum(VehicleOwnership) ownership?: VehicleOwnership;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateVehicleDto {
  @IsOptional() @Matches(REGISTRATION_PATTERN, { message: 'registrationNumber must look like KA 22 AB 1234' }) registrationNumber?: string;
  @IsOptional() @IsEnum(VehicleKind) kind?: VehicleKind;
  @IsOptional() @IsEnum(FuelType) fuelType?: FuelType;
  @IsOptional() @IsString() @MaxLength(60) make?: string;
  @IsOptional() @IsString() @MaxLength(80) model?: string;
  @IsOptional() @IsString() @MaxLength(60) variant?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1950) @Max(2100) manufactureYear?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999) capacityTonnes?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999) mileageKmpl?: number;
  @IsOptional() @IsEnum(VehicleOwnership) ownership?: VehicleOwnership;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class SetVehicleStatusDto {
  @IsEnum(VehicleStatus)
  status!: VehicleStatus;

  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** Loan terms. Accepted only while the vehicle's ownership is FINANCED. */
export class UpsertFinancingDto {
  @IsOptional() @IsString() @MaxLength(120) lenderName?: string;
  @IsOptional() @IsString() @MaxLength(60) loanAccountNumber?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) loanAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) downPayment?: number;

  @IsOptional() @IsDateString({}, { message: 'financeStartDate must be an ISO date (YYYY-MM-DD)' }) financeStartDate?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(600) tenureMonths?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) interestRatePct?: number;

  /** Optional: recalculated from the loan terms when omitted. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) emiAmount?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(600) totalInstallments?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(600) paidInstallments?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) outstandingAmount?: number;
  @IsOptional() @IsDateString({}, { message: 'nextDueDate must be an ISO date (YYYY-MM-DD)' }) nextDueDate?: string;
  @IsOptional() @IsEnum(FinanceStatus) status?: FinanceStatus;
}

export class ListVehiclesQuery extends PaginationQuery {
  /** Free-text search across registration, make, model and the assigned driver's name. */
  @IsOptional() @IsString() @MaxLength(80) q?: string;

  @IsOptional() @IsEnum(VehicleStatus) status?: VehicleStatus;
  @IsOptional() @IsEnum(VehicleKind) kind?: VehicleKind;
  @IsOptional() @IsEnum(FuelType) fuelType?: FuelType;
  @IsOptional() @IsEnum(VehicleOwnership) ownership?: VehicleOwnership;
  @IsOptional() @IsEnum(FinanceStatus) financeStatus?: FinanceStatus;
  @IsOptional() @IsUUID('7') driverId?: string;

  /** 1 = only vehicles with a driver, 0 = only vehicles without one. */
  @IsOptional() @Type(() => Number) assigned?: number;
}
