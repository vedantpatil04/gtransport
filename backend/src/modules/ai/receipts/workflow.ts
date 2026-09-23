import type { ProcessServiceReceiptInput } from '../types';
import type { ServiceReceiptAIStatus } from './ai-status';

export interface StoredReceipt {
  id: string;
  filename: string;
  mimeType: string;
  storageKey: string;
}

export interface ServiceReceiptRepository {
  create(input: {
    vehicleId: string;
    driverId?: string | null;
    receipt: StoredReceipt;
    aiStatus: ServiceReceiptAIStatus;
  }): Promise<{ id: string }>;
  setAIStatus(id: string, status: ServiceReceiptAIStatus, details?: { error?: string | null }): Promise<void>;
  saveExtraction(id: string, extraction: unknown): Promise<void>;
}

export interface ReceiptFileStore {
  storeOriginal(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<StoredReceipt>;
  readOriginal(receipt: StoredReceipt): Promise<ProcessServiceReceiptInput['receipt']>;
}

export interface ReceiptAIJobQueue {
  enqueue(job: { serviceReceiptId: string }): Promise<void>;
}

/**
 * Upload workflow: persist the original receipt first, create the service
 * record, mark it PENDING, and only then enqueue AI processing.
 */
export class ServiceReceiptUploadWorkflow {
  constructor(
    private readonly files: ReceiptFileStore,
    private readonly repository: ServiceReceiptRepository,
    private readonly queue: ReceiptAIJobQueue,
  ) {}

  async submit(input: { vehicleId: string; driverId?: string | null; receipt: ProcessServiceReceiptInput['receipt'] }): Promise<{ serviceReceiptId: string }> {
    const stored = await this.files.storeOriginal(input.receipt);
    const record = await this.repository.create({
      vehicleId: input.vehicleId,
      driverId: input.driverId,
      receipt: stored,
      aiStatus: 'PENDING',
    });

    await this.queue.enqueue({ serviceReceiptId: record.id });
    return { serviceReceiptId: record.id };
  }
}
