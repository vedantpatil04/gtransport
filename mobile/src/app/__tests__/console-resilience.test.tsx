import NetInfo from '@react-native-community/netinfo';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { initI18n } from '../../i18n';
import { accountApi } from '../../lib/api/account';
import { ApiError } from '../../lib/api/client';
import { wakeApi } from '../../lib/api/warmup';
import { useSession } from '../../lib/auth/session-store';
import ConsoleScreen from '../console';

jest.mock('../../lib/api/account', () => ({ accountApi: { webHandoff: jest.fn(), me: jest.fn() } }));

const handoff = jest.mocked(accountApi.webHandoff);
const wake = jest.mocked(wakeApi);
const net = jest.mocked(NetInfo);
const CODE = 'Q'.repeat(43);

const signIn = () =>
  useSession.setState({
    status: 'signedIn',
    token: 'native-token',
    role: 'ADMIN',
    user: { id: 'u1', role: 'ADMIN', companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false, displayName: 'Priya', email: 'p@example.test', phone: null },
    driver: null,
    expiredMessage: false,
  });

/**
 * "The office console could not be opened" on a phone that was online: the API runs on a free-tier
 * instance that sleeps when idle and needs up to a minute to wake (a request to a cold instance was
 * measured at 53 s against production), while the app gave the handoff request 15 s and no repeat.
 */
describe('office console — a sleeping server', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    net.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);
    handoff.mockResolvedValue({ code: CODE, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    wake.mockResolvedValue(true);
    signIn();
  });

  afterEach(() => jest.useRealTimers());

  it('wakes the API first, and asks for the one-minute code only once it is up', async () => {
    const order: string[] = [];
    wake.mockImplementation(async () => {
      order.push('wake');
      return true;
    });
    handoff.mockImplementation(async () => {
      order.push('handoff');
      return { code: CODE, expiresAt: '' };
    });

    await render(<ConsoleScreen />);
    await screen.findByTestId('console-webview');

    expect(order).toEqual(['wake', 'handoff']);
  });

  it('explains a slow start instead of showing a bare spinner', async () => {
    jest.useFakeTimers();
    let wakeUp: (up: boolean) => void = () => undefined;
    wake.mockImplementation(() => new Promise<boolean>((resolve) => (wakeUp = resolve)));

    await render(<ConsoleScreen />);
    expect(await screen.findByText('Opening the office console…')).toBeTruthy();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(7_000);
    });
    expect(screen.getByText(/The server is waking up/)).toBeTruthy();

    await act(async () => {
      wakeUp(true);
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(await screen.findByTestId('console-webview')).toBeTruthy();
  });

  it('says the server is starting — not "offline" — when the phone is online but the API has not answered', async () => {
    handoff.mockRejectedValueOnce(new ApiError('timeout', 0, 'The server is taking too long to respond.'));
    await render(<ConsoleScreen />);

    expect(await screen.findByText('The server is starting up')).toBeTruthy();
    expect(screen.queryByText('No internet connection')).toBeNull();
    expect(screen.queryByTestId('console-webview')).toBeNull();

    // Try again once it is up: a fresh code, the console opens.
    await act(async () => fireEvent.press(screen.getByTestId('console-retry')));
    expect(await screen.findByTestId('console-webview')).toBeTruthy();
    expect(handoff).toHaveBeenCalledTimes(2);
  });

  it('still says "offline" when the phone itself has no connection', async () => {
    handoff.mockRejectedValueOnce(new ApiError('network', 0, 'Unable to connect right now.'));
    net.fetch
      .mockResolvedValueOnce({ isConnected: true, isInternetReachable: true } as never)
      .mockResolvedValueOnce({ isConnected: false, isInternetReachable: false } as never);

    await render(<ConsoleScreen />);
    expect(await screen.findByText('No internet connection')).toBeTruthy();
  });

  it('is configured for zoom on purpose: honours the page’s own viewport, keeps pinch zoom, hides the +/- widget, fixes text scale', async () => {
    await render(<ConsoleScreen />);
    const view = await screen.findByTestId('console-webview');

    expect(view.props).toMatchObject({
      scalesPageToFit: true,
      setBuiltInZoomControls: true,
      setDisplayZoomControls: false,
      textZoom: 100,
    });
  });

  it('keeps the server awake while the console is open, and stops when it is closed', async () => {
    jest.useFakeTimers();
    const view = await render(<ConsoleScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId('console-webview')).toBeTruthy();
    wake.mockClear();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(9 * 60_000 + 100);
    });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith(20_000);

    view.unmount();
    wake.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30 * 60_000);
    });
    expect(wake).not.toHaveBeenCalled();
  });
});
