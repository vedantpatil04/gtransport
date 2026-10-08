import { Type } from 'class-transformer';
import { PaymentMethod, PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
import { PaginationQuery } from '../../../common/pagination/pagination';

export class CreatePaymentDto {
  @IsUUID('7') employeeId!: string;
  @IsEnum(PaymentType) type!: PaymentType;
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  /**
   * MANUAL (the office pays and records it) or RAZORPAYX (sent through the payout provider).
   * PHONEPE is reserved for a future integration and refused until one is configured.
   */
  @IsEnum(PaymentProvider) provider!: PaymentProvider;
  @IsOptional() @IsUUID('7') salaryRecordId?: string;
  @IsOptional() @IsUUID('7') advanceId?: string;
  /** Only for allowance/other payments; salary and advance amounts come from their records. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) amount?: number;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @IsString() @MaxLength(1000) remarks?: string;
}

export class PaymentQueryDto extends PaginationQuery {
  @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @IsOptional() @IsEnum(PaymentType) type?: PaymentType;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @IsUUID('7') employeeId?: string;
  /** Created on or after / on or before these days (India time). */
  @IsOptional() @Matches(ISO_DATE, { message: 'from must be a date (YYYY-MM-DD)' }) from?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'to must be a date (YYYY-MM-DD)' }) to?: string;
  /** Employee name or code, or the payment's reference. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class RecordManualDto {
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'paidOn must be a date (YYYY-MM-DD)' }) paidOn?: string;
  /** Proof of payment uploaded first through POST /files/documents. */
  @IsOptional() @IsUUID('7') proofFileId?: string;
  @IsOptional() @IsString() @MaxLength(1000) remarks?: string;
}

/** Attaches or replaces the proof of payment. The earlier file is kept; the audit log names it. */
export class PaymentProofDto {
  @IsUUID('7') fileId!: string;
}

/** Notes only: nothing financial about a payment can be edited after it is created. */
export class UpdatePaymentNotesDto {
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @IsString() @MaxLength(1000) remarks?: string;
}

export class CancelPaymentDto {
  @IsString() @IsNotEmpty({ message: 'a reason is required' }) @MaxLength(300) reason!: string;
}

export class PayoutAccountDto {
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @IsString() @IsNotEmpty() @MaxLength(120) accountHolderName!: string;
  @IsOptional() @IsString() @MaxLength(11) ifsc?: string;
  @IsOptional() @IsString() @MaxLength(24) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(256) upiId?: string;
}
