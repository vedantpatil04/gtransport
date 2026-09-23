import type { AIConfig } from './config';
import type { AIProvider } from './provider';
import { DifyProvider } from './providers/dify.provider';
import { OllamaProvider } from './providers/ollama.provider';

/** The only place that knows which concrete providers exist. Constructing a provider makes no network calls. */
export function createAIProvider(config: AIConfig): AIProvider {
  switch (config.provider) {
    case 'ollama':
      return new OllamaProvider({
        baseUrl: config.ollama.baseUrl,
        model: config.ollama.model,
        timeoutMs: config.requestTimeoutMs,
      });
    case 'dify':
      return new DifyProvider({
        baseUrl: config.dify.baseUrl,
        apiKey: config.dify.apiKey,
        appId: config.dify.appId,
        timeoutMs: config.requestTimeoutMs,
      });
  }
}
