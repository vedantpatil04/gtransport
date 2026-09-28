import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationFixPayload } from '../../types/domain';

/**
 * Bounded on-device buffer for captured positions.
 *
 * Why this is not the shared `offlineQueue`: that queue is built never to drop anything and to
 * send one item per request, which is exactly right for a fuel entry a driver typed in. Positions
 * are the opposite case — they arrive on a timer, forever, in volume. A driver on a hill road can
 * be out of signal for hours, so the buffer has to be bounded (a phone cannot fill its storage
 * with GPS) and has to upload in batches (one request per fix would never drain on these
 * networks). Two different problems, two mechanisms.
 *
 * The rules:
 *
 *  - `capturedAt` is preserved exactly. A fix uploaded four hours late still says when it was
 *    taken, which is what makes stationary detection correct on the server.
 *  - Every fix carries a `clientSubmissionId` from the moment it is captured, so a retry — or a
 *    batch that was half-uploaded when the connection died — cannot create a second record.
 *  - When the buffer is full the *oldest* fixes go, not the newest. A driver's current position
 *    matters more than where they were this morning, and the loss is reported rather than hidden.
 *
 * This runs in two JavaScript contexts: the app, and the background location task, which the OS
 * may start with no app on screen. That is why the buffer is plain functions over AsyncStorage
 * rather than anything held in React state — there is no component tree in the background.
 */

const BUFFER_KEY = 'gangamata.location.buffer';
const SENT_KEY = 'gangamata.location.sent';
const DROPPED_KEY = 'gangamata.location.dropped';

/** Submission ids of recently accepted fixes, so a late retry is recognised without the network. */
const SENT_LIMIT = 300;

/** Used until the API's policy has been read. The server's value wins as soon as it is known. */
export const DEFAULT_BUFFER_LIMIT = 1_000;

const readJson = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Storage full, unavailable, or holding something corrupt: behave as if empty rather than
    // crashing a background task the driver cannot see or restart.
    return fallback;
  }
};

const writeJson = async (key: string, value: unknown): Promise<boolean> => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export interface BufferStats {
  pending: number;
  /** Fixes lost to the size limit since the counter was last cleared. */
  dropped: number;
  oldestCapturedAt: string | null;
  newestCapturedAt: string | null;
}

/** Oldest first, which is the order the server wants so its stationary timeline stays in sequence. */
const byCaptureTime = (a: LocationFixPayload, b: LocationFixPayload) =>
  Date.parse(a.capturedAt) - Date.parse(b.capturedAt);

export async function readBuffer(): Promise<LocationFixPayload[]> {
  const fixes = await readJson<LocationFixPayload[]>(BUFFER_KEY, []);
  return fixes.slice().sort(byCaptureTime);
}

export async function bufferStats(): Promise<BufferStats> {
  const [fixes, dropped] = await Promise.all([readBuffer(), readJson<number>(DROPPED_KEY, 0)]);
  return {
    pending: fixes.length,
    dropped,
    oldestCapturedAt: fixes[0]?.capturedAt ?? null,
    newestCapturedAt: fixes[fixes.length - 1]?.capturedAt ?? null,
  };
}

export interface EnqueueOutcome {
  /** 'queued' | 'duplicate' (already held or already sent) | 'unavailable' (storage refused). */
  result: 'queued' | 'duplicate' | 'unavailable';
  pending: number;
  /** How many of the oldest fixes were dropped to make room. */
  dropped: number;
}

/**
 * Adds a captured fix to the buffer.
 *
 * Refuses a fix already buffered or already accepted by the server, so the background task
 * delivering the same position twice — which happens on Android after a task restart — cannot
 * double up.
 */
export async function enqueueFix(fix: LocationFixPayload, limit = DEFAULT_BUFFER_LIMIT): Promise<EnqueueOutcome> {
  const [fixes, sent] = await Promise.all([readBuffer(), readJson<string[]>(SENT_KEY, [])]);

  if (sent.includes(fix.clientSubmissionId) || fixes.some((held) => held.clientSubmissionId === fix.clientSubmissionId)) {
    return { result: 'duplicate', pending: fixes.length, dropped: 0 };
  }

  const next = [...fixes, fix].sort(byCaptureTime);

  let dropped = 0;
  if (next.length > limit) {
    dropped = next.length - limit;
    // The newest fixes are kept: where the driver is now matters more than where they were.
    next.splice(0, dropped);
    await writeJson(DROPPED_KEY, (await readJson<number>(DROPPED_KEY, 0)) + dropped);
  }

  const written = await writeJson(BUFFER_KEY, next);
  if (!written) return { result: 'unavailable', pending: fixes.length, dropped };

  return { result: 'queued', pending: next.length, dropped };
}

/** The next batch to upload, oldest first and never larger than the server accepts. */
export async function nextBatch(maxBatchSize: number): Promise<LocationFixPayload[]> {
  return (await readBuffer()).slice(0, Math.max(1, maxBatchSize));
}

/**
 * Removes fixes the server has finished with, and remembers their ids.
 *
 * Called for anything the server said was stored, already a duplicate, or permanently rejected —
 * all three are settled. A fix that merely failed to upload stays in the buffer untouched, so a
 * bad connection never loses a position.
 */
export async function settleFixes(submissionIds: string[]): Promise<number> {
  if (!submissionIds.length) return (await readBuffer()).length;

  const settled = new Set(submissionIds);
  const [fixes, sent] = await Promise.all([readBuffer(), readJson<string[]>(SENT_KEY, [])]);

  const remaining = fixes.filter((fix) => !settled.has(fix.clientSubmissionId));
  await writeJson(BUFFER_KEY, remaining);
  await writeJson(SENT_KEY, [...sent, ...submissionIds].slice(-SENT_LIMIT));
  return remaining.length;
}

/** Clears the dropped counter once the driver has been told. */
export async function acknowledgeDropped(): Promise<void> {
  await writeJson(DROPPED_KEY, 0);
}

/** Sign-out: one driver's positions must not be left on the device for the next one. */
export async function clearBuffer(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([BUFFER_KEY, SENT_KEY, DROPPED_KEY]);
  } catch {
    /* nothing readable to clear */
  }
}
