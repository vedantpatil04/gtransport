/**
 * Thin client for the Gangamata production API (Phase 1).
 *
 * The prototype keeps working with no backend at all: when VITE_API_URL is unset the app
 * stays in demo mode and never calls any of this. See src/features/api/mode.ts.
 */

export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Shape of the API's error envelope. */
interface ApiErrorBody {
  error?: {
    statusCode?: number;
    code?: string;
    message?: string;
    details?: { field?: string; constraints?: string[] }[];
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { field?: string; constraints?: string[] }[],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the session is gone or was never valid. */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  /** Field-level validation messages, ready to show under inputs. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      if (detail.field && detail.constraints?.length) out[detail.field] = detail.constraints[0] as string;
    }
    return out;
  }
}

export interface Page<T> {
  data: T[];
  page: { limit: number; nextCursor: string | null };
}

export type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE_URL}/api/v1${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  token?: string | null;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, token, signal } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    // Network failure, CORS rejection, or the API simply not running.
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.', undefined, undefined);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const envelope = (parsed ?? {}) as ApiErrorBody;
    throw new ApiError(
      response.status,
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.message ?? 'Something went wrong. Please try again.',
      envelope.error?.details,
      envelope.error?.requestId,
    );
  }

  return parsed as T;
}
