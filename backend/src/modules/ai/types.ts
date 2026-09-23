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
}

export type AIProcessingFailureCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_BAD_RESPONSE'
  | 'INVALID_AI_OUTPUT'
  | 'UNSUPPORTED_DOCUMENT'
  | 'CONFIGURATION_ERROR'
  | 'RATE_LIMITED'
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
      extraction: ServiceReceiptExtraction;
    }
  | {
      ok: false;
      provider: AIProviderName;
      failure: AIProcessingFailure;
    };
