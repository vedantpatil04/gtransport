import { Type } from 'class-transformer';
import { DriverStatus } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, Matches } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';
import { PHONE_PATTERN } from '../../employees/dto/employee.dto';

export class CreateDriverDto {
  /** The existing employee who becomes a driver. A person is never duplicated. */
  @IsUUID('7')
  employeeId!: string;

  /** Optional: generated per company (GR-D-101, GR-D-102, …) when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  driverCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  licenceNumber?: string;

  @IsOptional()
  @IsDateString({}, { message: 'licenceExpiryDate must be an ISO date (YYYY-MM-DD)' })
  licenceExpiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  homeTown?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  emergencyContactName?: string;

  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'emergencyContactPhone must be a valid contact number' })
  emergencyContactPhone?: string;

  @IsOptional()
  @IsBoolean()
  locationSharingEnabled?: boolean;

  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}

export class UpdateDriverDto {
  @IsOptional() @IsString() @MaxLength(40) licenceNumber?: string;
  @IsOptional() @IsDateString({}, { message: 'licenceExpiryDate must be an ISO date (YYYY-MM-DD)' }) licenceExpiryDate?: string;
  @IsOptional() @IsString() @MaxLength(80) homeTown?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;
  @IsOptional() @Matches(PHONE_PATTERN, { message: 'emergencyContactPhone must be a valid contact number' }) emergencyContactPhone?: string;
  @IsOptional() @IsBoolean() locationSharingEnabled?: boolean;
}

export class SetDriverStatusDto {
  @IsEnum(DriverStatus)
  status!: DriverStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ListDriversQuery extends PaginationQuery {
  /** Free-text search across name, driver code, phone and assigned registration. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;

  /** Filter to the driver of one vehicle. */
  @IsOptional()
  @IsUUID('7')
  vehicleId?: string;

  /** 1 = only drivers with a vehicle, 0 = only drivers without one. */
  @IsOptional()
  @Type(() => Number)
  assigned?: number;
}
