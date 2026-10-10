import { API_URL, IDEMPOTENT_WRITE_TIMEOUT_MS } from '../config';
import { assertLocalFileExists } from '../receipts/storage';
import type { FuelEntry, FuelTotals, FuelTypeValue, OperationCategory, OperationRecord, Page } from '../../types/domain';
import { apiRequest } from './client';
import { uploadFile } from './upload';

/**
 * Fuel, daily operations and receipts for the signed-in driver. Every route is under /mine or
 * is a receipt upload, and none carries a driver or vehicle id: the server takes both from the
 * session and the driver's current assignment.
 */

export interface FuelPayload {
  fuelType: FuelTypeValue;
  amount: number;
  litres: number;
  fuelStation: string;
  transactionDate: string;
  receiptFileId?: string;
  clientSubmissionId: string;
}

export interface OperationPayload {
  category: OperationCategory;
  amount: number;
  expenseDate: string;
  vendorName?: string;
  description?: string;
  receiptFileId?: string;
  clientSubmissionId: string;
}

export interface TyreInsurancePayload {
  insurer: string;
  policyNumber?: string;
  premium?: number;
  startDate?: string;
  expiryDate: string;
  receiptFileId?: string;
  clientSubmissionId: string;
}

/**
 * Every create below carries a clientSubmissionId, which the server stores exactly once, so a repeat
 * after a lost response or a timeout returns the original record. That is what makes the retries and
 * the long time limit (a sleeping API instance needs up to a minute to wake) safe.
 */
const SAFE_TO_REPEAT = { retries: 2, timeoutMs: IDEMPOTENT_WRITE_TIMEOUT_MS } as const;

export const fuelApi = {
  create: (token: string, body: FuelPayload) => apiRequest<FuelEntry>('/fuel/mine', { method: 'POST', token, body, ...SAFE_TO_REPEAT }),
  list: (token: string, query: { from?: string; to?: string; cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    const qs = params.toString();
    return apiRequest<Page<FuelEntry> & { totals: FuelTotals }>(`/fuel/mine${qs ? `?${qs}` : ''}`, { token });
  },
  get: (token: string, id: string) => apiRequest<FuelEntry>(`/fuel/mine/${id}`, { token }),
  stations: (token: string) => apiRequest<string[]>('/fuel/mine/stations', { token }),
};

export const operationsApi = {
  create: (token: string, body: OperationPayload) =>
    apiRequest<OperationRecord>('/operations/mine', { method: 'POST', token, body, ...SAFE_TO_REPEAT }),
  createTyreInsurance: (token: string, body: TyreInsurancePayload) =>
    apiRequest<{ id: string }>('/operations/mine/tyre-insurance', { method: 'POST', token, body, ...SAFE_TO_REPEAT }),
  list: (token: string, query: { from?: string; to?: string } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    const qs = params.toString();
    return apiRequest<Page<OperationRecord> & { total: string }>(`/operations/mine${qs ? `?${qs}` : ''}`, { token });
  },
};

/** Address of a receipt for <Image source={{ uri, headers }} />. Receipts are never public. */
export const receiptSource = (token: string, fileId: string) => ({
  uri: `${API_URL}/api/v1/files/${fileId}/content`,
  headers: { Authorization: `Bearer ${token}` },
});

/**
 * Uploads a receipt from a local file. The server de-duplicates identical bytes per uploader,
 * so a retried upload after a dropped connection returns the same file rather than a copy.
 * Multipart goes through lib/api/upload (see there for why it is not fetch).
 */
export async function uploadReceipt(token: string, file: { uri: string; mimeType: string; name: string }): Promise<string> {
  assertLocalFileExists(file.uri);
  return uploadFile({ path: '/files/receipts', token, file });
}
