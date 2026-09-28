import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_PROVIDER, DOCUMENT_PREPARER } from './ai.tokens';
import { ServiceReceiptExtractionSchema } from './schema';
import { AIProviderError } from './provider';
import { parseJsonObject } from './json';
import { DocumentPreparationError, type DocumentPreparer } from './preprocessing/document-preparation';
import type { AIProvider } from './provider';
import type { AIProcessingFailure, ProcessServiceReceiptInput, ServiceReceiptProcessingResult } from './types';

/**
 * The one entry point the application has to receipt AI.
 *
 * It owns the whole pipeline and hides all of it:
 *
 *     prepare the document → call the provider → parse → validate against the shared schema
 *
 * Callers never learn whether Ollama or Dify ran, and never see raw model output. Anything that
 * fails anywhere along the way comes back as a structured failure with a code — never as a thrown
 * exception the worker would have to interpret, and never as a partially-trusted result.
 *
 * The single most important property: **this method cannot return a successful result that did
 * not come from a real provider call.** There is no fallback path, no cached sample, no
 * development stub. If no provider answered, the answer is a failure with a reason (§36, §39).
 */
@Injectable()
export class ReceiptAIService {
  private readonly logger = new Logger(ReceiptAIService.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AIProvider,
    @Inject(DOCUMENT_PREPARER) private readonly preparer: DocumentPreparer,
  ) {}

  /** Which provider and model are configured, for the job record and for diagnostics. */
  describeProvider(): { provider: string; model: string } {
    return { provider: this.provider.name, model: this.provider.model };
  }

  async processServiceReceipt(input: ProcessServiceReceiptInput): Promise<ServiceReceiptProcessingResult> {
    const startedAt = Date.now();
    let preparation: string | null = null;

    try {
      // 1. Prepare. A PDF becomes page images plus its own text; a photo is checked and passed on.
      const prepared = await this.preparer.prepare(input.receipt);
      preparation = prepared.kind;

      // 2. Call the provider. This is the only place a model is ever contacted for a receipt.
      const rawOutput = await this.provider.processServiceReceipt({
        ...input,
        receipt: prepared.document,
        sourceText: prepared.sourceText,
      });

      // 3. Parse and validate. Raw output is never trusted: a response that does not match the
      //    shared contract is a failure, not a partial success to be salvaged.
      const parsed = parseJsonObject(rawOutput);
      const extraction = ServiceReceiptExtractionSchema.safeParse(parsed);

      if (!extraction.success) {
        // The issues say which fields were wrong; they never contain the receipt's contents.
        const fields = [...new Set(extraction.error.issues.map((issue) => issue.path.join('.') || '(root)'))].slice(0, 6);
        return {
          ok: false,
          provider: this.provider.name,
          model: this.provider.model,
          preparation,
          durationMs: Date.now() - startedAt,
          failure: {
            code: 'INVALID_AI_OUTPUT',
            message: `The model returned data that did not match the receipt contract (${fields.join(', ')}).`,
            retryable: true,
          },
        };
      }

      return {
        ok: true,
        provider: this.provider.name,
        model: this.provider.model,
        extraction: {
          ...extraction.data,
          // Preparation warnings belong with the model's own, so review sees everything that was
          // odd about this document in one list.
          warnings: [...prepared.warnings, ...extraction.data.warnings],
        },
        preparation: prepared.kind,
        sourceTextChars: prepared.sourceTextChars,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.provider.name,
        model: this.provider.model,
        preparation,
        durationMs: Date.now() - startedAt,
        failure: this.toFailure(error),
      };
    }
  }

  /** Every way this pipeline can fail, turned into one of the codes the job table stores. */
  private toFailure(error: unknown): AIProcessingFailure {
    if (error instanceof DocumentPreparationError) {
      return { code: error.code, message: error.message, retryable: error.retryable };
    }
    if (error instanceof AIProviderError) {
      return { code: error.code, message: error.message, retryable: error.retryable };
    }
    if (error instanceof Error && /JSON|empty response/i.test(error.message)) {
      return { code: 'INVALID_AI_OUTPUT', message: 'The model did not return usable JSON.', retryable: true };
    }

    // Deliberately vague to the caller and detailed only in the server log: an unexpected error
    // can carry anything, and the receipt's contents must not travel with it.
    this.logger.error('Receipt AI processing failed unexpectedly', error instanceof Error ? error.stack : String(error));
    return {
      code: 'UNKNOWN',
      message: 'Reading the receipt failed unexpectedly. The original is stored and can be entered by hand.',
      retryable: true,
    };
  }
}
