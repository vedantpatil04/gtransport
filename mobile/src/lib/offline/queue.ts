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
 *
 * "Syncing" is not stored: an item is syncing exactly while its handler is running (see `activeId`).
 * "Synced" is not stored either: a synced item leaves the queue, and its key is remembered.
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
  /** What kind of failure it was (an ApiError kind), so the screen can offer the right way out. */
  lastErrorKind?: string;
  /** Reference of the failing API request, so the office can find it in the server log. */
  lastRequestId?: string;
  lastAttemptAt?: number;
  /** When the next automatic attempt is due (epoch ms). Absent means "whenever the next pass runs". */
  nextAttemptAt?: number;
  /** The account that queued it. Entries belong to one driver; another sign-in on the same phone never sends them. */
  ownerId?: string;
}

export type QueueHandler = (payload: unknown) => Promise<void>;

export interface DrainResult {
  sent: number;
  failed: number;
  rejected: number;
  remaining: number;
  /** Why the pass stopped early, if it did: the session ended, or the network is down. */
  paused?: 'auth' | 'network';
}

export interface DrainOptions {
  /** Skip items still inside their retry delay. Timers use this; an explicit trigger (back online, app resumed, signed in, Retry) does not. */
  onlyDue?: boolean;
}

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

/** Default: any temporary failure stops the pass, which keeps entries in the order they were made. */
const defaultStopsPass = (): boolean => true;

const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 15 * 60_000;

/**
 * How long to wait before the next automatic attempt: 15 s, 30 s, 1 min, 2 min … capped at 15 min,
 * with up to 20 % jitter so a fleet that regains signal together does not hit the server in lockstep.
 * Bounded, so a flaky link never turns into a tight retry loop — and never gives up, either.
 */
export function retryDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (1 + 0.2 * random()));
}

/** Entries the signed-in account may see and send: its own, plus any queued before entries were stamped. */
export function visibleTo<T extends { ownerId?: string }>(items: T[], ownerId: string | null | undefined): T[] {
  return items.filter((item) => !item.ownerId || !ownerId || item.ownerId === ownerId);
}

export class OfflineQueue {
  private handlers = new Map<string, QueueHandler>();
  private classify: (error: unknown) => FailureKind = defaultClassify;
  private stopsPass: (error: unknown) => boolean = defaultStopsPass;
  private describe: (error: unknown) => { message?: string; requestId?: string; kind?: string } = (error) => ({ message: (error as Error)?.message });
  private owner: () => string | null | undefined = () => null;
  private listeners = new Set<(items: QueuedAction[]) => void>();
  private activityListeners = new Set<(activeId: string | null) => void>();
  private active: Promise<DrainResult> | null = null;
  private rerunRequested = false;
  private activeItemId: string | null = null;
  /** Every change to the stored queue goes through this chain, one at a time. */
  private writes: Promise<unknown> = Promise.resolve();

  /** Installs the rule that decides whether a failure is temporary, permanent or a pause. */
  setClassifier(classify: (error: unknown) => FailureKind): void {
    this.classify = classify;
  }

  /**
   * Of the temporary failures, which ones mean "the network is down, stop trying the rest now"
   * (true) as against "this one entry has a problem, carry on with the others" (false). Without it
   * every temporary failure stops the pass.
   */
  setStopsPass(rule: (error: unknown) => boolean): void {
    this.stopsPass = rule;
  }

  /** What to record about a failure: a message a person can read, and the request reference. */
  setDescriber(describe: (error: unknown) => { message?: string; requestId?: string; kind?: string }): void {
    this.describe = describe;
  }

  /** Whose entries these are; see QueuedAction.ownerId. */
  setOwnerResolver(owner: () => string | null | undefined): void {
    this.owner = owner;
  }

  register(kind: string, handler: QueueHandler): void {
    this.handlers.set(kind, handler);
  }

  subscribe(listener: (items: QueuedAction[]) => void): () => void {
    this.listeners.add(listener);
    void this.list().then((items) => listener(items));
    return () => this.listeners.delete(listener);
  }

  /** Called with the id of the entry being sent, or null when nothing is. */
  subscribeActivity(listener: (activeId: string | null) => void): () => void {
    this.activityListeners.add(listener);
    listener(this.activeItemId);
    return () => this.activityListeners.delete(listener);
  }

  get activeId(): string | null {
    return this.activeItemId;
  }

  get syncing(): boolean {
    return this.active !== null;
  }

  list(): Promise<QueuedAction[]> {
    return readJson<QueuedAction[]>(STORAGE_KEY, []);
  }

  /** Queues an action unless the same dedupeKey is already queued or already sent. */
  enqueue<TPayload>(input: { kind: string; payload: TPayload; dedupeKey: string }): Promise<'queued' | 'duplicate'> {
    return this.exclusive(async () => {
      const [items, sent] = await Promise.all([this.list(), readJson<string[]>(SENT_KEYS_KEY, [])]);

      if (sent.includes(input.dedupeKey) || items.some((item) => item.dedupeKey === input.dedupeKey)) {
        return 'duplicate' as const;
      }

      const ownerId = this.owner() ?? undefined;
      const action: QueuedAction = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        kind: input.kind,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
        createdAt: Date.now(),
        attempts: 0,
        status: 'pending',
        ...(ownerId ? { ownerId } : {}),
      };

      await this.save([...items, action]);
      return 'queued' as const;
    });
  }

  /**
   * Sends everything it can, oldest first. Safe to call repeatedly: a call while a pass is running
   * joins it (and makes it look again for anything queued meanwhile), so regaining connectivity
   * cannot start two passes over the same items.
   *
   * An item is only ever removed once the server has accepted it, so a driver's entry cannot be
   * silently discarded. A temporary failure keeps the item, records why, and schedules its next
   * automatic attempt (see retryDelayMs); one that cannot be fixed by waiting is marked rejected
   * and left for the driver. A network-wide failure ends the pass; a failure specific to one entry
   * does not stop the entries behind it.
   */
  drain(options: DrainOptions = {}): Promise<DrainResult> {
    if (this.active) {
      this.rerunRequested = true;
      return this.active;
    }
    const pass = this.run(options).finally(() => {
      this.active = null;
      this.notifyActivity();
    });
    this.active = pass;
    this.notifyActivity();
    return pass;
  }

  private async run(options: DrainOptions): Promise<DrainResult> {
    const result: DrainResult = { sent: 0, failed: 0, rejected: 0, remaining: 0 };
    // Each entry is tried at most once per pass, however many times the pass is asked to look again.
    const attempted = new Set<string>();

    passes: do {
      this.rerunRequested = false;
      for (;;) {
        const item = await this.nextItem(attempted, options.onlyDue === true);
        if (!item) break;
        attempted.add(item.id);
        const handler = this.handlers.get(item.kind);
        if (!handler) continue;

        this.setActive(item.id);
        try {
          await handler(item.payload);
          await this.complete(item);
          result.sent += 1;
        } catch (error) {
          const kind = this.classify(error);
          if (kind === 'halt') {
            result.paused = 'auth';
            break passes;
          }
          const { message, requestId, kind: errorKind } = this.describe(error);
          if (kind === 'permanent') {
            await this.patch(item.id, { status: 'rejected', lastError: message, lastErrorKind: errorKind, lastRequestId: requestId, lastAttemptAt: Date.now() });
            result.rejected += 1;
            continue;
          }
          const attemptsSoFar = item.attempts + 1;
          await this.patch(item.id, {
            attempts: attemptsSoFar,
            status: 'failed',
            lastError: message,
            lastErrorKind: errorKind,
            lastRequestId: requestId,
            lastAttemptAt: Date.now(),
            nextAttemptAt: Date.now() + retryDelayMs(attemptsSoFar),
          });
          result.failed += 1;
          if (this.stopsPass(error)) {
            result.paused = 'network';
            break passes;
          }
        } finally {
          this.setActive(null);
        }
      }
    } while (this.rerunRequested);

    result.remaining = (await this.list()).length;
    return result;
  }

  /** The oldest entry that should be tried now, read fresh so anything queued during the pass is seen. */
  private async nextItem(attempted: Set<string>, onlyDue: boolean): Promise<QueuedAction | undefined> {
    const owner = this.owner();
    const now = Date.now();
    return (await this.list())
      .filter(
        (item) =>
          item.status !== 'rejected' &&
          !attempted.has(item.id) &&
          this.handlers.has(item.kind) &&
          (!item.ownerId || !owner || item.ownerId === owner) &&
          (!onlyDue || (item.nextAttemptAt ?? 0) <= now),
      )
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  /** The server has it: take it off the queue and remember its key, in one step. */
  private complete(item: QueuedAction): Promise<void> {
    return this.exclusive(async () => {
      const [items, sent] = await Promise.all([this.list(), readJson<string[]>(SENT_KEYS_KEY, [])]);
      await writeJson(SENT_KEYS_KEY, [...sent, item.dedupeKey].slice(-SENT_KEYS_LIMIT));
      await this.save(items.filter((candidate) => candidate.id !== item.id));
    });
  }

  private patch(id: string, changes: Partial<QueuedAction>): Promise<void> {
    return this.exclusive(async () => {
      const items = await this.list();
      // The entry may have been discarded while it was being sent; never bring it back.
      if (!items.some((item) => item.id === id)) return;
      await this.save(items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
    });
  }

  /** Puts a failed or rejected entry back in line for the next pass (the driver tapped Retry). */
  requeue(id: string): Promise<void> {
    return this.exclusive(async () => {
      const items = await this.list();
      if (!items.some((item) => item.id === id)) return;
      await this.save(items.map((item) => (item.id === id ? { ...item, status: 'pending' as const, nextAttemptAt: undefined } : item)));
    });
  }

  /** Changes what an entry will send (the driver chose to send it without its photo). Everything else about it stays. */
  updatePayload<TPayload>(id: string, update: (payload: TPayload) => TPayload): Promise<void> {
    return this.exclusive(async () => {
      const items = await this.list();
      if (!items.some((item) => item.id === id)) return;
      await this.save(items.map((item) => (item.id === id ? { ...item, payload: update(item.payload as TPayload) } : item)));
    });
  }

  /** Removes one item, e.g. when the driver discards a rejected entry. */
  remove(id: string): Promise<void> {
    return this.exclusive(async () => {
      await this.save((await this.list()).filter((item) => item.id !== id));
    });
  }

  clear(): Promise<void> {
    return this.exclusive(() => this.save([]));
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writes.then(work);
    this.writes = run.catch(() => undefined);
    return run;
  }

  private async save(items: QueuedAction[]): Promise<void> {
    await writeJson(STORAGE_KEY, items);
    this.listeners.forEach((listener) => listener(items));
  }

  private setActive(id: string | null): void {
    this.activeItemId = id;
    this.notifyActivity();
  }

  private notifyActivity(): void {
    this.activityListeners.forEach((listener) => listener(this.activeItemId));
  }
}

export const offlineQueue = new OfflineQueue();
