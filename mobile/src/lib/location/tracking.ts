import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
type TaskManagerModule = typeof import('expo-task-manager');

let TaskManager: TaskManagerModule | null = null;
try {
  TaskManager = require('expo-task-manager') as TaskManagerModule;
} catch {
  TaskManager = null;
}
import * as Crypto from 'expo-crypto';
import type { DriverTrackingState, LocationFixPayload, TrackingPolicy } from '../../types/domain';
import { locationsApi } from '../api/locations';
import { ApiError } from '../api/client';
import { loadSession } from '../storage/secure';
import {
  acknowledgeDropped, bufferStats, clearBuffer, DEFAULT_BUFFER_LIMIT, enqueueFix, nextBatch, settleFixes,
} from './buffer';
import { readPermission, toApiPermission, type LocationPermissionSnapshot } from './permission';
import { deriveTrackingState } from './tracking-state';

/**
 * Real background location tracking.
 *
 * ── How this actually runs ──
 *
 * `Location.startLocationUpdatesAsync` hands the job to the operating system: Android runs it in a
 * foreground service with a persistent notification, iOS wakes the app for location events. Either
 * way the OS starts a *fresh JavaScript context* to deliver a fix, with no app on screen, no React
 * tree and no module state from the app's own context. Two consequences shape everything here:
 *
 *  1. The task must be defined at module scope, before the app mounts, so it exists in whichever
 *     context the OS spins up. That is why this file is imported from the root layout for its side
 *     effect rather than called from a component.
 *  2. The task cannot read anything from the app's memory. The session token comes from the OS
 *     keystore and the buffer from AsyncStorage, because those are the only things both contexts
 *     can see.
 *
 * ── What it does with a fix ──
 *
 * Buffer first, then try to upload. Never the other way round: if the upload fails — or the process
 * is killed mid-request — the fix is already on disk and will go out later. Uploading first would
 * lose positions exactly when the network is worst, which is exactly when drivers are out of signal.
 *
 * ── Recovery ──
 *
 * Android kills long-running services, and a reboot stops everything. `ensureTracking` re-registers
 * an interrupted task, and is called whenever the app is opened or returns to the foreground, so
 * tracking resumes without the driver being asked to do anything.
 */

export const LOCATION_TASK = 'gangamata-background-location';

/** Cached policy, so the background context knows the batch size without a network call. */
const POLICY_KEY = 'gangamata.location.policy';

export const DEFAULT_POLICY: TrackingPolicy = {
  movingIntervalSeconds: 10,
  stationaryIntervalSeconds: 180,
  distanceMeters: 15,
  bufferLimit: DEFAULT_BUFFER_LIMIT,
  maxBatchSize: 100,
  staleAfterMinutes: 10,
};

/**
 * The policy is cached on disk because the background context cannot reach the app's memory and
 * must not depend on the network to know its own batch size. A read that fails falls back to the
 * defaults above rather than stopping tracking.
 */
const readPolicy = async (): Promise<TrackingPolicy> => {
  try {
    const raw = await AsyncStorage.getItem(POLICY_KEY);
    return raw ? { ...DEFAULT_POLICY, ...(JSON.parse(raw) as Partial<TrackingPolicy>) } : DEFAULT_POLICY;
  } catch {
    return DEFAULT_POLICY;
  }
};

export const savePolicy = async (policy: TrackingPolicy): Promise<void> => {
  try {
    await AsyncStorage.setItem(POLICY_KEY, JSON.stringify(policy));
  } catch {
    /* the defaults above still apply */
  }
};

const metresPerSecondToKmh = (value: number | null | undefined): number | undefined => {
  if (value === null || value === undefined || value < 0 || !Number.isFinite(value)) return undefined;
  return Math.round(value * 3.6 * 10) / 10;
};

const finite = (value: number | null | undefined): number | undefined =>
  value === null || value === undefined || !Number.isFinite(value) ? undefined : value;

/** Turns a platform reading into the payload the API accepts. */
export function toFixPayload(location: Location.LocationObject, submissionId: string): LocationFixPayload {
  const { coords } = location;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    // The device clock at capture, kept exactly: a fix uploaded hours later still says when it
    // happened, which is what makes the server's stationary timing correct.
    capturedAt: new Date(location.timestamp).toISOString(),
    accuracyMeters: finite(coords.accuracy ?? undefined),
    speedKmh: metresPerSecondToKmh(coords.speed),
    // A stationary device reports heading as -1; that is "unknown", not a direction.
    headingDeg: coords.heading !== null && coords.heading !== undefined && coords.heading >= 0 ? coords.heading : undefined,
    altitudeMeters: finite(coords.altitude ?? undefined),
    clientSubmissionId: submissionId,
  };
}

/** A per-fix id, stamped at capture so it survives buffering and every later retry unchanged. */
const newSubmissionId = (): string => {
  try {
    return Crypto.randomUUID();
  } catch {
    // A UUID is preferred, but any value stable for this fix will do — it only has to be unique.
    return `fix-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

export interface SyncOutcome {
  uploaded: number;
  duplicates: number;
  rejected: number;
  pending: number;
  /** Set when nothing could be sent, so the caller can tell "nothing to do" from "no network". */
  failure?: 'offline' | 'unauthorized' | 'server';
}

/**
 * Sends everything the buffer holds, in batches, and settles what the server has finished with.
 *
 * Safe to call from anywhere and at any time. A fix is removed only once the server has accounted
 * for it — stored, already known, or permanently refused. A network failure removes nothing and
 * simply stops the pass, so the next attempt picks up where this one left off.
 */
export async function syncBuffer(token?: string | null): Promise<SyncOutcome> {
  const accessToken = token ?? (await loadSession())?.accessToken ?? null;
  const policy = await readPolicy();
  const stats = await bufferStats();

  if (!stats.pending) return { uploaded: 0, duplicates: 0, rejected: 0, pending: 0 };
  if (!accessToken) return { uploaded: 0, duplicates: 0, rejected: 0, pending: stats.pending, failure: 'unauthorized' };

  let uploaded = 0;
  let duplicates = 0;
  let rejected = 0;
  let pending = stats.pending;

  // Bounded: one pass sends at most a few batches, so a huge backlog drains over several passes
  // instead of holding the radio open and draining the battery in one go.
  for (let pass = 0; pass < 5; pass += 1) {
    const batch = await nextBatch(policy.maxBatchSize);
    if (!batch.length) break;

    try {
      const response = await locationsApi.submit(accessToken, {
        fixes: batch,
        pendingUploads: Math.max(0, pending - batch.length),
        trackingState: pending > batch.length ? 'SYNC_PENDING' : undefined,
      });

      // Stored, duplicate and rejected are all settled. Anything the server did not mention stays
      // in the buffer rather than being assumed sent.
      const settled = response.results.map((result) => result.clientSubmissionId);
      uploaded += response.stored;
      duplicates += response.duplicates;
      rejected += response.rejected;
      pending = await settleFixes(settled);

      if (!settled.length) break;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === 'unauthorized') return { uploaded, duplicates, rejected, pending, failure: 'unauthorized' };
        if (error.retryable) return { uploaded, duplicates, rejected, pending, failure: 'offline' };
        // A 4xx on the batch as a whole (too large, driver stood down): keep the fixes and stop.
        // Per-fix refusals arrive as 'rejected' results above, not as an error.
        return { uploaded, duplicates, rejected, pending, failure: 'server' };
      }
      return { uploaded, duplicates, rejected, pending, failure: 'offline' };
    }
  }

  return { uploaded, duplicates, rejected, pending };
}

/**
 * Handles one delivery from the OS. Exported so it can be tested directly: the task callback
 * itself is registered with the platform and is not directly callable in a test.
 */
export async function handleLocations(locations: Location.LocationObject[]): Promise<void> {
  if (!locations.length) return;
  const policy = await readPolicy();

  for (const location of locations) {
    // On disk before anything else is attempted: a fix that is never uploaded is still a fix.
    await enqueueFix(toFixPayload(location, newSubmissionId()), policy.bufferLimit);
  }

  await syncBuffer();
}

/**
 * The background task.
 *
 * Defined at module scope so it exists in whichever JavaScript context the OS starts. It must
 * never throw: an unhandled error here can make the platform stop delivering updates altogether,
 * which would take tracking down silently.
 */
if (TaskManager && typeof TaskManager.isTaskDefined === 'function' && !TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      // Nothing useful can be done from a background context with no UI; the next fix retries,
      // and the state report tells the office if tracking has genuinely stopped.
      return;
    }
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
    try {
      await handleLocations(locations);
    } catch {
      /* swallowed on purpose: see above */
    }
  });
}

export interface TrackingStartResult {
  started: boolean
  /** Why tracking is not running, when it is not. */
  reason?: 'permission' | 'background-permission' | 'services' | 'platform';
}

let webWatcher: { remove: () => void } | null = null;

/** Whether the OS currently holds our task. The truthful answer to "is tracking running?". */
export async function isTrackingRegistered(): Promise<boolean> {
  if (webWatcher !== null) return true;
  if (!TaskManager) return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/**
 * Starts background tracking if — and only if — the platform genuinely allows it.
 *
 * The interval and distance come from the server's policy, so reporting can be tuned without
 * shipping a new build. `pausesUpdatesAutomatically` is deliberately off: iOS would otherwise stop
 * updates when it decides the device is stationary, and a four-hour stop is precisely what the
 * office needs to see.
 */
export async function startTracking(policy?: TrackingPolicy): Promise<TrackingStartResult> {
  const snapshot = await readPermission();
  if (!snapshot.servicesEnabled) return { started: false, reason: 'services' };
  if (snapshot.foreground !== 'GRANTED') return { started: false, reason: 'permission' };

  const effective = policy ?? (await readPolicy());

  // Web or environments without TaskManager: watchPositionAsync keeps updates alive while app is active
  if (Platform.OS === 'web' || !TaskManager) {
    if (webWatcher) return { started: true };
    try {
      if (typeof Location.watchPositionAsync === 'function') {
        webWatcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 5_000, distanceInterval: 5 },
          (loc) => { void handleLocations([loc]); },
        );
      }
      if (typeof Location.getCurrentPositionAsync === 'function') {
        void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then((loc) => { if (loc) void handleLocations([loc]); })
          .catch(() => {});
      }
      return { started: true };
    } catch {
      return { started: false, reason: 'platform' };
    }
  }

  if (snapshot.background !== 'GRANTED') return { started: false, reason: 'background-permission' };

  try {
    if (await isTrackingRegistered()) return { started: true };

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      distanceInterval: effective.distanceMeters,
      timeInterval: effective.movingIntervalSeconds * 1_000,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      foregroundService: {
        notificationTitle: 'Gangamata Transport — Live Tracking',
        notificationBody: 'Sharing your vehicle location in real-time with the office.',
        notificationColor: '#1B2B44',
        killServiceOnDestroy: false,
      },
      deferredUpdatesInterval: effective.movingIntervalSeconds * 1_000,
      deferredUpdatesDistance: effective.distanceMeters,
      showsBackgroundLocationIndicator: true,
    });

    // Capture an immediate fix on native so the driver's location is reported right away with zero lag
    if (typeof Location.getCurrentPositionAsync === 'function') {
      void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        .then((loc) => { if (loc) void handleLocations([loc]); })
        .catch(() => {});
    }

    return { started: true };
  } catch {
    // Task registration refused by the platform (restricted device, unsupported configuration).
    return { started: false, reason: 'platform' };
  }
}

/** Stops tracking. Used when the driver signs out, or when the office withdraws the assignment. */
export async function stopTracking(): Promise<void> {
  if (webWatcher) {
    try {
      webWatcher.remove();
    } catch {
      /* ignore */
    }
    webWatcher = null;
  }
  if (!TaskManager) return;
  try {
    if (await isTrackingRegistered()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    /* already stopped, or the task was never registered */
  }
}

export interface TrackingSnapshot {
  permission: LocationPermissionSnapshot;
  taskRegistered: boolean;
  state: DriverTrackingState;
  pendingUploads: number;
  droppedFixes: number;
  lastFixAt: string | null;
  policy: TrackingPolicy;
}

/**
 * Brings tracking into line with reality, and reports the result.
 *
 * This is the one function the app calls — at launch, when returning to the foreground, and after
 * the driver answers a permission prompt. It re-registers a task the OS killed, drains anything the
 * buffer is holding, and returns the honest state, which the caller reports to the office.
 *
 * `paused` is for the cases where not tracking is correct: no driver signed in, or the office has
 * withdrawn the vehicle. It stops tracking rather than leaving a service running for no reason.
 */
export async function ensureTracking(options: { paused?: boolean; policy?: TrackingPolicy } = {}): Promise<TrackingSnapshot> {
  const policy = options.policy ?? (await readPolicy());

  if (options.paused) {
    await stopTracking();
  } else {
    // Re-registers an interrupted task. Android kills long-running services and a reboot stops
    // everything, so this is the recovery path, not just a first-run path.
    await startTracking(policy);
  }

  const [permission, taskRegistered, stats] = await Promise.all([readPermission(), isTrackingRegistered(), bufferStats()]);

  // Drain whatever is waiting. Failure is expected and harmless: the fixes stay buffered.
  const sync = stats.pending ? await syncBuffer() : { pending: 0 };
  const pendingUploads = sync.pending ?? stats.pending;

  const state = deriveTrackingState({
    permission,
    taskRegistered,
    paused: Boolean(options.paused),
    pendingUploads,
    lastFixAt: stats.newestCapturedAt,
    staleAfterMinutes: policy.staleAfterMinutes,
  });

  return {
    permission,
    taskRegistered,
    state,
    pendingUploads,
    droppedFixes: stats.dropped,
    lastFixAt: stats.newestCapturedAt,
    policy,
  };
}

/**
 * Reports the current state to the office and adopts the policy it sends back.
 *
 * Best effort by design: the office learning about a permission problem a minute later is fine, and
 * a failed report must never stop the driver using the app.
 */
export async function reportTracking(token: string, snapshot: TrackingSnapshot): Promise<TrackingPolicy | null> {
  try {
    const response = await locationsApi.reportState(token, {
      permission: toApiPermission(snapshot.permission),
      locationServicesEnabled: snapshot.permission.servicesEnabled,
      trackingState: snapshot.state,
      pendingUploads: snapshot.pendingUploads,
      ...(snapshot.lastFixAt ? { lastFixAt: snapshot.lastFixAt } : {}),
    });
    if (response.trackingPolicy) {
      await savePolicy(response.trackingPolicy);
      return response.trackingPolicy;
    }
    return null;
  } catch {
    return null;
  }
}

/** Sign-out: stop the service and leave no positions behind for the next driver on this phone. */
export async function shutdownTracking(): Promise<void> {
  await stopTracking();
  await clearBuffer();
}

export { acknowledgeDropped };
