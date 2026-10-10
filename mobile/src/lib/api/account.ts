import type { LoginResponse, SessionUser } from '../../types/domain';
import { WAKE_TIMEOUT_MS } from './warmup';
import { apiRequest } from './client';

/**
 * Sign-in for every role. The server decides who the account is and what it may do; the app
 * only uses the role to choose which screens to show.
 */
export const accountApi = {
  // The first sign-in after a quiet spell reaches a sleeping API instance (up to a minute to wake), so
  // it waits longer than an ordinary request and tries once more. A wrong password is a 401, which
  // is never retried, so this cannot count extra failed attempts against the account.
  login: (identifier: string, password: string) =>
    apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: { identifier, password }, timeoutMs: WAKE_TIMEOUT_MS, retries: 1 }),

  /** The account as it is now — read on every launch so a changed role is picked up. */
  me: (token: string) => apiRequest<SessionUser>('/auth/me', { token }),

  /** Returns a fresh session: the change ends every other one. */
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    apiRequest<LoginResponse>('/auth/change-password', { method: 'POST', token, body: { currentPassword, newPassword } }),

  /**
   * A one-time, minute-long code that opens the office console already signed in (office roles
   * only). Each call replaces the account's previous code, so a repeat after a lost response is
   * harmless: only the latest code is ever used. The console wakes the API first (lib/api/warmup),
   * so this normally answers at once; the longer limit and one repeat cover a wake that is still finishing.
   */
  webHandoff: (token: string) =>
    apiRequest<{ code: string; expiresAt: string }>('/auth/web-handoff', { method: 'POST', token, timeoutMs: 30_000, retries: 1 }),
};
