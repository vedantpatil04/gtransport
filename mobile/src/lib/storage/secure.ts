import * as SecureStore from 'expo-secure-store';
import type { UserRole } from '../../types/domain';

/**
 * Credential storage. Session tokens go into the OS keystore (Android Keystore / iOS
 * Keychain) — never AsyncStorage or anything resembling browser localStorage.
 *
 * SecureStore is unavailable on web, so the helpers degrade to a no-op there rather than
 * silently writing a token somewhere insecure.
 */

const SESSION_KEY = 'gangamata.session';

export interface StoredSession {
  accessToken: string;
  /** Epoch milliseconds; the client treats the session as gone once this passes. */
  expiresAt: number;
  userId: string;
  /** Kept so the right app opens even when the phone is offline at launch. */
  role: UserRole;
}

/** Sessions saved before roles existed here belonged to drivers — the app only admitted them. */
interface LegacySession {
  accessToken: string;
  expiresAt: number;
  driverUserId?: string;
  userId?: string;
  role?: UserRole;
}

const available = async (): Promise<boolean> => {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
};

export async function saveSession(session: StoredSession): Promise<void> {
  if (!(await available())) return;
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadSession(): Promise<StoredSession | null> {
  if (!(await available())) return null;
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as LegacySession;
    if (!stored.accessToken || typeof stored.expiresAt !== 'number') return null;
    const parsed: StoredSession = {
      accessToken: stored.accessToken,
      expiresAt: stored.expiresAt,
      userId: stored.userId ?? stored.driverUserId ?? '',
      role: stored.role ?? 'DRIVER',
    };
    // An expired token is treated as no session at all.
    if (parsed.expiresAt <= Date.now()) {
      await clearSession();
      return null;
    }
    return parsed;
  } catch {
    // Corrupt or unreadable entry: drop it rather than crashing on launch.
    await clearSession();
    return null;
  }
}

export async function clearSession(): Promise<void> {
  if (!(await available())) return;
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    /* already gone */
  }
}
