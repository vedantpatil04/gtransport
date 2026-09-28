import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ServiceReceiptAIStatus } from '@prisma/client';

/**
 * Review and verification requests.
 *
 * What the administrator submits is what gets saved. The server never reads values out of the
 * extraction on their behalf — that would make "verified" mean "the AI said so and nobody
 * objected", which is precisely what Phase 7 forbids.
 */

/** The fields of a service record that may be taken from an extraction. */
export const VERIFIABLE_FIELDS = ['totalAmount', 'invoiceDate', 'vendorName', 'invoiceNumber', 'serviceType'] as const;

export class VerifyServiceReceiptDto {
  /** Rupees, at most two decimals. Sent as a string so no amount passes through a float. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'amount must be a number with at most two decimal places' })
  amount?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'expenseDate must be an ISO date (YYYY-MM-DD)' })
  expenseDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  vendorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  /**
   * Which submitted values were taken from the extraction rather than typed. Recorded so an
   * acceptance can later be told from a correction — the two mean different things about how
   * much the model was actually trusted.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  acceptedFields?: string[];

  /** The extraction version the administrator worked from, when there was one. */
  @IsOptional()
  @IsUUID('7')
  resultId?: string;
}

export class RejectExtractionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReopenServiceReceiptDto {
  /** Required: re-opening a confirmed record is a deliberate act and the audit trail says why. */
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class PendingReceiptsQuery {
  @IsOptional()
  @IsEnum(ServiceReceiptAIStatus)
  status?: ServiceReceiptAIStatus;

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

export class MyReceiptsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
