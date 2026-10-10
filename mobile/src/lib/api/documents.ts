import { IDEMPOTENT_WRITE_TIMEOUT_MS } from '../config';
import { assertLocalFileExists } from '../receipts/storage';
import { apiRequest } from './client';
import { uploadFile } from './upload';

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
    // Stored once per clientSubmissionId, so a repeat after a lost response returns the same document.
    apiRequest<DriverDocument>('/documents/mine', { method: 'POST', token, body, retries: 2, timeoutMs: IDEMPOTENT_WRITE_TIMEOUT_MS }),
};

/**
 * Uploads a document file (high-resolution photo or PDF) to the backend files API, exactly as
 * captured — official documents are never recompressed. Multipart goes through lib/api/upload,
 * which explains why this cannot be a plain fetch(FormData) in this Expo SDK.
 */
export async function uploadDocumentFile(
  token: string,
  file: { uri: string; mimeType: string; name: string },
  onProgress: (fraction: number) => void,
): Promise<string> {
  assertLocalFileExists(file.uri);
  return uploadFile({ path: '/files/documents', token, file, onProgress });
}
