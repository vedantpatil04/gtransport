import { API_URL } from '../config';
import { ApiError, apiRequest } from './client';

/**
 * The driver's documents. The server decides what the driver may see — their own licence and
 * their assigned vehicle's documents — and sets the owner of anything they upload.
 */

export type DocumentType = 'RC' | 'INSURANCE' | 'PUC' | 'TYRE_INSURANCE' | 'DRIVING_LICENCE';
export type ComplianceStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'NOT_UPLOADED';

export interface DriverDocument {
  id: string;
  type: DocumentType;
  documentNumber: string | null;
  expiryDate: string | null;
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
  daysRemaining: number | null;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  rejectionReason: string | null;
  file: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null;
}

export interface ComplianceItem {
  type: DocumentType;
  /** Computed by the server from the stored expiry date and today. */
  status: ComplianceStatus;
  daysRemaining: number | null;
  document: DriverDocument | null;
}

export interface MyDocuments {
  vehicle: { id: string; registrationNumber: string; documents: ComplianceItem[] } | null;
  personal: ComplianceItem[];
}

export const documentsApi = {
  mine: (token: string) => apiRequest<MyDocuments>('/documents/mine', { token }),
  /** New document, or a new version replacing the current one of the same type. */
  save: (token: string, body: { type: DocumentType; fileId: string; expiryDate?: string; documentNumber?: string; clientSubmissionId: string }) =>
    apiRequest<DriverDocument>('/documents/mine', { method: 'POST', token, body }),
};

/**
 * Uploads a document file (high-resolution photo or PDF) to the backend files API.
 * Uses standard fetch with multipart FormData, matching uploadReceipt for rock-solid
 * reliability on Android and iOS development builds.
 */
export async function uploadDocumentFile(
  token: string,
  file: { uri: string; mimeType: string; name: string },
  onProgress: (fraction: number) => void,
): Promise<string> {
  onProgress(0.1);

  const rawMime = file.mimeType?.toLowerCase().split(';')[0].trim() || 'image/jpeg';
  const cleanMime = rawMime === 'image/jpg' || rawMime === 'image/pjpeg' ? 'image/jpeg' : rawMime;

  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name || 'document',
    type: cleanMime,
  } as unknown as Blob);

  onProgress(0.3);
  const controller = new AbortController();
  // High-resolution photos and multi-page PDFs need adequate timeout on mobile networks
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${API_URL}/api/v1/files/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body: form,
      signal: controller.signal,
    });

    onProgress(0.85);
    const text = await response.text();
    let body: { fileId?: string; error?: { message?: string } } = {};
    try {
      body = text ? (JSON.parse(text) as { fileId?: string; error?: { message?: string } }) : {};
    } catch {
      /* non-JSON response */
    }

    if (!response.ok) {
      const kind = response.status === 401 ? 'unauthorized' : response.status >= 500 ? 'server' : 'validation';
      throw new ApiError(kind, response.status, body.error?.message ?? 'Could not upload the document.');
    }

    if (!body.fileId) {
      throw new ApiError('server', response.status, 'Upload did not return a file.');
    }

    onProgress(1);
    return body.fileId;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const aborted = (error as { name?: string })?.name === 'AbortError';
    throw new ApiError(aborted ? 'timeout' : 'network', 0, aborted ? 'The upload took too long.' : 'Could not upload right now.');
  } finally {
    clearTimeout(timer);
  }
}
