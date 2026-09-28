import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { FilesModule } from '../files/files.module';
import { DocumentsModule } from '../documents/documents.module';
import { AiModule } from '../ai/ai.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

/**
 * Daily vehicle operations other than fuel: RTO, tyre and maintenance/service expenses, plus
 * tyre insurance policies.
 *
 * A maintenance record with a receipt attached queues AI reading of that receipt (see AiModule).
 * The queueing happens after the record is saved and never blocks the response.
 */
@Module({
  imports: [FinanceModule, FilesModule, DocumentsModule, AiModule],
  controllers: [OperationsController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class ExpensesModule {}
