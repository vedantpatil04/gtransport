import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Page } from '../../common/pagination/pagination';
import { requireDriverScope } from '../auth/access-scope';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import { ReportTrackingStateDto } from '../locations/dto/location.dto';
import { LocationsService } from '../locations/locations.service';
import { CreateDriverDto, ListDriversQuery, SetDriverStatusDto, UpdateDriverDto } from './dto/driver.dto';
import { presentDriver, type DriverView } from './driver.presenter';
import { DriversService } from './drivers.service';

const uuid = () => new ParseUUIDPipe({ version: '7' });

@Controller('drivers')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly locations: LocationsService,
  ) {}

  /**
   * A driver's own record. The driver id comes from the authenticated session, never from
   * the request, so one driver can never read another's data.
   */
  @Get('me')
  @Roles(UserRole.DRIVER)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<DriverView> {
    const { driverId } = requireDriverScope(user);
    return presentDriver(await this.drivers.findById(user.companyId, driverId), user.role);
  }

  /**
   * The driver app reports what its own tracking is doing here — permissions, the device location
   * toggle, the background task, and any fixes still waiting to upload. Scoped to the caller's own
   * record; positions themselves go to POST /locations, never to this route.
   *
   * Phase 6 extended this endpoint rather than adding a second one: the existing fields keep their
   * meaning, so a driver app build that predates tracking still works unchanged.
   */
  @Patch('me/location-state')
  @Roles(UserRole.DRIVER)
  async reportLocationState(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReportTrackingStateDto) {
    requireDriverScope(user);
    return this.locations.reportTrackingState(user, dto);
  }

  @Get()
  @Roles(...OFFICE_ROLES)
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDriversQuery): Promise<Page<DriverView>> {
    const page = await this.drivers.list(user.companyId, query);
    return { ...page, data: page.data.map((driver) => presentDriver(driver, user.role)) };
  }

  @Get(':id')
  @Roles(...OFFICE_ROLES)
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string): Promise<DriverView> {
    return presentDriver(await this.drivers.findById(user.companyId, id), user.role);
  }

  /** Document counts for the driver profile screen. */
  @Get(':id/documents/summary')
  @Roles(...OFFICE_ROLES)
  documentSummary(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.drivers.documentSummary(user.companyId, id);
  }

  @Post()
  @Roles(...FLEET_MANAGE_ROLES)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDriverDto): Promise<DriverView & { temporaryPassword?: string }> {
    const { temporaryPassword, ...driver } = await this.drivers.create(user, dto);
    // Shown once to the administrator who created the login; never retrievable again.
    return { ...presentDriver(driver, user.role), ...(temporaryPassword ? { temporaryPassword } : {}) };
  }

  @Patch(':id')
  @Roles(...FLEET_MANAGE_ROLES)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateDriverDto,
  ): Promise<DriverView> {
    return presentDriver(await this.drivers.update(user, id, dto), user.role);
  }

  @Patch(':id/status')
  @Roles(...FLEET_MANAGE_ROLES)
  async setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body() dto: SetDriverStatusDto,
  ): Promise<DriverView> {
    return presentDriver(await this.drivers.setStatus(user, id, dto), user.role);
  }
}
