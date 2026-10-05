import { z } from 'zod';

const nullableMoney = z.preprocess(
  (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') {
      const normalized = value.replace(/[₹,\s]/g, '');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  },
  z.number().nonnegative().nullable(),
);

const nullableQuantity = z.preprocess(
  (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[,\s]/g, ''));
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  },
  z.number().nonnegative().nullable(),
);

/**
 * A distance in whole kilometres, as printed on a job card ("45,230 km", "45230").
 *
 * Only separators and a trailing unit are removed. Anything else that is not a number — "approx
 * 45k", "see overleaf" — fails validation rather than being coaxed into a figure (§6: never invent).
 */
const nullableKilometres = z.preprocess(
  (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') {
      const normalized = value.replace(/[,\s]/g, '').replace(/km$/i, '');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  },
  z.number().nonnegative().max(10_000_000).nullable().transform((value) => (value === null ? null : Math.round(value))),
);

/** What a line on a service invoice is for. Null when the receipt does not make it clear. */
export const LINE_ITEM_KINDS = ['PART', 'LABOUR', 'OTHER'] as const;
export type ServiceLineItemKind = (typeof LINE_ITEM_KINDS)[number];

const lineItemKind = z.preprocess(
  (value: unknown) => (typeof value === 'string' ? value.trim().toUpperCase().replace(/^LABOR$/, 'LABOUR') || null : value ?? null),
  z.enum(LINE_ITEM_KINDS).nullable(),
);

export const ServiceReceiptLineItemSchema = z
  .object({
    description: z.string().trim().nullable(),
    kind: lineItemKind.default(null),
    quantity: nullableQuantity,
    unitPrice: nullableMoney,
    amount: nullableMoney,
  })
  .strict();

export type ServiceReceiptLineItem = z.infer<typeof ServiceReceiptLineItemSchema>;

const ExtractionObjectSchema = z
  .object({
    /** The workshop or service centre. */
    vendorName: z.string().trim().nullable(),
    invoiceNumber: z.string().trim().nullable(),
    /** The service / invoice date, YYYY-MM-DD. */
    invoiceDate: z.string().trim().nullable(),
    vehicleNumber: z.string().trim().nullable(),
    serviceType: z.string().trim().nullable(),
    /** Odometer at the service. Absent on many roadside bills; null then, never estimated. */
    odometerKm: nullableKilometres.default(null),
    /** When the workshop says the next service is due. Only when printed on the receipt. */
    nextServiceDate: z.string().trim().nullable().default(null),
    nextServiceKm: nullableKilometres.default(null),
    lineItems: z.array(ServiceReceiptLineItemSchema).max(200),
    partsAmount: nullableMoney,
    labourAmount: nullableMoney,
    /** GST and any other tax. */
    gstAmount: nullableMoney,
    otherCharges: nullableMoney,
    subtotal: nullableMoney,
    totalAmount: nullableMoney,
    confidence: z.number().min(0).max(1),
    rawText: z.string(),
    warnings: z.array(z.string()),
  })
  .strict();

/**
 * The one contract every provider's output must meet before it is stored (§9, §10).
 *
 * Extractions stored before line items were typed carried a `parts` list of `{ name, ... }`; those
 * are read as PART lines, so a stored result is never shown as unusable just because the contract
 * grew. A model that still answers in that shape is accepted the same way — the values are the
 * model's own, only the key differs.
 */
export const ServiceReceiptExtractionSchema = z.preprocess((value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  if (!('lineItems' in record) && Array.isArray(record.parts)) {
    record.lineItems = record.parts.map((part: unknown) => {
      if (!part || typeof part !== 'object') return part;
      const { name, ...rest } = part as Record<string, unknown>;
      return { description: name ?? null, kind: 'PART', ...rest };
    });
  }
  delete record.parts;
  return record;
}, ExtractionObjectSchema);

export type ServiceReceiptExtraction = z.infer<typeof ExtractionObjectSchema>;

export const EMPTY_SERVICE_RECEIPT_EXTRACTION: ServiceReceiptExtraction = {
  vendorName: null,
  invoiceNumber: null,
  invoiceDate: null,
  vehicleNumber: null,
  serviceType: null,
  odometerKm: null,
  nextServiceDate: null,
  nextServiceKm: null,
  lineItems: [],
  partsAmount: null,
  labourAmount: null,
  gstAmount: null,
  otherCharges: null,
  subtotal: null,
  totalAmount: null,
  confidence: 0,
  rawText: '',
  warnings: [],
};
