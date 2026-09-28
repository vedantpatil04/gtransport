import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Patch, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import {
  ArchiveOperationDto, CreateOfficeOperationDto, CreateOfficeTyreInsuranceDto, CreateOperationDto,
  CreateTyreInsuranceDto, MyOperationsQuery, OperationBreakdownQuery, OperationFilterQuery, UpdateOperationDto,
} from './dto/operation.dto';
import { presentOperation, presentTyreInsurance } from './operations.presenter';
import { OperationsService } from './operations.service';

const uuid = () => new ParseUUIDPipe({ version: '7' });
const WRITE_ROLES = [...FLEET_MANAGE_ROLES, UserRole.ACCOUNTING];

/** RTO, tyre, maintenance/service and tyre insurance. */
@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  // ── Driver ──

  @Post('mine')
  @Roles(UserRole.DRIVER)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOperationDto, @Res({ passthrough: true }) res: Response) {
    const { record, created } = await this.operations.createForDriver(user, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return presentOperation(record);
  }

  @Get('mine')
  @Roles(UserRole.DRIVER)
  async mine(@CurrentUser() user: AuthenticatedUser, @Query() query: MyOperationsQuery) {
    const page = await this.operations.listForDriver(user, query);
    return { ...page, data: page.data.map(presentOperation) };
  }

  @Post('mine/tyre-insurance')
  @Roles(UserRole.DRIVER)
  async createTyreInsurance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTyreInsuranceDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { record, created } = await this.operations.createTyreInsuranceForDriver(user, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return presentTyreInsurance(record);
  }

  // ── Office ──

  @Get()
  @Roles(...OFFICE_ROLES)
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: OperationFilterQuery) {
    const page = await this.operations.list(user.companyId, query);
    return { ...page, data: page.data.map(presentOperation) };
  }

  @Get('breakdown')
  @Roles(...OFFICE_ROLES)
  breakdown(@CurrentUser() user: AuthenticatedUser, @Query() query: OperationBreakdownQuery) {
    return this.operations.breakdown(user.companyId, query);
  }

  @Get('tyre-insurance')
  @Roles(...OFFICE_ROLES)
  async tyreInsurance(@CurrentUser() user: AuthenticatedUser, @Query('vehicleId') vehicleId?: string) {
    return (await this.operations.listTyreInsurance(user.companyId, vehicleId)).map(presentTyreInsurance);
  }

  @Post('tyre-insurance')
  @Roles(...WRITE_ROLES)
  async createOfficeTyreInsurance(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOfficeTyreInsuranceDto) {
    return presentTyreInsurance((await this.operations.createTyreInsuranceForOffice(user, dto)).record);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  async createOffice(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOfficeOperationDto, @Res({ passthrough: true }) res: Response) {
    const { record, created } = await this.operations.createForOffice(user, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return presentOperation(record);
  }

  @Get(':id')
  @Roles(...OFFICE_ROLES)
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return presentOperation(await this.operations.findById(user.companyId, id));
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: UpdateOperationDto) {
    return presentOperation(await this.operations.update(user, id, dto));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: ArchiveOperationDto) {
    return presentOperation(await this.operations.archive(user, id, dto));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  async restore(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return presentOperation(await this.operations.restore(user, id));
  }
}
