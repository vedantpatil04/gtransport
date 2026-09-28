import { Transform, Type } from 'class-transformer';
import { AdvanceStatus, AdvanceType, LedgerDirection, LedgerEntryType, SalaryStatus } from '@prisma/client';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-\d{2}$/;
const FY = /^\d{4}(-\d{2})?$/;
/** Rupees with at most two decimals, within a sane ceiling. */
const Rupees = (min = 0) => [Type(() => Number), IsNumber({ maxDecimalPlaces: 2 }, { message: 'amounts may have at most 2 decimal places' }), Min(min), Max(100_000_000)];
const apply = (decorators: PropertyDecorator[]): PropertyDecorator => (target, key) => decorators.forEach((d) => d(target, key));

export class LedgerQueryDto extends PaginationQuery {
  @IsOptional() @Matches(FY, { message: 'fy must look like 2026-27' }) fy?: string;
  @IsOptional() @Matches(ISO_DATE) from?: string;
  @IsOptional() @Matches(ISO_DATE) to?: string;
  @IsOptional() @IsEnum(LedgerEntryType) type?: LedgerEntryType;
  @IsOptional() @IsEnum(LedgerDirection) direction?: LedgerDirection;
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsUUID('7') employeeId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class CreateSalaryDto {
  @IsUUID('7') employeeId!: string;
  @Matches(PERIOD, { message: 'payPeriod must look like 2026-09' }) payPeriod!: string;
  @apply(Rupees(0)) baseSalary!: number;
  @IsOptional() @apply(Rupees(0)) allowances?: number;
  @IsOptional() @apply(Rupees(0)) deductions?: number;
  /** Paid advances to recover from this salary. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('7', { each: true }) recoverAdvanceIds?: string[];
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CreateAdvanceDto {
  @IsUUID('7') employeeId!: string;
  @IsEnum(AdvanceType) type!: AdvanceType;
  @apply(Rupees(0.01)) amount!: number;
  @Matches(ISO_DATE, { message: 'advanceDate must be a date (YYYY-MM-DD)' }) advanceDate!: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ReasonDto {
  @IsString() @IsNotEmpty({ message: 'a reason is required' }) @MaxLength(300) reason!: string;
}

export class SalaryQueryDto extends PaginationQuery {
  @IsOptional() @Matches(PERIOD) payPeriod?: string;
  @IsOptional() @IsUUID('7') employeeId?: string;
  @IsOptional() @IsEnum(SalaryStatus) status?: SalaryStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class AdvanceQueryDto extends PaginationQuery {
  @IsOptional() @IsUUID('7') employeeId?: string;
  @IsOptional() @IsEnum(AdvanceStatus) status?: AdvanceStatus;
  @IsOptional() @IsEnum(AdvanceType) type?: AdvanceType;
  /** Only paid advances not yet recovered — the ones a new salary can recover. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() recoverable?: boolean;
}

export class PayInstalmentDto {
  @Matches(ISO_DATE, { message: 'paidOn must be a date (YYYY-MM-DD)' }) paidOn!: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}
