import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AI_PROVIDER, DOCUMENT_PREPARER, OCR_ENGINE } from './ai.tokens';
import { ServiceReceiptExtractionSchema } from './schema';
import { AIProviderError } from './provider';
import { parseJsonObject } from './json';
import { DocumentPreparationError, type DocumentPreparer, type PreparedDocument } from './preprocessing/document-preparation';
import { OcrError, type OcrEngine } from './ocr/ocr-engine';
import type { AIProvider } from './provider';
import type { AIProcessingFailure, ProcessServiceReceiptInput, ServiceReceiptProcessingResult } from './types';

/**
 * How OCR is bound in this process: the engine, and whether a receipt that needs OCR may proceed
 * without it. Null when OCR is switched off, or set to `auto` on a server without an engine.
 */
export interface OcrBinding {
  engine: OcrEngine;
  required: boolean;
}

/**
 * The one entry point the application has to receipt AI.
 *
 * It owns the whole pipeline and hides all of it:
 *
 *     prepare the document → OCR → call the provider → parse → validate against the shared schema
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
    @Optional() @Inject(OCR_ENGINE) private readonly ocr: OcrBinding | null = null,
  ) {}

  /** Which provider and model are configured, for the job record and for diagnostics. */
  describeProvider(): { provider: string; model: string; ocr: string } {
    return {
      provider: this.provider.name,
      model: this.provider.model,
      ocr: this.ocr ? `${this.ocr.engine.name}${this.ocr.required ? ' (required)' : ''}` : 'none',
    };
  }

  async processServiceReceipt(input: ProcessServiceReceiptInput): Promise<ServiceReceiptProcessingResult> {
    const startedAt = Date.now();
    let preparation: string | null = null;

    try {
      // 1. Prepare. A PDF becomes page images plus its own text; a photo is checked and passed on.
      const prepared = await this.preparer.prepare(input.receipt);
      preparation = prepared.kind;

      // 2. OCR, where the document has no text of its own. A digital PDF's text layer is exact
      //    and needs no second reading; a photograph or a scan gets one.
      const ocr = prepared.sourceText ? { text: null, warnings: [] as string[] } : await this.readText(prepared);
      if (ocr.text) preparation = `${prepared.kind}+ocr`;

      // 3. Call the provider. This is the only place a model is ever contacted for a receipt.
      const rawOutput = await this.provider.processServiceReceipt({
        ...input,
        receipt: prepared.document,
        sourceText: prepared.sourceText,
        ocrText: ocr.text,
      });

      // 4. Parse and validate. Raw output is never trusted: a response that does not match the
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
          // Preparation and OCR warnings belong with the model's own, so review sees everything
          // that was odd about this document in one list.
          warnings: [...prepared.warnings, ...ocr.warnings, ...extraction.data.warnings],
        },
        preparation,
        sourceTextChars: prepared.sourceTextChars || (ocr.text?.length ?? 0),
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

  /**
   * Runs local OCR over the prepared page images.
   *
   * With OCR optional (`auto`), anything that stops it — an unreadable format, an engine error —
   * becomes a warning and the vision model reads the image on its own. With OCR required, the
   * same conditions fail the job, because the deployment asked for a guarantee it cannot keep.
   * Either way the result is stated, never papered over.
   */
  private async readText(prepared: PreparedDocument): Promise<{ text: string | null; warnings: string[] }> {
    if (!this.ocr) return { text: null, warnings: [] };
    const { engine, required } = this.ocr;

    const images = this.ocrImages(prepared);
    if (images.length === 0) return { text: null, warnings: [] };

    if (!(await engine.isAvailable())) {
      if (!required) return { text: null, warnings: [] };
      throw new DocumentPreparationError(
        `OCR is required on this server, but the ${engine.name} engine is not installed. The original receipt is stored unchanged.`,
        'PREPROCESSING_FAILED',
        // A deployment fix: retrying is worthwhile once the engine is installed.
        true,
      );
    }

    const readable = images.filter((image) => engine.supports(image.mimeType));
    if (readable.length === 0) {
      const message = `OCR cannot read ${images[0]!.mimeType} images; the model read the photo directly.`;
      if (required) throw new DocumentPreparationError(message, 'UNSUPPORTED_DOCUMENT', false);
      return { text: null, warnings: [message] };
    }

    try {
      const result = await engine.recognise(readable);
      const text = result.text.trim();
      if (!text) return { text: null, warnings: ['OCR found no readable text on the receipt image.'] };
      return { text, warnings: [] };
    } catch (error) {
      const message = error instanceof OcrError ? error.message : 'OCR failed on this receipt.';
      if (required) {
        throw new DocumentPreparationError(message, 'PREPROCESSING_FAILED', error instanceof OcrError ? error.retryable : true, {
          cause: error,
        });
      }
      this.logger.warn(`OCR was skipped for a receipt: ${message}`);
      return { text: null, warnings: [`${message} The model read the image directly.`] };
    }
  }

  /** The images OCR should read: the photograph itself, or a scanned PDF's rendered pages. */
  private ocrImages(prepared: PreparedDocument): { bytes: Uint8Array; mimeType: string }[] {
    const document = prepared.document;
    if (document.mimeType.startsWith('image/')) return [{ bytes: document.bytes, mimeType: document.mimeType }];
    return (document.renderedImages ?? []).map((bytes) => ({ bytes, mimeType: 'image/png' }));
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
