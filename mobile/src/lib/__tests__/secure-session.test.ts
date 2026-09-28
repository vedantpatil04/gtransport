import * as SecureStore from 'expo-secure-store';
import { clearSession, loadSession, saveSession } from '../storage/secure';
import { expiryToMs, toE164 } from '../auth/session-store';

describe('secure session storage', () => {
  beforeEach(async () => {
    await clearSession();
    jest.clearAllMocks();
  });

  it('stores the session in the OS keystore, not plain storage', async () => {
    await saveSession({ accessToken: 'token-1', expiresAt: Date.now() + 60_000, userId: 'u1', role: 'DRIVER' });

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'gangamata.session',
      expect.stringContaining('token-1'),
      expect.objectContaining({ keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }),
    );
  });

  it('returns a stored session that is still valid', async () => {
    await saveSession({ accessToken: 'token-1', expiresAt: Date.now() + 60_000, userId: 'u1', role: 'DRIVER' });
    await expect(loadSession()).resolves.toMatchObject({ accessToken: 'token-1', userId: 'u1', role: 'DRIVER' });
  });

  it('treats an expired session as no session and clears it', async () => {
    await saveSession({ accessToken: 'old', expiresAt: Date.now() - 1, userId: 'u1', role: 'DRIVER' });

    await expect(loadSession()).resolves.toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
  });

  it('reads a session saved before roles were stored as a driver session', async () => {
    const SecureStore = jest.requireMock('expo-secure-store') as typeof import('expo-secure-store');
    await SecureStore.setItemAsync('gangamata.session', JSON.stringify({ accessToken: 'old-driver', expiresAt: Date.now() + 60_000, driverUserId: 'u9' }));
    await expect(loadSession()).resolves.toEqual({ accessToken: 'old-driver', expiresAt: expect.any(Number), userId: 'u9', role: 'DRIVER' });
  });

  it('survives a corrupt entry rather than crashing at launch', async () => {
    await (SecureStore.setItemAsync as jest.Mock)('gangamata.session', 'not-json');
    await expect(loadSession()).resolves.toBeNull();
  });

  it('forgets everything on logout', async () => {
    await saveSession({ accessToken: 'token-1', expiresAt: Date.now() + 60_000, userId: 'u1', role: 'DRIVER' });
    await clearSession();
    await expect(loadSession()).resolves.toBeNull();
  });
});

describe('session helpers', () => {
  it('converts the token lifetime into milliseconds', () => {
    expect(expiryToMs('12h')).toBe(12 * 3_600_000);
    expect(expiryToMs('30m')).toBe(30 * 60_000);
    expect(expiryToMs('7d')).toBe(7 * 86_400_000);
    // An unparseable value falls back rather than producing an instantly dead session.
    expect(expiryToMs('nonsense')).toBe(12 * 3_600_000);
  });

  it('normalises Indian mobile numbers to the E.164 form the backend stores', () => {
    expect(toE164('9845012301')).toBe('+919845012301');
    expect(toE164('98450 12301')).toBe('+919845012301');
    expect(toE164('919845012301')).toBe('+919845012301');
  });
});
