import { ReceiptAIService } from '../receipt-ai.service';
import type { ServiceReceiptContext, ServiceReceiptDocument } from '../types';
import type { ServiceReceiptRepository, ReceiptFileStore } from './workflow';

export interface ServiceReceiptAIJob {
  serviceReceiptId: string;
  receiptId: string;
  context?: ServiceReceiptContext;
}

export interface ServiceReceiptJobRepository extends ServiceReceiptRepository {
  getStoredReceipt(job: ServiceReceiptAIJob): Promise<{ id: string; filename: string; mimeType: string; storageKey: string }>;
}

/**
 * Background job handler. A production queue (BullMQ, SQS, Cloud Tasks, etc.)
 * can invoke this without changing ReceiptAIService or provider code.
 */
export class ServiceReceiptAIWorker {
  constructor(
    private readonly files: ReceiptFileStore,
    private readonly repository: ServiceReceiptJobRepository,
    private readonly ai: ReceiptAIService,
  ) {}

  async process(job: ServiceReceiptAIJob): Promise<void> {
    const stored = await this.repository.getStoredReceipt(job);
    if (!stored.storageKey) {
      await this.repository.setAIStatus(job.serviceReceiptId, 'FAILED', {
        error: 'Original receipt was not found in storage. No AI processing was attempted.',
      });
      return;
    }

    await this.repository.setAIStatus(job.serviceReceiptId, 'PROCESSING');

    try {
      const receipt: ServiceReceiptDocument = await this.files.readOriginal(stored);
      const result = await this.ai.processServiceReceipt({ receipt, context: job.context });

      if (!result.ok) {
        await this.repository.setAIStatus(job.serviceReceiptId, 'FAILED', {
          error: result.failure.message,
        });
        return;
      }

      await this.repository.saveExtraction(job.serviceReceiptId, result.extraction);
      await this.repository.setAIStatus(job.serviceReceiptId, 'COMPLETED');
      await this.repository.setAIStatus(job.serviceReceiptId, 'REVIEW_REQUIRED');
    } catch {
      await this.repository.setAIStatus(job.serviceReceiptId, 'FAILED', {
        error: 'Receipt AI processing failed unexpectedly. The original receipt remains safely stored.',
      });
    }
  }
}
