import { Inject, Injectable } from '@nestjs/common';
import { AI_PROVIDER } from './ai.tokens';
import { ServiceReceiptExtractionSchema } from './schema';
import { AIProviderError } from './provider';
import { parseJsonObject } from './json';
import type { AIProvider } from './provider';
import type { ProcessServiceReceiptInput, ServiceReceiptProcessingResult } from './types';

@Injectable()
export class ReceiptAIService {
  constructor(@Inject(AI_PROVIDER) private readonly provider: AIProvider) {}

  /**
   * The business/application layer calls this method only.
   * It never knows whether Ollama, Dify, or another provider is active.
   */
  async processServiceReceipt(input: ProcessServiceReceiptInput): Promise<ServiceReceiptProcessingResult> {
    try {
      const rawOutput = await this.provider.processServiceReceipt(input);
      const parsed = parseJsonObject(rawOutput);
      const extraction = ServiceReceiptExtractionSchema.safeParse(parsed);

      if (!extraction.success) {
        return {
          ok: false,
          provider: this.provider.name,
          failure: {
            code: 'INVALID_AI_OUTPUT',
            message: 'AI returned data that did not match the service receipt schema.',
            retryable: true,
          },
        };
      }

      return {
        ok: true,
        provider: this.provider.name,
        extraction: extraction.data,
      };
    } catch (error) {
      if (error instanceof AIProviderError) {
        return {
          ok: false,
          provider: this.provider.name,
          failure: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
        };
      }

      return {
        ok: false,
        provider: this.provider.name,
        failure: {
          code: 'UNKNOWN',
          message: 'AI extraction failed unexpectedly. The original receipt remains available for manual entry.',
          retryable: true,
        },
      };
    }
  }
}
