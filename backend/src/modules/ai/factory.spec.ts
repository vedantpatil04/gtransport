import type { AIConfig } from './config';
import { createAIProvider } from './factory';

const config = (provider: 'ollama' | 'dify'): AIConfig => ({
  provider,
  requestTimeoutMs: 1000,
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma4' },
  dify: { baseUrl: 'https://api.dify.ai/v1', apiKey: 'key', appId: 'app' },
});

describe('createAIProvider', () => {
  it('builds the configured provider without performing any I/O', () => {
    expect(createAIProvider(config('ollama')).name).toBe('ollama');
    expect(createAIProvider(config('dify')).name).toBe('dify');
  });
});
