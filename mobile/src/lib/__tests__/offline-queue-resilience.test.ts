import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineQueue, retryDelayMs, visibleTo } from '../offline/queue';

const item = (id: string, kind = 'fuel.create') => ({ kind, payload: { id }, dedupeKey: id });
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('retryDelayMs — bounded backoff', () => {
  it('doubles from 15 s, never beyond 15 minutes, with at most 20% jitter', () => {
    const none = () => 0;
    const full = () => 1;
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(n, none))).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 480_000]);
    expect(retryDelayMs(7, none)).toBe(900_000);
    expect(retryDelayMs(500, none)).toBe(900_000);
    expect(retryDelayMs(1, full)).toBe(18_000);
    expect(retryDelayMs(500, full)).toBe(1_080_000);
  });
});

describe('offline queue — resilience', () => {
  let queue: OfflineQueue;

  beforeEach(async () => {
    await AsyncStorage.clear();
    queue = new OfflineQueue();
  });

  describe('retry timing', () => {
    it('schedules the next attempt in the future and records why it failed, with the API reference', async () => {
      queue.register('fuel.create', jest.fn().mockRejectedValue(Object.assign(new Error('Server error'), { ref: 'req-77' })));
      queue.setDescriber((error) => ({ message: (error as Error).message, requestId: (error as { ref?: string }).ref }));
      await queue.enqueue(item('a'));

      const before = Date.now();
      await queue.drain();

      const [saved] = await queue.list();
      expect(saved).toMatchObject({ status: 'failed', attempts: 1, lastError: 'Server error', lastRequestId: 'req-77' });
      expect(saved!.nextAttemptAt!).toBeGreaterThanOrEqual(before + 15_000);
      expect(saved!.nextAttemptAt!).toBeLessThanOrEqual(Date.now() + 18_000);
    });

    it('a timer-driven pass leaves an entry alone until its retry time, but an explicit pass tries it at once', async () => {
      const handler = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
      queue.register('fuel.create', handler);
      await queue.enqueue(item('a'));
      await queue.drain();
      expect(handler).toHaveBeenCalledTimes(1);

      await queue.drain({ onlyDue: true });
      expect(handler).toHaveBeenCalledTimes(1);

      // Connection regained / app reopened / Retry tapped: do not make the driver wait out the delay.
      await expect(queue.drain()).resolves.toMatchObject({ sent: 1, remaining: 0 });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('tries each entry at most once per pass, so a failing entry cannot spin', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('boom'));
      queue.register('fuel.create', handler);
      queue.setStopsPass(() => false);
      await queue.enqueue(item('a'));

      await Promise.all([queue.drain(), queue.drain(), queue.drain()]);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('one bad entry does not hold up the rest', () => {
    it('carries on past an entry-specific failure, but stops when the whole network is down', async () => {
      const seen: string[] = [];
      queue.register('fuel.create', async (payload) => {
        const { id } = payload as { id: string };
        seen.push(id);
        if (id === 'bad') throw new Error('this one entry breaks');
        if (id === 'offline') throw new Error('network gone');
      });
      queue.setStopsPass((error) => (error as Error).message === 'network gone');

      for (const id of ['bad', 'ok-1', 'ok-2', 'offline', 'never-reached']) await queue.enqueue(item(id));
      await flush();
      await queue.drain();

      expect(seen).toEqual(['bad', 'ok-1', 'ok-2', 'offline']);
      const remaining = (await queue.list()).map((entry) => entry.dedupeKey);
      expect(remaining).toEqual(['bad', 'offline', 'never-reached']);
    });
  });

  describe('nothing queued during a pass is lost', () => {
    it('keeps an entry that was added while another was being sent, and sends it in the same run', async () => {
      let release: () => void = () => undefined;
      const sent: string[] = [];
      queue.register('fuel.create', async (payload) => {
        const { id } = payload as { id: string };
        if (id === 'first') await new Promise<void>((resolve) => (release = resolve));
        sent.push(id);
      });
      await queue.enqueue(item('first'));

      const pass = queue.drain();
      await flush();
      // The driver submits another entry while the first is still in flight.
      await queue.enqueue(item('second'));
      void queue.drain();
      release();
      await pass;

      expect(sent).toEqual(['first', 'second']);
      await expect(queue.list()).resolves.toHaveLength(0);
    });

    it('does not bring back an entry the driver discarded while it was being sent', async () => {
      let release: () => void = () => undefined;
      queue.register('fuel.create', async () => {
        await new Promise<void>((resolve) => (release = resolve));
        throw new Error('network gone');
      });
      await queue.enqueue(item('a'));
      const [queued] = await queue.list();

      const pass = queue.drain();
      await flush();
      await queue.remove(queued!.id);
      release();
      await pass;

      await expect(queue.list()).resolves.toHaveLength(0);
    });
  });

  describe('what the driver sees', () => {
    it('reports which entry is being sent, then none', async () => {
      const activity: (string | null)[] = [];
      let release: () => void = () => undefined;
      queue.register('fuel.create', () => new Promise<void>((resolve) => (release = resolve)));
      await queue.enqueue(item('a'));
      const [queued] = await queue.list();
      queue.subscribeActivity((id) => activity.push(id));

      const pass = queue.drain();
      await flush();
      expect(queue.activeId).toBe(queued!.id);
      expect(queue.syncing).toBe(true);
      release();
      await pass;

      expect(queue.activeId).toBeNull();
      expect(queue.syncing).toBe(false);
      expect(activity).toContain(queued!.id);
      expect(activity[activity.length - 1]).toBeNull();
    });

    it('can change what an entry will send without touching anything else about it', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      queue.register('fuel.create', handler);
      await queue.enqueue({ kind: 'fuel.create', payload: { id: 'a', receipt: { uri: 'file:///gone.jpg' } }, dedupeKey: 'a' });
      const [before] = await queue.list();

      await queue.updatePayload<{ id: string; receipt: unknown }>(before!.id, (payload) => ({ ...payload, receipt: null }));

      const [after] = await queue.list();
      expect(after).toMatchObject({ id: before!.id, dedupeKey: 'a', createdAt: before!.createdAt, payload: { id: 'a', receipt: null } });
      await queue.drain();
      expect(handler).toHaveBeenCalledWith({ id: 'a', receipt: null });
    });

    it('puts a failed entry back in line when the driver taps Retry', async () => {
      const refused = Object.assign(new Error('No vehicle assigned'), { permanent: true });
      const handler = jest.fn().mockRejectedValueOnce(refused).mockResolvedValue(undefined);
      queue.register('fuel.create', handler);
      queue.setClassifier((error) => ((error as { permanent?: boolean }).permanent ? 'permanent' : 'retry'));
      await queue.enqueue(item('a'));
      await queue.drain();
      const [rejected] = await queue.list();
      expect(rejected).toMatchObject({ status: 'rejected' });

      await queue.drain();
      expect(handler).toHaveBeenCalledTimes(1);

      await queue.requeue(rejected!.id);
      await expect(queue.drain()).resolves.toMatchObject({ sent: 1 });
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('whose entries they are', () => {
    it('sends only the signed-in driver\'s entries; another sign-in on the same phone never posts them', async () => {
      let signedIn: string | null = 'driver-a';
      queue.setOwnerResolver(() => signedIn);
      const handler = jest.fn().mockResolvedValue(undefined);
      queue.register('fuel.create', handler);

      await queue.enqueue(item('a-entry'));
      signedIn = 'driver-b';
      await queue.enqueue(item('b-entry'));

      await queue.drain();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ id: 'b-entry' });
      expect((await queue.list()).map((entry) => entry.dedupeKey)).toEqual(['a-entry']);

      signedIn = 'driver-a';
      await queue.drain();
      expect(handler).toHaveBeenLastCalledWith({ id: 'a-entry' });
    });

    it('still sends entries queued before entries carried an owner', async () => {
      await queue.enqueue(item('legacy'));
      queue.setOwnerResolver(() => 'driver-a');
      const handler = jest.fn().mockResolvedValue(undefined);
      queue.register('fuel.create', handler);

      await expect(queue.drain()).resolves.toMatchObject({ sent: 1 });
    });

    it('lists only the signed-in account\'s entries', () => {
      const all = [{ ownerId: 'a' }, { ownerId: 'b' }, {}];
      expect(visibleTo(all, 'a')).toEqual([{ ownerId: 'a' }, {}]);
      expect(visibleTo(all, null)).toEqual(all);
    });
  });
});
