import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { OFFICE_ROLES } from '../auth/roles';
import { ComplianceService } from './compliance.service';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /** Records expiry events for this company now. Normally run by the scheduled CLI instead. */
  @Post('expiry-events/scan')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  scan(@CurrentUser() user: AuthenticatedUser) {
    return this.compliance.scanExpiryEvents(undefined, user.companyId);
  }

  @Get('expiry-events')
  @Roles(...OFFICE_ROLES)
  events(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.compliance.undelivered(user.companyId, limit ? Number(limit) || 100 : 100);
  }
}
