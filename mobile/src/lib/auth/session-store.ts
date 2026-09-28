import { create } from 'zustand';
import { ApiError, setUnauthorizedHandler } from '../api/client';
import { accountApi } from '../api/account';
import { driverApi } from '../api/driver';
import { shutdownTracking } from '../location/tracking';
import { clearSession, loadSession, saveSession } from '../storage/secure';
import { languageFromApi, setLanguage } from '../../i18n';
import type { DriverProfile, LoginResponse, SessionUser, UserRole } from '../../types/domain';

/**
 * One session for every role. The token lives in the keystore, never in plain storage. The
 * role decides which app is shown (driver or office); the server decides what each may do.
 */

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: SessionStatus;
  token: string | null;
  /** The account as the API last described it. Null only when offline at launch. */
  user: SessionUser | null;
  /** Known even offline (kept in secure storage), so the right app opens without the network. */
  role: UserRole | null;
  /** Driver-specific profile — drivers only. */
  driver: DriverProfile | null;
  /** Set when a session ends on its own, so the login screen can explain why. */
  expiredMessage: boolean;

  restore: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshDriver: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  clearExpiredMessage: () => void;
}

/** "12h" / "45m" / "30s" → milliseconds. Falls back to 12 hours. */
export function expiryToMs(expiresIn?: string | null): number {
  if (!expiresIn || typeof expiresIn !== 'string') return 12 * 60 * 60 * 1000;
  const match = /^(\d+)([smhd])$/.exec(expiresIn.trim());
  if (!match) return 12 * 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * factor;
}

/** Indian mobile numbers are stored in E.164 by the backend. */
export function toE164(mobileNumber: string): string {
  const digits = mobileNumber.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

/** Drivers sign in with a mobile number; office staff may use an email address instead. */
export function toIdentifier(input: string): string {
  const value = input.trim();
  return value.includes('@') ? value.toLowerCase() : toE164(value);
}

const SIGNED_OUT = { status: 'signedOut' as const, token: null, user: null, role: null, driver: null };

async function loadDriver(token: string): Promise<DriverProfile> {
  const driver = await driverApi.me(token);
  const lang = languageFromApi(driver.employee?.preferredLanguage);
  if (lang) void setLanguage(lang);
  return driver;
}

async function persist(result: LoginResponse): Promise<void> {
  const expiresAt = result.expiresAt ? new Date(result.expiresAt).getTime() : Date.now() + expiryToMs(result.expiresIn);
  await saveSession({ accessToken: result.accessToken, expiresAt, userId: result.user.id, role: result.user.role });
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  token: null,
  user: null,
  role: null,
  driver: null,
  expiredMessage: false,

  restore: async () => {
    const stored = await loadSession();
    if (!stored) {
      set({ ...SIGNED_OUT });
      return;
    }
    try {
      // Read fresh: the role may have changed since the last launch.
      const user = await accountApi.me(stored.accessToken);
      const driver = user.role === 'DRIVER' && !user.mustChangePassword ? await loadDriver(stored.accessToken) : null;
      set({ status: 'signedIn', token: stored.accessToken, user, role: user.role, driver });
    } catch (error) {
      // An unusable session is cleared; a flaky network keeps the person signed in offline.
      if (error instanceof ApiError && error.kind === 'unauthorized') {
        await clearSession();
        set({ ...SIGNED_OUT, expiredMessage: true });
      } else {
        set({ status: 'signedIn', token: stored.accessToken, user: null, role: stored.role, driver: null });
      }
    }
  },

  signIn: async (identifier, password) => {
    const result = await accountApi.login(toIdentifier(identifier), password);
    await persist(result);
    const user = result.user;
    const driver = user.role === 'DRIVER' && !user.mustChangePassword ? await loadDriver(result.accessToken) : null;
    set({ status: 'signedIn', token: result.accessToken, user, role: user.role, driver, expiredMessage: false });
  },

  signOut: async () => {
    // Stop the background service and clear any buffered positions: one driver's whereabouts must
    // not be left on a shared phone, and no service should keep running for nobody.
    try {
      await shutdownTracking();
    } catch {
      /* best effort: signing out must always succeed */
    }
    await clearSession();
    set({ ...SIGNED_OUT, expiredMessage: false });
  },

  refreshDriver: async () => {
    const { token, role } = get();
    if (!token || role !== 'DRIVER') return;
    try {
      set({ driver: await loadDriver(token) });
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'unauthorized') {
        await clearSession();
        set({ ...SIGNED_OUT, expiredMessage: true });
      }
      throw error;
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const { token } = get();
    if (!token) return;
    const result = await accountApi.changePassword(token, currentPassword, newPassword);
    await persist(result);
    const user = result.user;
    const driver = user.role === 'DRIVER' ? await loadDriver(result.accessToken) : null;
    set({ token: result.accessToken, user, role: user.role, driver });
  },

  clearExpiredMessage: () => set({ expiredMessage: false }),
}));

/** A 401 on a signed-in request ends the session once, centrally. */
setUnauthorizedHandler(() => {
  void clearSession();
  useSession.setState({ ...SIGNED_OUT, expiredMessage: true });
});
