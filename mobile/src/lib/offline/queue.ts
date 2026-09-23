import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Generic offline action queue.
 *
 * Indian rural networks drop constantly, so anything a driver submits must survive being
 * offline, an app restart, or a failed request. Phase 2 provides the mechanism only: the fuel
 * and expense flows that use it arrive in a later phase.
 *
 * Duplicate protection is by `dedupeKey`: an action already queued or already sent with the
 * same key is never queued twice, so a double tap cannot create two records.
 */

export type QueueItemStatus = 'pending' | 'failed';

export interface QueuedAction<TPayload = unknown> {
  id: string;
  /** What to do, e.g. "fuel.create". Handlers are registered per kind. */
  kind: string;
  payload: TPayload;
  /** Stable key derived from the action's content; repeats are ignored. */
  dedupeKey: string;
  createdAt: number;
  attempts: number;
  status: QueueItemStatus;
  lastError?: string;
}

export type QueueHandler = (payload: unknown) => Promise<void>;

const STORAGE_KEY = 'gangamata.offline.queue';
const SENT_KEYS_KEY = 'gangamata.offline.sent';
const MAX_ATTEMPTS = 5;
/** Remembering recent successes is what stops a retry from creating a duplicate record. */
const SENT_KEYS_LIMIT = 200;

const readJson = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = async (key: string, value: unknown): Promise<void> => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the queue degrades to in-memory for this session */
  }
};

export class OfflineQueue {
  private handlers = new Map<string, QueueHandler>();
  private listeners = new Set<(items: QueuedAction[]) => void>();
  private draining = false;

  register(kind: string, handler: QueueHandler): void {
    this.handlers.set(kind, handler);
  }

  subscribe(listener: (items: QueuedAction[]) => void): () => void {
    this.listeners.add(listener);
    void this.list().then((items) => listener(items));
    return () => this.listeners.delete(listener);
  }

  list(): Promise<QueuedAction[]> {
    return readJson<QueuedAction[]>(STORAGE_KEY, []);
  }

  /** Queues an action unless the same dedupeKey is already queued or already sent. */
  async enqueue<TPayload>(input: { kind: string; payload: TPayload; dedupeKey: string }): Promise<'queued' | 'duplicate'> {
    const [items, sent] = await Promise.all([this.list(), readJson<string[]>(SENT_KEYS_KEY, [])]);

    if (sent.includes(input.dedupeKey) || items.some((item) => item.dedupeKey === input.dedupeKey)) {
      return 'duplicate';
    }

    const action: QueuedAction = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      kind: input.kind,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
      createdAt: Date.now(),
      attempts: 0,
      status: 'pending',
    };

    await this.save([...items, action]);
    return 'queued';
  }

  /**
   * Sends everything it can, oldest first. Safe to call repeatedly: concurrent drains are
   * ignored, so regaining connectivity cannot start two passes over the same items.
   */
  async drain(): Promise<{ sent: number; failed: number; remaining: number }> {
    if (this.draining) return { sent: 0, failed: 0, remaining: (await this.list()).length };
    this.draining = true;

    try {
      let items = await this.list();
      const sentKeys = await readJson<string[]>(SENT_KEYS_KEY, []);
      let sent = 0;
      let failed = 0;

      for (const item of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
        const handler = this.handlers.get(item.kind);
        if (!handler) continue;

        try {
          await handler(item.payload);
          items = items.filter((candidate) => candidate.id !== item.id);
          sentKeys.push(item.dedupeKey);
          sent += 1;
        } catch (error) {
          failed += 1;
          const attempts = item.attempts + 1;
          items = attempts >= MAX_ATTEMPTS
            ? items.filter((candidate) => candidate.id !== item.id)
            : items.map((candidate) =>
                candidate.id === item.id
                  ? { ...candidate, attempts, status: 'failed' as const, lastError: (error as Error)?.message }
                  : candidate,
              );
          // Stop on the first failure: the network is probably still down.
          break;
        }
      }

      await writeJson(SENT_KEYS_KEY, sentKeys.slice(-SENT_KEYS_LIMIT));
      await this.save(items);
      return { sent, failed, remaining: items.length };
    } finally {
      this.draining = false;
    }
  }

  async clear(): Promise<void> {
    await this.save([]);
  }

  private async save(items: QueuedAction[]): Promise<void> {
    await writeJson(STORAGE_KEY, items);
    this.listeners.forEach((listener) => listener(items));
  }
}

export const offlineQueue = new OfflineQueue();
