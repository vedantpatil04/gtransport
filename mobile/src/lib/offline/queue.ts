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

/**
 * pending  — waiting for its first attempt
 * failed   — a temporary failure (no network, server down); will be retried
 * rejected — the server refused it for good (e.g. validation); kept so the driver can see it
 */
export type QueueItemStatus = 'pending' | 'failed' | 'rejected';

/**
 * How a failed attempt should be treated. Handlers throw errors; this decides what they mean.
 * - retry:     temporary; keep the item and try again later (never dropped)
 * - permanent: the server will never accept it; mark rejected and move on
 * - halt:      stop draining without counting an attempt (e.g. the session expired)
 */
export type FailureKind = 'retry' | 'permanent' | 'halt';

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

/** Default classification: anything unrecognised is treated as temporary, so nothing is lost. */
const defaultClassify = (): FailureKind => 'retry';

export class OfflineQueue {
  private handlers = new Map<string, QueueHandler>();
  private classify: (error: unknown) => FailureKind = defaultClassify;

  /** Installs the rule that decides whether a failure is temporary, permanent or a pause. */
  setClassifier(classify: (error: unknown) => FailureKind): void {
    this.classify = classify;
  }
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
   *
   * A temporary failure stops the pass (the network is probably still down) and the item is
   * kept for next time — however many attempts it takes. An item is only ever removed once the
   * server has accepted it, so a driver's entry cannot be silently discarded.
   */
  async drain(): Promise<{ sent: number; failed: number; rejected: number; remaining: number }> {
    if (this.draining) return { sent: 0, failed: 0, rejected: 0, remaining: (await this.list()).length };
    this.draining = true;

    try {
      let items = await this.list();
      const sentKeys = await readJson<string[]>(SENT_KEYS_KEY, []);
      let sent = 0;
      let failed = 0;
      let rejected = 0;

      for (const item of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
        if (item.status === 'rejected') continue;
        const handler = this.handlers.get(item.kind);
        if (!handler) continue;

        try {
          await handler(item.payload);
          items = items.filter((candidate) => candidate.id !== item.id);
          sentKeys.push(item.dedupeKey);
          sent += 1;
        } catch (error) {
          const kind = this.classify(error);
          const message = (error as Error)?.message;

          if (kind === 'halt') break;

          if (kind === 'permanent') {
            rejected += 1;
            items = items.map((candidate) =>
              candidate.id === item.id ? { ...candidate, status: 'rejected' as const, lastError: message } : candidate,
            );
            continue;
          }

          failed += 1;
          items = items.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, attempts: candidate.attempts + 1, status: 'failed' as const, lastError: message }
              : candidate,
          );
          break;
        }
      }

      await writeJson(SENT_KEYS_KEY, sentKeys.slice(-SENT_KEYS_LIMIT));
      await this.save(items);
      return { sent, failed, rejected, remaining: items.length };
    } finally {
      this.draining = false;
    }
  }

  /** Removes one item, e.g. when the driver discards a rejected entry. */
  async remove(id: string): Promise<void> {
    await this.save((await this.list()).filter((item) => item.id !== id));
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
