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

  it('never discards an entry because the network kept failing', async () => {
    // Phase 2 dropped an item after five failures, which would lose a driver's fuel entry on a
    // bad day. A temporary failure is now retried for as long as it takes.
    queue.register('fuel.create', jest.fn().mockRejectedValue(new Error('no network')));
    await queue.enqueue({ kind: 'fuel.create', payload: { litres: 30 }, dedupeKey: 'fuel-1' });

    for (let attempt = 0; attempt < 12; attempt += 1) await queue.drain();

    const [item] = await queue.list();
    expect(item).toMatchObject({ status: 'failed', attempts: 12 });
  });

  it('keeps an entry the server refused, marked for the driver, and moves on to the next', async () => {
    const refused = Object.assign(new Error('No vehicle is assigned'), { permanent: true });
    const handler = jest.fn().mockImplementation(async (payload: { id: string }) => {
      if (payload.id === 'a') throw refused;
    });
    queue.register('fuel.create', handler);
    queue.setClassifier((error) => ((error as { permanent?: boolean }).permanent ? 'permanent' : 'retry'));

    await queue.enqueue({ kind: 'fuel.create', payload: { id: 'a' }, dedupeKey: 'a' });
    await queue.enqueue({ kind: 'fuel.create', payload: { id: 'b' }, dedupeKey: 'b' });

    await expect(queue.drain()).resolves.toMatchObject({ sent: 1, rejected: 1, remaining: 1 });
    const [item] = await queue.list();
    expect(item).toMatchObject({ dedupeKey: 'a', status: 'rejected', lastError: 'No vehicle is assigned' });

    // A rejected entry is not retried on its own; the driver decides what to do with it.
    handler.mockClear();
    await queue.drain();
    expect(handler).not.toHaveBeenCalled();
  });

  it('pauses without spending attempts when the session has expired', async () => {
    queue.register('fuel.create', jest.fn().mockRejectedValue(new Error('unauthorized')));
    queue.setClassifier(() => 'halt');
    await queue.enqueue({ kind: 'fuel.create', payload: {}, dedupeKey: 'fuel-1' });

    await queue.drain();
    const [item] = await queue.list();
    expect(item).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('lets the driver discard an entry explicitly', async () => {
    await queue.enqueue({ kind: 'fuel.create', payload: {}, dedupeKey: 'fuel-1' });
    const [item] = await queue.list();
    await queue.remove(item!.id);
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
