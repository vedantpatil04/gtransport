import { AIProviderError, type AIProvider } from '../provider';
import { SERVICE_RECEIPT_EXTRACTION_PROMPT } from '../prompt';
import type { ProcessServiceReceiptInput } from '../types';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

interface OllamaResponse {
  message?: {
    content?: unknown;
  };
}

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export class OllamaProvider implements AIProvider {
  readonly name = 'ollama' as const;

  constructor(private readonly options: OllamaProviderOptions) {}

  async processServiceReceipt(input: ProcessServiceReceiptInput): Promise<unknown> {
    const images = input.receipt.mimeType.startsWith('image/')
      ? [input.receipt.bytes]
      : input.receipt.renderedImages ?? [];

    if (images.length === 0) {
      throw new AIProviderError(
        'Ollama requires document pages to be supplied as rasterized images. PDF/document rendering remains an upstream storage/processing concern in the prototype phase.',
        'UNSUPPORTED_DOCUMENT',
        false,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(`${this.options.baseUrl}/api/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          format: 'json',
          messages: [
            { role: 'system', content: SERVICE_RECEIPT_EXTRACTION_PROMPT },
            {
              role: 'user',
              content: [
                'Extract the service receipt into the exact JSON contract described above.',
                input.context?.vehicleNumber ? `Vehicle context: ${input.context.vehicleNumber}` : 'Vehicle context: unavailable',
              ].join('\n'),
              images: images.map(bytesToBase64),
            },
          ],
        }),
      });

      if (response.status === 429) {
        throw new AIProviderError('Ollama request was rate limited.', 'RATE_LIMITED', true);
      }
      if (!response.ok) {
        throw new AIProviderError(`Ollama returned HTTP ${response.status}.`, 'PROVIDER_BAD_RESPONSE', true);
      }

      const payload = (await response.json()) as OllamaResponse;
      const content = payload.message?.content;
      if (typeof content !== 'string' && typeof content !== 'object') {
        throw new AIProviderError('Ollama returned no assistant content.', 'PROVIDER_BAD_RESPONSE', true);
      }
      return content;
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AIProviderError('Ollama request timed out.', 'PROVIDER_TIMEOUT', true);
      }
      if (error instanceof TypeError) {
        throw new AIProviderError('Ollama is unavailable.', 'PROVIDER_UNAVAILABLE', true);
      }
      throw new AIProviderError('Ollama processing failed.', 'UNKNOWN', true, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
