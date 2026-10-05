import { Type } from 'class-transformer';
import {
  IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { InboxClassification, InboxMessageStatus, InboxSuggestionStatus } from '@prisma/client';

export class InboxQuery {
  @IsOptional()
  @IsEnum(InboxMessageStatus)
  status?: InboxMessageStatus;

  @IsOptional()
  @IsEnum(InboxClassification)
  classification?: InboxClassification;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @IsOptional()
  @IsUUID('7')
  cursor?: string;
}

export class SetInboxStatusDto {
  @IsEnum(InboxMessageStatus)
  status!: InboxMessageStatus;
}

export class ClassifyMessageDto {
  @IsEnum(InboxClassification)
  classification!: InboxClassification;
}

export class SyncInboxDto {
  /** Messages to fetch per page in this run. Omitted uses the configured batch size. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class SuggestionQuery {
  @IsOptional()
  @IsEnum(InboxSuggestionStatus)
  status?: InboxSuggestionStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @IsOptional()
  @IsUUID('7')
  cursor?: string;
}

/**
 * The service record a person creates from a workshop invoice that arrived by email. Every value
 * is the person's, checked against the invoice — the suggestion only pre-fills the form.
 */
export class ServiceRecordFromEmailDto {
  @IsUUID('7')
  vehicleId!: string;

  @IsOptional()
  @IsUUID('7')
  driverId?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount must be a number with at most 2 decimal places' })
  @Min(0.01, { message: 'amount must be greater than 0' })
  @Max(10_000_000)
  amount!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expenseDate must be a date (YYYY-MM-DD)' })
  expenseDate!: string;

  @IsOptional() @IsString() @MaxLength(120) vendorName?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;

  /** The invoice attachment, when the suggestion did not name one or named the wrong one. */
  @IsOptional()
  @IsUUID('7')
  attachmentId?: string;
}

export class AcceptSuggestionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Required for CREATE_SERVICE_RECORD; ignored for the review-only kinds. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceRecordFromEmailDto)
  serviceRecord?: ServiceRecordFromEmailDto;
}

export class RejectSuggestionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
