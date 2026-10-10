import { API_URL, UPLOAD_TIMEOUT_MS } from '../config';
import { ApiError, reportUnauthorized } from './client';

/**
 * Uploads one photo or PDF from the phone to a multipart endpoint (`/files/receipts`,
 * `/files/documents`) and returns the stored file's id.
 *
 * Why XMLHttpRequest and not fetch: in Expo SDK 57 the global `fetch` is `expo/fetch`, which only
 * accepts web-standard FormData parts (strings and Blobs). React Native's `{ uri, name, type }`
 * file part — the only way to send a camera photo or a picked file without reading it all into
 * JavaScript memory — makes it reject with "Unsupported FormDataPart implementation" before any
 * request is sent (Expo's own convertFormData tests pin this behaviour). React Native's XHR still
 * streams `uri` parts straight from disk, and gives real upload progress. Do not "simplify" this
 * back to fetch(url, { body: formData }).
 *
 * The server stores identical bytes once per uploader (SHA-256), so a retried upload after a
 * dropped connection returns the same file instead of a copy — which is what makes the retries
 * below safe.
 */

export interface UploadableFile {
  uri: string;
  mimeType: string;
  name: string;
}

export interface UploadOptions {
  /** Path under /api/v1, e.g. "/files/documents". */
  path: string;
  token: string;
  file: UploadableFile;
  /** 0..1. Bytes sent, never 1 until the server has answered. */
  onProgress?: (fraction: number) => void;
  timeoutMs?: number;
  /** Extra attempts after a connection failure, timeout or 5xx. */
  retries?: number;
  /** Test seam: waits between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Canonical image types the server accepts; some Android pickers report the legacy aliases. */
export function normaliseMimeType(mimeType: string | undefined | null): string {
  const raw = mimeType?.toLowerCase().split(';')[0]?.trim() || 'image/jpeg';
  return raw === 'image/jpg' || raw === 'image/pjpeg' ? 'image/jpeg' : raw;
}

interface ErrorEnvelope {
  fileId?: string;
  error?: { message?: string; code?: string; requestId?: string };
}

function parse(text: string): ErrorEnvelope {
  try {
    return text ? (JSON.parse(text) as ErrorEnvelope) : {};
  } catch {
    return {};
  }
}

function errorForStatus(status: number, body: ErrorEnvelope): ApiError {
  const { message, code, requestId } = body.error ?? {};
  if (status === 401) return new ApiError('unauthorized', status, message ?? 'Your session has ended. Sign in again.', code, requestId);
  if (status === 403) return new ApiError('forbidden', status, message ?? 'You are not allowed to upload this.', code, requestId);
  if (status === 404) return new ApiError('notFound', status, message ?? 'Upload address not found.', code, requestId);
  if (status === 408 || status === 429 || status >= 500) {
    return new ApiError('server', status, message ?? 'The server could not save the file right now.', code, requestId);
  }
  // 400 (not a photo/PDF, empty), 413 (too large), 415, 422: the same file will be refused again.
  return new ApiError('validation', status, message ?? 'The file was not accepted.', code, requestId);
}

function attempt(options: UploadOptions): Promise<string> {
  const { path, token, file, onProgress, timeoutMs = UPLOAD_TIMEOUT_MS } = options;

  return new Promise<string>((resolve, reject) => {
    const form = new FormData();
    // React Native's FormData sends a { uri, name, type } object as a file part.
    form.append('file', { uri: file.uri, name: file.name || 'upload', type: normaliseMimeType(file.mimeType) } as unknown as Blob);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/v1${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = timeoutMs;

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        // Hold back the last stretch: the bytes are sent, but the server still has to store them.
        if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(0.95, event.loaded / event.total));
      };
    }

    xhr.onload = () => {
      const body = parse(typeof xhr.responseText === 'string' ? xhr.responseText : '');
      if (xhr.status >= 200 && xhr.status < 300) {
        if (!body.fileId) return reject(new ApiError('server', xhr.status, 'The server did not confirm the upload.', undefined, body.error?.requestId));
        onProgress?.(1);
        return resolve(body.fileId);
      }
      return reject(errorForStatus(xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError('network', 0, 'Could not reach the server.'));
    xhr.ontimeout = () => reject(new ApiError('timeout', 0, 'The upload took too long.'));
    xhr.onabort = () => reject(new ApiError('network', 0, 'The upload was interrupted.'));

    try {
      xhr.send(form);
    } catch {
      // A file part that cannot be opened (the cached copy was cleared, the path is wrong) throws here
      // or fires onerror with no response; the screens check the file first, this is the backstop.
      reject(new ApiError('network', 0, 'Could not read the file or reach the server.'));
    }
  });
}

/** Uploads with a few bounded retries for failures that are worth repeating; everything else is thrown at once. */
export async function uploadFile(options: UploadOptions): Promise<string> {
  const { retries = 2, sleep = defaultSleep } = options;
  let lastError: ApiError | null = null;

  for (let tryNumber = 0; tryNumber <= retries; tryNumber += 1) {
    try {
      return await attempt(options);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.kind === 'unauthorized') {
        // A session the server rejected ends once, centrally, exactly as for any other request.
        reportUnauthorized();
        throw error;
      }
      lastError = error;
      if (!error.retryable || tryNumber === retries) throw error;
      // 1.5 s, then 3 s: enough for a flaky link to recover, short enough not to stall the screen.
      await sleep(1500 * 2 ** tryNumber);
    }
  }
  throw lastError ?? new ApiError('unknown', 0, 'The upload failed.');
}
