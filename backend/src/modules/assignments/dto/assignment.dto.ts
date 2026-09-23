import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';

export class AssignDriverDto {
  @IsUUID('7')
  driverId!: string;

  /** Defaults to now. Useful when recording an assignment that began earlier. */
  @IsOptional()
  @IsDateString({}, { message: 'startedAt must be an ISO date-time' })
  startedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UnassignDriverDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ListAssignmentsQuery extends PaginationQuery {}
