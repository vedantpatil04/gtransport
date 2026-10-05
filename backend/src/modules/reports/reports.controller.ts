import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { financialYear, financialYearOf, toIsoDate } from '../../common/dates/financial-year';
import { getRequestId } from '../../common/http/request-context';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { OFFICE_ROLES } from '../auth/roles';
import {
  ComplianceExportQuery, ComplianceRecordsQuery, ComplianceReportQuery, DriverExportQuery, DriverRecordsQuery, DriverReportQuery,
  EXPENSE_CATEGORIES, ExpenseExportQuery, ExpenseRecordsQuery, ExpenseReportQuery, FinanceExportQuery, FinanceRecordsQuery,
  FinanceReportQuery, FuelExportQuery, FuelRecordsQuery, FuelReportQuery, LocationExportQuery, LocationRecordsQuery,
  LocationReportQuery, MaintenanceExportQuery, MaintenanceRecordsQuery, MaintenanceReportQuery, MAX_REPORT_PAGE_SIZE,
  OverviewExportQuery, OverviewReportQuery, TyreExportQuery, TyreRecordsQuery, TyreReportQuery, VehicleExportQuery,
  VehicleRecordsQuery, VehicleReportQuery,
} from './dto/report-query.dto';
import { EXPORT_LIMITS, ReportExportService } from './export/report-export.service';
import { REPORT_ROLES, reportsFor, reportVisibility, type ReportType } from './report-access';
import { reportContext, reportHead } from './report-context';
import { DEFAULT_EXPIRY_WINDOW, EXPIRY_WINDOWS } from './report-maths';
import { MAX_RANGE_DAYS, REPORT_PRESETS } from './report-range';
import { ComplianceReportService } from './services/compliance-report.service';
import { DriverReportService } from './services/driver-report.service';
import { ExpenseReportService } from './services/expense-report.service';
import { FinanceReportService } from './services/finance-report.service';
import { FuelReportService } from './services/fuel-report.service';
import { LocationReportService } from './services/location-report.service';
import { MaintenanceReportService } from './services/maintenance-report.service';
import { OverviewReportService } from './services/overview-report.service';
import { TyreReportService } from './services/tyre-report.service';
import { VehicleReportService } from './services/vehicle-report.service';

/**
 * Reports & Management.
 *
 * Each report has three routes: the summary (`GET /reports/<type>`: totals, breakdowns, trend),
 * its records (`/records`: one server-side page, sorted and searched), and an export
 * (`/export?format=pdf|xlsx|csv`). Every route names its roles from the one policy table, so a
 * report and its export can never disagree about who may see it; RolesGuard refuses everyone
 * else (DRIVER included) before a query runs. Everything is scoped to the caller's company.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly overview: OverviewReportService,
    private readonly fuel: FuelReportService,
    private readonly vehicles: VehicleReportService,
    private readonly drivers: DriverReportService,
    private readonly finance: FinanceReportService,
    private readonly expenses: ExpenseReportService,
    private readonly maintenance: MaintenanceReportService,
    private readonly tyres: TyreReportService,
    private readonly compliance: ComplianceReportService,
    private readonly location: LocationReportService,
    private readonly exporter: ReportExportService,
  ) {}

  /** What this role may open, and the calendar options the screens offer. */
  @Get('meta')
  @Roles(...OFFICE_ROLES)
  meta(@CurrentUser() user: AuthenticatedUser) {
    const ctx = reportContext(user, {});
    const current = financialYearOf(ctx.today);
    return {
      reports: reportsFor(user.role),
      visibility: reportVisibility(user.role),
      today: toIsoDate(ctx.today),
      currentFinancialYear: { code: current.code, label: current.label },
      financialYears: Array.from({ length: 6 }, (_, i) => financialYear(current.startYear - i)).map((fy) => ({ code: fy.code, label: fy.label, from: toIsoDate(fy.start), to: toIsoDate(fy.end) })),
      presets: REPORT_PRESETS,
      maxRangeDays: MAX_RANGE_DAYS,
      maxPageSize: MAX_REPORT_PAGE_SIZE,
      expenseCategories: EXPENSE_CATEGORIES,
      expiryWindows: EXPIRY_WINDOWS,
      defaultExpiryWindow: DEFAULT_EXPIRY_WINDOW,
      exportLimits: EXPORT_LIMITS,
    };
  }

  // ───────────────────────────── Overview ─────────────────────────────

  @Get('overview')
  @Roles(...REPORT_ROLES.overview)
  async overviewSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: OverviewReportQuery) {
    const ctx = reportContext(user, query);
    return { ...reportHead('overview', ctx, query), visibility: ctx.visibility, ...(await this.overview.summary(ctx, query)) };
  }

  @Get('overview/export')
  @Roles(...REPORT_ROLES.overview)
  overviewExport(@CurrentUser() user: AuthenticatedUser, @Query() query: OverviewExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('overview', user, query, req, res);
  }

  // ───────────────────────────── Fuel ─────────────────────────────

  @Get('fuel')
  @Roles(...REPORT_ROLES.fuel)
  async fuelSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: FuelReportQuery) {
    const ctx = reportContext(user, query);
    return { ...reportHead('fuel', ctx, query), ...(await this.fuel.summary(ctx, query)) };
  }

  @Get('fuel/records')
  @Roles(...REPORT_ROLES.fuel)
  fuelRecords(@CurrentUser() user: AuthenticatedUser, @Query() query: FuelRecordsQuery) {
    return this.fuel.records(reportContext(user, query), query);
  }

  @Get('fuel/export')
  @Roles(...REPORT_ROLES.fuel)
  fuelExport(@CurrentUser() user: AuthenticatedUser, @Query() query: FuelExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('fuel', user, query, req, res);
  }

  // ───────────────────────────── Vehicles ─────────────────────────────

  @Get('vehicles')
  @Roles(...REPORT_ROLES.vehicles)
  async vehicleSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: VehicleReportQuery) {
    const ctx = reportContext(user, query);
    return { ...reportHead('vehicles', ctx, query), visibility: ctx.visibility, ...(await this.vehicles.summary(ctx, query)) };
  }

  @Get('vehicles/records')
  @Roles(...REPORT_ROLES.vehicles)
  vehicleRecords(@CurrentUser() user: AuthenticatedUser, @Query() query: VehicleRecordsQuery) {
    return this.vehicles.records(reportContext(user, query), query);
  }

  @Get('vehicles/export')
  @Roles(...REPORT_ROLES.vehicles)
  vehicleExport(@CurrentUser() user: AuthenticatedUser, @Query() query: VehicleExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('vehicles', user, query, req, res);
  }

  // ───────────────────────────── Drivers ─────────────────────────────

  @Get('drivers')
  @Roles(...REPORT_ROLES.drivers)
  async driverSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: DriverReportQuery) {
    const ctx = reportContext(user, query);
    return { ...reportHead('drivers', ctx, query), visibility: ctx.visibility, ...(await this.drivers.summary(ctx, query)) };
  }

  @Get('drivers/records')
  @Roles(...REPORT_ROLES.drivers)
  driverRecords(@CurrentUser() user: AuthenticatedUser, @Query() query: DriverRecordsQuery) {
    return this.drivers.records(reportContext(user, query), query);
  }

  @Get('drivers/export')
  @Roles(...REPORT_ROLES.drivers)
  driverExport(@CurrentUser() user: AuthenticatedUser, @Query() query: DriverExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('drivers', user, query, req, res);
  }

  // ───────────────────────────── Finance ─────────────────────────────

  @Get('finance')
  @Roles(...REPORT_ROLES.finance)
  async financeSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: FinanceReportQuery) {
    const ctx = reportContext(user, query);
    return { ...reportHead('finance', ctx, query), ...(await this.finance.summary(ctx, query)) };
  }

  @Get('finance/records')
  @Roles(...REPORT_ROLES.finance)
  financeRecords(@CurrentUser() user: AuthenticatedUser, @Query() query: FinanceRecordsQuery) {
    return this.finance.records(reportContext(user, query), query);
  }

  @Get('finance/export')
  @Roles(...REPORT_ROLES.finance)
  financeExport(@CurrentUser() user: AuthenticatedUser, @Query() query: FinanceExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('finance', user, query, req, res);
  }

  // ───────────────────────────── Expenses ─────────────────────────────

  @Get('expenses')
  @Roles(...REPORT_ROLES.expenses)
  async expenseSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: ExpenseReportQuery) {
    const ctx = reportContext(user, query);
    return { ...reportHead('expenses', ctx, query), ...(await this.expenses.summary(ctx, query)) };
  }

  @Get('expenses/records')
  @Roles(...REPORT_ROLES.expenses)
  expenseRecords(@CurrentUser() user: AuthenticatedUser, @Query() query: ExpenseRecordsQuery) {
    return this.expenses.records(reportContext(user, query), query);
  }

  @Get('expenses/export')
  @Roles(...REPORT_ROLES.expenses)
  expenseExport(@CurrentUser() user: AuthenticatedUser, @Query() query: ExpenseExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('expenses', user, query, req, res);
  }

  // ───────────────────────────── Maintenance ─────────────────────────────

  @Get('maintenance')
  @Roles(...REPORT_ROLES.maintenance)
  async maintenanceSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: MaintenanceReportQuery) {
    const ctx = reportContext(user, query);
    return { ...reportHead('maintenance', ctx, query), ...(await this.maintenance.summary(ctx, query)) };
  }

  @Get('maintenance/records')
  @Roles(...REPORT_ROLES.maintenance)
  maintenanceRecords(@CurrentUser() user: AuthenticatedUser, @Query() query: MaintenanceRecordsQuery) {
    return this.maintenance.records(reportContext(user, query), query);
  }

  @Get('maintenance/export')
  @Roles(...REPORT_ROLES.maintenance)
  maintenanceExport(@CurrentUser() user: AuthenticatedUser, @Query() query: MaintenanceExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('maintenance', user, query, req, res);
  }

  // ───────────────────────────── Tyres ─────────────────────────────

  @Get('tyres')
  @Roles(...REPORT_ROLES.tyres)
  async tyreSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: TyreReportQuery) {
    const ctx = reportContext(user, query);
    return { ...reportHead('tyres', ctx, query), ...(await this.tyres.summary(ctx, query)) };
  }

  @Get('tyres/records')
  @Roles(...REPORT_ROLES.tyres)
  tyreRecords(@CurrentUser() user: AuthenticatedUser, @Query() query: TyreRecordsQuery) {
    return this.tyres.records(reportContext(user, query), query);
  }

  @Get('tyres/export')
  @Roles(...REPORT_ROLES.tyres)
  tyreExport(@CurrentUser() user: AuthenticatedUser, @Query() query: TyreExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('tyres', user, query, req, res);
  }

  // ───────────────────────────── Compliance (as of today) ─────────────────────────────

  @Get('compliance')
  @Roles(...REPORT_ROLES.compliance)
  async complianceSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: ComplianceReportQuery) {
    const ctx = reportContext(user, {});
    return { ...reportHead('compliance', ctx, query, { pointInTime: true }), ...(await this.compliance.summary(ctx, query)) };
  }

  @Get('compliance/records')
  @Roles(...REPORT_ROLES.compliance)
  complianceRecords(@CurrentUser() user: AuthenticatedUser, @Query() query: ComplianceRecordsQuery) {
    return this.compliance.records(reportContext(user, {}), query);
  }

  @Get('compliance/export')
  @Roles(...REPORT_ROLES.compliance)
  complianceExport(@CurrentUser() user: AuthenticatedUser, @Query() query: ComplianceExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('compliance', user, query, req, res);
  }

  // ───────────────────────────── Location / fleet ─────────────────────────────

  @Get('location')
  @Roles(...REPORT_ROLES.location)
  async locationSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: LocationReportQuery) {
    const ctx = reportContext(user, query);
    return { ...reportHead('location', ctx, query), ...(await this.location.summary(ctx, query)) };
  }

  @Get('location/records')
  @Roles(...REPORT_ROLES.location)
  locationRecords(@CurrentUser() user: AuthenticatedUser, @Query() query: LocationRecordsQuery) {
    return this.location.records(reportContext(user, query), query);
  }

  @Get('location/export')
  @Roles(...REPORT_ROLES.location)
  locationExport(@CurrentUser() user: AuthenticatedUser, @Query() query: LocationExportQuery, @Req() req: Request, @Res() res: Response) {
    return this.send('location', user, query, req, res);
  }

  // ───────────────────────────── Download ─────────────────────────────

  /** Streams a finished file. Nothing is sent until it is fully built, so a failure is a clean error. */
  private async send(type: ReportType, user: AuthenticatedUser, query: { format: 'pdf' | 'xlsx' | 'csv' } & object, req: Request, res: Response): Promise<void> {
    const file = await this.exporter.export(user, type, query as never, {
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
      requestId: getRequestId(req),
    });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', String(file.body.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Report-Rows', String(file.rows));
    res.status(200).end(file.body);
  }
}
