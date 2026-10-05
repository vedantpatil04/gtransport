import { EmailProviderError } from '../email-provider';
import type { FetchLike } from '../oauth/oauth-client';

/**
 * Supplies a valid access token for one connected mailbox.
 *
 * Implemented by the connection service, which refreshes tokens, stores the rotated ones
 * encrypted, and marks the connection as needing re-authorisation when the provider refuses the
 * refresh token. A provider adapter only ever asks for "a token", or "a new one" after a 401.
 */
export interface AccessTokenSource {
  getAccessToken(options?: { forceRefresh?: boolean }): Promise<string>;
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

/**
 * HTTP for the Gmail and Graph adapters: bearer token, one refresh-and-retry on 401, timeouts, and
 * every failure mapped to an EmailProviderError the sync can record and decide about.
 *
 * Statuses the caller has a use for (Gmail's 404 for an expired history id, Graph's 410 for an
 * expired delta token) are returned rather than thrown when listed in `accept`.
 */
export class MailApiClient {
  constructor(
    private readonly label: string,
    private readonly tokens: AccessTokenSource,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly timeoutMs = 30_000,
  ) {}

  async json<T>(url: string, options: { headers?: Record<string, string>; accept?: number[] } = {}): Promise<ApiResponse<T>> {
    const response = await this.send(url, options.headers ?? {}, options.accept ?? []);
    const body = response.status === 204 ? ({} as T) : ((await response.json().catch(() => ({}))) as T);
    return { status: response.status, body };
  }

  async bytes(url: string): Promise<Uint8Array> {
    const response = await this.send(url, {}, []);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async send(url: string, headers: Record<string, string>, accept: number[], refreshed = false): Promise<Response> {
    const token = await this.tokens.getAccessToken({ forceRefresh: refreshed });
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json', ...headers, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new EmailProviderError(`${this.label} did not respond in time.`, 'TIMEOUT', true, { cause: error });
      }
      throw new EmailProviderError(`${this.label} could not be reached.`, 'UNAVAILABLE', true, { cause: error });
    }

    if (response.ok || accept.includes(response.status)) return response;

    // An access token can be revoked or expire early. One refresh, one retry — a second 401
    // means the grant itself is no longer good, and that needs a person, not a loop.
    if (response.status === 401 && !refreshed) return this.send(url, headers, accept, true);
    if (response.status === 401) {
      throw new EmailProviderError(
        `${this.label} refused the mailbox's access token. Connect the mailbox again.`,
        'AUTHENTICATION_FAILED',
        false,
      );
    }

    const detail = await this.errorReason(response);
    if (response.status === 429 || /rateLimit|throttl/i.test(detail)) {
      const retryAfter = response.headers.get('retry-after');
      throw new EmailProviderError(
        `${this.label} is rate limiting requests${retryAfter ? ` (retry after ${retryAfter}s)` : ''}. The sync will try again.`,
        'RATE_LIMITED',
        true,
      );
    }
    if (response.status === 403) {
      throw new EmailProviderError(
        `${this.label} denied access to the mailbox (${detail || 'forbidden'}). The account may not have granted read access.`,
        'AUTHENTICATION_FAILED',
        false,
      );
    }
    if (response.status === 404) {
      throw new EmailProviderError(`${this.label} could not find the requested mailbox item.`, 'MAILBOX_NOT_FOUND', false);
    }
    if (response.status >= 500) {
      throw new EmailProviderError(`${this.label} is having problems (HTTP ${response.status}). The sync will try again.`, 'UNAVAILABLE', true);
    }
    throw new EmailProviderError(`${this.label} rejected a request (HTTP ${response.status}${detail ? `, ${detail}` : ''}).`, 'PROTOCOL_ERROR', false);
  }

  /** The provider's own short error code, never the full body (which may echo request content). */
  private async errorReason(response: Response): Promise<string> {
    try {
      const body = (await response.clone().json()) as {
        error?: { code?: string | number; status?: string; errors?: { reason?: string }[] } | string;
      };
      if (typeof body.error === 'string') return body.error.slice(0, 80);
      const reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? body.error?.code;
      return reason === undefined ? '' : String(reason).slice(0, 80);
    } catch {
      return '';
    }
  }
}

/** Runs `work` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(runners);
  return results;
}
