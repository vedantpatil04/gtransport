import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import {
  classifyDocumentKind, DocumentPreparationError, MAX_PDF_PAGES, MIN_USEFUL_TEXT_CHARS,
  SUPPORTED_IMAGE_TYPES, type DocumentPreparationKind, type DocumentPreparer, type PreparedDocument,
} from './document-preparation';
import type { ServiceReceiptDocument } from '../types';

const run = promisify(execFile);

/**
 * Document preparation using Poppler (`pdftotext`, `pdftoppm`).
 *
 * Poppler was chosen over a bundled JavaScript PDF library for two reasons. It is the same
 * renderer the rest of the Linux world uses, so a PDF that opens in any viewer renders here; and
 * it keeps a heavy native dependency out of `package.json`, where it would have to build on every
 * deploy. The cost is a deployment prerequisite — `poppler-utils` must be installed — which is why
 * `isAvailable()` exists and why its absence produces an explicit, visible failure rather than a
 * quietly degraded result.
 *
 * Nothing here ever modifies the uploaded file. Every conversion happens in a temporary directory
 * that is removed afterwards, whatever the outcome.
 */
@Injectable()
export class PopplerDocumentPreparer implements DocumentPreparer {
  readonly name = 'poppler';
  private readonly logger = new Logger(PopplerDocumentPreparer.name);
  private availability: Promise<boolean> | null = null;

  /** Milliseconds a conversion may take before it is abandoned. A receipt is small; this is generous. */
  private static readonly CONVERSION_TIMEOUT_MS = 30_000;
  /** Rendering resolution. 200 dpi keeps small print legible without producing enormous images. */
  private static readonly RASTER_DPI = 200;

  async isAvailable(): Promise<boolean> {
    // Probed once per process: the answer cannot change while the container is running.
    this.availability ??= this.probe();
    return this.availability;
  }

  private async probe(): Promise<boolean> {
    try {
      await run('pdftoppm', ['-v'], { timeout: 5_000 });
      return true;
    } catch {
      this.logger.warn(
        'poppler-utils is not installed, so PDF receipts cannot be prepared for extraction. ' +
          'Photographs are unaffected. Install poppler-utils to enable PDF receipts.',
      );
      return false;
    }
  }

  async prepare(document: ServiceReceiptDocument): Promise<PreparedDocument> {
    const kind = classifyDocumentKind(document.mimeType);

    if (kind === 'image') return this.prepareImage(document);
    if (kind === 'pdf') return this.preparePdf(document);

    throw new DocumentPreparationError(
      `A ${document.mimeType} file cannot be read as a service receipt. Upload a photo or a PDF.`,
      'UNSUPPORTED_DOCUMENT',
      // Retrying will not change the file's type.
      false,
    );
  }

  private prepareImage(document: ServiceReceiptDocument): PreparedDocument {
    if (!SUPPORTED_IMAGE_TYPES.has(document.mimeType)) {
      throw new DocumentPreparationError(
        `${document.mimeType} images cannot be read. Upload a JPEG, PNG or WebP photo.`,
        'UNSUPPORTED_DOCUMENT',
        false,
      );
    }
    if (document.bytes.byteLength === 0) {
      throw new DocumentPreparationError('The receipt file is empty.', 'UNSUPPORTED_DOCUMENT', false);
    }

    // A photograph carries no machine-readable text; the model reads the picture.
    return {
      document: { ...document, kind: 'image' },
      kind: 'image',
      sourceText: null,
      sourceTextChars: 0,
      warnings: [],
    };
  }

  /**
   * A PDF is mined for its own text first, then rendered.
   *
   * Both are supplied when available: the text is what the extraction should trust, and the page
   * image lets a vision model resolve layout the flat text loses — which column a figure sat in,
   * whether a number was the line total or the invoice total.
   */
  private async preparePdf(document: ServiceReceiptDocument): Promise<PreparedDocument> {
    if (!(await this.isAvailable())) {
      throw new DocumentPreparationError(
        'PDF receipts cannot be processed on this server because poppler-utils is not installed. ' +
          'The original receipt is stored and can be read and entered by hand.',
        'PREPROCESSING_FAILED',
        // A deployment fix, not a transient one: retrying immediately is pointless, but the job is
        // worth retrying once the dependency is installed.
        true,
      );
    }

    const workspace = await mkdtemp(path.join(tmpdir(), 'gangamata-receipt-'));
    const source = path.join(workspace, 'receipt.pdf');
    const warnings: string[] = [];

    try {
      await writeFile(source, document.bytes);

      const sourceText = await this.extractText(source);
      const hasUsefulText = sourceText !== null && sourceText.length >= MIN_USEFUL_TEXT_CHARS;
      const renderedImages = await this.renderPages(source, workspace, warnings);

      if (!hasUsefulText && renderedImages.length === 0) {
        throw new DocumentPreparationError(
          'The PDF contained no readable text and could not be rendered. The original is stored for manual entry.',
          'PREPROCESSING_FAILED',
          true,
        );
      }

      const kind: DocumentPreparationKind =
        hasUsefulText && renderedImages.length ? 'pdf:text+raster' : hasUsefulText ? 'pdf:text' : 'pdf:raster';

      if (!hasUsefulText) {
        warnings.push('The PDF appears to be a scan: its text was read from the page image rather than the file.');
      }

      return {
        document: { ...document, kind: 'pdf', renderedImages },
        kind,
        sourceText: hasUsefulText ? sourceText : null,
        sourceTextChars: sourceText?.length ?? 0,
        warnings,
      };
    } catch (error) {
      if (error instanceof DocumentPreparationError) throw error;
      throw new DocumentPreparationError(
        'The receipt could not be prepared for reading. The original is stored and unchanged.',
        'PREPROCESSING_FAILED',
        true,
        { cause: error },
      );
    } finally {
      // The temporary copy goes whatever happened. The stored original is never touched.
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Pulls the PDF's own text layer. Returns null when there is none — a scan, or an image-only file. */
  private async extractText(source: string): Promise<string | null> {
    try {
      const { stdout } = await run(
        'pdftotext',
        ['-layout', '-f', '1', '-l', String(MAX_PDF_PAGES), '-enc', 'UTF-8', source, '-'],
        { timeout: PopplerDocumentPreparer.CONVERSION_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      );
      const text = stdout.replace(/\f/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
      return text.length ? text : null;
    } catch {
      // No text layer is a normal outcome, not an error: the page image path handles it.
      return null;
    }
  }

  /** Renders the first pages to PNG for a vision model. */
  private async renderPages(source: string, workspace: string, warnings: string[]): Promise<Uint8Array[]> {
    const prefix = path.join(workspace, 'page');
    try {
      await run(
        'pdftoppm',
        ['-png', '-r', String(PopplerDocumentPreparer.RASTER_DPI), '-f', '1', '-l', String(MAX_PDF_PAGES), source, prefix],
        { timeout: PopplerDocumentPreparer.CONVERSION_TIMEOUT_MS },
      );
    } catch (error) {
      this.logger.warn(`Rendering the receipt PDF failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return [];
    }

    const files = (await readdir(workspace)).filter((f) => f.startsWith('page') && f.endsWith('.png')).sort();
    if (files.length === MAX_PDF_PAGES) {
      warnings.push(`Only the first ${MAX_PDF_PAGES} pages were read.`);
    }
    return Promise.all(files.map((file) => readFile(path.join(workspace, file)).then((buffer) => new Uint8Array(buffer))));
  }
}

/**
 * Used where PDFs genuinely cannot be handled: images pass through, and anything else is refused
 * with an explicit reason rather than pretending. Wired in only when Poppler is unavailable.
 */
@Injectable()
export class ImageOnlyDocumentPreparer implements DocumentPreparer {
  readonly name = 'image-only';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async prepare(document: ServiceReceiptDocument): Promise<PreparedDocument> {
    if (classifyDocumentKind(document.mimeType) !== 'image' || !SUPPORTED_IMAGE_TYPES.has(document.mimeType)) {
      throw new DocumentPreparationError(
        'Only photographs can be read on this server. The original receipt is stored and can be entered by hand.',
        'UNSUPPORTED_DOCUMENT',
        false,
      );
    }
    return { document: { ...document, kind: 'image' }, kind: 'image', sourceText: null, sourceTextChars: 0, warnings: [] };
  }
}
