import type { ServiceReceiptAIStatus } from './ai-status';
import type { ReceiptAIJobQueue } from './workflow';

export interface RetryableReceiptRepository {
  getAIStatus(id: string): Promise<ServiceReceiptAIStatus>;
  setAIStatus(id: string, status: ServiceReceiptAIStatus): Promise<void>;
}

/** Explicit retry boundary: the same receipt is only re-enqueued after an admin/user requests retry. */
export class RetryServiceReceiptAI {
  constructor(
    private readonly repository: RetryableReceiptRepository,
    private readonly queue: ReceiptAIJobQueue,
  ) {}

  async retry(serviceReceiptId: string): Promise<void> {
    const status = await this.repository.getAIStatus(serviceReceiptId);
    if (status !== 'FAILED') return;

    await this.repository.setAIStatus(serviceReceiptId, 'PENDING');
    await this.queue.enqueue({ serviceReceiptId });
  }
}
