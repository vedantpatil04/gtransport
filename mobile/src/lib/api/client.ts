import { API_URL, REQUEST_TIMEOUT_MS } from '../config';

/**
 * The single place that talks to the Gangamata API. Components never call fetch directly.
 */

export type ApiErrorKind = 'network' | 'timeout' | 'unauthorized' | 'forbidden' | 'notFound' | 'validation' | 'server' | 'unknown';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly requestId?: string,
    /** Which request fields were refused (field name → first message), for screens to translate. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when retrying later might succeed — drives the offline queue and retry buttons. */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server';
  }
}

function kindFor(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 400 || status === 409 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  /** Extra attempts for retryable failures. Only safe for idempotent requests. */
  retries?: number;
  signal?: AbortSignal;
}

/** Called when the API rejects the session, so the app can sign the driver out once, centrally. */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (handler: (() => void) | null): void => {
  onUnauthorized = handler;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, retries = method === 'GET' ? 2 : 0, signal } = options;

  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller);

    try {
      const response = await fetch(`${API_URL}/api/v1${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      if (response.status === 204) return undefined as T;

      const text = await response.text();
      const payload: unknown = text ? safeParse(text) : undefined;

      if (!response.ok) {
        const envelope = payload as { error?: { message?: string; code?: string; requestId?: string; details?: { field?: string; messages?: string[] }[] } } | undefined;
        const error = new ApiError(
          kindFor(response.status),
          response.status,
          envelope?.error?.message ?? 'Something went wrong. Please try again.',
          envelope?.error?.code,
          envelope?.error?.requestId,
          Object.fromEntries(
            (envelope?.error?.details ?? [])
              .filter((d) => d.field && d.messages?.length)
              .map((d) => [d.field as string, (d.messages as string[])[0] as string]),
          ),
        );

        if (error.kind === 'unauthorized') {
          // Only a request that carried a session can end one; a wrong password at sign-in cannot.
          if (options.token) onUnauthorized?.();
          throw error;
        }
        if (error.retryable && attempt < retries) {
          lastError = error;
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw error;
      }

      return payload as T;
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;

      const aborted = (cause as { name?: string })?.name === 'AbortError';
      // A caller-triggered abort is not a failure to report.
      if (aborted && signal?.aborted) throw cause;

      const error = aborted
        ? new ApiError('timeout', 0, 'The server is taking too long to respond.')
        : new ApiError('network', 0, 'Unable to connect right now. Your data is safe. Please try again.');

      if (attempt < retries) {
        lastError = error;
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw lastError ?? new ApiError('unknown', 0, 'Something went wrong. Please try again.');
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
