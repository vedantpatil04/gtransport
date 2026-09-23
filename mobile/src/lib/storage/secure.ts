import * as SecureStore from 'expo-secure-store';

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
  driverUserId: string;
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
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || typeof parsed.expiresAt !== 'number') return null;
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
