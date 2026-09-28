import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { bufferStats, readBuffer } from '../location/buffer';
import {
  ensureTracking, handleLocations, LOCATION_TASK, savePolicy, startTracking, stopTracking,
  syncBuffer, toFixPayload,
} from '../location/tracking';
import type { TrackingPolicy } from '../../types/domain';

/**
 * The background tracker, end to end within the app: a fix arrives from the OS, is buffered, and is
 * uploaded — or is kept safely when the upload fails.
 *
 * The behaviour worth protecting is the ordering. The fix goes to disk *before* the upload is
 * attempted, so a failure at the worst possible moment — which is exactly when drivers are out of
 * signal — cannot lose a position.
 */

const mockedLocation = Location as unknown as {
  startLocationUpdatesAsync: jest.Mock;
  stopLocationUpdatesAsync: jest.Mock;
  hasStartedLocationUpdatesAsync: jest.Mock;
  hasServicesEnabledAsync: jest.Mock;
  getForegroundPermissionsAsync: jest.Mock;
  getBackgroundPermissionsAsync: jest.Mock;
  __started: Set<string>;
};

const granted = { status: 'granted', canAskAgain: true };
const denied = { status: 'denied', canAskAgain: true };

const POLICY: TrackingPolicy = {
  movingIntervalSeconds: 60,
  stationaryIntervalSeconds: 900,
  distanceMeters: 150,
  bufferLimit: 50,
  maxBatchSize: 10,
  staleAfterMinutes: 15,
};

const platformFix = (over: Partial<Location.LocationObject['coords']> = {}, timestamp = Date.now()): Location.LocationObject =>
  ({
    coords: {
      latitude: 15.85,
      longitude: 74.498,
      accuracy: 9,
      altitude: 751,
      altitudeAccuracy: 3,
      heading: 190,
      speed: 12.5,
      ...over,
    },
    timestamp,
  }) as Location.LocationObject;

const mockFetch = (fn: jest.Mock) => {
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
};
const respond = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

const accepted = (ids: string[]) =>
  respond(200, {
    stored: ids.length,
    duplicates: 0,
    rejected: 0,
    results: ids.map((clientSubmissionId) => ({ clientSubmissionId, outcome: 'stored' })),
    state: { status: 'ACTIVE', trackingState: 'TRACKING_ACTIVE', lastSeenAt: new Date().toISOString() },
    alertRaised: false,
  });

describe('turning a platform reading into a payload', () => {
  it('carries everything the office needs, and no identity', () => {
    const payload = toFixPayload(platformFix(), 'sub-1');

    expect(payload).toMatchObject({ latitude: 15.85, longitude: 74.498, accuracyMeters: 9, altitudeMeters: 751, headingDeg: 190 });
    // The API resolves driver and vehicle from the session; the app has no business naming either.
    expect(payload).not.toHaveProperty('driverId');
    expect(payload).not.toHaveProperty('vehicleId');
    expect(payload.clientSubmissionId).toBe('sub-1');
  });

  it('converts speed from metres per second to km/h, which is what the office reads', () => {
    expect(toFixPayload(platformFix({ speed: 12.5 }), 'sub-1').speedKmh).toBeCloseTo(45, 0);
  });

  it('keeps the device capture time, not the time of upload', () => {
    const captured = Date.parse('2026-03-04T06:30:00.000Z');
    expect(toFixPayload(platformFix({}, captured), 'sub-1').capturedAt).toBe('2026-03-04T06:30:00.000Z');
  });

  it('drops a heading of -1, which means unknown rather than due north', () => {
    // A stationary device reports -1. Sent as a number it would appear on the map as a direction.
    expect(toFixPayload(platformFix({ heading: -1 }), 'sub-1').headingDeg).toBeUndefined();
  });

  it('drops a negative speed and any non-finite reading', () => {
    expect(toFixPayload(platformFix({ speed: -1 }), 'sub-1').speedKmh).toBeUndefined();
    expect(toFixPayload(platformFix({ accuracy: Number.NaN }), 'sub-1').accuracyMeters).toBeUndefined();
    expect(toFixPayload(platformFix({ altitude: null }), 'sub-1').altitudeMeters).toBeUndefined();
  });
});

describe('starting and stopping background tracking', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockedLocation.__started.clear();
    await AsyncStorage.clear();
    mockedLocation.hasServicesEnabledAsync.mockResolvedValue(true);
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue(granted);
    mockedLocation.getBackgroundPermissionsAsync.mockResolvedValue(granted);
  });

  it('defines the background task at module scope, so the OS can find it', () => {
    // The OS starts a fresh JavaScript context with no app on screen; a task defined inside a
    // component would not exist there.
    expect(TaskManager.isTaskDefined(LOCATION_TASK)).toBe(true);
  });

  it('starts tracking when the platform genuinely allows it', async () => {
    const result = await startTracking(POLICY);

    expect(result.started).toBe(true);
    expect(mockedLocation.startLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK, expect.objectContaining({
      distanceInterval: POLICY.distanceMeters,
      timeInterval: POLICY.movingIntervalSeconds * 1_000,
      // iOS would otherwise suspend updates for a device it judges stationary — the one case the
      // office most needs reported.
      pausesUpdatesAutomatically: false,
    }));
    // Android requires a visible notification for background location.
    expect(mockedLocation.startLocationUpdatesAsync.mock.calls[0]![1].foregroundService).toBeDefined();
  });

  it('does not start when location services are off', async () => {
    mockedLocation.hasServicesEnabledAsync.mockResolvedValue(false);

    expect(await startTracking(POLICY)).toEqual({ started: false, reason: 'services' });
    expect(mockedLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('does not start without foreground permission', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue(denied);
    expect(await startTracking(POLICY)).toEqual({ started: false, reason: 'permission' });
  });

  it('does not start without background permission', async () => {
    mockedLocation.getBackgroundPermissionsAsync.mockResolvedValue(denied);

    // Registering a background task that the OS will not honour would report tracking as working
    // while silently delivering nothing once the app leaves the screen.
    expect(await startTracking(POLICY)).toEqual({ started: false, reason: 'background-permission' });
    expect(mockedLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('does not register the task twice', async () => {
    await startTracking(POLICY);
    await startTracking(POLICY);

    expect(mockedLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it('reports a platform refusal instead of throwing into a background context', async () => {
    mockedLocation.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('unsupported'));
    expect(await startTracking(POLICY)).toEqual({ started: false, reason: 'platform' });
  });

  it('re-registers a task the operating system killed', async () => {
    await startTracking(POLICY);
    // Android stops long-running services under memory pressure, and a reboot clears everything.
    mockedLocation.__started.clear();

    await ensureTracking({ policy: POLICY });

    expect(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)).toBe(true);
  });

  it('stops tracking when it is deliberately paused', async () => {
    await startTracking(POLICY);

    const snapshot = await ensureTracking({ paused: true, policy: POLICY });

    expect(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)).toBe(false);
    expect(snapshot.state).toBe('TRACKING_PAUSED');
  });

  it('stops quietly when nothing was running', async () => {
    await expect(stopTracking()).resolves.toBeUndefined();
  });
});

describe('capturing and uploading a fix', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockedLocation.__started.clear();
    await AsyncStorage.clear();
    await SecureStore.setItemAsync(
      'gangamata.session',
      JSON.stringify({ accessToken: 'test-token', expiresAt: Date.now() + 3_600_000, userId: 'u1', role: 'DRIVER' }),
    );
    await savePolicy(POLICY);
    mockedLocation.hasServicesEnabledAsync.mockResolvedValue(true);
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue(granted);
    mockedLocation.getBackgroundPermissionsAsync.mockResolvedValue(granted);
  });

  it('buffers a fix and uploads it', async () => {
    const fetchMock = jest.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { fixes: { clientSubmissionId: string }[] };
      return accepted(body.fixes.map((f) => f.clientSubmissionId));
    });
    mockFetch(fetchMock);

    await handleLocations([platformFix()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Accepted, so nothing is left waiting.
    expect(await readBuffer()).toHaveLength(0);
  });

  it('keeps the fix when the upload fails, because that is when it matters most', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));

    await handleLocations([platformFix()]);

    // Buffered before the upload was attempted: a driver out of signal loses nothing.
    expect(await readBuffer()).toHaveLength(1);
  });

  it('uploads a whole batch the OS delivered at once', async () => {
    const fetchMock = jest.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { fixes: { clientSubmissionId: string }[] };
      return accepted(body.fixes.map((f) => f.clientSubmissionId));
    });
    mockFetch(fetchMock);

    await handleLocations([platformFix({}, Date.now() - 120_000), platformFix({}, Date.now() - 60_000), platformFix()]);

    // One request, not three: batched delivery is what keeps this affordable on these networks.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body).fixes).toHaveLength(3);
  });

  it('gives every fix a distinct submission id', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));

    await handleLocations([platformFix({}, Date.now() - 60_000), platformFix()]);

    const ids = (await readBuffer()).map((f) => f.clientSubmissionId);
    expect(new Set(ids).size).toBe(2);
  });

  it('drains the backlog when connectivity returns, oldest first', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    for (let minute = 5; minute >= 1; minute -= 1) await handleLocations([platformFix({}, Date.now() - minute * 60_000)]);
    expect((await bufferStats()).pending).toBe(5);

    const sent: string[][] = [];
    mockFetch(
      jest.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { fixes: { clientSubmissionId: string; capturedAt: string }[] };
        sent.push(body.fixes.map((f) => f.capturedAt));
        return accepted(body.fixes.map((f) => f.clientSubmissionId));
      }),
    );

    const outcome = await syncBuffer('test-token');

    expect(outcome.uploaded).toBe(5);
    expect(outcome.pending).toBe(0);
    // The server's stationary timeline depends on seeing the driver's day in order.
    const times = sent.flat().map((t) => Date.parse(t));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('splits a long backlog into batches the server accepts', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    for (let minute = 25; minute >= 1; minute -= 1) await handleLocations([platformFix({}, Date.now() - minute * 60_000)]);

    const sizes: number[] = [];
    mockFetch(
      jest.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { fixes: { clientSubmissionId: string }[] };
        sizes.push(body.fixes.length);
        return accepted(body.fixes.map((f) => f.clientSubmissionId));
      }),
    );

    await syncBuffer('test-token');

    expect(sizes.every((size) => size <= POLICY.maxBatchSize)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(25);
  });

  it('drops a fix the server will never accept, rather than retrying it for ever', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    await handleLocations([platformFix()]);
    const [held] = await readBuffer();

    mockFetch(
      jest.fn().mockResolvedValue(
        respond(200, {
          stored: 0,
          duplicates: 0,
          rejected: 1,
          results: [{ clientSubmissionId: held!.clientSubmissionId, outcome: 'rejected', reason: 'coordinates', message: 'bad' }],
          state: { status: 'ACTIVE', trackingState: 'TRACKING_ACTIVE', lastSeenAt: null },
          alertRaised: false,
        }),
      ),
    );

    const outcome = await syncBuffer('test-token');

    expect(outcome.rejected).toBe(1);
    // Settled, not retried: a permanently refused fix would otherwise block the queue behind it.
    expect(await readBuffer()).toHaveLength(0);
  });

  it('settles a duplicate exactly as it settles a stored fix', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    await handleLocations([platformFix()]);
    const [held] = await readBuffer();

    mockFetch(
      jest.fn().mockResolvedValue(
        respond(200, {
          stored: 0,
          duplicates: 1,
          rejected: 0,
          results: [{ clientSubmissionId: held!.clientSubmissionId, outcome: 'duplicate' }],
          state: { status: 'ACTIVE', trackingState: 'TRACKING_ACTIVE', lastSeenAt: null },
          alertRaised: false,
        }),
      ),
    );

    const outcome = await syncBuffer('test-token');

    // The first upload did reach the server; there is nothing left to do.
    expect(outcome.duplicates).toBe(1);
    expect(await readBuffer()).toHaveLength(0);
  });

  it('keeps everything and reports why when the session has expired', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    await handleLocations([platformFix()]);

    mockFetch(jest.fn().mockResolvedValue(respond(401, { error: { message: 'expired', code: 'UNAUTHORIZED' } })));

    const outcome = await syncBuffer('test-token');

    expect(outcome.failure).toBe('unauthorized');
    // Signing in again must not have cost the driver their positions.
    expect(await readBuffer()).toHaveLength(1);
  });

  it('does nothing, and reports nothing wrong, with an empty buffer', async () => {
    const fetchMock = jest.fn();
    mockFetch(fetchMock);

    expect(await syncBuffer('test-token')).toMatchObject({ uploaded: 0, pending: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the honest state after a pass, for the office', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    await handleLocations([platformFix()]);

    const snapshot = await ensureTracking({ policy: POLICY });

    expect(snapshot.state).toBe('SYNC_PENDING');
    expect(snapshot.pendingUploads).toBe(1);
    expect(snapshot.taskRegistered).toBe(true);
  });

  it('reports missing background permission rather than claiming to track', async () => {
    mockedLocation.getBackgroundPermissionsAsync.mockResolvedValue(denied);
    mockFetch(jest.fn());

    const snapshot = await ensureTracking({ policy: POLICY });

    expect(snapshot.state).toBe('BACKGROUND_PERMISSION_MISSING');
    expect(snapshot.taskRegistered).toBe(false);
  });
});
