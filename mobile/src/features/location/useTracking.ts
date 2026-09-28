import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSession } from '../../lib/auth/session-store';
import { openLocationSettings, needsSettings, requestPermission } from '../../lib/location/permission';
import { ensureTracking, reportTracking, syncBuffer, type TrackingSnapshot } from '../../lib/location/tracking';
import { toDriverFacingState, type DriverFacingState } from '../../lib/location/tracking-state';

/**
 * Keeps background tracking alive, and keeps the office informed.
 *
 * The app cannot simply start tracking once and assume it continues. Android stops long-running
 * services under memory pressure, a reboot clears everything, and the driver can revoke permission
 * or switch location off at any moment from outside the app. So the truth is re-established at the
 * three moments it can have changed:
 *
 *  - when the driver signs in or the app launches;
 *  - when the app returns to the foreground, which is when an OS change becomes visible;
 *  - when connectivity returns, which is when a buffered backlog can finally go.
 *
 * Tracking is paused — genuinely stopped, not merely reported as stopped — when there is no signed-in
 * driver, so no service runs for nobody.
 */

export interface TrackingView {
  state: DriverFacingState;
  /** The precise state, for the sync counter and for anything the office also sees. */
  snapshot: TrackingSnapshot | null;
  pendingUploads: number;
  droppedFixes: number;
  /** True while a permission prompt or a manual sync is in flight. */
  busy: boolean;
  /** The one action that would help: the prompt, or the OS settings screen. */
  action: 'requestPermission' | 'openSettings' | 'none';
  /** Runs that action. */
  resolve: () => Promise<void>;
  /** Uploads whatever the buffer holds, for the driver's own "sync now". */
  sync: () => Promise<void>;
}

export function useTracking(): TrackingView {
  const token = useSession((s) => s.token);
  const role = useSession((s) => s.role);
  const driverStatus = useSession((s) => s.driver?.status);

  const [snapshot, setSnapshot] = useState<TrackingSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  // Guards against two refreshes overlapping — an app-state change and a network change can land
  // together, and both would otherwise start a sync pass over the same buffer.
  const running = useRef(false);

  /**
   * Tracking is only appropriate for a signed-in driver who is actually on duty. A stood-down
   * driver's app stops the service rather than reporting positions the server would refuse.
   */
  const paused = !token || role !== 'DRIVER' || (driverStatus !== undefined && driverStatus !== 'ACTIVE');

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const next = await ensureTracking({ paused });
      setSnapshot(next);
      // The office needs to know when tracking cannot work, and the response carries the reporting
      // policy — so this is also how a tuned interval reaches the device.
      if (token && !paused) await reportTracking(token, next);
    } catch {
      // Tracking is best effort; a failure here must never break the screen the driver is using.
    } finally {
      running.current = false;
    }
  }, [paused, token]);

  // Launch, sign-in, sign-out, and a change of driver status.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Returning to the foreground: the moment an OS-level change becomes observable.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status === 'active') void refresh();
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [refresh]);

  // Connectivity returning is the moment a buffered backlog can go out.
  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      const reachable = Boolean(state.isConnected) && state.isInternetReachable !== false;
      if (!reachable || paused || !token) return;
      void syncBuffer(token)
        .then((outcome) => setSnapshot((current) => (current ? { ...current, pendingUploads: outcome.pending } : current)))
        .catch(() => undefined);
    });
  }, [paused, token]);

  const action: TrackingView['action'] = (() => {
    if (!snapshot || paused) return 'none';
    if (snapshot.state === 'TRACKING_ACTIVE' || snapshot.state === 'SYNC_PENDING') return 'none';
    return needsSettings(snapshot.permission) ? 'openSettings' : 'requestPermission';
  })();

  const resolve = useCallback(async () => {
    if (busy || action === 'none') return;
    setBusy(true);
    try {
      // Once the OS has stopped showing the prompt, only Settings can change the answer — offering
      // the prompt again would do nothing and would look broken.
      if (action === 'openSettings') await openLocationSettings();
      else await requestPermission({ includeBackground: true });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [action, busy, refresh]);

  const sync = useCallback(async () => {
    if (busy || !token) return;
    setBusy(true);
    try {
      const outcome = await syncBuffer(token);
      setSnapshot((current) => (current ? { ...current, pendingUploads: outcome.pending } : current));
    } finally {
      setBusy(false);
    }
  }, [busy, token]);

  return {
    state: snapshot ? toDriverFacingState(paused ? 'TRACKING_PAUSED' : snapshot.state) : 'unavailable',
    snapshot,
    pendingUploads: snapshot?.pendingUploads ?? 0,
    droppedFixes: snapshot?.droppedFixes ?? 0,
    busy,
    action,
    resolve,
    sync,
  };
}
