import { Logger, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { AuditModule } from '../../common/audit/audit.module';
import { FilesModule } from '../files/files.module';
import { AI_PROVIDER, DOCUMENT_PREPARER } from './ai.tokens';
import { createAIProvider } from './factory';
import type { AIProvider } from './provider';
import { ReceiptAIService } from './receipt-ai.service';
import { ImageOnlyDocumentPreparer, PopplerDocumentPreparer } from './preprocessing/poppler.preparer';
import type { DocumentPreparer } from './preprocessing/document-preparation';
import { MaintenanceIntelligenceService } from './receipts/maintenance-intelligence.service';
import { ReceiptDispatcherService } from './receipts/receipt-dispatcher.service';
import { ReceiptJobService } from './receipts/receipt-job.service';
import { ReceiptReviewService } from './receipts/receipt-review.service';
import { ReceiptWorkerService } from './receipts/receipt-worker.service';
import { ServiceReceiptsController } from './receipts/receipts.controller';

/**
 * Receipt AI.
 *
 * The module's job is to bind one provider and one document preparer behind their tokens, and to
 * expose the queue, the worker and the review boundary. Nothing outside this module imports a
 * concrete provider, which is what keeps `AI_PROVIDER=dify` a configuration change (§9).
 */
@Module({
  imports: [FilesModule, AuditModule],
  controllers: [ServiceReceiptsController],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): AIProvider => {
        const provider = createAIProvider(config.ai);
        // Logged at boot so the running configuration is never a matter of guesswork. The model
        // name is not a secret; the Dify key and the Ollama URL are never logged.
        new Logger('AiModule').log(`Receipt AI provider: ${provider.name} (model: ${provider.model})`);
        return provider;
      },
    },
    {
      provide: DOCUMENT_PREPARER,
      useFactory: async (): Promise<DocumentPreparer> => {
        // Bound to what this server can actually do. A deployment without poppler-utils gets the
        // image-only preparer, which refuses PDFs with a clear reason rather than failing
        // obscurely inside a provider — and the office is told, at boot, in one line.
        const poppler = new PopplerDocumentPreparer();
        if (await poppler.isAvailable()) {
          new Logger('AiModule').log('Receipt preparation: poppler (photographs and PDFs).');
          return poppler;
        }
        new Logger('AiModule').warn('Receipt preparation: photographs only — install poppler-utils to process PDF receipts.');
        return new ImageOnlyDocumentPreparer();
      },
    },
    ReceiptAIService,
    ReceiptJobService,
    ReceiptWorkerService,
    ReceiptDispatcherService,
    ReceiptReviewService,
    MaintenanceIntelligenceService,
  ],
  // AI_PROVIDER is exported because the Inbox classifies mail with the same configured provider.
  // Without it the Inbox's optional injection resolves to null and classification silently never
  // runs — which is exactly the kind of quiet nothing §39 forbids.
  exports: [
    AI_PROVIDER,
    ReceiptAIService,
    ReceiptJobService,
    ReceiptWorkerService,
    ReceiptDispatcherService,
    MaintenanceIntelligenceService,
  ],
})
export class AiModule {}
