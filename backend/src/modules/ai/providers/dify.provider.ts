import { AIProviderError, type AIProvider, type TextCompletionInput } from '../provider';
import { SERVICE_RECEIPT_EXTRACTION_PROMPT } from '../prompt';
import type { ProcessServiceReceiptInput } from '../types';
import { parseJsonObject } from '../json';

interface DifyUploadResponse {
  id?: string;
}

interface DifyWorkflowResponse {
  data?: {
    status?: string;
    error?: string | null;
    outputs?: Record<string, unknown> | null;
  };
}

export interface DifyProviderOptions {
  baseUrl: string;
  apiKey: string;
  appId: string;
  timeoutMs: number;
}

/**
 * Dify-specific protocol handling stays inside this adapter. The rest of the
 * application only sees the common extraction contract after validation.
 *
 * Expected published Dify workflow inputs:
 * - receipt_file: file input
 * - extraction_instructions: text
 * - vehicle_context: text
 * - document_text: text (optional — a digital PDF's own text layer)
 * - ocr_text: text (optional — local OCR of a photo or scan)
 * The workflow should expose its final structured JSON in `outputs.result`.
 */
export class DifyProvider implements AIProvider {
  readonly name = 'dify' as const;

  /**
   * The model lives in the published Dify workflow, not in this application's configuration, so
   * the app id is what identifies the run. Recorded as such rather than guessed.
   */
  get model(): string {
    return `dify-workflow:${this.options.appId || 'default'}`;
  }

  constructor(private readonly options: DifyProviderOptions) {}

  async processServiceReceipt(input: ProcessServiceReceiptInput): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const user = `gangamata-service-receipt:${this.options.appId}:${input.context?.driverId ?? 'system'}`;
      const fileId = await this.uploadFile(input, user, controller.signal);

      const workflowResponse = await fetch(`${this.options.baseUrl}/workflows/run`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: {
            receipt_file: [
              {
                type: this.toDifyFileType(input.receipt.mimeType),
                transfer_method: 'local_file',
                upload_file_id: fileId,
              },
            ],
            extraction_instructions: SERVICE_RECEIPT_EXTRACTION_PROMPT,
            vehicle_context: JSON.stringify(input.context ?? {}),
            // Supplied for workflows that use it; a workflow that ignores the input is unaffected.
            document_text: input.sourceText?.slice(0, 24_000) ?? '',
            // Local OCR of a photograph or scan. A machine reading, offered as a cross-check.
            ocr_text: input.ocrText?.slice(0, 24_000) ?? '',
          },
          response_mode: 'blocking',
          user,
        }),
      });

      if (workflowResponse.status === 429) {
        throw new AIProviderError('Dify request was rate limited.', 'RATE_LIMITED', true);
      }
      if (!workflowResponse.ok) {
        throw new AIProviderError(`Dify workflow returned HTTP ${workflowResponse.status}.`, 'PROVIDER_BAD_RESPONSE', true);
      }

      const body = (await workflowResponse.json()) as DifyWorkflowResponse;
      if (body.data?.status && body.data.status !== 'succeeded') {
        throw new AIProviderError(body.data.error || 'Dify workflow did not succeed.', 'PROVIDER_BAD_RESPONSE', true);
      }

      const outputs = body.data?.outputs;
      if (!outputs) throw new AIProviderError('Dify workflow returned no outputs.', 'PROVIDER_BAD_RESPONSE', true);

      const result = outputs.result ?? outputs.extraction ?? outputs;
      return parseJsonObject(result);
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AIProviderError('Dify request timed out.', 'PROVIDER_TIMEOUT', true);
      }
      if (error instanceof TypeError) {
        throw new AIProviderError('Dify is unavailable.', 'PROVIDER_UNAVAILABLE', true);
      }
      throw new AIProviderError('Dify processing failed.', 'UNKNOWN', true, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * A text-only workflow run.
   *
   * Uses the same published workflow with no file input, so a deployment configures one Dify app
   * rather than two. A workflow that ignores `document_text` and `receipt_file` simply triages
   * the text it is given.
   */
  async processText(input: TextCompletionInput): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const user = `gangamata-email-triage:${this.options.appId}`;
      const response = await fetch(`${this.options.baseUrl}/workflows/run`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: { extraction_instructions: input.instructions, document_text: input.content, vehicle_context: '' },
          response_mode: 'blocking',
          user,
        }),
      });

      if (response.status === 429) throw new AIProviderError('Dify request was rate limited.', 'RATE_LIMITED', true);
      if (!response.ok) throw new AIProviderError(`Dify workflow returned HTTP ${response.status}.`, 'PROVIDER_BAD_RESPONSE', true);

      const body = (await response.json()) as DifyWorkflowResponse;
      if (body.data?.status && body.data.status !== 'succeeded') {
        throw new AIProviderError(body.data.error || 'Dify workflow did not succeed.', 'PROVIDER_BAD_RESPONSE', true);
      }
      const outputs = body.data?.outputs;
      if (!outputs) throw new AIProviderError('Dify workflow returned no outputs.', 'PROVIDER_BAD_RESPONSE', true);
      return parseJsonObject(outputs.result ?? outputs.extraction ?? outputs);
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AIProviderError('Dify request timed out.', 'PROVIDER_TIMEOUT', true);
      }
      if (error instanceof TypeError) throw new AIProviderError('Dify is unavailable.', 'PROVIDER_UNAVAILABLE', true);
      throw new AIProviderError('Dify processing failed.', 'UNKNOWN', true, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async uploadFile(input: ProcessServiceReceiptInput, user: string, signal: AbortSignal): Promise<string> {
    const form = new FormData();
    const bytes = input.receipt.bytes.slice();
    form.append('file', new Blob([bytes.buffer as ArrayBuffer], { type: input.receipt.mimeType }), input.receipt.filename);
    form.append('user', user);

    const response = await fetch(`${this.options.baseUrl}/files/upload`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      body: form,
    });

    if (response.status === 429) {
      throw new AIProviderError('Dify file upload was rate limited.', 'RATE_LIMITED', true);
    }
    if (!response.ok) {
      throw new AIProviderError(`Dify file upload returned HTTP ${response.status}.`, 'PROVIDER_BAD_RESPONSE', true);
    }

    const body = (await response.json()) as DifyUploadResponse;
    if (!body.id) throw new AIProviderError('Dify file upload returned no file id.', 'PROVIDER_BAD_RESPONSE', true);
    return body.id;
  }

  private toDifyFileType(mimeType: string): 'image' | 'document' {
    return mimeType.startsWith('image/') ? 'image' : 'document';
  }
}
