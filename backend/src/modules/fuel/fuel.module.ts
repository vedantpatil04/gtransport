import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { FilesModule } from '../files/files.module';
import { FuelController } from './fuel.controller';
import { FuelService } from './fuel.service';

/** Petrol/diesel fill-ups: driver submission, office review, financial-year statements. */
@Module({
  imports: [FinanceModule, FilesModule],
  controllers: [FuelController],
  providers: [FuelService],
  exports: [FuelService],
})
export class FuelModule {}
