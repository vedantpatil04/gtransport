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
}
