import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { LedgerService } from './ledger.service';
import { PayrollService } from './payroll.service';
import { VehicleFinanceController } from './vehicle-finance.controller';
import { VehicleFinanceService } from './vehicle-finance.service';

/**
 * Finance: what is owed and recorded — the ledger, salaries, advances and vehicle EMIs.
 * Moving money belongs to the payments module; the two are separate so a failed payout never
 * rewrites financial history.
 */
@Module({
  controllers: [FinanceController, VehicleFinanceController],
  providers: [LedgerService, PayrollService, VehicleFinanceService],
  exports: [LedgerService],
})
export class FinanceModule {}
