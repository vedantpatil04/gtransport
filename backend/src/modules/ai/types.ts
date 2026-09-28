import type { ServiceReceiptExtraction } from './schema';

export type AIProviderName = 'ollama' | 'dify';

export type ServiceReceiptDocumentKind = 'image' | 'pdf' | 'document';

export interface ServiceReceiptDocument {
  filename: string;
  mimeType: string;
  kind: ServiceReceiptDocumentKind;
  bytes: Uint8Array;
  /** Optional rasterized pages for document formats that the provider consumes as images. */
  renderedImages?: Uint8Array[];
}

export interface ServiceReceiptContext {
  vehicleNumber?: string | null;
  vehicleId?: string | null;
  driverId?: string | null;
}

export interface ProcessServiceReceiptInput {
  receipt: ServiceReceiptDocument;
  context?: ServiceReceiptContext;
  /**
   * Machine-readable text the document carried itself, found during preparation (a digital PDF
   * invoice has this; a photograph does not). Supplied to the provider as the authoritative
   * reading of the document, so the model interprets text it does not have to decipher.
   */
  sourceText?: string | null;
}

/** What a provider reports about the run it just performed. */
export interface AIProviderRunInfo {
  /** The model that actually served the request, as the provider names it. */
  model: string;
}

/** Mirrors the AIFailureCode enum in the Prisma schema, so every failure maps to a stored code. */
export type AIProcessingFailureCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_BAD_RESPONSE'
  | 'INVALID_AI_OUTPUT'
  | 'UNSUPPORTED_DOCUMENT'
  | 'CONFIGURATION_ERROR'
  | 'RATE_LIMITED'
  | 'FILE_UNAVAILABLE'
  | 'PREPROCESSING_FAILED'
  | 'UNKNOWN';

export interface AIProcessingFailure {
  code: AIProcessingFailureCode;
  message: string;
  retryable: boolean;
}

export type ServiceReceiptProcessingResult =
  | {
      ok: true;
      provider: AIProviderName;
      /** The model that produced this extraction, recorded so a later rerun is comparable. */
      model: string;
      extraction: ServiceReceiptExtraction;
      /** How the document was prepared, e.g. "image" or "pdf:text+raster". */
      preparation: string;
      /** Characters of text the document carried itself. */
      sourceTextChars: number;
      /** Wall-clock milliseconds the provider call took. */
      durationMs: number;
    }
  | {
      ok: false;
      provider: AIProviderName;
      model: string | null;
      failure: AIProcessingFailure;
      preparation: string | null;
      durationMs: number;
    };
