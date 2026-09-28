import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ApiError, apiRequest } from '@/lib/api/client';

export type ApiRole = 'SUPER_ADMIN' | 'ADMIN' | 'ACCOUNTING' | 'MANAGER' | 'DRIVER';
export type ApiAccountStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

/** The signed-in account, exactly as the API describes it (login and /auth/me). */
export interface ApiSessionUser {
  id: string;
  role: ApiRole;
  companyId: string;
  employeeId: string | null;
  driverId: string | null;
  status: ApiAccountStatus;
  /** A temporary password is in use: nothing else works until it is changed. */
  mustChangePassword: boolean;
  displayName: string;
  email: string | null;
  phone: string | null;
}

interface LoginResponse {
  accessToken: string;
  expiresAt: string | null;
  expiresIn: string;
  user: ApiSessionUser;
}

interface SessionState {
  token: string | null;
  user: ApiSessionUser | null;
  /** ISO expiry of the token; a restored session past it is discarded. */
  expiresAt: string | null;
  /** Set when a session ends on its own (expired, revoked), so sign-in can say why. */
  endedMessage: boolean;
  signIn: (identifier: string, password: string) => Promise<ApiSessionUser>;
  signOut: () => void;
  /** Called when a request comes back 401: the stored token is no longer usable. */
  expire: () => void;
  /** Re-reads the account (role, status) from the API; a stale role never lingers. */
  refresh: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const EMPTY = { token: null, user: null, expiresAt: null } as const;

/** A valid login for a role that does not use the office console (drivers use the phone app). */
export class NotOfficeAccountError extends Error {
  constructor() {
    super('This account cannot use the office console.');
    this.name = 'NotOfficeAccountError';
  }
}

const isExpired = (expiresAt: string | null) => Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());

/**
 * The one admin session for the real API: token, account and expiry. Kept separate from the
 * prototype's demo `useApp` store so that demo mode is completely unaffected by it.
 *
 * The token lives in localStorage: the same trade-off the prototype already makes for its
 * own state, and acceptable while the API issues short-lived (12h) tokens. Passwords are never
 * stored anywhere. Moving to an httpOnly refresh-token cookie is a later hardening step.
 */
export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      ...EMPTY,
      endedMessage: false,
      signIn: async (identifier, password) => {
        const result = await apiRequest<LoginResponse>('/auth/login', {
          method: 'POST',
          body: { identifier: identifier.trim(), password },
        });
        // Refused before anything is stored, so the console never flashes open for a driver.
        if (!isOfficeRole(result.user.role)) throw new NotOfficeAccountError();
        set({ token: result.accessToken, user: result.user, expiresAt: result.expiresAt, endedMessage: false });
        return result.user;
      },
      signOut: () => set({ ...EMPTY, endedMessage: false }),
      expire: () => {
        if (get().token) set({ ...EMPTY, endedMessage: true });
      },
      refresh: async () => {
        const { token } = get();
        if (!token) return;
        if (isExpired(get().expiresAt)) return get().expire();
        try {
          const user = await apiRequest<ApiSessionUser>('/auth/me', { token });
          set({ user });
        } catch (error) {
          if (error instanceof ApiError && error.isAuthError) get().expire();
          // Offline or a server hiccup: keep the session; the next request will tell.
        }
      },
      changePassword: async (currentPassword, newPassword) => {
        const result = await apiRequest<LoginResponse>('/auth/change-password', {
          method: 'POST',
          token: get().token,
          body: { currentPassword, newPassword },
        });
        // Changing the password ends every other session; this one continues on a new token.
        set({ token: result.accessToken, user: result.user, expiresAt: result.expiresAt });
      },
    }),
    {
      name: 'gangamata-session',
      partialize: (state) => ({ token: state.token, user: state.user, expiresAt: state.expiresAt }),
      // A session restored after its expiry, or saved before accounts had a status, is dropped.
      onRehydrateStorage: () => (state) => {
        if (state?.token && (isExpired(state.expiresAt) || !state.user?.status)) useSession.setState({ ...EMPTY, endedMessage: true });
      },
    },
  ),
);

/** Roles allowed into the admin console. */
const OFFICE_ROLES: ApiRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTING'];

export const canManageFleet = (role?: ApiRole): boolean =>
  role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER';

export const canManageFinance = (role?: ApiRole): boolean =>
  role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'ACCOUNTING';

/** Account administration (see backend account-policy.ts). UX only — the API decides. */
export const canAdministerAccounts = (role?: ApiRole): boolean => role === 'SUPER_ADMIN' || role === 'ADMIN';

/** Roles an administrator may give a new office login (drivers get theirs with a driver profile). */
export const grantableOfficeRoles = (role?: ApiRole): ApiRole[] =>
  role === 'SUPER_ADMIN' ? ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTING'] : role === 'ADMIN' ? ['MANAGER', 'ACCOUNTING'] : [];

export const isOfficeRole = (role?: ApiRole): boolean => Boolean(role && OFFICE_ROLES.includes(role));

/**
 * Performs an authenticated request, signing the user out if the session has expired so the
 * login screen appears instead of a wall of failures.
 */
export async function authedRequest<T>(path: string, options: Parameters<typeof apiRequest>[1] = {}): Promise<T> {
  const token = useSession.getState().token;
  try {
    return await apiRequest<T>(path, { ...options, token });
  } catch (error) {
    if (error instanceof ApiError && error.isAuthError) useSession.getState().expire();
    throw error;
  }
}
