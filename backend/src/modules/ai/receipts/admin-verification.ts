import type { ServiceReceiptAIStatus } from './ai-status';
import type { ServiceReceiptExtraction } from '../schema';

export interface ServiceReceiptAdminRepository {
  updateExtraction(id: string, extraction: ServiceReceiptExtraction): Promise<void>;
  setStatus(id: string, status: ServiceReceiptAIStatus): Promise<void>;
}

/** AI is advisory. Only this human-verification boundary can make a record final. */
export class ServiceReceiptAdminVerification {
  constructor(private readonly repository: ServiceReceiptAdminRepository) {}

  async confirm(id: string, correctedExtraction: ServiceReceiptExtraction): Promise<void> {
    await this.repository.updateExtraction(id, correctedExtraction);
    await this.repository.setStatus(id, 'CONFIRMED');
  }
}
