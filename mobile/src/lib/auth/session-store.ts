import { create } from 'zustand';
import { ApiError, setUnauthorizedHandler } from '../api/client';
import { driverApi } from '../api/driver';
import { clearSession, loadSession, saveSession } from '../storage/secure';
import type { DriverProfile } from '../../types/domain';

/** Session lifecycle for the driver app. Tokens live in the keystore, never in plain storage. */

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: SessionStatus;
  token: string | null;
  driver: DriverProfile | null;
  /** Set when a session ends on its own, so the login screen can explain why. */
  expiredMessage: boolean;

  restore: () => Promise<void>;
  signIn: (mobileNumber: string, passcode: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshDriver: () => Promise<void>;
  clearExpiredMessage: () => void;
}

/** "12h" / "45m" / "30s" → milliseconds. Falls back to 12 hours. */
export function expiryToMs(expiresIn: string): number {
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

export class NotADriverError extends Error {
  constructor() {
    super('This account is not a driver account.');
    this.name = 'NotADriverError';
  }
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  token: null,
  driver: null,
  expiredMessage: false,

  restore: async () => {
    const stored = await loadSession();
    if (!stored) {
      set({ status: 'signedOut', token: null, driver: null });
      return;
    }
    try {
      const driver = await driverApi.me(stored.accessToken);
      set({ status: 'signedIn', token: stored.accessToken, driver });
    } catch (error) {
      // An unusable session is cleared; a flaky network keeps the driver signed in offline.
      if (error instanceof ApiError && error.kind === 'unauthorized') {
        await clearSession();
        set({ status: 'signedOut', token: null, driver: null, expiredMessage: true });
      } else {
        set({ status: 'signedIn', token: stored.accessToken, driver: null });
      }
    }
  },

  signIn: async (mobileNumber, passcode) => {
    const result = await driverApi.login(toE164(mobileNumber), passcode);
    if (result.user.role !== 'DRIVER') throw new NotADriverError();

    await saveSession({
      accessToken: result.accessToken,
      expiresAt: Date.now() + expiryToMs(result.expiresIn),
      driverUserId: result.user.id,
    });

    const driver = await driverApi.me(result.accessToken);
    set({ status: 'signedIn', token: result.accessToken, driver, expiredMessage: false });
  },

  signOut: async () => {
    await clearSession();
    set({ status: 'signedOut', token: null, driver: null, expiredMessage: false });
  },

  refreshDriver: async () => {
    const { token } = get();
    if (!token) return;
    const driver = await driverApi.me(token);
    set({ driver });
  },

  clearExpiredMessage: () => set({ expiredMessage: false }),
}));

/** A 401 from anywhere ends the session once, centrally. */
setUnauthorizedHandler(() => {
  void clearSession();
  useSession.setState({ status: 'signedOut', token: null, driver: null, expiredMessage: true });
});
