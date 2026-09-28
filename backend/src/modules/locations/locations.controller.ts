import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import {
  AcknowledgeAlertDto, AlertsQuery, FleetQuery, LocationHistoryQuery, ResolveAlertDto, SubmitLocationsDto,
} from './dto/location.dto';
import { LocationsService } from './locations.service';

const uuid = () => new ParseUUIDPipe({ version: '7' });

/**
 * Fleet location.
 *
 * Two audiences, strictly separated by @Roles:
 *
 *  - A DRIVER may submit their own fixes and read their own history. Neither route takes a
 *    driver id, so there is nothing to tamper with: identity comes from the token.
 *  - The office reads the fleet, one driver's detail and history, and the alert list. No
 *    office route lets anyone write a position.
 *
 * A driver calling an office route is refused by RolesGuard before any handler runs, so fleet-wide
 * location history is never exposed to a driver.
 */
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  // ── Driver ──

  /**
   * Submits one or more fixes for the signed-in driver.
   *
   * Always 200, never 201: a batch usually mixes newly stored fixes with duplicates from a
   * retried upload, so "created" would be a half-truth. The body says what happened to each.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DRIVER)
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitLocationsDto) {
    return this.locations.ingest(user, dto);
  }

  /** How often, and how far apart, this device should report. Read at app start. */
  @Get('tracking-policy')
  @Roles(UserRole.DRIVER)
  trackingPolicy() {
    return this.locations.trackingPolicy();
  }

  /** The driver's own recent fixes — their own data, and nothing else. */
  @Get('mine')
  @Roles(UserRole.DRIVER)
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: LocationHistoryQuery) {
    return this.locations.myHistory(user, query);
  }

  // ── Office: live fleet ──

  /** Every driver's current location, plus a status breakdown and the polling interval. */
  @Get('fleet')
  @Roles(...OFFICE_ROLES)
  fleet(@CurrentUser() user: AuthenticatedUser, @Query() query: FleetQuery) {
    return this.locations.fleet(user.companyId, user.role, query);
  }

  @Get('alerts')
  @Roles(...OFFICE_ROLES)
  alerts(@CurrentUser() user: AuthenticatedUser, @Query() query: AlertsQuery) {
    return this.locations.alerts(user.companyId, user.role, query);
  }

  @Get('alerts/summary')
  @Roles(...OFFICE_ROLES)
  alertSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.locations.alertSummary(user.companyId);
  }

  @Get('alerts/:id')
  @Roles(...OFFICE_ROLES)
  alert(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.locations.findAlert(user.companyId, id, user.role);
  }

  /** Acknowledging is an operational decision, so it is limited to the roles that run the fleet. */
  @Post('alerts/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  acknowledge(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: AcknowledgeAlertDto) {
    return this.locations.acknowledgeAlert(user, id, dto);
  }

  @Post('alerts/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  resolve(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: ResolveAlertDto) {
    return this.locations.resolveAlert(user, id, dto);
  }

  // ── Office: one driver / one vehicle ──
  // Declared after the literal 'fleet', 'alerts' and 'mine' paths so none of those is ever
  // captured as an id.

  @Get('drivers/:driverId')
  @Roles(...OFFICE_ROLES)
  driver(@CurrentUser() user: AuthenticatedUser, @Param('driverId', uuid()) driverId: string) {
    return this.locations.driverLocation(user.companyId, driverId);
  }

  @Get('drivers/:driverId/history')
  @Roles(...OFFICE_ROLES)
  driverHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('driverId', uuid()) driverId: string,
    @Query() query: LocationHistoryQuery,
  ) {
    return this.locations.history(user.companyId, driverId, query);
  }

  @Get('vehicles/:vehicleId/history')
  @Roles(...OFFICE_ROLES)
  vehicleHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', uuid()) vehicleId: string,
    @Query() query: LocationHistoryQuery,
  ) {
    return this.locations.vehicleHistory(user.companyId, vehicleId, query);
  }
}
