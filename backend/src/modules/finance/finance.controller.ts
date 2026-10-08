import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { PAYROLL_ROLES } from '../auth/roles';
import {
  AdvanceQueryDto, CreateAdvanceDto, CreateManualLedgerEntryDto, CreateSalaryDto, LedgerQueryDto, ReasonDto, SalaryQueryDto, UpdateManualLedgerEntryDto,
} from './dto/finance.dto';
import { presentAdvance, presentLedgerEntry, presentManualEntry, presentSalary } from './finance.presenter';
import { LedgerService } from './ledger.service';
import { ManualLedgerService } from './manual-ledger.service';
import { PayrollService } from './payroll.service';
import { PrismaService } from '../../database/prisma.service';

/**
 * Ledger, salaries and advances. Salary data is personal, so every route here is limited to
 * payroll roles (admin, accounting); managers see operations, not pay.
 */
@Controller('finance')
@Roles(...PAYROLL_ROLES)
export class FinanceController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly manual: ManualLedgerService,
    private readonly payroll: PayrollService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('ledger')
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: LedgerQueryDto) {
    const page = await this.ledger.list(user.companyId, { ...query, limit: query.limit });
    // Names for the page in two queries, not one per row.
    const employeeIds = [...new Set(page.data.map((l) => l.employeeId).filter((id): id is string => Boolean(id)))];
    const vehicleIds = [...new Set(page.data.map((l) => l.vehicleId).filter((id): id is string => Boolean(id)))];
    const manualIds = [...new Set(page.data.filter((l) => l.sourceType === 'MANUAL').map((l) => l.sourceId))];
    const [employees, vehicles, manual] = await Promise.all([
      this.prisma.employee.findMany({ where: { companyId: user.companyId, id: { in: employeeIds } }, select: { id: true, fullName: true, employeeCode: true } }),
      this.prisma.vehicle.findMany({ where: { companyId: user.companyId, id: { in: vehicleIds } }, select: { id: true, registrationNumber: true } }),
      this.manual.forLines(user.companyId, manualIds),
    ]);
    const parties = { employees: new Map(employees.map((e) => [e.id, e])), vehicles: new Map(vehicles.map((v) => [v.id, v])), manual };
    return { ...page, data: page.data.map((l) => presentLedgerEntry(l, parties)) };
  }

  // ───────────────────────────── Hand entries ─────────────────────────────
  // Editable records the ledger mirrors append-only: an edit is a reversal plus a new line, and
  // "delete" is a reversal that keeps the record. Every change is audited before-and-after.

  @Post('ledger/entries')
  async createEntry(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateManualLedgerEntryDto) {
    return presentManualEntry(await this.manual.create(user, dto));
  }

  @Get('ledger/entries/:id')
  async entry(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const { entry, lines, history } = await this.manual.detail(user.companyId, id);
    const parties = {
      employees: new Map(entry.employee ? [[entry.employee.id, { id: entry.employee.id, fullName: entry.employee.fullName, employeeCode: entry.employee.employeeCode }]] : []),
      vehicles: new Map(entry.vehicle ? [[entry.vehicle.id, entry.vehicle]] : []),
    };
    return {
      ...presentManualEntry(entry),
      lines: lines.map((l) => presentLedgerEntry(l, parties)),
      history: history.map((h) => ({ id: h.id, action: h.action, at: h.occurredAt.toISOString(), actor: h.actorName, role: h.actorRole, changes: h.changes, metadata: h.metadata })),
    };
  }

  @Patch('ledger/entries/:id')
  async updateEntry(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateManualLedgerEntryDto) {
    return presentManualEntry(await this.manual.update(user, id, dto));
  }

  /** Reverses the entry out of the ledger; the record and its history are kept. */
  @Post('ledger/entries/:id/reverse')
  @HttpCode(HttpStatus.OK)
  async reverseEntry(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return presentManualEntry(await this.manual.archive(user, id, dto.reason));
  }

  @Post('ledger/entries/:id/restore')
  @HttpCode(HttpStatus.OK)
  async restoreEntry(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return presentManualEntry(await this.manual.restore(user, id));
  }

  /** Financial-year totals by type, plus payments awaiting action. */
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser, @Query('fy') fy?: string) {
    return this.ledger.summary(user.companyId, fy);
  }

  @Get('payroll-summary')
  payrollSummary(@CurrentUser() user: AuthenticatedUser, @Query('period') period?: string) {
    return this.payroll.monthSummary(user.companyId, period);
  }

  @Get('salaries')
  async salaries(@CurrentUser() user: AuthenticatedUser, @Query() query: SalaryQueryDto) {
    const page = await this.payroll.listSalaries(user.companyId, query);
    return { ...page, data: page.data.map(presentSalary) };
  }

  @Post('salaries')
  async createSalary(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSalaryDto) {
    return presentSalary(await this.payroll.createSalary(user, dto));
  }

  @Get('salaries/:id')
  async salary(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return presentSalary(await this.payroll.findSalary(user.companyId, id));
  }

  @Post('salaries/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSalary(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return presentSalary(await this.payroll.cancelSalary(user, id, dto.reason));
  }

  @Get('advances')
  async advances(@CurrentUser() user: AuthenticatedUser, @Query() query: AdvanceQueryDto) {
    const page = await this.payroll.listAdvances(user.companyId, query);
    return { ...page, data: page.data.map(presentAdvance) };
  }

  @Post('advances')
  async createAdvance(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAdvanceDto) {
    return presentAdvance(await this.payroll.createAdvance(user, dto));
  }

  @Post('advances/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelAdvance(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return presentAdvance(await this.payroll.cancelAdvance(user, id, dto.reason));
  }
}
