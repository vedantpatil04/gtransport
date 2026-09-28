import { clearSession, loadSession, saveSession } from '../storage/secure';
import { toIdentifier, useSession } from '../auth/session-store';
import { accountApi } from '../api/account';
import { driverApi } from '../api/driver';
import type { SessionUser, UserRole } from '../../types/domain';

jest.mock('../api/account', () => ({
  accountApi: { login: jest.fn(), me: jest.fn(), changePassword: jest.fn() },
}));
jest.mock('../api/driver', () => ({
  driverApi: { me: jest.fn(), reportLocationState: jest.fn() },
}));

const account = accountApi as jest.Mocked<typeof accountApi>;
const drivers = driverApi as jest.Mocked<typeof driverApi>;

const user = (role: UserRole, extra: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1',
  role,
  companyId: 'c1',
  employeeId: 'e1',
  driverId: role === 'DRIVER' ? 'd1' : null,
  status: 'ACTIVE',
  mustChangePassword: false,
  displayName: 'Ramesh Kumar',
  email: null,
  phone: '+919845012301',
  ...extra,
});
const loginResponse = (role: UserRole, extra: Partial<SessionUser> = {}) => ({
  accessToken: 'token-1',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  expiresIn: '12h',
  user: user(role, extra),
});
const profile = { id: 'd1', driverCode: 'GR-D-101', employee: { fullName: 'Ramesh Kumar', preferredLanguage: 'KN' } };
const reset = () => useSession.setState({ status: 'loading', token: null, user: null, role: null, driver: null, expiredMessage: false });

describe('session', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    reset();
  });

  it('signs a driver in, loads the driver profile and keeps the token in secure storage', async () => {
    account.login.mockResolvedValue(loginResponse('DRIVER'));
    drivers.me.mockResolvedValue(profile as never);

    await useSession.getState().signIn('98450 12301', 'passcode');

    expect(account.login).toHaveBeenCalledWith('+919845012301', 'passcode');
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', role: 'DRIVER', driver: { driverCode: 'GR-D-101' } });
    await expect(loadSession()).resolves.toMatchObject({ accessToken: 'token-1', userId: 'u1', role: 'DRIVER' });
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTING'] as UserRole[])('lets a %s sign in (no driver profile is requested)', async (role) => {
    account.login.mockResolvedValue(loginResponse(role, { email: 'office@gangamata.in', phone: null }));

    await useSession.getState().signIn('Office@Gangamata.in', 'password1');

    expect(account.login).toHaveBeenCalledWith('office@gangamata.in', 'password1');
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', role, driver: null });
    expect(drivers.me).not.toHaveBeenCalled();
  });

  it('holds a temporary-password session without loading anything else', async () => {
    account.login.mockResolvedValue(loginResponse('DRIVER', { mustChangePassword: true, status: 'INVITED' }));

    await useSession.getState().signIn('9845012301', 'Kp7m-X3qa');

    expect(useSession.getState().user?.mustChangePassword).toBe(true);
    expect(drivers.me).not.toHaveBeenCalled();
  });

  it('changes the password and continues on the fresh token', async () => {
    account.login.mockResolvedValue(loginResponse('DRIVER', { mustChangePassword: true, status: 'INVITED' }));
    await useSession.getState().signIn('9845012301', 'Kp7m-X3qa');
    account.changePassword.mockResolvedValue({ ...loginResponse('DRIVER'), accessToken: 'token-2' });
    drivers.me.mockResolvedValue(profile as never);

    await useSession.getState().changePassword('Kp7m-X3qa', 'trucks-2026');

    expect(account.changePassword).toHaveBeenCalledWith('token-1', 'Kp7m-X3qa', 'trucks-2026');
    expect(useSession.getState()).toMatchObject({ token: 'token-2', user: { mustChangePassword: false }, driver: { driverCode: 'GR-D-101' } });
    await expect(loadSession()).resolves.toMatchObject({ accessToken: 'token-2' });
  });

  it('restores a stored session and reads the current role from /auth/me', async () => {
    await saveSession({ accessToken: 'token-1', expiresAt: Date.now() + 60_000, userId: 'u1', role: 'DRIVER' });
    // Promoted while away: the fresh role wins over the stored one.
    account.me.mockResolvedValue(user('MANAGER'));

    await useSession.getState().restore();

    expect(useSession.getState()).toMatchObject({ status: 'signedIn', role: 'MANAGER', driver: null });
    expect(drivers.me).not.toHaveBeenCalled();
  });

  it('restores a driver with the driver profile', async () => {
    await saveSession({ accessToken: 'token-1', expiresAt: Date.now() + 60_000, userId: 'u1', role: 'DRIVER' });
    account.me.mockResolvedValue(user('DRIVER'));
    drivers.me.mockResolvedValue(profile as never);

    await useSession.getState().restore();

    expect(useSession.getState().driver).toMatchObject({ driverCode: 'GR-D-101' });
  });

  it('starts signed out when there is nothing stored', async () => {
    await useSession.getState().restore();
    expect(useSession.getState().status).toBe('signedOut');
    expect(account.me).not.toHaveBeenCalled();
  });

  it('keeps the stored role when the network is down at launch, so the right app still opens', async () => {
    await saveSession({ accessToken: 'token-1', expiresAt: Date.now() + 60_000, userId: 'u1', role: 'ACCOUNTING' });
    const { ApiError } = jest.requireActual('../api/client') as typeof import('../api/client');
    account.me.mockRejectedValue(new ApiError('network', 0, 'offline'));

    await useSession.getState().restore();

    expect(useSession.getState()).toMatchObject({ status: 'signedIn', role: 'ACCOUNTING', user: null });
  });

  it('signs out and explains why when the server rejects the session', async () => {
    await saveSession({ accessToken: 'stale', expiresAt: Date.now() + 60_000, userId: 'u1', role: 'DRIVER' });
    const { ApiError } = jest.requireActual('../api/client') as typeof import('../api/client');
    account.me.mockRejectedValue(new ApiError('unauthorized', 401, 'no'));

    await useSession.getState().restore();

    expect(useSession.getState()).toMatchObject({ status: 'signedOut', expiredMessage: true, role: null });
    await expect(loadSession()).resolves.toBeNull();
  });

  it('clears everything on logout', async () => {
    account.login.mockResolvedValue(loginResponse('ADMIN'));
    await useSession.getState().signIn('admin@gangamata.in', 'password1');

    await useSession.getState().signOut();

    expect(useSession.getState()).toMatchObject({ status: 'signedOut', token: null, user: null, role: null, driver: null });
    await expect(loadSession()).resolves.toBeNull();
  });

  it('turns what was typed into the identifier the API stores', () => {
    expect(toIdentifier('98450 12301')).toBe('+919845012301');
    expect(toIdentifier(' Office@Gangamata.IN ')).toBe('office@gangamata.in');
  });
});
