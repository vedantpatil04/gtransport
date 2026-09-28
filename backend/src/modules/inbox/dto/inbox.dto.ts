import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { InboxClassification, InboxMessageStatus } from '@prisma/client';

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
  /** Messages to fetch in this run. Omitted uses the configured batch size. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
