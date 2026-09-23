export const SERVICE_RECEIPT_AI_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REVIEW_REQUIRED',
  'CONFIRMED',
] as const;

export type ServiceReceiptAIStatus = (typeof SERVICE_RECEIPT_AI_STATUSES)[number];
