import type { LoginResponse, SessionUser } from '../../types/domain';
import { apiRequest } from './client';

/**
 * Sign-in for every role. The server decides who the account is and what it may do; the app
 * only uses the role to choose which screens to show.
 */
export const accountApi = {
  login: (identifier: string, password: string) =>
    apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: { identifier, password } }),

  /** The account as it is now — read on every launch so a changed role is picked up. */
  me: (token: string) => apiRequest<SessionUser>('/auth/me', { token }),

  /** Returns a fresh session: the change ends every other one. */
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    apiRequest<LoginResponse>('/auth/change-password', { method: 'POST', token, body: { currentPassword, newPassword } }),
};
