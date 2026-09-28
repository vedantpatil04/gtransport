import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ACCOUNT_ADMIN_ROLES } from './account-policy';
import { AccountsService, type AccountAccess, type AccountView } from './accounts.service';
import { AccountReasonDto, ChangeRoleDto, CreateAccountDto } from './dto/account.dto';

/**
 * Account access for an employee. Lives under the employee because the employee is the parent
 * concept; there is no separate "users" area. Administrators only — and the service further
 * limits admins to operational roles (see account-policy.ts).
 *
 * A temporary password is returned exactly once, on create and on reset. It is never stored
 * in clear and cannot be fetched again.
 */
@Controller('employees/:employeeId/account')
@Roles(...ACCOUNT_ADMIN_ROLES)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  access(@CurrentUser() actor: AuthenticatedUser, @Param('employeeId', ParseUUIDPipe) employeeId: string): Promise<AccountAccess> {
    return this.accounts.access(actor, employeeId);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: CreateAccountDto,
  ): Promise<{ account: AccountView; temporaryPassword: string }> {
    return this.accounts.create(actor, employeeId, dto);
  }

  @Patch('role')
  changeRole(@CurrentUser() actor: AuthenticatedUser, @Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: ChangeRoleDto): Promise<AccountView> {
    return this.accounts.changeRole(actor, employeeId, dto.role);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  activate(@CurrentUser() actor: AuthenticatedUser, @Param('employeeId', ParseUUIDPipe) employeeId: string): Promise<AccountView> {
    return this.accounts.activate(actor, employeeId);
  }

  @Post('suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentUser() actor: AuthenticatedUser, @Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: AccountReasonDto): Promise<AccountView> {
    return this.accounts.suspend(actor, employeeId, dto.reason);
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  disable(@CurrentUser() actor: AuthenticatedUser, @Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: AccountReasonDto): Promise<AccountView> {
    return this.accounts.disable(actor, employeeId, dto.reason);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@CurrentUser() actor: AuthenticatedUser, @Param('employeeId', ParseUUIDPipe) employeeId: string): Promise<{ account: AccountView; temporaryPassword: string }> {
    return this.accounts.resetPassword(actor, employeeId);
  }
}
