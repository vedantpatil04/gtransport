import { API_URL, REQUEST_TIMEOUT_MS } from '../config';
import type { FuelEntry, FuelTotals, FuelTypeValue, OperationCategory, OperationRecord, Page } from '../../types/domain';
import { ApiError, apiRequest } from './client';

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

export const fuelApi = {
  create: (token: string, body: FuelPayload) => apiRequest<FuelEntry>('/fuel/mine', { method: 'POST', token, body }),
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
  create: (token: string, body: OperationPayload) => apiRequest<OperationRecord>('/operations/mine', { method: 'POST', token, body }),
  createTyreInsurance: (token: string, body: TyreInsurancePayload) =>
    apiRequest<{ id: string }>('/operations/mine/tyre-insurance', { method: 'POST', token, body }),
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
 */
export async function uploadReceipt(token: string, file: { uri: string; mimeType: string; name: string }): Promise<string> {
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } for a file on disk.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);

  const controller = new AbortController();
  // Photos on a slow 2G/3G link take longer than an ordinary request.
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 4);
  try {
    const response = await fetch(`${API_URL}/api/v1/files/receipts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body: form,
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as { fileId?: string; error?: { message?: string } }) : {};
    if (!response.ok) {
      const kind = response.status === 401 ? 'unauthorized' : response.status >= 500 ? 'server' : 'validation';
      throw new ApiError(kind, response.status, body.error?.message ?? 'Could not upload the receipt.');
    }
    if (!body.fileId) throw new ApiError('server', response.status, 'Upload did not return a file.');
    return body.fileId;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const aborted = (error as { name?: string })?.name === 'AbortError';
    throw new ApiError(aborted ? 'timeout' : 'network', 0, 'Could not upload right now.');
  } finally {
    clearTimeout(timer);
  }
}
