import { InboxClassification } from '@prisma/client';
import { buildClassificationInput, EmailClassificationSchema, mayApplyClassification } from './email-ai';

/**
 * What a model is allowed to say about an email, and when its answer may be applied.
 *
 * The rule that matters: a person's classification is final. A later model run records what it
 * thought — that stays visible — but does not change what the office decided.
 */

const VALID = {
  classification: 'SERVICE_INVOICE',
  confidence: 0.88,
  summary: 'Sharma Auto Works has sent invoice INV-2291 for brake work on KA 22 AB 1234, totalling ₹4,850.',
  references: [
    { type: 'invoice_number', value: 'INV-2291' },
    { type: 'vehicle_registration', value: 'KA 22 AB 1234' },
    { type: 'amount', value: '4850' },
  ],
  warnings: [],
};

describe('EmailClassificationSchema', () => {
  it('accepts a well-formed classification', () => {
    const parsed = EmailClassificationSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.classification).toBe(InboxClassification.SERVICE_INVOICE);
  });

  it('refuses a category outside the agreed list', () => {
    expect(EmailClassificationSchema.safeParse({ ...VALID, classification: 'PROBABLY_IMPORTANT' }).success).toBe(false);
  });

  it('refuses a confidence outside 0–1', () => {
    expect(EmailClassificationSchema.safeParse({ ...VALID, confidence: 4 }).success).toBe(false);
    expect(EmailClassificationSchema.safeParse({ ...VALID, confidence: -1 }).success).toBe(false);
  });

  it('refuses a reference of an unknown type, so nothing unexpected is stored', () => {
    const parsed = EmailClassificationSchema.safeParse({
      ...VALID,
      references: [{ type: 'bank_account', value: '1234567890' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses extra fields rather than storing whatever the model volunteered', () => {
    expect(EmailClassificationSchema.safeParse({ ...VALID, suggestedAction: 'pay this invoice' }).success).toBe(false);
  });

  it('accepts a model that honestly cannot tell', () => {
    const parsed = EmailClassificationSchema.safeParse({
      ...VALID,
      classification: 'UNCLASSIFIED',
      confidence: 0.2,
      references: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('bounds the number of references, so one response cannot flood the record', () => {
    const many = Array.from({ length: 40 }, () => ({ type: 'reference', value: 'X' }));
    expect(EmailClassificationSchema.safeParse({ ...VALID, references: many }).success).toBe(false);
  });
});

describe('mayApplyClassification', () => {
  it('applies an AI classification when nobody has decided', () => {
    expect(mayApplyClassification({ classifiedById: null })).toBe(true);
  });

  it('never overrides a person', () => {
    // The office has looked at this mail and said what it is. A model reading it again later
    // records its own view, but the category stays as the person set it.
    expect(mayApplyClassification({ classifiedById: 'user-1' })).toBe(false);
  });
});

describe('buildClassificationInput', () => {
  const message = {
    fromAddress: 'billing@sharmaauto.example',
    fromName: 'Sharma Auto Works',
    subject: 'Invoice INV-2291',
    bodyText: 'Please find attached invoice INV-2291 for brake work.',
    attachments: [{ filename: 'invoice-2291.pdf', mimeType: 'application/pdf' }],
  };

  it('includes what the model needs to judge the mail', () => {
    const input = buildClassificationInput(message);
    expect(input).toContain('Sharma Auto Works');
    expect(input).toContain('Invoice INV-2291');
    expect(input).toContain('invoice-2291.pdf');
    expect(input).toContain('brake work');
  });

  it('caps the body, so one long marketing email cannot crowd out the useful part', () => {
    const input = buildClassificationInput({ ...message, bodyText: 'x'.repeat(50_000) }, 1_000);
    expect(input.length).toBeLessThan(1_500);
  });

  it('says so plainly when there is no readable body', () => {
    expect(buildClassificationInput({ ...message, bodyText: null })).toContain('(no readable body)');
  });

  it('handles a message with no subject', () => {
    expect(buildClassificationInput({ ...message, subject: null })).toContain('(no subject)');
  });
});
