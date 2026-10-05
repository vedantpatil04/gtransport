import { AIProviderError, type AIProvider } from './provider';
import { ReceiptAIService } from './receipt-ai.service';
import type { ServiceReceiptExtraction } from './schema';
import type { ProcessServiceReceiptInput } from './types';
import { DocumentPreparationError, type DocumentPreparer, type PreparedDocument } from './preprocessing/document-preparation';
import { OcrError, type OcrEngine } from './ocr/ocr-engine';

/** A preparer that passes an image straight through — the common case, and the simplest. */
const passThroughPreparer: DocumentPreparer = {
  name: 'test-passthrough',
  isAvailable: async () => true,
  prepare: async (document): Promise<PreparedDocument> => ({
    document,
    kind: 'image',
    sourceText: null,
    sourceTextChars: 0,
    warnings: [],
  }),
};

const preparerThrowing = (error: unknown): DocumentPreparer => ({
  name: 'test-failing',
  isAvailable: async () => true,
  prepare: async () => {
    throw error;
  },
});

const VALID_EXTRACTION: ServiceReceiptExtraction = {
  vendorName: 'Sharma Auto Works',
  invoiceNumber: 'INV-114',
  invoiceDate: '2026-03-04',
  vehicleNumber: 'KA 22 AB 1234',
  serviceType: 'Brake service',
  odometerKm: 48_200,
  nextServiceDate: null,
  nextServiceKm: null,
  lineItems: [{ description: 'Brake pad', kind: 'PART', quantity: 2, unitPrice: 850, amount: 1700 }],
  partsAmount: 1700,
  labourAmount: 500,
  gstAmount: 396,
  otherCharges: null,
  subtotal: 2200,
  totalAmount: 2596,
  confidence: 0.82,
  rawText: 'Sharma Auto Works ...',
  warnings: [],
};

const INPUT: ProcessServiceReceiptInput = {
  receipt: { filename: 'receipt.jpg', mimeType: 'image/jpeg', kind: 'image', bytes: new Uint8Array([1, 2, 3]) },
};

function providerReturning(value: unknown): AIProvider {
  return {
    name: 'ollama',
    model: 'test-model',
    processServiceReceipt: jest.fn().mockResolvedValue(value),
    processText: jest.fn().mockResolvedValue(value),
  };
}

function providerThrowing(error: unknown): AIProvider {
  return {
    name: 'ollama',
    model: 'test-model',
    processServiceReceipt: jest.fn().mockRejectedValue(error),
    processText: jest.fn().mockRejectedValue(error),
  };
}

/** Builds the service under test with a preparer that does nothing interesting. */
const serviceWith = (provider: AIProvider, preparer: DocumentPreparer = passThroughPreparer) =>
  new ReceiptAIService(provider, preparer);

describe('ReceiptAIService', () => {
  it('returns a validated extraction on success', async () => {
    const result = await serviceWith(providerReturning(VALID_EXTRACTION)).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: true, provider: 'ollama' });
    if (result.ok) expect(result.extraction.totalAmount).toBe(2596);
  });

  it('parses JSON strings wrapped in markdown fences', async () => {
    const fenced = '```json\n' + JSON.stringify(VALID_EXTRACTION) + '\n```';
    const result = await serviceWith(providerReturning(fenced)).processServiceReceipt(INPUT);
    expect(result.ok).toBe(true);
  });

  it('coerces formatted rupee amounts to numbers', async () => {
    const result = await serviceWith(providerReturning({ ...VALID_EXTRACTION, totalAmount: '₹2,596.00' })).processServiceReceipt(INPUT);
    expect(result.ok && result.extraction.totalAmount).toBe(2596);
  });

  it('rejects output that does not match the schema', async () => {
    const result = await serviceWith(providerReturning({ ...VALID_EXTRACTION, confidence: 4 })).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: false, failure: { code: 'INVALID_AI_OUTPUT', retryable: true } });
  });

  it('rejects malformed JSON without throwing', async () => {
    const result = await serviceWith(providerReturning('not json at all')).processServiceReceipt(INPUT);
    expect(result.ok).toBe(false);
  });

  it('surfaces provider errors with their retryability intact', async () => {
    const result = await serviceWith(providerThrowing(new AIProviderError('Ollama is unavailable.', 'PROVIDER_UNAVAILABLE', true))).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: false, failure: { code: 'PROVIDER_UNAVAILABLE', retryable: true } });
  });

  it('marks an unsupported document as not retryable', async () => {
    const result = await serviceWith(providerThrowing(new AIProviderError('PDF rendering required.', 'UNSUPPORTED_DOCUMENT', false))).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: false, failure: { code: 'UNSUPPORTED_DOCUMENT', retryable: false } });
  });

  it('never throws on an unexpected error, so the original receipt stays usable', async () => {
    const result = await serviceWith(providerThrowing(new Error('boom'))).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: false, failure: { code: 'UNKNOWN', retryable: true } });
  });

  it('records the model and how the document was prepared, for the audit trail', async () => {
    const result = await serviceWith(providerReturning(VALID_EXTRACTION)).processServiceReceipt(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // A rerun against a different model has to be comparable with this one (§29).
      expect(result.model).toBe('test-model');
      expect(result.preparation).toBe('image');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('hands the document\'s own text to the provider when preparation found some', async () => {
    const provider = providerReturning(VALID_EXTRACTION);
    const withText: DocumentPreparer = {
      name: 'test-pdf',
      isAvailable: async () => true,
      prepare: async (document) => ({
        document,
        kind: 'pdf:text',
        sourceText: 'TAX INVOICE  Sharma Auto Works  Total 2596.00',
        sourceTextChars: 44,
        warnings: [],
      }),
    };

    const result = await new ReceiptAIService(provider, withText).processServiceReceipt(INPUT);

    // A digital invoice's own text is a better reading than any model gets off a rendered page.
    const call = (provider.processServiceReceipt as jest.Mock).mock.calls[0][0] as ProcessServiceReceiptInput;
    expect(call.sourceText).toContain('Sharma Auto Works');
    expect(result.ok && result.sourceTextChars).toBe(44);
  });

  it('carries preparation warnings through to review alongside the model\'s own', async () => {
    const truncating: DocumentPreparer = {
      name: 'test-truncating',
      isAvailable: async () => true,
      prepare: async (document) => ({
        document,
        kind: 'pdf:raster',
        sourceText: null,
        sourceTextChars: 0,
        warnings: ['Only the first 3 pages were read.'],
      }),
    };

    const result = await new ReceiptAIService(
      providerReturning({ ...VALID_EXTRACTION, warnings: ['Total was partly obscured.'] }),
      truncating,
    ).processServiceReceipt(INPUT);

    // Everything odd about this document appears in one list on the review screen.
    expect(result.ok && result.extraction.warnings).toEqual([
      'Only the first 3 pages were read.',
      'Total was partly obscured.',
    ]);
  });

  it('reports an unreadable file type as not retryable, because retrying cannot help', async () => {
    const result = await serviceWith(
      providerReturning(VALID_EXTRACTION),
      preparerThrowing(new DocumentPreparationError('A .docx cannot be read.', 'UNSUPPORTED_DOCUMENT', false)),
    ).processServiceReceipt(INPUT);

    expect(result).toMatchObject({ ok: false, failure: { code: 'UNSUPPORTED_DOCUMENT', retryable: false } });
  });

  it('reports a missing rasterizer as retryable, because installing it would fix the job', async () => {
    const result = await serviceWith(
      providerReturning(VALID_EXTRACTION),
      preparerThrowing(new DocumentPreparationError('poppler-utils is not installed.', 'PREPROCESSING_FAILED', true)),
    ).processServiceReceipt(INPUT);

    expect(result).toMatchObject({ ok: false, failure: { code: 'PREPROCESSING_FAILED', retryable: true } });
  });

  it('never contacts a provider for a document that could not be prepared', async () => {
    const provider = providerReturning(VALID_EXTRACTION);

    await new ReceiptAIService(
      provider,
      preparerThrowing(new DocumentPreparationError('unreadable', 'UNSUPPORTED_DOCUMENT', false)),
    ).processServiceReceipt(INPUT);

    // Calling a model with nothing to read would burn time and return noise.
    expect(provider.processServiceReceipt).not.toHaveBeenCalled();
  });

  it('names the failing fields when output does not match the contract, but not the contents', async () => {
    const result = await serviceWith(providerReturning({ ...VALID_EXTRACTION, confidence: 4 })).processServiceReceipt(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('confidence');
      // A failure message is shown to the office; the receipt's own text must not travel in it.
      expect(result.failure.message).not.toContain('Sharma Auto Works');
    }
  });

  it('exposes which provider and model are configured', () => {
    expect(serviceWith(providerReturning(VALID_EXTRACTION)).describeProvider()).toEqual({
      provider: 'ollama',
      model: 'test-model',
      ocr: 'none',
    });
  });

  it('reads an extraction stored before line items were typed', async () => {
    // Older results carried `parts: [{ name, ... }]`. They are still valid readings.
    const { lineItems: _omit, odometerKm: _o, nextServiceDate: _d, nextServiceKm: _k, ...legacy } = VALID_EXTRACTION;
    const result = await serviceWith(
      providerReturning({ ...legacy, parts: [{ name: 'Brake pad', quantity: 2, unitPrice: 850, amount: 1700 }] }),
    ).processServiceReceipt(INPUT);
    expect(result.ok && result.extraction.lineItems).toEqual([
      { description: 'Brake pad', kind: 'PART', quantity: 2, unitPrice: 850, amount: 1700 },
    ]);
    // Values the old shape never had are unknown, not zero.
    expect(result.ok && result.extraction.odometerKm).toBeNull();
  });

  it('reads printed kilometres without inventing any', async () => {
    const result = await serviceWith(providerReturning({ ...VALID_EXTRACTION, odometerKm: '48,200 km' })).processServiceReceipt(INPUT);
    expect(result.ok && result.extraction.odometerKm).toBe(48_200);

    const vague = await serviceWith(providerReturning({ ...VALID_EXTRACTION, odometerKm: 'about 48k' })).processServiceReceipt(INPUT);
    expect(vague).toMatchObject({ ok: false, failure: { code: 'INVALID_AI_OUTPUT' } });
  });
});

describe('ReceiptAIService — the OCR stage', () => {
  const engine = (overrides: Partial<OcrEngine> = {}): OcrEngine => ({
    name: 'tesseract',
    isAvailable: async () => true,
    supports: (mimeType) => mimeType !== 'image/heic',
    recognise: jest.fn().mockResolvedValue({ text: 'SHARMA AUTO WORKS\nTOTAL 2596.00', pages: 1 }),
    ...overrides,
  });

  it('runs OCR on a photograph and hands the text to the provider beside the image', async () => {
    const provider = providerReturning(VALID_EXTRACTION);
    const ocr = engine();
    const result = await new ReceiptAIService(provider, passThroughPreparer, { engine: ocr, required: false }).processServiceReceipt(INPUT);

    expect(ocr.recognise).toHaveBeenCalledWith([{ bytes: INPUT.receipt.bytes, mimeType: 'image/jpeg' }]);
    const call = (provider.processServiceReceipt as jest.Mock).mock.calls[0][0] as ProcessServiceReceiptInput;
    expect(call.ocrText).toContain('TOTAL 2596.00');
    // The original image still goes to the model: OCR is a cross-check, not a replacement.
    expect(call.receipt.bytes).toBe(INPUT.receipt.bytes);
    expect(result.ok && result.preparation).toBe('image+ocr');
  });

  it('skips OCR for a digital PDF that carried its own text', async () => {
    const ocr = engine();
    const withText: DocumentPreparer = {
      ...passThroughPreparer,
      prepare: async (document) => ({ document, kind: 'pdf:text', sourceText: 'TAX INVOICE ...', sourceTextChars: 15, warnings: [] }),
    };
    await new ReceiptAIService(providerReturning(VALID_EXTRACTION), withText, { engine: ocr, required: false }).processServiceReceipt(INPUT);
    expect(ocr.recognise).not.toHaveBeenCalled();
  });

  it('carries on without OCR when it is optional and fails, saying so in review', async () => {
    const ocr = engine({ recognise: jest.fn().mockRejectedValue(new OcrError('The OCR engine could not read this image.', true)) });
    const result = await new ReceiptAIService(providerReturning(VALID_EXTRACTION), passThroughPreparer, { engine: ocr, required: false })
      .processServiceReceipt(INPUT);
    expect(result.ok).toBe(true);
    expect(result.ok && result.preparation).toBe('image');
    expect(result.ok && result.extraction.warnings.join(' ')).toContain('OCR engine could not read');
  });

  it('fails visibly when OCR is required and the engine is missing', async () => {
    const provider = providerReturning(VALID_EXTRACTION);
    const result = await new ReceiptAIService(provider, passThroughPreparer, { engine: engine({ isAvailable: async () => false }), required: true })
      .processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: false, failure: { code: 'PREPROCESSING_FAILED', retryable: true } });
    expect(provider.processServiceReceipt).not.toHaveBeenCalled();
  });

  it('never presents an empty OCR result as text', async () => {
    const provider = providerReturning(VALID_EXTRACTION);
    const result = await new ReceiptAIService(provider, passThroughPreparer, {
      engine: engine({ recognise: jest.fn().mockResolvedValue({ text: '   ', pages: 1 }) }),
      required: false,
    }).processServiceReceipt(INPUT);
    const call = (provider.processServiceReceipt as jest.Mock).mock.calls[0][0] as ProcessServiceReceiptInput;
    expect(call.ocrText).toBeNull();
    expect(result.ok && result.extraction.warnings).toContain('OCR found no readable text on the receipt image.');
  });

  it('notes a photo format OCR cannot read, and lets the model read it directly', async () => {
    const heic: ProcessServiceReceiptInput = { receipt: { ...INPUT.receipt, mimeType: 'image/heic' } };
    const result = await new ReceiptAIService(providerReturning(VALID_EXTRACTION), passThroughPreparer, { engine: engine(), required: false })
      .processServiceReceipt(heic);
    expect(result.ok && result.extraction.warnings.join(' ')).toContain('OCR cannot read image/heic');
  });
});
