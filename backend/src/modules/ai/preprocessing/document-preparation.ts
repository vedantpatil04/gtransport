import type { ServiceReceiptDocument } from '../types';

/**
 * Preparing a receipt for extraction.
 *
 * This is the step the AI architecture places between the service and the provider:
 *
 *     ReceiptAIService → preprocessing → AIProvider → normalized extraction schema
 *
 * It exists because the two kinds of receipt a transport office actually receives need opposite
 * handling, and neither should be the provider's problem:
 *
 *  - **A photograph** of a paper bill from a roadside garage. There is no text in the file; the
 *    vision model has to read the picture. Preparation here means checking it is a usable image.
 *  - **A PDF** e-invoice from a service centre. These are usually *digital* — the text is in the
 *    file, exactly as printed, with no reading required. Pulling that text out and handing it to
 *    the model alongside the page image is both far more accurate than asking a vision model to
 *    read it back off a rendered page, and much cheaper. A scanned PDF has no such text, and
 *    falls back to the rendered page.
 *
 * Providers must not need to know any of this. `OllamaProvider` asks for rasterized pages and
 * gets them; `DifyProvider` uploads the original file. Both receive the extracted text when
 * there is any.
 */

/** How a document was made usable, recorded on the result so a poor extraction is explicable. */
export type DocumentPreparationKind =
  /** An image used as-is. */
  | 'image'
  /** A PDF that carried its own text layer — the most reliable case. */
  | 'pdf:text'
  /** A PDF with no usable text, rendered to page images for the vision model. */
  | 'pdf:raster'
  /** A PDF that yielded both. */
  | 'pdf:text+raster';

export interface PreparedDocument {
  document: ServiceReceiptDocument;
  kind: DocumentPreparationKind;
  /** Machine-readable text found in the document itself, before any model ran. */
  sourceText: string | null;
  /** How many characters that was. Zero for a photograph; thousands for a digital invoice. */
  sourceTextChars: number;
  /** Notes worth surfacing in review, e.g. that only the first pages were read. */
  warnings: string[];
}

export class DocumentPreparationError extends Error {
  constructor(
    message: string,
    readonly code: 'UNSUPPORTED_DOCUMENT' | 'PREPROCESSING_FAILED',
    /** False when retrying would change nothing — a file type we will never read. */
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DocumentPreparationError';
  }
}

/**
 * Turns a stored file into something a provider can work with.
 *
 * Implementations must never invent content. If a document cannot be prepared they throw, the job
 * records an explicit failure, and the original file stays exactly where it was — which is the
 * whole point of preparing a copy rather than modifying the upload.
 */
export interface DocumentPreparer {
  readonly name: string;
  prepare(document: ServiceReceiptDocument): Promise<PreparedDocument>;
  /** Whether this preparer can do anything useful in the current deployment. */
  isAvailable(): Promise<boolean>;
}

/** Image types a receipt photo may arrive as, matching what FilesService accepts. */
export const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/** Pages read from a multi-page PDF. A service invoice is one or two; a manual is not a receipt. */
export const MAX_PDF_PAGES = 3;

/**
 * Below this, a PDF's text layer is treated as absent rather than useful — a scanned page often
 * carries a few stray characters from a header or a stamp, which is not an invoice.
 */
export const MIN_USEFUL_TEXT_CHARS = 120;

export const classifyDocumentKind = (mimeType: string): ServiceReceiptDocument['kind'] => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'document';
};
