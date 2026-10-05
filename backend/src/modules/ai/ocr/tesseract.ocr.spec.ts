import { OcrError } from './ocr-engine';
import { TesseractOcrEngine } from './tesseract.ocr';

/**
 * The OCR engine is a host binary, so these tests replace the process call — what is checked is
 * everything around it: what is asked of Tesseract, what is refused before it is asked, and how
 * each way it can fail is reported. Nothing here produces text the engine did not.
 */

const PNG = { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' };

function engineWith(exec: jest.Mock) {
  return new TesseractOcrEngine({ binary: 'tesseract', languages: 'eng+hin', timeoutMs: 5_000, exec });
}

describe('TesseractOcrEngine', () => {
  it('reads each page with the configured languages and receipt-friendly segmentation', async () => {
    const exec = jest.fn().mockResolvedValue({ stdout: 'SHARMA AUTO WORKS\nTOTAL 2596.00\n\f' });
    const result = await engineWith(exec).recognise([PNG, PNG]);

    expect(exec).toHaveBeenCalledTimes(2);
    const [binary, args] = exec.mock.calls[0] as [string, string[]];
    expect(binary).toBe('tesseract');
    expect(args).toEqual(expect.arrayContaining(['stdout', '-l', 'eng+hin', '--psm', '4']));
    expect(result.pages).toBe(2);
    expect(result.text).toContain('TOTAL 2596.00');
  });

  it('refuses a format it cannot read before running anything', async () => {
    const exec = jest.fn();
    await expect(engineWith(exec).recognise([{ bytes: new Uint8Array([1]), mimeType: 'image/heic' }])).rejects.toBeInstanceOf(OcrError);
    expect(exec).not.toHaveBeenCalled();
  });

  it('reports a missing language pack by name', async () => {
    const exec = jest.fn().mockRejectedValue(Object.assign(new Error('failed'), { stderr: 'Error opening data file hin.traineddata\nFailed loading language' }));
    await expect(engineWith(exec).recognise([PNG])).rejects.toThrow('language pack "eng+hin"');
  });

  it('reports a timeout as retryable', async () => {
    const exec = jest.fn().mockRejectedValue(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }));
    await expect(engineWith(exec).recognise([PNG])).rejects.toMatchObject({ retryable: true, message: expect.stringContaining('too long') });
  });

  it('says it is unavailable when the binary is not installed, and asks only once', async () => {
    const exec = jest.fn().mockRejectedValue(Object.assign(new Error('spawn tesseract ENOENT'), { code: 'ENOENT' }));
    const engine = engineWith(exec);
    expect(await engine.isAvailable()).toBe(false);
    expect(await engine.isAvailable()).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('returns nothing for nothing', async () => {
    const exec = jest.fn();
    expect(await engineWith(exec).recognise([])).toEqual({ text: '', pages: 0 });
    expect(exec).not.toHaveBeenCalled();
  });
});
