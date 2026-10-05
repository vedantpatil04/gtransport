import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { ServiceReceiptAIStatus } from '@prisma/client';
import { LINE_ITEM_KINDS, type ServiceLineItemKind } from '../../schema';

/**
 * Review and verification requests.
 *
 * What the administrator submits is what gets saved. The server never reads values out of the
 * extraction on their behalf — that would make "verified" mean "the AI said so and nobody
 * objected", which is precisely what Phase 7 forbids. Which submitted values match the reading
 * (accepted) and which differ from it (corrected) is worked out on the server, against the
 * extraction version the administrator was looking at.
 */

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'must be a number with at most two decimal places';

/** One verified line on the invoice. */
export class VerifiedLineItemDto {
  @IsString()
  @MaxLength(200)
  description!: string;

  @IsOptional()
  @IsIn(LINE_ITEM_KINDS as unknown as string[])
  kind?: ServiceLineItemKind | null;

  @IsOptional()
  @Matches(/^\d{1,6}(\.\d{1,3})?$/, { message: 'quantity must be a positive number' })
  quantity?: string | null;

  @IsOptional()
  @Matches(MONEY, { message: `unitPrice ${MONEY_MESSAGE}` })
  unitPrice?: string | null;

  @IsOptional()
  @Matches(MONEY, { message: `amount ${MONEY_MESSAGE}` })
  amount?: string | null;
}

export class VerifyServiceReceiptDto {
  /** Rupees, at most two decimals. Sent as a string so no amount passes through a float. */
  @IsOptional()
  @IsString()
  @Matches(MONEY, { message: `amount ${MONEY_MESSAGE}` })
  amount?: string;

  /** The service date. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'expenseDate must be an ISO date (YYYY-MM-DD)' })
  expenseDate?: string;

  /** The workshop. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  vendorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  // ── Structured service details. Null clears a value; omitted leaves it as it is. ──

  @IsOptional()
  @IsString()
  @MaxLength(80)
  invoiceNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serviceType?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'odometerKm must be a whole number of kilometres' })
  @Min(0)
  @Max(10_000_000)
  odometerKm?: number | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'nextServiceDate must be an ISO date (YYYY-MM-DD)' })
  nextServiceDate?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'nextServiceKm must be a whole number of kilometres' })
  @Min(0)
  @Max(10_000_000)
  nextServiceKm?: number | null;

  @IsOptional()
  @Matches(MONEY, { message: `labourAmount ${MONEY_MESSAGE}` })
  labourAmount?: string | null;

  @IsOptional()
  @Matches(MONEY, { message: `partsAmount ${MONEY_MESSAGE}` })
  partsAmount?: string | null;

  @IsOptional()
  @Matches(MONEY, { message: `taxAmount ${MONEY_MESSAGE}` })
  taxAmount?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => VerifiedLineItemDto)
  lineItems?: VerifiedLineItemDto[] | null;

  /**
   * Which values the client says it took from the extraction. Kept for older clients; the server
   * now derives accepted and corrected fields itself by comparing against the extraction.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
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
  /** Required: re-opening a verified record is a deliberate act and the audit trail says why. */
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
