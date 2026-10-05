import { AIProviderError, type AIProvider, type TextCompletionInput } from '../provider';
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
  /** Ollama answers 200 with this field for a model that is not installed. */
  error?: string;
}

/**
 * Text handed to the model is capped. A service invoice is a page or two; anything far longer is
 * not a receipt, and sending it would push the real content out of the context window.
 */
const MAX_SOURCE_TEXT_CHARS = 24_000;

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export class OllamaProvider implements AIProvider {
  readonly name = 'ollama' as const;

  get model(): string {
    return this.options.model;
  }

  constructor(private readonly options: OllamaProviderOptions) {}

  async processServiceReceipt(input: ProcessServiceReceiptInput): Promise<unknown> {
    const images = input.receipt.mimeType.startsWith('image/')
      ? [input.receipt.bytes]
      : (input.receipt.renderedImages ?? []);
    const sourceText = input.sourceText?.trim() ?? '';
    const ocrText = input.ocrText?.trim() ?? '';

    // A digital PDF carries its own text, which is a better reading than any model would get off
    // a rendered page. When preparation found some, the request can proceed on text alone — so a
    // text-only model, or a server without a rasterizer, still handles e-invoices correctly.
    if (images.length === 0 && !sourceText && !ocrText) {
      throw new AIProviderError(
        'The receipt could not be supplied to the model as either page images or text.',
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
                input.context?.vehicleNumber
                  ? `Vehicle on file for this record: ${input.context.vehicleNumber}. Report what the receipt says, even if it differs.`
                  : 'Vehicle context: unavailable',
                ...(sourceText
                  ? [
                      'The document carried the following machine-readable text. Trust it over anything you read from the page image:',
                      '--- BEGIN DOCUMENT TEXT ---',
                      sourceText.slice(0, MAX_SOURCE_TEXT_CHARS),
                      '--- END DOCUMENT TEXT ---',
                    ]
                  : []),
                ...(ocrText
                  ? [
                      'Local OCR read the following text from the receipt image. It may contain recognition errors; where it disagrees with the image, trust the image and add a warning:',
                      '--- BEGIN OCR TEXT ---',
                      ocrText.slice(0, MAX_SOURCE_TEXT_CHARS),
                      '--- END OCR TEXT ---',
                    ]
                  : []),
              ].join('\n'),
              ...(images.length ? { images: images.map(bytesToBase64) } : {}),
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
      if (typeof payload.error === 'string' && payload.error) {
        // Ollama answers 200 with an error body when a model is not installed — the single most
        // likely misconfiguration on a fresh server, so it gets its own message.
        const missingModel = /not found|no such model|pull the model/i.test(payload.error);
        throw new AIProviderError(
          missingModel
            ? `The model "${this.options.model}" is not installed on the Ollama server. Run: ollama pull ${this.options.model}`
            : `Ollama reported: ${payload.error}`,
          // A missing model is a configuration problem, not a transient one: retrying changes
          // nothing until someone installs it, so it is not marked retryable.
          missingModel ? 'CONFIGURATION_ERROR' : 'PROVIDER_BAD_RESPONSE',
          !missingModel,
        );
      }
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

  /**
   * A text-only completion. Same transport, same error handling, no images.
   *
   * The content is passed as a user message and the instruction as the system message, so the
   * material being triaged is never able to pose as an instruction.
   */
  async processText(input: TextCompletionInput): Promise<unknown> {
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
            { role: 'system', content: input.instructions },
            { role: 'user', content: input.content.slice(0, MAX_SOURCE_TEXT_CHARS) },
          ],
        }),
      });

      if (response.status === 429) throw new AIProviderError('Ollama request was rate limited.', 'RATE_LIMITED', true);
      if (!response.ok) throw new AIProviderError(`Ollama returned HTTP ${response.status}.`, 'PROVIDER_BAD_RESPONSE', true);

      const payload = (await response.json()) as OllamaResponse;
      if (typeof payload.error === 'string' && payload.error) {
        const missingModel = /not found|no such model|pull the model/i.test(payload.error);
        throw new AIProviderError(
          missingModel
            ? `The model "${this.options.model}" is not installed on the Ollama server. Run: ollama pull ${this.options.model}`
            : `Ollama reported: ${payload.error}`,
          missingModel ? 'CONFIGURATION_ERROR' : 'PROVIDER_BAD_RESPONSE',
          !missingModel,
        );
      }

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
      if (error instanceof TypeError) throw new AIProviderError('Ollama is unavailable.', 'PROVIDER_UNAVAILABLE', true);
      throw new AIProviderError('Ollama processing failed.', 'UNKNOWN', true, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
