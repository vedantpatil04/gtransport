import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineQueue } from '../offline/queue';

describe('offline queue', () => {
  let queue: OfflineQueue;

  beforeEach(async () => {
    await AsyncStorage.clear();
    queue = new OfflineQueue();
  });

  it('queues an action while offline and keeps it until it is sent', async () => {
    await expect(queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' })).resolves.toBe('queued');
    await expect(queue.list()).resolves.toHaveLength(1);
  });

  it('survives a restart, because the queue is persisted', async () => {
    await queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' });

    const afterRestart = new OfflineQueue();
    await expect(afterRestart.list()).resolves.toHaveLength(1);
  });

  it('refuses to queue the same action twice, so a double tap cannot duplicate a record', async () => {
    await queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' });
    await expect(queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' })).resolves.toBe('duplicate');
    await expect(queue.list()).resolves.toHaveLength(1);
  });

  it('sends queued actions when connectivity returns, then empties', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    queue.register('fuel.create', handler);
    await queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' });

    await expect(queue.drain()).resolves.toMatchObject({ sent: 1, remaining: 0 });
    expect(handler).toHaveBeenCalledWith({ litres: 30 });
    await expect(queue.list()).resolves.toHaveLength(0);
  });

  it('will not re-send an action that already succeeded', async () => {
    queue.register('fuel.create', jest.fn().mockResolvedValue(undefined));
    await queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' });
    await queue.drain();

    await expect(queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' })).resolves.toBe('duplicate');
  });

  it('keeps a failed action for a later retry and records the attempt', async () => {
    queue.register('fuel.create', jest.fn().mockRejectedValue(new Error('still offline')));
    await queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' });

    await expect(queue.drain()).resolves.toMatchObject({ sent: 0, failed: 1, remaining: 1 });

    const [item] = await queue.list();
    expect(item).toMatchObject({ status: 'failed', attempts: 1, lastError: 'still offline' });
  });

  it('eventually gives up rather than retrying forever', async () => {
    queue.register('fuel.create', jest.fn().mockRejectedValue(new Error('permanently broken')));
    await queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' });

    for (let attempt = 0; attempt < 5; attempt += 1) await queue.drain();

    await expect(queue.list()).resolves.toHaveLength(0);
  });

  it('sends oldest first and stops at the first failure, so ordering is preserved', async () => {
    const seen: string[] = [];
    queue.register('fuel.create', async (payload) => {
      const { id } = payload as { id: string };
      seen.push(id);
      if (id === 'b') throw new Error('network dropped again');
    });

    await queue.enqueue({ kind: 'fuel.create', payload: { id: 'a' }, dedupeKey: 'a' });
    await queue.enqueue({ kind: 'fuel.create', payload: { id: 'b' }, dedupeKey: 'b' });
    await queue.enqueue({ kind: 'fuel.create', payload: { id: 'c' }, dedupeKey: 'c' });

    await queue.drain();

    expect(seen).toEqual(['a', 'b']);
    await expect(queue.list()).resolves.toHaveLength(2);
  });

  it('ignores a concurrent drain, so regaining signal cannot send an action twice', async () => {
    const handler = jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));
    queue.register('fuel.create', handler);
    await queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' });

    await Promise.all([queue.drain(), queue.drain()]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers so the sync indicator stays accurate', async () => {
    const listener = jest.fn();
    queue.subscribe(listener);
    await queue.enqueue({ kind: 'fuel.create', payload: {}, dedupeKey: 'fuel-1' });

    expect(listener).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ dedupeKey: 'fuel-1' })]));
  });
});
