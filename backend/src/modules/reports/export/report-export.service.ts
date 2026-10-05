import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import { PrismaService } from '../../../database/prisma.service';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import type { ExportFormat } from '../dto/report-query.dto';
import { canViewReport, type ReportType } from '../report-access';
import { reportContext, type DetailLimits, type ReportContext } from '../report-context';
import { REPORT_TITLES, type ReportDocument } from '../report-document';
import type { RangeInput } from '../report-range';
import { ComplianceReportService } from '../services/compliance-report.service';
import { DriverReportService } from '../services/driver-report.service';
import { ExpenseReportService } from '../services/expense-report.service';
import { FinanceReportService } from '../services/finance-report.service';
import { FuelReportService } from '../services/fuel-report.service';
import { LocationReportService } from '../services/location-report.service';
import { MaintenanceReportService } from '../services/maintenance-report.service';
import { OverviewReportService } from '../services/overview-report.service';
import { ReportLookups } from '../services/report-lookups';
import { TyreReportService } from '../services/tyre-report.service';
import { VehicleReportService } from '../services/vehicle-report.service';
import { writeCsv } from './csv-writer';
import { writePdf } from './pdf-writer';
import { writeXlsx } from './xlsx-writer';

/** Spreadsheets carry every record or refuse; PDFs carry a stated excerpt. */
export const EXPORT_LIMITS: Record<ExportFormat, DetailLimits> = {
  pdf: { maxRows: 1_000, strict: false },
  xlsx: { maxRows: 50_000, strict: true },
  csv: { maxRows: 100_000, strict: true },
};

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

export interface ExportedFile {
  filename: string;
  contentType: string;
  body: Buffer;
  rows: number;
}

type Describer = (ctx: ReportContext, query: never, limits: DetailLimits) => Promise<Partial<ReportDocument>>;

/**
 * Produces report files on the server.
 *
 * Every file is built from the same report services the screens read, for the signed-in user's
 * company and role — the role is checked again here, not only on the route — and every export is
 * written to the audit trail (who, which report, which filters, which period, how many records).
 * Only that description is audited; the file itself is streamed to the user and never stored.
 */
@Injectable()
export class ReportExportService {
  private readonly describers: Record<ReportType, Describer>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lookups: ReportLookups,
    overview: OverviewReportService,
    fuel: FuelReportService,
    vehicles: VehicleReportService,
    drivers: DriverReportService,
    finance: FinanceReportService,
    expenses: ExpenseReportService,
    maintenance: MaintenanceReportService,
    tyres: TyreReportService,
    compliance: ComplianceReportService,
    location: LocationReportService,
  ) {
    this.describers = {
      overview: overview.document.bind(overview) as Describer,
      fuel: fuel.document.bind(fuel) as Describer,
      vehicles: vehicles.document.bind(vehicles) as Describer,
      drivers: drivers.document.bind(drivers) as Describer,
      finance: finance.document.bind(finance) as Describer,
      expenses: expenses.document.bind(expenses) as Describer,
      maintenance: maintenance.document.bind(maintenance) as Describer,
      tyres: tyres.document.bind(tyres) as Describer,
      compliance: compliance.document.bind(compliance) as Describer,
      location: location.document.bind(location) as Describer,
    };
  }

  async export(user: AuthenticatedUser, type: ReportType, query: RangeInput & { format: ExportFormat } & Record<string, unknown>, meta: { ipAddress?: string | null; userAgent?: string | null; requestId?: string | null } = {}): Promise<ExportedFile> {
    if (!canViewReport(user.role, type)) throw new ForbiddenException('Your role does not permit this report.');

    const pointInTime = type === 'compliance';
    const ctx = reportContext(user, pointInTime ? {} : query);
    const partial = await this.describers[type](ctx, query as never, EXPORT_LIMITS[query.format]);

    const document: ReportDocument = {
      type,
      title: partial.title ?? REPORT_TITLES[type],
      company: await this.lookups.companyName(ctx.companyId),
      period: pointInTime ? null : { label: ctx.range.label, from: toIsoDate(ctx.range.from), to: toIsoDate(ctx.range.to) },
      asOf: toIsoDate(ctx.today),
      financialYears: pointInTime ? [] : ctx.range.financialYears.map((fy) => fy.label),
      filters: partial.filters ?? [],
      generatedAt: ctx.now,
      generatedBy: await this.displayName(user),
      summary: partial.summary ?? [],
      tables: partial.tables ?? [],
      definitions: partial.definitions ?? [],
    };

    const body = query.format === 'pdf' ? await writePdf(document) : query.format === 'xlsx' ? await writeXlsx(document) : writeCsv(document);
    const rows = document.tables.filter((t) => t.detail).reduce((n, t) => n + t.rows.length, 0);
    const stamp = pointInTime ? toIsoDate(ctx.today) : `${toIsoDate(ctx.range.from)}_${toIsoDate(ctx.range.to)}`;

    await this.audit.record({
      action: 'report.exported',
      entityType: 'Report',
      entityId: null,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      metadata: {
        report: type,
        format: query.format,
        period: document.period ?? { asOf: document.asOf },
        filters: document.filters.map((f) => ({ [f.label]: f.value })),
        rows,
        bytes: body.length,
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      requestId: meta.requestId ?? null,
    });

    return { filename: `gangamata-${type}-report-${stamp}.${query.format}`, contentType: CONTENT_TYPES[query.format], body, rows };
  }

  private async displayName(user: AuthenticatedUser): Promise<string> {
    const account = await this.prisma.user.findUnique({ where: { id: user.id }, select: { email: true, phone: true, employee: { select: { fullName: true } } } });
    return account?.employee?.fullName ?? account?.email ?? account?.phone ?? user.role;
  }
}
