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
 * Uploads a document file exactly as chosen, reporting progress (0–1). XMLHttpRequest is used
 * because fetch cannot report upload progress, and a PDF on a slow connection needs a visible bar.
 */
export function uploadDocumentFile(
  token: string,
  file: { uri: string; mimeType: string; name: string },
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_URL}/api/v1/files/documents`);
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Accept', 'application/json');
    request.timeout = 120_000;

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      let body: { fileId?: string; error?: { message?: string } } = {};
      try {
        body = JSON.parse(request.responseText || '{}');
      } catch {
        /* non-JSON error page */
      }
      if (request.status >= 200 && request.status < 300 && body.fileId) {
        onProgress(1);
        resolve(body.fileId);
        return;
      }
      const kind = request.status === 401 ? 'unauthorized' : request.status >= 500 ? 'server' : 'validation';
      reject(new ApiError(kind, request.status, body.error?.message ?? 'Could not upload the document.'));
    };
    request.onerror = () => reject(new ApiError('network', 0, 'Could not upload right now.'));
    request.ontimeout = () => reject(new ApiError('timeout', 0, 'The upload took too long.'));

    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    request.send(form);
  });
}
