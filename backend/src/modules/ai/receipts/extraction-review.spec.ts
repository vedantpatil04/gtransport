import { decideReviewOutcome, normaliseRegistration, parseIsoDate, toSuggestedValues, validateExtraction } from './extraction-review';
import type { ServiceReceiptExtraction } from '../schema';

/**
 * The checks that decide whether an extraction can be offered as ready-to-confirm, or whether
 * someone must look properly. These are the questions a careful clerk asks — does the bill add
 * up, is this the right truck, is the date plausible — written down so they are asked every time.
 */

const GOOD: ServiceReceiptExtraction = {
  vendorName: 'Sharma Auto Works',
  invoiceNumber: 'INV-2291',
  invoiceDate: '2026-03-04',
  vehicleNumber: 'KA 22 AB 1234',
  serviceType: 'Brake service',
  parts: [{ name: 'Brake pad set', quantity: 1, unitPrice: 1700, amount: 1700 }],
  partsAmount: 1700,
  labourAmount: 500,
  gstAmount: 396,
  otherCharges: null,
  subtotal: 2200,
  totalAmount: 2596,
  confidence: 0.91,
  rawText: 'Sharma Auto Works ...',
  warnings: [],
};

const NOW = new Date('2026-03-10T00:00:00.000Z');

describe('validateExtraction — the bill must make sense', () => {
  it('passes a coherent invoice', () => {
    expect(validateExtraction(GOOD, { now: NOW })).toEqual([]);
  });

  it('flags a total that disagrees with its own parts', () => {
    // 1700 + 500 + 396 = 2596, so a printed total of 9000 means something was misread.
    const issues = validateExtraction({ ...GOOD, totalAmount: 9000 }, { now: NOW });
    expect(issues.some((issue) => issue.includes('add up to'))).toBe(true);
  });

  it('tolerates a rounding difference of a rupee', () => {
    expect(validateExtraction({ ...GOOD, totalAmount: 2596.5 }, { now: NOW })).toEqual([]);
  });

  it('flags a missing total, rather than substituting zero', () => {
    const issues = validateExtraction({ ...GOOD, totalAmount: null }, { now: NOW });
    expect(issues).toContain('No total amount could be read from the receipt.');
  });

  it('flags a missing date, rather than substituting today', () => {
    const issues = validateExtraction({ ...GOOD, invoiceDate: null }, { now: NOW });
    expect(issues).toContain('No invoice date could be read from the receipt.');
  });

  it('flags a missing vendor', () => {
    expect(validateExtraction({ ...GOOD, vendorName: null }, { now: NOW })).toContain(
      'No service centre name could be read from the receipt.',
    );
  });

  it('flags an invoice dated in the future', () => {
    const issues = validateExtraction({ ...GOOD, invoiceDate: '2026-12-01' }, { now: NOW });
    expect(issues.some((issue) => issue.includes('in the future'))).toBe(true);
  });

  it('flags a date the system cannot read', () => {
    const issues = validateExtraction({ ...GOOD, invoiceDate: '04/03/2026' }, { now: NOW });
    expect(issues.some((issue) => issue.includes('not a date'))).toBe(true);
  });

  it('flags a receipt for a different vehicle — the mistake that is easiest to make', () => {
    const issues = validateExtraction(GOOD, { vehicleNumber: 'MH 12 CD 5678', now: NOW });
    expect(issues.some((issue) => issue.includes('but this record is for'))).toBe(true);
  });

  it('accepts the same registration written differently', () => {
    // A driver's photo may read "KA22AB1234" where the record says "KA 22 AB 1234".
    expect(validateExtraction(GOOD, { vehicleNumber: 'ka22ab1234', now: NOW })).toEqual([]);
  });

  it('flags a total that disagrees with what someone already typed', () => {
    const issues = validateExtraction(GOOD, { recordedAmount: 4000, now: NOW });
    expect(issues.some((issue) => issue.includes('was entered on this record'))).toBe(true);
  });

  it('says nothing when the typed amount agrees', () => {
    expect(validateExtraction(GOOD, { recordedAmount: 2596, now: NOW })).toEqual([]);
  });

  it('flags line items that exceed the subtotal they belong to', () => {
    const issues = validateExtraction(
      { ...GOOD, parts: [{ name: 'Gearbox', quantity: 1, unitPrice: 40_000, amount: 40_000 }] },
      { now: NOW },
    );
    expect(issues.some((issue) => issue.includes('more than the parts subtotal'))).toBe(true);
  });

  it('does not invent a contradiction from a single component', () => {
    // With only one component known there is nothing to cross-check against the total.
    const sparse = { ...GOOD, partsAmount: null, gstAmount: null, otherCharges: null };
    expect(validateExtraction(sparse, { now: NOW })).toEqual([]);
  });
});

describe('decideReviewOutcome — who has to look, and how hard', () => {
  it('offers a clean high-confidence extraction as ready to confirm', () => {
    expect(decideReviewOutcome(GOOD, [])).toBe('COMPLETED');
  });

  it('routes any validation issue to review, however confident the model was', () => {
    // Confidence is the model's opinion of itself. A contradiction is a fact.
    expect(decideReviewOutcome({ ...GOOD, confidence: 0.99 }, ['The total does not add up.'])).toBe('REVIEW_REQUIRED');
  });

  it('routes a low-confidence extraction to review', () => {
    expect(decideReviewOutcome({ ...GOOD, confidence: 0.4 }, [])).toBe('REVIEW_REQUIRED');
  });

  it('routes to review when the model flagged its own uncertainty', () => {
    expect(decideReviewOutcome({ ...GOOD, warnings: ['The total was partly obscured.'] }, [])).toBe('REVIEW_REQUIRED');
  });

  it('never returns a state that means "accepted"', () => {
    // Neither outcome is authoritative. Both still require a person to confirm the record.
    for (const confidence of [0, 0.5, 0.95, 1]) {
      expect(['COMPLETED', 'REVIEW_REQUIRED']).toContain(decideReviewOutcome({ ...GOOD, confidence }, []));
    }
  });

  it('honours a configured threshold', () => {
    expect(decideReviewOutcome({ ...GOOD, confidence: 0.8 }, [], 0.9)).toBe('REVIEW_REQUIRED');
    expect(decideReviewOutcome({ ...GOOD, confidence: 0.8 }, [], 0.7)).toBe('COMPLETED');
  });
});

describe('toSuggestedValues — missing stays missing', () => {
  it('marks what was found', () => {
    const suggestions = toSuggestedValues(GOOD);
    expect(suggestions.totalAmount).toEqual({ value: 2596, state: 'found' });
    expect(suggestions.vendorName).toEqual({ value: 'Sharma Auto Works', state: 'found' });
  });

  it('marks what was not found, rather than filling in a default', () => {
    // The whole point of §6: a blank the clerk fills in, not a zero they might trust.
    const suggestions = toSuggestedValues({ ...GOOD, totalAmount: null, invoiceDate: null });
    expect(suggestions.totalAmount).toEqual({ value: null, state: 'missing' });
    expect(suggestions.invoiceDate).toEqual({ value: null, state: 'missing' });
  });
});

describe('parseIsoDate', () => {
  it('accepts a real ISO date', () => {
    expect(parseIsoDate('2026-03-04')?.toISOString()).toBe('2026-03-04T00:00:00.000Z');
  });

  it('refuses a date that does not exist', () => {
    // Date would roll 31 February forward into March rather than admit it is not a date.
    expect(parseIsoDate('2026-02-31')).toBeNull();
  });

  it('refuses other formats rather than guessing day and month order', () => {
    expect(parseIsoDate('04/03/2026')).toBeNull();
    expect(parseIsoDate('4 March 2026')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
  });
});

describe('normaliseRegistration', () => {
  it('ignores spacing and case', () => {
    expect(normaliseRegistration('ka 22 ab 1234')).toBe(normaliseRegistration('KA22AB1234'));
    expect(normaliseRegistration('KA-22-AB-1234')).toBe('KA22AB1234');
  });

  it('keeps genuinely different registrations different', () => {
    expect(normaliseRegistration('KA 22 AB 1234')).not.toBe(normaliseRegistration('KA 22 AB 1235'));
  });
});
