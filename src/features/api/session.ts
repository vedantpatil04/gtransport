import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ApiError, apiRequest } from '@/lib/api/client';

export interface ApiSessionUser {
  id: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'ACCOUNTING' | 'MANAGER' | 'DRIVER';
  companyId: string;
  email: string | null;
  phone: string | null;
  employee: { id: string; fullName: string } | null;
}

interface LoginResponse {
  accessToken: string;
  expiresIn: string;
  user: ApiSessionUser;
}

interface SessionState {
  token: string | null;
  user: ApiSessionUser | null;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Called when a request comes back 401: the stored token is no longer usable. */
  expire: () => void;
}

/**
 * Admin session for the real API. Kept separate from the prototype's demo `useApp` store so
 * that demo mode is completely unaffected by it.
 *
 * The token lives in localStorage: the same trade-off the prototype already makes for its
 * own state, and acceptable while the API issues short-lived (12h) tokens. Moving to an
 * httpOnly refresh-token cookie is a later-phase hardening step.
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      signIn: async (identifier, password) => {
        const result = await apiRequest<LoginResponse>('/auth/login', {
          method: 'POST',
          body: { identifier: identifier.trim(), password },
        });
        set({ token: result.accessToken, user: result.user });
      },
      signOut: () => set({ token: null, user: null }),
      expire: () => set({ token: null, user: null }),
    }),
    { name: 'gangamata-session', partialize: (state) => ({ token: state.token, user: state.user }) },
  ),
);

/** Roles allowed into the admin console. */
const OFFICE_ROLES: ApiSessionUser['role'][] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTING'];

export const canManageFleet = (role?: ApiSessionUser['role']): boolean =>
  role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER';

export const canManageFinance = (role?: ApiSessionUser['role']): boolean =>
  role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'ACCOUNTING';

export const isOfficeRole = (role?: ApiSessionUser['role']): boolean => Boolean(role && OFFICE_ROLES.includes(role));

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
