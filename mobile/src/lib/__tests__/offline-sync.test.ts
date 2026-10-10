import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { ApiError } from '../api/client';
import { useSession } from '../auth/session-store';
import { offlineQueue } from '../offline/queue';
import { requestSync, startQueueSync } from '../offline/sync';

const mockNet: { listener: ((state: unknown) => void) | null; reachable: boolean } = { listener: null, reachable: true };
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: unknown) => void) => {
      mockNet.listener = listener;
      return () => {
        mockNet.listener = null;
      };
    },
    fetch: async () => ({ isConnected: mockNet.reachable, isInternetReachable: mockNet.reachable }),
  },
}));

const mockApp: { listener: ((state: string) => void) | null } = { listener: null };

const settle = () => jest.advanceTimersByTimeAsync(50);
const netEvent = (reachable: boolean) => {
  mockNet.reachable = reachable;
  mockNet.listener?.({ isConnected: reachable, isInternetReachable: reachable });
};

describe('queue sync triggers', () => {
  const handler = jest.fn();
  let stop: () => void = () => undefined;

  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    handler.mockReset();
    mockNet.reachable = true;
    mockNet.listener = null;
    mockApp.listener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
      mockApp.listener = listener;
      return { remove: () => (mockApp.listener = null) };
    }) as never);
    offlineQueue.register('test.entry', handler);
    offlineQueue.setClassifier((error) => ((error as ApiError).kind === 'unauthorized' ? 'halt' : 'retry'));
    offlineQueue.setStopsPass(() => true);
    offlineQueue.setOwnerResolver(() => 'driver-1');
    useSession.setState({ token: 'token-1', status: 'signedIn', user: { id: 'driver-1' } as never });
    await offlineQueue.clear();
  });

  afterEach(() => {
    stop();
    stop = () => undefined;
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const queueOne = (id = 'e1') => offlineQueue.enqueue({ kind: 'test.entry', payload: { id }, dedupeKey: id });

  it('sends what is waiting as soon as the app starts', async () => {
    await queueOne();
    handler.mockResolvedValue(undefined);
    stop = startQueueSync();
    await settle();

    expect(handler).toHaveBeenCalledTimes(1);
    await expect(offlineQueue.list()).resolves.toHaveLength(0);
  });

  it('keeps everything while signed out, and sends it once the driver signs in again', async () => {
    useSession.setState({ token: null, status: 'signedOut' });
    await queueOne();
    handler.mockResolvedValue(undefined);
    stop = startQueueSync();
    await settle();
    expect(handler).not.toHaveBeenCalled();
    await expect(offlineQueue.list()).resolves.toHaveLength(1);

    useSession.setState({ token: 'token-2', status: 'signedIn' });
    await settle();

    expect(handler).toHaveBeenCalledTimes(1);
    await expect(offlineQueue.list()).resolves.toHaveLength(0);
  });

  it('retries by itself after a failure — but not before its backoff time, and not in a tight loop', async () => {
    await queueOne();
    handler.mockRejectedValueOnce(new ApiError('network', 0, 'offline')).mockResolvedValue(undefined);
    stop = startQueueSync();
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    const [waiting] = await offlineQueue.list();
    expect(waiting).toMatchObject({ status: 'failed', attempts: 1 });

    await jest.advanceTimersByTimeAsync(10_000);
    expect(handler).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(10_000);
    expect(handler).toHaveBeenCalledTimes(2);
    await expect(offlineQueue.list()).resolves.toHaveLength(0);
  });

  it('retries when the phone regains a connection, without waiting out the delay', async () => {
    netEvent(false);
    await queueOne();
    handler.mockRejectedValueOnce(new ApiError('network', 0, 'offline')).mockResolvedValue(undefined);
    stop = startQueueSync();
    netEvent(false);
    await settle();
    expect(handler).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(4_000);
    netEvent(true);
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);

    // Dropped again, then back: another explicit pass sends it, long before its 15 s retry time.
    await jest.advanceTimersByTimeAsync(4_000);
    netEvent(false);
    netEvent(true);
    await settle();
    expect(handler).toHaveBeenCalledTimes(2);
    await expect(offlineQueue.list()).resolves.toHaveLength(0);
  });

  it('retries when the app returns to the foreground', async () => {
    await queueOne();
    handler.mockRejectedValueOnce(new ApiError('server', 503, 'waking')).mockResolvedValue(undefined);
    stop = startQueueSync();
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(4_000);
    mockApp.listener?.('active');
    await settle();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('coalesces triggers that arrive together into one pass', async () => {
    await queueOne();
    handler.mockRejectedValue(new ApiError('network', 0, 'offline'));
    stop = startQueueSync();
    netEvent(true);
    mockApp.listener?.('active');
    await settle();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('pauses on an expired session without spending an attempt, and leaves no timer spinning', async () => {
    await queueOne();
    handler.mockRejectedValue(new ApiError('unauthorized', 401, 'expired'));
    stop = startQueueSync();
    await settle();

    expect(handler).toHaveBeenCalledTimes(1);
    const [kept] = await offlineQueue.list();
    expect(kept).toMatchObject({ status: 'pending', attempts: 0 });

    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does nothing for an offline phone except check back occasionally', async () => {
    await queueOne();
    mockNet.reachable = false;
    stop = startQueueSync();
    await settle();
    expect(handler).not.toHaveBeenCalled();

    // Back online without a network event ever arriving: the slow check-in still finds it.
    mockNet.reachable = true;
    handler.mockResolvedValue(undefined);
    await jest.advanceTimersByTimeAsync(61_000);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a manual retry always tries, even if the phone believes it is offline', async () => {
    await queueOne();
    mockNet.reachable = false;
    handler.mockResolvedValue(undefined);
    await requestSync('manual');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
