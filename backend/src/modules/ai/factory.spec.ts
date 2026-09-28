import type { AIConfig } from './config';
import { createAIProvider } from './factory';

const config = (provider: 'ollama' | 'dify'): AIConfig => ({
  provider,
  requestTimeoutMs: 1000,
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma4' },
  dify: { baseUrl: 'https://api.dify.ai/v1', apiKey: 'key', appId: 'app' },
  workerEnabled: false,
  workerPollSeconds: 15,
  workerBatchSize: 3,
  maxAttempts: 3,
  lowConfidenceThreshold: 0.6,
});

describe('createAIProvider', () => {
  it('builds the configured provider without performing any I/O', () => {
    expect(createAIProvider(config('ollama')).name).toBe('ollama');
    expect(createAIProvider(config('dify')).name).toBe('dify');
  });

  it('reports the model each provider will run, for the audit record', () => {
    expect(createAIProvider(config('ollama')).model).toBe('gemma4');
    // Dify's model lives in the published workflow, so the app identifies the run instead.
    expect(createAIProvider(config('dify')).model).toContain('app');
  });

  it('honours a configuration change without any business code changing', () => {
    // The whole point of the abstraction: AI_PROVIDER=dify is a deployment decision.
    const ollama = createAIProvider(config('ollama'));
    const dify = createAIProvider(config('dify'));
    expect(ollama.name).not.toBe(dify.name);
    // Both satisfy the same contract, so nothing above the provider layer can tell them apart.
    expect(typeof ollama.processServiceReceipt).toBe('function');
    expect(typeof dify.processServiceReceipt).toBe('function');
  });
});
