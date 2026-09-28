import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import { ArchiveDto, CreateFuelEntryDto, FuelBreakdownQuery, FuelFilterQuery, MyFuelQuery, UpdateFuelEntryDto } from './dto/fuel.dto';
import { presentFuelEntry, presentPeriod, presentTotals } from './fuel.presenter';
import { FuelService } from './fuel.service';

const uuid = () => new ParseUUIDPipe({ version: '7' });

/**
 * Fuel. Drivers use the /fuel/mine routes, which are scoped to their own record by the session;
 * the office uses the rest, scoped to the company.
 */
@Controller('fuel')
export class FuelController {
  constructor(private readonly fuel: FuelService) {}

  // ── Driver ──

  /** 201 for a new entry, 200 when a retried submission returns the original. */
  @Post('mine')
  @Roles(UserRole.DRIVER)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFuelEntryDto, @Res({ passthrough: true }) res: Response) {
    const { entry, created } = await this.fuel.createForDriver(user, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return presentFuelEntry(entry);
  }

  @Get('mine')
  @Roles(UserRole.DRIVER)
  async mine(@CurrentUser() user: AuthenticatedUser, @Query() query: MyFuelQuery) {
    const page = await this.fuel.listForDriver(user, query);
    return { ...page, data: page.data.map(presentFuelEntry), totals: presentTotals(page.totals) };
  }

  @Get('mine/stations')
  @Roles(UserRole.DRIVER)
  stations(@CurrentUser() user: AuthenticatedUser) {
    return this.fuel.recentStations(user);
  }

  @Get('mine/:id')
  @Roles(UserRole.DRIVER)
  async mineOne(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return presentFuelEntry(await this.fuel.findForDriver(user, id));
  }

  // ── Office ──

  @Get('summary')
  @Roles(...OFFICE_ROLES)
  async summary(@CurrentUser() user: AuthenticatedUser) {
    const summary = await this.fuel.summary(user.companyId);
    return {
      today: presentPeriod(summary.today),
      month: presentPeriod(summary.month),
      financialYear: { ...presentPeriod(summary.financialYear), label: summary.financialYear.label, code: summary.financialYear.code },
    };
  }

  /**
   * The list doubles as the financial-year statement: filter by fy (or from/to), driver,
   * vehicle, fuel type and station. Totals cover every matching entry, not just this page.
   */
  @Get()
  @Roles(...OFFICE_ROLES)
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: FuelFilterQuery) {
    const page = await this.fuel.list(user.companyId, query);
    return { ...page, data: page.data.map(presentFuelEntry), totals: presentTotals(page.totals) };
  }

  @Get('breakdown')
  @Roles(...OFFICE_ROLES)
  async breakdown(@CurrentUser() user: AuthenticatedUser, @Query() query: FuelBreakdownQuery) {
    const rows = await this.fuel.breakdown(user.companyId, query);
    return rows.map((row) => ({ key: row.key, label: row.label, ...presentTotals(row) }));
  }

  @Get(':id')
  @Roles(...OFFICE_ROLES)
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return presentFuelEntry(await this.fuel.findById(user.companyId, id));
  }

  @Patch(':id')
  @Roles(...FLEET_MANAGE_ROLES, UserRole.ACCOUNTING)
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: UpdateFuelEntryDto) {
    return presentFuelEntry(await this.fuel.update(user, id, dto));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES, UserRole.ACCOUNTING)
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: ArchiveDto) {
    return presentFuelEntry(await this.fuel.archive(user, id, dto));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES, UserRole.ACCOUNTING)
  async restore(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return presentFuelEntry(await this.fuel.restore(user, id));
  }
}
