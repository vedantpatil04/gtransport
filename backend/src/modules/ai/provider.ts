import type { ProcessServiceReceiptInput, AIProviderName } from './types';

export interface AIProvider {
  readonly name: AIProviderName;
  processServiceReceipt(input: ProcessServiceReceiptInput): Promise<unknown>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_BAD_RESPONSE' | 'UNSUPPORTED_DOCUMENT' | 'RATE_LIMITED' | 'UNKNOWN',
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AIProviderError';
  }
}
