import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CreateEmployeeDto, ListEmployeesQuery, SetEmployeeStatusDto, UpdateEmployeeDto } from './dto/employee.dto';
import { presentEmployee, type EmployeeView } from './employee.presenter';
import { EmployeesService } from './employees.service';
import type { Page } from '../../common/pagination/pagination';

@Controller('employees')
@Roles(...OFFICE_ROLES)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListEmployeesQuery): Promise<Page<EmployeeView>> {
    const page = await this.employees.list(user.companyId, query);
    return { ...page, data: page.data.map((employee) => presentEmployee(employee, user.role)) };
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe({ version: '7' })) id: string): Promise<EmployeeView> {
    return presentEmployee(await this.employees.findById(user.companyId, id), user.role);
  }

  @Post()
  @Roles(...FLEET_MANAGE_ROLES)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmployeeDto): Promise<EmployeeView & { temporaryPassword?: string }> {
    const { temporaryPassword, ...employee } = await this.employees.create(user, dto);
    // Shown once to the administrator who created the login; never retrievable again.
    return { ...presentEmployee(employee, user.role), ...(temporaryPassword ? { temporaryPassword } : {}) };
  }

  @Patch(':id')
  @Roles(...FLEET_MANAGE_ROLES)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeView> {
    return presentEmployee(await this.employees.update(user, id, dto), user.role);
  }

  @Patch(':id/status')
  @Roles(...FLEET_MANAGE_ROLES)
  async setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() dto: SetEmployeeStatusDto,
  ): Promise<EmployeeView> {
    return presentEmployee(await this.employees.setStatus(user, id, dto), user.role);
  }
}
