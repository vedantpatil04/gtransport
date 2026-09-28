import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { FINANCE_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import { PayInstalmentDto } from './dto/finance.dto';
import { VehicleFinanceService } from './vehicle-finance.service';

@Controller('vehicles/:vehicleId/financing/installments')
export class VehicleFinanceController {
  constructor(private readonly finance: VehicleFinanceService) {}

  @Get()
  @Roles(...OFFICE_ROLES)
  list(@CurrentUser() user: AuthenticatedUser, @Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.finance.list(user.companyId, vehicleId);
  }

  @Post('generate')
  @Roles(...FINANCE_MANAGE_ROLES)
  generate(@CurrentUser() user: AuthenticatedUser, @Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.finance.generate(user, vehicleId);
  }

  @Post(':number/pay')
  @Roles(...FINANCE_MANAGE_ROLES)
  pay(@CurrentUser() user: AuthenticatedUser, @Param('vehicleId', ParseUUIDPipe) vehicleId: string, @Param('number', ParseIntPipe) number: number, @Body() dto: PayInstalmentDto) {
    return this.finance.markPaid(user, vehicleId, number, dto);
  }
}
