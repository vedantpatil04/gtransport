import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { Page } from '../../common/pagination/pagination';
import { AssignDriverDto, ListAssignmentsQuery, UnassignDriverDto } from './dto/assignment.dto';
import { presentAssignment, type AssignmentView } from './assignment.presenter';
import { AssignmentsService } from './assignments.service';

const uuid = () => new ParseUUIDPipe({ version: '7' });

@Controller()
@Roles(...OFFICE_ROLES)
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post('vehicles/:vehicleId/assignment')
  @Roles(...FLEET_MANAGE_ROLES)
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', uuid()) vehicleId: string,
    @Body() dto: AssignDriverDto,
  ): Promise<AssignmentView> {
    return presentAssignment(await this.assignments.assign(user, vehicleId, dto));
  }

  @Delete('vehicles/:vehicleId/assignment')
  @Roles(...FLEET_MANAGE_ROLES)
  async unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', uuid()) vehicleId: string,
    @Body() dto: UnassignDriverDto,
  ): Promise<AssignmentView> {
    return presentAssignment(await this.assignments.unassign(user, vehicleId, dto));
  }

  @Get('vehicles/:vehicleId/assignments')
  async vehicleHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', uuid()) vehicleId: string,
    @Query() query: ListAssignmentsQuery,
  ): Promise<Page<AssignmentView>> {
    const page = await this.assignments.historyForVehicle(user.companyId, vehicleId, query);
    return { ...page, data: page.data.map(presentAssignment) };
  }

  @Get('drivers/:driverId/assignments')
  async driverHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('driverId', uuid()) driverId: string,
    @Query() query: ListAssignmentsQuery,
  ): Promise<Page<AssignmentView>> {
    const page = await this.assignments.historyForDriver(user.companyId, driverId, query);
    return { ...page, data: page.data.map(presentAssignment) };
  }
}
