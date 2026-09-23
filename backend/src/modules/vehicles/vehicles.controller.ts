import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import type { Page } from '../../common/pagination/pagination';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { FINANCE_MANAGE_ROLES, FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import { CreateVehicleDto, ListVehiclesQuery, SetVehicleStatusDto, UpdateVehicleDto, UpsertFinancingDto } from './dto/vehicle.dto';
import { presentVehicle, type VehicleView } from './vehicle.presenter';
import { VehiclesService } from './vehicles.service';

const uuid = () => new ParseUUIDPipe({ version: '7' });

@Controller('vehicles')
@Roles(...OFFICE_ROLES)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListVehiclesQuery): Promise<Page<VehicleView>> {
    const page = await this.vehicles.list(user.companyId, query);
    return { ...page, data: page.data.map(presentVehicle) };
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string): Promise<VehicleView> {
    return presentVehicle(await this.vehicles.findById(user.companyId, id));
  }

  @Post()
  @Roles(...FLEET_MANAGE_ROLES)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVehicleDto): Promise<VehicleView> {
    return presentVehicle(await this.vehicles.create(user, dto));
  }

  @Patch(':id')
  @Roles(...FLEET_MANAGE_ROLES)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateVehicleDto,
  ): Promise<VehicleView> {
    return presentVehicle(await this.vehicles.update(user, id, dto));
  }

  @Patch(':id/status')
  @Roles(...FLEET_MANAGE_ROLES)
  async setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body() dto: SetVehicleStatusDto,
  ): Promise<VehicleView> {
    return presentVehicle(await this.vehicles.setStatus(user, id, dto));
  }

  /** Loan terms for a financed vehicle. Accounting may maintain these as well as admins. */
  @Put(':id/financing')
  @Roles(...FINANCE_MANAGE_ROLES)
  async upsertFinancing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body() dto: UpsertFinancingDto,
  ): Promise<VehicleView> {
    return presentVehicle(await this.vehicles.upsertFinancing(user, id, dto));
  }
}
