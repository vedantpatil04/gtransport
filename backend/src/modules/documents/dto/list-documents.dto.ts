import { Type } from 'class-transformer';
import { DocumentState, DocumentType, DocumentVerificationStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const STATUS_FILTERS = ['EXPIRED', 'WITHIN_7_DAYS', 'EXPIRING_SOON', 'VALID'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export class ListDocumentsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(DocumentType) type?: DocumentType;
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsUUID('7') employeeId?: string;
  /** Convenience: a driver's documents, resolved to their employee record. */
  @IsOptional() @IsUUID('7') driverId?: string;
  @IsOptional() @IsIn(STATUS_FILTERS) status?: StatusFilter;
  @IsOptional() @IsEnum(DocumentVerificationStatus) verificationStatus?: DocumentVerificationStatus;
  /** Defaults to CURRENT: history and archive are opt-in. */
  @IsOptional() @IsEnum(DocumentState) state?: DocumentState;
  @IsOptional() @Matches(ISO_DATE, { message: 'expiryFrom must be a date (YYYY-MM-DD)' }) expiryFrom?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'expiryTo must be a date (YYYY-MM-DD)' }) expiryTo?: string;
}

/** Document details shared by every upload path. The file is uploaded first via /files/documents. */
export class DocumentDetailsDto {
  @IsUUID('7')
  fileId!: string;

  @IsOptional() @IsString() @MaxLength(80) documentNumber?: string;
  /** Issuing authority or insurer. */
  @IsOptional() @IsString() @MaxLength(120) issuer?: string;
  @IsOptional() @IsDateString({}, { message: 'issueDate must be an ISO date (YYYY-MM-DD)' }) issueDate?: string;
  @IsOptional() @IsDateString({}, { message: 'expiryDate must be an ISO date (YYYY-MM-DD)' }) expiryDate?: string;
  /** Premium or fee, e.g. an insurance premium. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) amount?: number;
  /** Name for an "Other" document. */
  @IsOptional() @IsString() @MaxLength(120) customName?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsString() @MaxLength(100) clientSubmissionId?: string;
}

/** Office upload: names the owner explicitly. */
export class CreateDocumentDto extends DocumentDetailsDto {
  @IsEnum(DocumentType) type!: DocumentType;
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsUUID('7') employeeId?: string;
}

/**
 * Driver upload: only the type. The owner is implied — the assigned vehicle for vehicle
 * documents, the driver themself for a driving licence — and is resolved by the server.
 */
export class CreateMyDocumentDto extends DocumentDetailsDto {
  @IsEnum(DocumentType) type!: DocumentType;
}

export class RejectDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'a reason is required so the driver knows what to fix' })
  @MaxLength(300)
  reason!: string;
}

export class ArchiveDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'a reason is required to archive a document' })
  @MaxLength(300)
  reason!: string;
}
