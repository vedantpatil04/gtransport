import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import { OcrError, type OcrEngine, type OcrResult } from './ocr-engine';

const run = promisify(execFile);

/** Image types Leptonica (Tesseract's image library) reads. HEIC/HEIF are not among them. */
const READABLE_TYPES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/tiff', 'tif'],
]);

/**
 * OCR with the Tesseract command-line engine.
 *
 * The same choice as Poppler for PDFs: a widely deployed native tool on the host rather than a
 * heavy binding in `package.json`. The cost is a deployment prerequisite (`tesseract-ocr`, plus a
 * language pack for anything beyond English), which is why availability is probed and reported at
 * boot and why its absence is a stated condition rather than a quiet degradation.
 *
 * Images are written to a private temporary directory, read, and the directory is removed
 * whatever happens. The stored original is never touched — OCR works on a copy of the bytes.
 */
export class TesseractOcrEngine implements OcrEngine {
  readonly name = 'tesseract';
  private readonly logger = new Logger(TesseractOcrEngine.name);
  private availability: Promise<boolean> | null = null;

  constructor(
    private readonly options: {
      binary: string;
      languages: string;
      timeoutMs: number;
      /** Injected in tests; production uses the real child process. */
      exec?: (file: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
    },
  ) {}

  isAvailable(): Promise<boolean> {
    this.availability ??= this.probe();
    return this.availability;
  }

  supports(mimeType: string): boolean {
    return READABLE_TYPES.has(mimeType);
  }

  async recognise(images: { bytes: Uint8Array; mimeType: string }[]): Promise<OcrResult> {
    if (images.length === 0) return { text: '', pages: 0 };
    for (const image of images) {
      if (!this.supports(image.mimeType)) {
        throw new OcrError(`${image.mimeType} images cannot be read by the OCR engine.`, false);
      }
    }

    const workspace = await mkdtemp(path.join(tmpdir(), 'gangamata-ocr-'));
    try {
      const pages: string[] = [];
      for (const [index, image] of images.entries()) {
        const file = path.join(workspace, `page-${index + 1}.${READABLE_TYPES.get(image.mimeType)}`);
        await writeFile(file, image.bytes);
        pages.push(await this.readPage(file));
      }
      return { text: pages.map((page) => page.trim()).filter(Boolean).join('\n\n'), pages: images.length };
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async readPage(file: string): Promise<string> {
    try {
      // --psm 4: "a single column of text of variable sizes" — how a bill is laid out, and
      // markedly better on itemised receipts than the default full-page segmentation.
      const { stdout } = await this.exec(this.options.binary, [file, 'stdout', '-l', this.options.languages, '--psm', '4'], {
        timeout: this.options.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout.replace(/\f/g, '\n').replace(/[ \t]+\n/g, '\n');
    } catch (error) {
      const details = error as { killed?: boolean; signal?: string; stderr?: string };
      if (details?.killed || details?.signal === 'SIGTERM') {
        throw new OcrError('OCR took too long and was stopped.', true, { cause: error });
      }
      // A missing language pack is the likeliest failure on a new server, and worth naming.
      if (typeof details?.stderr === 'string' && /Failed loading language|Error opening data file/i.test(details.stderr)) {
        throw new OcrError(
          `The OCR language pack "${this.options.languages}" is not installed on this server.`,
          true,
          { cause: error },
        );
      }
      throw new OcrError('The OCR engine could not read this image.', true, { cause: error });
    }
  }

  private async probe(): Promise<boolean> {
    try {
      await this.exec(this.options.binary, ['--version'], { timeout: 5_000, maxBuffer: 1024 * 1024 });
      return true;
    } catch {
      this.logger.warn('Tesseract is not installed, so receipt photographs are read by the vision model without OCR.');
      return false;
    }
  }

  private exec(file: string, args: string[], options: { timeout: number; maxBuffer: number }): Promise<{ stdout: string }> {
    if (this.options.exec) return this.options.exec(file, args, options);
    return run(file, args, { ...options, encoding: 'utf8' });
  }
}
