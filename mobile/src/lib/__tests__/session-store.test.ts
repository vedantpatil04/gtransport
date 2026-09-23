import { clearSession, loadSession, saveSession } from '../storage/secure';
import { NotADriverError, useSession } from '../auth/session-store';
import { driverApi } from '../api/driver';

jest.mock('../api/driver', () => ({
  driverApi: { login: jest.fn(), me: jest.fn(), reportLocationState: jest.fn() },
}));

const api = driverApi as jest.Mocked<typeof driverApi>;

const loginResponse = (role: string) => ({
  accessToken: 'token-1',
  expiresIn: '12h',
  user: { id: 'u1', role, companyId: 'c1', email: null, phone: '+919845012301', employee: { id: 'e1', fullName: 'Ramesh Kumar' } },
});

const profile = { id: 'd1', driverCode: 'GR-D-101', employee: { fullName: 'Ramesh Kumar', preferredLanguage: 'KN' } };

describe('driver session', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    useSession.setState({ status: 'loading', token: null, driver: null, expiredMessage: false });
  });

  it('signs a driver in and keeps the token in secure storage', async () => {
    api.login.mockResolvedValue(loginResponse('DRIVER') as never);
    api.me.mockResolvedValue(profile as never);

    await useSession.getState().signIn('9845012301', 'passcode');

    expect(api.login).toHaveBeenCalledWith('+919845012301', 'passcode');
    expect(useSession.getState().status).toBe('signedIn');
    await expect(loadSession()).resolves.toMatchObject({ accessToken: 'token-1' });
  });

  it('refuses an office account, so only drivers use the driver app', async () => {
    api.login.mockResolvedValue(loginResponse('ADMIN') as never);

    await expect(useSession.getState().signIn('9845012301', 'passcode')).rejects.toBeInstanceOf(NotADriverError);
    expect(useSession.getState().status).not.toBe('signedIn');
    await expect(loadSession()).resolves.toBeNull();
  });

  it('restores a stored session on launch', async () => {
    await saveSession({ accessToken: 'token-1', expiresAt: Date.now() + 60_000, driverUserId: 'u1' });
    api.me.mockResolvedValue(profile as never);

    await useSession.getState().restore();

    expect(useSession.getState().status).toBe('signedIn');
    expect(useSession.getState().driver).toMatchObject({ driverCode: 'GR-D-101' });
  });

  it('starts signed out when there is nothing stored', async () => {
    await useSession.getState().restore();
    expect(useSession.getState().status).toBe('signedOut');
    expect(api.me).not.toHaveBeenCalled();
  });

  it('keeps the driver signed in when the network is down at launch', async () => {
    await saveSession({ accessToken: 'token-1', expiresAt: Date.now() + 60_000, driverUserId: 'u1' });
    const { ApiError } = jest.requireActual('../api/client') as typeof import('../api/client');
    api.me.mockRejectedValue(new ApiError('network', 0, 'offline'));

    await useSession.getState().restore();

    // A flaky network must not throw the driver back to the login screen.
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('signs out and explains why when the server rejects the session', async () => {
    await saveSession({ accessToken: 'stale', expiresAt: Date.now() + 60_000, driverUserId: 'u1' });
    const { ApiError } = jest.requireActual('../api/client') as typeof import('../api/client');
    api.me.mockRejectedValue(new ApiError('unauthorized', 401, 'no'));

    await useSession.getState().restore();

    expect(useSession.getState().status).toBe('signedOut');
    expect(useSession.getState().expiredMessage).toBe(true);
    await expect(loadSession()).resolves.toBeNull();
  });

  it('clears everything on logout', async () => {
    api.login.mockResolvedValue(loginResponse('DRIVER') as never);
    api.me.mockResolvedValue(profile as never);
    await useSession.getState().signIn('9845012301', 'passcode');

    await useSession.getState().signOut();

    expect(useSession.getState()).toMatchObject({ status: 'signedOut', token: null, driver: null });
    await expect(loadSession()).resolves.toBeNull();
  });
});
