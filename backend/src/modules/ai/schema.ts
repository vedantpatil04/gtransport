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

export const ServiceReceiptPartSchema = z
  .object({
    name: z.string().trim().nullable(),
    quantity: nullableQuantity,
    unitPrice: nullableMoney,
    amount: nullableMoney,
  })
  .strict();

export const ServiceReceiptExtractionSchema = z
  .object({
    vendorName: z.string().trim().nullable(),
    invoiceNumber: z.string().trim().nullable(),
    invoiceDate: z.string().trim().nullable(),
    vehicleNumber: z.string().trim().nullable(),
    serviceType: z.string().trim().nullable(),
    parts: z.array(ServiceReceiptPartSchema),
    partsAmount: nullableMoney,
    labourAmount: nullableMoney,
    gstAmount: nullableMoney,
    otherCharges: nullableMoney,
    subtotal: nullableMoney,
    totalAmount: nullableMoney,
    confidence: z.number().min(0).max(1),
    rawText: z.string(),
    warnings: z.array(z.string()),
  })
  .strict();

export type ServiceReceiptExtraction = z.infer<typeof ServiceReceiptExtractionSchema>;

export const EMPTY_SERVICE_RECEIPT_EXTRACTION: ServiceReceiptExtraction = {
  vendorName: null,
  invoiceNumber: null,
  invoiceDate: null,
  vehicleNumber: null,
  serviceType: null,
  parts: [],
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
