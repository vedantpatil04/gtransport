import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { useSession } from '../auth/session-store';
import { offlineQueue, visibleTo } from './queue';

/**
 * The one place that decides when the offline queue is sent.
 *
 * Before this, the queue was only drained when connectivity changed while a screen showing the
 * sync banner was open, or when a form was submitted. A failed pass (a sleeping API instance, a
 * dropped signal, an expired session) therefore sat until the driver happened to toggle airplane
 * mode, and re-opening the app or signing in again did nothing. Now a pass runs when:
 *
 *   start    the app opens
 *   network  the phone regains a usable connection
 *   resume   the app returns to the foreground
 *   signin   a session starts (the queue pauses while signed out, and keeps everything)
 *   manual   the driver taps Retry
 *   timer    an entry's retry time arrives (bounded exponential backoff: see retryDelayMs)
 *
 * The queue itself guarantees one pass at a time and sends each entry with its original
 * submission id, so the server stores every entry once however many triggers fire.
 */

export type SyncReason = 'start' | 'network' | 'resume' | 'signin' | 'manual' | 'timer';

/** Several triggers often arrive together (connection regained + app resumed); one pass is enough. */
const MIN_GAP_BETWEEN_TRIGGERS_MS = 3_000;
const MIN_WAIT_MS = 5_000;
const MAX_WAIT_MS = 15 * 60_000;
/** While the phone says it is offline, only look occasionally: the network event is the real trigger. */
const OFFLINE_POLL_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastTriggerAt = 0;
/** The server said the session is no longer valid: no timer retries until a person-driven trigger. */
let authPaused = false;

async function reachable(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return Boolean(state.isConnected) && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Points the timer at the earliest entry that will be due, if any is waiting. */
export async function scheduleNext(offline = false): Promise<void> {
  clearTimer();
  if (authPaused) return;
  const owner = useSession.getState().user?.id;
  const waiting = visibleTo(await offlineQueue.list(), owner).filter((item) => item.status !== 'rejected');
  if (waiting.length === 0) return;

  const now = Date.now();
  const earliest = Math.min(...waiting.map((item) => item.nextAttemptAt ?? now));
  const floor = offline ? OFFLINE_POLL_MS : MIN_WAIT_MS;
  const delay = Math.min(MAX_WAIT_MS, Math.max(floor, earliest - now));
  timer = setTimeout(() => {
    timer = null;
    void requestSync('timer');
  }, delay);
}

/** Runs one pass of the queue if there is anything to do and someone is signed in. */
export async function requestSync(reason: SyncReason): Promise<void> {
  const timerPass = reason === 'timer';
  if (timerPass && authPaused) return;
  // Nothing can be sent without a session. Signing in triggers its own pass, so no timer is kept alive.
  if (!useSession.getState().token) return;

  if (!timerPass && reason !== 'manual') {
    if (Date.now() - lastTriggerAt < MIN_GAP_BETWEEN_TRIGGERS_MS) {
      await scheduleNext();
      return;
    }
  }
  if (!timerPass) lastTriggerAt = Date.now();

  // A manual retry always tries: NetInfo is occasionally wrong, and the attempt reports the truth.
  if (reason !== 'manual' && !(await reachable())) {
    await scheduleNext(true);
    return;
  }

  const result = await offlineQueue.drain({ onlyDue: timerPass });
  // The session ended mid-pass: stay quiet until signing in again (or the app reopening) starts the next one.
  authPaused = result.paused === 'auth';
  if (authPaused) return;
  // After a network-wide failure the entries carry their own backoff times; otherwise the next due one.
  await scheduleNext();
}

/** Starts listening for the triggers above. Returns the function that stops it. */
export function startQueueSync(): () => void {
  const stops: (() => void)[] = [];
  // A new start is never "too soon after" a trigger from an earlier one, nor paused by an earlier session.
  lastTriggerAt = 0;
  authPaused = false;

  let wasReachable = false;
  stops.push(
    NetInfo.addEventListener((state) => {
      const ok = Boolean(state.isConnected) && state.isInternetReachable !== false;
      if (ok && !wasReachable) void requestSync('network');
      wasReachable = ok;
    }),
  );

  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') void requestSync('resume');
  });
  stops.push(() => appState.remove());

  let lastToken = useSession.getState().token;
  stops.push(
    useSession.subscribe((state) => {
      if (state.token && state.token !== lastToken) {
        authPaused = false;
        void requestSync('signin');
      }
      lastToken = state.token;
    }),
  );

  // Keeps the timer pointed at the earliest retry as entries are added, sent or changed.
  stops.push(offlineQueue.subscribe(() => void scheduleNext()));

  void requestSync('start');

  return () => {
    stops.forEach((stop) => stop());
    clearTimer();
  };
}
