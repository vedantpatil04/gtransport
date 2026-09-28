import { Type } from 'class-transformer';
import { PaymentMethod, PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';

export class CreatePaymentDto {
  @IsUUID('7') employeeId!: string;
  @IsEnum(PaymentType) type!: PaymentType;
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  /** MANUAL (the office pays and records it) or RAZORPAYX (sent through the payout provider). */
  @IsEnum(PaymentProvider) provider!: PaymentProvider;
  @IsOptional() @IsUUID('7') salaryRecordId?: string;
  @IsOptional() @IsUUID('7') advanceId?: string;
  /** Only for allowance/other payments; salary and advance amounts come from their records. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) amount?: number;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}

export class PaymentQueryDto extends PaginationQuery {
  @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @IsOptional() @IsEnum(PaymentType) type?: PaymentType;
  @IsOptional() @IsUUID('7') employeeId?: string;
}

export class RecordManualDto {
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'paidOn must be a date (YYYY-MM-DD)' }) paidOn?: string;
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
