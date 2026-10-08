import NetInfo from '@react-native-community/netinfo';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { initI18n } from '../../i18n';
import { accountApi } from '../../lib/api/account';
import { ApiError } from '../../lib/api/client';
import { useSession } from '../../lib/auth/session-store';
import type { SessionUser, UserRole } from '../../types/domain';
import ConsoleScreen from '../console';
import UnsupportedRoleScreen from '../unsupported-role';

jest.mock('../../lib/api/account', () => ({ accountApi: { webHandoff: jest.fn(), me: jest.fn() } }));

const handoff = jest.mocked(accountApi.webHandoff);
const net = jest.mocked(NetInfo);
const CODE = 'Q'.repeat(43);
const PAGE = 'https://gtransportt.vercel.app/admin';

const user = (role: UserRole): SessionUser => ({
  id: 'u1', role, companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false,
  displayName: 'Priya Office', email: 'priya@example.test', phone: null,
});

const signInAs = (role: UserRole) =>
  useSession.setState({ status: 'signedIn', token: 'native-token', user: user(role), role, driver: null, expiredMessage: false });

const webView = () => screen.getByTestId('console-webview');
const message = (data: unknown, url = PAGE) =>
  act(() => webView().props.onMessage({ nativeEvent: { data: JSON.stringify(data), url } }));

describe('office console in the app', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    net.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);
    handoff.mockResolvedValue({ code: CODE, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTING'] as const)('opens the production console for %s with a one-time code, not a token', async (role) => {
    signInAs(role);
    await render(<ConsoleScreen />);

    const view = await screen.findByTestId('console-webview');
    expect(handoff).toHaveBeenCalledWith('native-token');
    const uri = view.props.source.uri as string;
    expect(uri).toBe(`https://gtransportt.vercel.app/#handoff=${CODE}`);
    expect(uri).not.toContain('native-token');
    // Hardened as the console needs: HTTPS only, no file access, one window, downloads bridged.
    expect(view.props).toMatchObject({ mixedContentMode: 'never', allowFileAccess: false, setSupportMultipleWindows: false, domStorageEnabled: true });
    expect(view.props.injectedJavaScriptBeforeContentLoaded).toContain('createObjectURL');
  });

  it('keeps the console window on the console and hands other links to the phone', async () => {
    signInAs('ADMIN');
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<ConsoleScreen />);
    const decide = (await screen.findByTestId('console-webview')).props.onShouldStartLoadWithRequest;

    expect(decide({ url: 'https://gtransportt.vercel.app/admin/fleet', isTopFrame: true })).toBe(true);
    expect(decide({ url: 'https://evil.example.test/phish', isTopFrame: true })).toBe(false);
    expect(open).toHaveBeenCalledWith('https://evil.example.test/phish');
    expect(decide({ url: 'http://gtransportt.vercel.app/', isTopFrame: true })).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('says plainly when offline, and connects once the user retries online', async () => {
    signInAs('MANAGER');
    net.fetch.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false } as never);
    await render(<ConsoleScreen />);

    expect(await screen.findByText('No internet connection')).toBeTruthy();
    expect(handoff).not.toHaveBeenCalled();
    expect(screen.queryByTestId('console-webview')).toBeNull();

    await act(async () => fireEvent.press(screen.getByTestId('console-retry')));
    expect(await screen.findByTestId('console-webview')).toBeTruthy();
  });

  it('shows an error with retry when the page itself fails to load, with a fresh code', async () => {
    signInAs('ADMIN');
    await render(<ConsoleScreen />);
    await act(() => webView().props.onError({ nativeEvent: { description: 'net::ERR_NAME_NOT_RESOLVED' } }));
    expect(await screen.findByText('The office console could not be opened')).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId('console-retry')));
    expect(await screen.findByTestId('console-webview')).toBeTruthy();
    expect(handoff).toHaveBeenCalledTimes(2);
  });

  it('shows the real failure when the API has no handoff route (the stale-deployment case)', async () => {
    signInAs('ADMIN');
    handoff.mockRejectedValue(new ApiError('notFound', 404, 'Cannot POST /api/v1/auth/web-handoff', 'NOT_FOUND', 'req-123'));
    await render(<ConsoleScreen />);
    expect(await screen.findByText('The office console could not be opened')).toBeTruthy();
    expect(screen.getByTestId('console-error-detail').props.children).toBe('POST /auth/web-handoff · HTTP 404 · NOT_FOUND · request req-123');
    expect(screen.queryByTestId('console-webview')).toBeNull();
  });

  it('names the failing page without leaking the handoff code', async () => {
    signInAs('ADMIN');
    await render(<ConsoleScreen />);
    await act(() =>
      webView().props.onError({ nativeEvent: { url: `https://gtransportt.vercel.app/#handoff=${CODE}`, description: 'net::ERR_CONNECTION_RESET', code: -6 } }),
    );
    const detail = String(screen.getByTestId('console-error-detail').props.children);
    expect(detail).toBe('https://gtransportt.vercel.app/ · net::ERR_CONNECTION_RESET · code -6');
    expect(detail).not.toContain(CODE);
  });

  it('refuses an account the API will not hand over, offering only sign-out', async () => {
    signInAs('ADMIN');
    handoff.mockRejectedValue(new ApiError('forbidden', 403, 'Your role does not permit this action.'));
    await render(<ConsoleScreen />);
    expect(await screen.findByText('This account cannot open the office console')).toBeTruthy();
    expect(screen.queryByTestId('console-retry')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('console-sign-out')));
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('returns to the app’s sign-in when the console session ends — never to the driver app', async () => {
    signInAs('ACCOUNTING');
    await render(<ConsoleScreen />);
    await screen.findByTestId('console-webview');

    // Ignored from any other page.
    await message({ type: 'session-ended', reason: 'expired' }, 'https://example.test/');
    expect(useSession.getState().status).toBe('signedIn');

    await message({ type: 'session-ended', reason: 'expired' });
    await act(async () => undefined);
    expect(useSession.getState()).toMatchObject({ status: 'signedOut', role: null, token: null, expiredMessage: true });
  });
});

describe('an account with a role the app does not know', () => {
  beforeAll(async () => {
    await initI18n();
  });

  it('explains, and offers only a retry and sign-out', async () => {
    useSession.setState({ status: 'signedIn', token: 't', user: null, role: 'AUDITOR' as UserRole, driver: null, expiredMessage: false });
    await render(<UnsupportedRoleScreen />);
    expect(screen.getByText('This account type is not supported in the app')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('unsupported-sign-out')));
    expect(useSession.getState().status).toBe('signedOut');
  });
});
