import type { OcrConfig } from './ocr/ocr-engine';
import type { AIProviderName } from './types';

/**
 * Resolved AI configuration. Values are read and validated centrally by the API's env
 * schema (src/config/env.schema.ts) and exposed via AppConfigService.ai.
 */
export interface AIConfig {
  provider: AIProviderName;
  requestTimeoutMs: number;
  ollama: {
    baseUrl: string;
    model: string;
  };
  dify: {
    baseUrl: string;
    apiKey: string;
    appId: string;
  };
  /** Whether this process drains the receipt queue. */
  workerEnabled: boolean;
  workerPollSeconds: number;
  workerBatchSize: number;
  /** Automatic attempts before a receipt is left for a person. */
  maxAttempts: number;
  /** Below this, an extraction is routed for review rather than offered as ready suggestions. */
  lowConfidenceThreshold: number;
  /** Local OCR run before the model on photographs and scanned PDFs. */
  ocr: OcrConfig;
}
