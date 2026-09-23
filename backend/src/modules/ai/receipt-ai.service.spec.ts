import { AIProviderError, type AIProvider } from './provider';
import { ReceiptAIService } from './receipt-ai.service';
import type { ServiceReceiptExtraction } from './schema';
import type { ProcessServiceReceiptInput } from './types';

const VALID_EXTRACTION: ServiceReceiptExtraction = {
  vendorName: 'Sharma Auto Works',
  invoiceNumber: 'INV-114',
  invoiceDate: '2026-03-04',
  vehicleNumber: 'KA 22 AB 1234',
  serviceType: 'Brake service',
  parts: [{ name: 'Brake pad', quantity: 2, unitPrice: 850, amount: 1700 }],
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
  return { name: 'ollama', processServiceReceipt: jest.fn().mockResolvedValue(value) };
}

function providerThrowing(error: unknown): AIProvider {
  return { name: 'ollama', processServiceReceipt: jest.fn().mockRejectedValue(error) };
}

describe('ReceiptAIService', () => {
  it('returns a validated extraction on success', async () => {
    const result = await new ReceiptAIService(providerReturning(VALID_EXTRACTION)).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: true, provider: 'ollama' });
    if (result.ok) expect(result.extraction.totalAmount).toBe(2596);
  });

  it('parses JSON strings wrapped in markdown fences', async () => {
    const fenced = '```json\n' + JSON.stringify(VALID_EXTRACTION) + '\n```';
    const result = await new ReceiptAIService(providerReturning(fenced)).processServiceReceipt(INPUT);
    expect(result.ok).toBe(true);
  });

  it('coerces formatted rupee amounts to numbers', async () => {
    const result = await new ReceiptAIService(
      providerReturning({ ...VALID_EXTRACTION, totalAmount: '₹2,596.00' }),
    ).processServiceReceipt(INPUT);
    expect(result.ok && result.extraction.totalAmount).toBe(2596);
  });

  it('rejects output that does not match the schema', async () => {
    const result = await new ReceiptAIService(
      providerReturning({ ...VALID_EXTRACTION, confidence: 4 }),
    ).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: false, failure: { code: 'INVALID_AI_OUTPUT', retryable: true } });
  });

  it('rejects malformed JSON without throwing', async () => {
    const result = await new ReceiptAIService(providerReturning('not json at all')).processServiceReceipt(INPUT);
    expect(result.ok).toBe(false);
  });

  it('surfaces provider errors with their retryability intact', async () => {
    const result = await new ReceiptAIService(
      providerThrowing(new AIProviderError('Ollama is unavailable.', 'PROVIDER_UNAVAILABLE', true)),
    ).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: false, failure: { code: 'PROVIDER_UNAVAILABLE', retryable: true } });
  });

  it('marks an unsupported document as not retryable', async () => {
    const result = await new ReceiptAIService(
      providerThrowing(new AIProviderError('PDF rendering required.', 'UNSUPPORTED_DOCUMENT', false)),
    ).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: false, failure: { code: 'UNSUPPORTED_DOCUMENT', retryable: false } });
  });

  it('never throws on an unexpected error, so the original receipt stays usable', async () => {
    const result = await new ReceiptAIService(providerThrowing(new Error('boom'))).processServiceReceipt(INPUT);
    expect(result).toMatchObject({ ok: false, failure: { code: 'UNKNOWN', retryable: true } });
  });
});
