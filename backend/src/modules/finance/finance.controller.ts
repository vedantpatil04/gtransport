import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { PAYROLL_ROLES } from '../auth/roles';
import { AdvanceQueryDto, CreateAdvanceDto, CreateSalaryDto, LedgerQueryDto, ReasonDto, SalaryQueryDto } from './dto/finance.dto';
import { presentAdvance, presentLedgerEntry, presentSalary } from './finance.presenter';
import { LedgerService } from './ledger.service';
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
    private readonly payroll: PayrollService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('ledger')
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: LedgerQueryDto) {
    const page = await this.ledger.list(user.companyId, { ...query, limit: query.limit });
    // Names for the page in two queries, not one per row.
    const employeeIds = [...new Set(page.data.map((l) => l.employeeId).filter((id): id is string => Boolean(id)))];
    const vehicleIds = [...new Set(page.data.map((l) => l.vehicleId).filter((id): id is string => Boolean(id)))];
    const [employees, vehicles] = await Promise.all([
      this.prisma.employee.findMany({ where: { companyId: user.companyId, id: { in: employeeIds } }, select: { id: true, fullName: true, employeeCode: true } }),
      this.prisma.vehicle.findMany({ where: { companyId: user.companyId, id: { in: vehicleIds } }, select: { id: true, registrationNumber: true } }),
    ]);
    const parties = { employees: new Map(employees.map((e) => [e.id, e])), vehicles: new Map(vehicles.map((v) => [v.id, v])) };
    return { ...page, data: page.data.map((l) => presentLedgerEntry(l, parties)) };
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
