/**
 * Optical character recognition — the step between "a photo of a bill" and "text a model can
 * check its reading against".
 *
 *     prepare document → OCR (local) → AI structured extraction → schema validation → review
 *
 * OCR is deliberately local and deliberately separate from the AI provider. The text it produces
 * is a second, independent reading of the page: handed to the model beside the image, it catches
 * a digit the vision model misread, and it lets a text-only model work at all. It is never a
 * substitute for the original — the receipt is preserved untouched whatever OCR makes of it.
 *
 * Nothing here may invent text. An engine that is not installed reports itself unavailable; an
 * image it cannot read produces an error or an empty result, never a plausible-looking guess.
 */

/** How OCR is wired in a deployment (OCR_ENGINE). */
export type OcrMode =
  /** Use Tesseract when the server has it; otherwise the vision model reads images directly. */
  | 'auto'
  /** Tesseract must be present. A receipt that needs OCR fails, visibly, when it is not. */
  | 'tesseract'
  /** OCR is switched off. */
  | 'none';

export interface OcrResult {
  /** The recognised text, pages separated by blank lines. May be empty for a blank image. */
  text: string;
  /** Pages (images) that were read. */
  pages: number;
}

export class OcrError extends Error {
  constructor(
    message: string,
    /** False when retrying would change nothing (an image format the engine cannot read). */
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OcrError';
  }
}

export interface OcrEngine {
  readonly name: string;
  /** Whether the engine is installed and runnable in this deployment. Probed once. */
  isAvailable(): Promise<boolean>;
  /** Whether this image type can be read at all. HEIC, for one, cannot be read by Tesseract. */
  supports(mimeType: string): boolean;
  recognise(images: { bytes: Uint8Array; mimeType: string }[]): Promise<OcrResult>;
}

/** OCR configuration, resolved from the environment. */
export interface OcrConfig {
  mode: OcrMode;
  /** Tesseract language packs, e.g. "eng" or "eng+hin". */
  languages: string;
  /** Path or name of the tesseract binary. */
  binary: string;
  timeoutMs: number;
}
