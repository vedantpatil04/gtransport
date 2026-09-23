import { Type } from 'class-transformer';
import { EmployeeRole, EmploymentStatus, AppLanguage } from '@prisma/client';
import {
  IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional,
  IsString, Max, Min, MaxLength, Matches,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';

/** Indian mobile numbers, accepted with or without +91 and internal spacing. */
export const PHONE_PATTERN = /^\+?[0-9][0-9 -]{7,17}$/;

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  /** Optional: generated from the company's sequence when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  employeeCode?: string;

  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'phone must be a valid contact number' })
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid address' })
  email?: string;

  @IsEnum(EmployeeRole)
  role!: EmployeeRole;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  designation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  department?: string;

  @IsOptional()
  @IsDateString({}, { message: 'dateOfBirth must be an ISO date (YYYY-MM-DD)' })
  dateOfBirth?: string;

  @IsOptional()
  @IsDateString({}, { message: 'joiningDate must be an ISO date (YYYY-MM-DD)' })
  joiningDate?: string;

  @IsOptional()
  @IsEnum(AppLanguage)
  preferredLanguage?: AppLanguage;

  @IsOptional()
  @IsEnum(EmploymentStatus)
  status?: EmploymentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  baseSalary?: number;

  @IsOptional()
  @IsBoolean()
  pfApplicable?: boolean;

  /** 12-digit Universal Account Number issued by EPFO. */
  @IsOptional()
  @Matches(/^[0-9]{12}$/, { message: 'uan must be 12 digits' })
  uan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  pfMemberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Every field optional; `employeeCode` is deliberately not updatable once issued. */
export class UpdateEmployeeDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) fullName?: string;
  @IsOptional() @Matches(PHONE_PATTERN, { message: 'phone must be a valid contact number' }) phone?: string;
  @IsOptional() @IsEmail({}, { message: 'email must be a valid address' }) email?: string;
  @IsOptional() @IsEnum(EmployeeRole) role?: EmployeeRole;
  @IsOptional() @IsString() @MaxLength(80) designation?: string;
  @IsOptional() @IsString() @MaxLength(80) department?: string;
  @IsOptional() @IsDateString({}, { message: 'dateOfBirth must be an ISO date (YYYY-MM-DD)' }) dateOfBirth?: string;
  @IsOptional() @IsDateString({}, { message: 'joiningDate must be an ISO date (YYYY-MM-DD)' }) joiningDate?: string;
  @IsOptional() @IsDateString({}, { message: 'exitDate must be an ISO date (YYYY-MM-DD)' }) exitDate?: string;
  @IsOptional() @IsEnum(AppLanguage) preferredLanguage?: AppLanguage;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) baseSalary?: number;
  @IsOptional() @IsBoolean() pfApplicable?: boolean;
  @IsOptional() @Matches(/^[0-9]{12}$/, { message: 'uan must be 12 digits' }) uan?: string;
  @IsOptional() @IsString() @MaxLength(40) pfMemberId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class SetEmployeeStatusDto {
  @IsEnum(EmploymentStatus)
  status!: EmploymentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ListEmployeesQuery extends PaginationQuery {
  /** Free-text search across name, employee code, phone and email. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsEnum(EmployeeRole)
  role?: EmployeeRole;

  @IsOptional()
  @IsEnum(EmploymentStatus)
  status?: EmploymentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  pfApplicable?: number;
}
