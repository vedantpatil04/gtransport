import { Type } from 'class-transformer';
import {
  DocumentType, DriverStatus, FuelType, LedgerEntryType, LocationStatus, PaymentStatus, ServiceReceiptAIStatus,
  VehicleKind, VehicleOwnership, VehicleStatus,
} from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { EXPIRY_WINDOWS } from '../report-maths';
import { REPORT_PRESETS } from '../report-range';

/**
 * Report query parameters. Every report has its own class, so the global validation pipe
 * (whitelist + forbidNonWhitelisted) refuses any parameter that report does not understand —
 * a filter can never be silently ignored, and nothing the client sends reaches a query as a
 * field name. Sort keys are checked against each report's own whitelist in the service.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FY_CODE = /^\d{4}(-\d{2})?$/;

export const EXPENSE_CATEGORIES = ['FUEL', 'RTO', 'TYRE', 'TYRE_INSURANCE', 'MAINTENANCE'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPORT_FORMATS = ['pdf', 'xlsx', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const MAX_REPORT_PAGE_SIZE = 100;

export class ReportRangeQuery {
  @IsOptional() @IsIn(REPORT_PRESETS, { message: `preset must be one of: ${REPORT_PRESETS.join(', ')}` }) preset?: string;
  @IsOptional() @Matches(FY_CODE, { message: 'fy must look like 2026-27' }) fy?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'from must be a date (YYYY-MM-DD)' }) from?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'to must be a date (YYYY-MM-DD)' }) to?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = object> = new (...args: any[]) => T;

/** Adds server-side paging, a whitelisted sort and a free-text search to a report's filters. */
export function Paged<TBase extends Constructor>(Base: TBase) {
  class PagedQuery extends Base {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page: number = 1;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_REPORT_PAGE_SIZE) pageSize: number = 25;
    @IsOptional() @IsString() @Matches(/^[a-zA-Z]{1,30}$/, { message: 'sort must be a column name' }) sort?: string;
    @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
    @IsOptional() @IsString() @MaxLength(100) q?: string;
  }
  return PagedQuery;
}

/** Adds the export format to a report's filters. */
export function Exported<TBase extends Constructor>(Base: TBase) {
  class ExportQuery extends Base {
    @IsIn(EXPORT_FORMATS, { message: 'format must be pdf, xlsx or csv' }) format!: ExportFormat;
    @IsOptional() @IsString() @Matches(/^[a-zA-Z]{1,30}$/, { message: 'sort must be a column name' }) sort?: string;
    @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
    @IsOptional() @IsString() @MaxLength(100) q?: string;
  }
  return ExportQuery;
}

// ───────────────────────────── Per report ─────────────────────────────

export class OverviewReportQuery extends ReportRangeQuery {}
export class OverviewExportQuery extends Exported(OverviewReportQuery) {}

export class FuelReportQuery extends ReportRangeQuery {
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsUUID('7') driverId?: string;
  @IsOptional() @IsEnum(FuelType) fuelType?: FuelType;
  @IsOptional() @IsString() @MaxLength(120) station?: string;
}
export class FuelRecordsQuery extends Paged(FuelReportQuery) {}
export class FuelExportQuery extends Exported(FuelReportQuery) {}

export class ExpenseReportQuery extends ReportRangeQuery {
  @IsOptional() @IsIn(EXPENSE_CATEGORIES, { message: `category must be one of: ${EXPENSE_CATEGORIES.join(', ')}` }) category?: ExpenseCategory;
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsUUID('7') driverId?: string;
}
export class ExpenseRecordsQuery extends Paged(ExpenseReportQuery) {}
export class ExpenseExportQuery extends Exported(ExpenseReportQuery) {}

export class VehicleReportQuery extends ReportRangeQuery {
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsEnum(VehicleStatus) status?: VehicleStatus;
  @IsOptional() @IsEnum(VehicleOwnership) ownership?: VehicleOwnership;
  @IsOptional() @IsEnum(VehicleKind) kind?: VehicleKind;
}
export class VehicleRecordsQuery extends Paged(VehicleReportQuery) {}
export class VehicleExportQuery extends Exported(VehicleReportQuery) {}

export class DriverReportQuery extends ReportRangeQuery {
  @IsOptional() @IsUUID('7') driverId?: string;
  @IsOptional() @IsEnum(DriverStatus) status?: DriverStatus;
}
export class DriverRecordsQuery extends Paged(DriverReportQuery) {}
export class DriverExportQuery extends Exported(DriverReportQuery) {}

export class FinanceReportQuery extends ReportRangeQuery {
  @IsOptional() @IsUUID('7') employeeId?: string;
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsEnum(LedgerEntryType) type?: LedgerEntryType;
  @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
}
export class FinanceRecordsQuery extends Paged(FinanceReportQuery) {}
export class FinanceExportQuery extends Exported(FinanceReportQuery) {}

export class MaintenanceReportQuery extends ReportRangeQuery {
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsUUID('7') driverId?: string;
  @IsOptional() @IsEnum(ServiceReceiptAIStatus) aiStatus?: ServiceReceiptAIStatus;
}
export class MaintenanceRecordsQuery extends Paged(MaintenanceReportQuery) {}
export class MaintenanceExportQuery extends Exported(MaintenanceReportQuery) {}

export class TyreReportQuery extends ReportRangeQuery {
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsUUID('7') driverId?: string;
}
export class TyreRecordsQuery extends Paged(TyreReportQuery) {
  @IsOptional() @IsIn(['expenses', 'policies']) section: 'expenses' | 'policies' = 'expenses';
}
export class TyreExportQuery extends Exported(TyreReportQuery) {}

export const COMPLIANCE_STATUSES = ['VALID', 'EXPIRING', 'EXPIRED', 'MISSING', 'PENDING_VERIFICATION'] as const;
export type ComplianceStatusFilter = (typeof COMPLIANCE_STATUSES)[number];

/** Compliance is "as of today", so it takes no date range — only what to look at. */
export class ComplianceReportQuery {
  @IsOptional() @IsEnum(DocumentType) documentType?: DocumentType;
  @IsOptional() @IsIn(['VEHICLE', 'EMPLOYEE']) owner?: 'VEHICLE' | 'EMPLOYEE';
  @IsOptional() @IsIn(COMPLIANCE_STATUSES) status?: ComplianceStatusFilter;
  @IsOptional() @Type(() => Number) @IsIn(EXPIRY_WINDOWS, { message: 'window must be 7, 30, 60 or 90 days' }) window?: number;
  @IsOptional() @IsUUID('7') vehicleId?: string;
  @IsOptional() @IsUUID('7') driverId?: string;
}
export class ComplianceRecordsQuery extends Paged(ComplianceReportQuery) {}
export class ComplianceExportQuery extends Exported(ComplianceReportQuery) {}

export class LocationReportQuery extends ReportRangeQuery {
  @IsOptional() @IsUUID('7') driverId?: string;
  @IsOptional() @IsEnum(LocationStatus) status?: LocationStatus;
}
export class LocationRecordsQuery extends Paged(LocationReportQuery) {
  @IsOptional() @IsIn(['drivers', 'alerts']) section: 'drivers' | 'alerts' = 'drivers';
}
export class LocationExportQuery extends Exported(LocationReportQuery) {}
