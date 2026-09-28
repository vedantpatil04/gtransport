import locationState from './contracts/location-state.json';
import locationsSubmit from './contracts/locations-submit.json';
import locationsDuplicate from './contracts/locations-duplicate.json';
import locationsRejected from './contracts/locations-rejected.json';
import locationsMine from './contracts/locations-mine.json';
import { locationsApi } from '../api/locations';
import { savePolicy, syncBuffer } from '../location/tracking';
import { enqueueFix, readBuffer } from '../location/buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationFixPayload, TrackingPolicy } from '../../types/domain';

/**
 * Replays the real API responses — captured from the running backend by
 * backend/test/mobile-contract.e2e-spec.ts — through the app's own code.
 *
 * Phase 2's login bug got through because the tests mocked the shape the app assumed rather than
 * the one the server sends. These fixtures are what the server actually returns, so a renamed field
 * fails here instead of silently stopping tracking on a driver's phone.
 */

const respond = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const mockFetch = (fn: jest.Mock) => {
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
};

const POLICY: TrackingPolicy = {
  movingIntervalSeconds: 60,
  stationaryIntervalSeconds: 900,
  distanceMeters: 150,
  bufferLimit: 100,
  maxBatchSize: 10,
  staleAfterMinutes: 15,
};

const fix = (id: string): LocationFixPayload => ({
  latitude: 15.85,
  longitude: 74.498,
  capturedAt: new Date(Date.now() - 60_000).toISOString(),
  accuracyMeters: 9,
  clientSubmissionId: id,
});

describe('location contract — real responses through mobile code', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await savePolicy(POLICY);
  });

  it('reads the tracking policy out of the real state report', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(200, locationState)));

    const response = await locationsApi.reportState('token', { permission: 'GRANTED_ALWAYS', locationServicesEnabled: true });

    // These are the numbers the background task spaces its fixes by; a rename stops tracking dead.
    expect(response.trackingPolicy.movingIntervalSeconds).toEqual(expect.any(Number));
    expect(response.trackingPolicy.stationaryIntervalSeconds).toEqual(expect.any(Number));
    expect(response.trackingPolicy.distanceMeters).toEqual(expect.any(Number));
    expect(response.trackingPolicy.bufferLimit).toEqual(expect.any(Number));
    expect(response.trackingPolicy.maxBatchSize).toEqual(expect.any(Number));
    expect(response.trackingState).toEqual(expect.any(String));
  });

  it('settles a buffered fix against the real success response', async () => {
    const ids = (locationsSubmit.results as { clientSubmissionId: string }[]).map((r) => r.clientSubmissionId);
    for (const id of ids) await enqueueFix(fix(id), POLICY.bufferLimit);

    mockFetch(jest.fn().mockResolvedValue(respond(200, locationsSubmit)));

    const outcome = await syncBuffer('token');

    expect(outcome.uploaded).toBe(locationsSubmit.stored);
    // The whole buffer model rests on reading these results correctly.
    expect(await readBuffer()).toHaveLength(0);
  });

  it('treats the real duplicate response as settled, not as a failure to retry', async () => {
    const id = (locationsDuplicate.results as { clientSubmissionId: string }[])[0]!.clientSubmissionId;
    await enqueueFix(fix(id), POLICY.bufferLimit);

    mockFetch(jest.fn().mockResolvedValue(respond(200, locationsDuplicate)));

    const outcome = await syncBuffer('token');

    expect(outcome.duplicates).toBe(1);
    expect(outcome.failure).toBeUndefined();
    // A fix that already reached the server would otherwise be retried for ever.
    expect(await readBuffer()).toHaveLength(0);
  });

  it('stops retrying a fix the real response reports as permanently rejected', async () => {
    const rejected = (locationsRejected.results as { clientSubmissionId: string; reason?: string }[])[0]!;
    await enqueueFix(fix(rejected.clientSubmissionId), POLICY.bufferLimit);

    mockFetch(jest.fn().mockResolvedValue(respond(200, locationsRejected)));

    const outcome = await syncBuffer('token');

    expect(outcome.rejected).toBe(1);
    expect(rejected.reason).toEqual(expect.any(String));
    expect(await readBuffer()).toHaveLength(0);
  });

  it('reads the driver\'s own fixes as numbers, which is what a map consumes', async () => {
    mockFetch(jest.fn().mockResolvedValue(respond(200, locationsMine)));

    const page = await locationsApi.mine('token', { limit: 5 });

    expect(Array.isArray(page.data)).toBe(true);
    for (const item of page.data) {
      expect(typeof item.latitude).toBe('number');
      expect(typeof item.longitude).toBe('number');
      expect(typeof item.capturedAt).toBe('string');
      // A bigint id crosses the wire as a string: JavaScript would lose precision past 2^53.
      expect(typeof item.id).toBe('string');
    }
  });

  it('sends no driver or vehicle identity, because the server resolves both', async () => {
    await enqueueFix(fix('contract-scope'), POLICY.bufferLimit);
    const fetchMock = jest.fn().mockResolvedValue(
      respond(200, {
        stored: 1,
        duplicates: 0,
        rejected: 0,
        results: [{ clientSubmissionId: 'contract-scope', outcome: 'stored' }],
        state: { status: 'ACTIVE', trackingState: 'TRACKING_ACTIVE', lastSeenAt: null },
        alertRaised: false,
      }),
    );
    mockFetch(fetchMock);

    await syncBuffer('token');

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toContain('/api/v1/locations');
    const body = JSON.parse(init.body) as { fixes: Record<string, unknown>[] };
    expect(body.fixes[0]).not.toHaveProperty('driverId');
    expect(body.fixes[0]).not.toHaveProperty('vehicleId');
    // Identity travels in the token, and nowhere else.
    expect(init.headers.Authorization).toBe('Bearer token');
  });
});
