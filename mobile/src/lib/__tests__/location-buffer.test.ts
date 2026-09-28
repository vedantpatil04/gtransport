import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  acknowledgeDropped, bufferStats, clearBuffer, enqueueFix, nextBatch, readBuffer, settleFixes,
} from '../location/buffer';
import type { LocationFixPayload } from '../../types/domain';

/**
 * The offline buffer is what stops a driver's positions being lost on the hill roads where there
 * is no signal for an hour at a time. The tests below pin the three promises it makes: nothing is
 * dropped for a mere network failure, nothing is stored twice, and the device's storage cannot grow
 * without bound.
 */

const BELAGAVI = { latitude: 15.85, longitude: 74.498 };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const fix = (id: string, minutes: number, over: Partial<LocationFixPayload> = {}): LocationFixPayload => ({
  ...BELAGAVI,
  capturedAt: minutesAgo(minutes),
  accuracyMeters: 10,
  clientSubmissionId: id,
  ...over,
});

describe('offline location buffer', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('holds a captured fix', async () => {
    const outcome = await enqueueFix(fix('a', 1));

    expect(outcome).toMatchObject({ result: 'queued', pending: 1 });
    expect(await readBuffer()).toHaveLength(1);
  });

  it('preserves the capture time exactly, however late the upload', async () => {
    const capturedAt = minutesAgo(240);
    await enqueueFix(fix('a', 0, { capturedAt }));

    // This is what makes the server's stationary timing correct for a fix uploaded four hours on.
    expect((await readBuffer())[0]!.capturedAt).toBe(capturedAt);
  });

  it('returns fixes oldest first, so the server sees the driver\'s day in order', async () => {
    await enqueueFix(fix('newest', 1));
    await enqueueFix(fix('oldest', 50));
    await enqueueFix(fix('middle', 20));

    expect((await readBuffer()).map((f) => f.clientSubmissionId)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('never holds the same fix twice', async () => {
    await enqueueFix(fix('a', 1));
    const again = await enqueueFix(fix('a', 1));

    // Android re-delivers a position after a task restart; that must not become two records.
    expect(again.result).toBe('duplicate');
    expect(await readBuffer()).toHaveLength(1);
  });

  it('refuses a fix the server has already accepted', async () => {
    await enqueueFix(fix('a', 1));
    await settleFixes(['a']);

    const resent = await enqueueFix(fix('a', 1));
    expect(resent.result).toBe('duplicate');
    expect(await readBuffer()).toHaveLength(0);
  });

  it('reports statistics for the driver\'s indicator', async () => {
    await enqueueFix(fix('old', 30));
    await enqueueFix(fix('new', 2));

    const stats = await bufferStats();
    expect(stats.pending).toBe(2);
    expect(stats.oldestCapturedAt).toBe((await readBuffer())[0]!.capturedAt);
    expect(stats.newestCapturedAt).toBe((await readBuffer())[1]!.capturedAt);
  });
});

describe('buffer bounds', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('drops the oldest fixes when the limit is reached, and says so', async () => {
    for (let i = 0; i < 5; i += 1) await enqueueFix(fix(`f${i}`, 50 - i), 5);

    const outcome = await enqueueFix(fix('newest', 1), 5);

    expect(outcome.dropped).toBe(1);
    const held = await readBuffer();
    expect(held).toHaveLength(5);
    // The newest position survives: where the driver is now matters more than this morning.
    expect(held.map((f) => f.clientSubmissionId)).toContain('newest');
    expect(held.map((f) => f.clientSubmissionId)).not.toContain('f0');
  });

  it('counts every dropped fix so the loss is reported, not hidden', async () => {
    for (let i = 0; i < 10; i += 1) await enqueueFix(fix(`f${i}`, 100 - i), 3);

    expect((await bufferStats()).dropped).toBe(7);

    await acknowledgeDropped();
    expect((await bufferStats()).dropped).toBe(0);
  });

  it('keeps a long offline spell within its bound', async () => {
    // Eight hours at one fix a minute, with a 100-fix ceiling.
    for (let minute = 480; minute > 0; minute -= 1) await enqueueFix(fix(`m${minute}`, minute), 100);

    const stats = await bufferStats();
    expect(stats.pending).toBe(100);
    expect(stats.dropped).toBe(380);
  });
});

describe('batching and settlement', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('offers no more than one batch at a time', async () => {
    for (let i = 0; i < 12; i += 1) await enqueueFix(fix(`f${i}`, 30 - i));

    const batch = await nextBatch(5);
    expect(batch).toHaveLength(5);
    // Oldest first: the batch is the front of the queue, not an arbitrary slice.
    expect(batch[0]!.clientSubmissionId).toBe('f0');
  });

  it('removes only what the server accounted for', async () => {
    for (const id of ['a', 'b', 'c']) await enqueueFix(fix(id, 10));

    const remaining = await settleFixes(['a', 'b']);

    expect(remaining).toBe(1);
    expect((await readBuffer()).map((f) => f.clientSubmissionId)).toEqual(['c']);
  });

  it('keeps everything when a failed upload settles nothing', async () => {
    for (const id of ['a', 'b']) await enqueueFix(fix(id, 10));

    // A network failure reports no outcomes, so nothing is settled and nothing is lost.
    expect(await settleFixes([])).toBe(2);
    expect(await readBuffer()).toHaveLength(2);
  });

  it('forgets a driver\'s positions on sign-out', async () => {
    await enqueueFix(fix('a', 1));
    await clearBuffer();

    expect(await readBuffer()).toHaveLength(0);
    expect((await bufferStats()).dropped).toBe(0);
  });

  it('behaves as empty rather than crashing when storage holds something corrupt', async () => {
    await AsyncStorage.setItem('gangamata.location.buffer', 'not json');

    expect(await readBuffer()).toEqual([]);
    // And a new fix can still be stored on top of the damaged value.
    expect((await enqueueFix(fix('a', 1))).result).toBe('queued');
  });
});
