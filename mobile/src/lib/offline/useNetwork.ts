import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { offlineQueue, visibleTo, type QueuedAction } from './queue';
import { useSession } from '../auth/session-store';

export interface NetworkState {
  online: boolean;
  /** Entries waiting to be sent (still being retried). */
  pending: number;
  /** Entries that failed for good and need the driver (retry or discard). */
  failed: number;
  syncing: boolean;
}

/**
 * Connectivity plus queue depth, which together drive the small offline/sync indicator.
 * Reaching the internet is what counts, not merely being attached to a network.
 *
 * Read-only: when to send is decided in one place (lib/offline/sync), not by whichever screen
 * happens to be showing the banner.
 */
export function useNetwork(): NetworkState {
  const [online, setOnline] = useState(true);
  const [counts, setCounts] = useState({ pending: 0, failed: 0 });
  const [syncing, setSyncing] = useState(false);
  const ownerId = useSession((s) => s.user?.id);

  useEffect(() => {
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });

    const unsubscribeQueue = offlineQueue.subscribe((items: QueuedAction[]) => {
      const mine = visibleTo(items, ownerId);
      const failed = mine.filter((item) => item.status === 'rejected').length;
      setCounts({ pending: mine.length - failed, failed });
    });
    const unsubscribeActivity = offlineQueue.subscribeActivity((activeId) => setSyncing(activeId !== null));

    return () => {
      unsubscribeNet();
      unsubscribeQueue();
      unsubscribeActivity();
    };
  }, [ownerId]);

  return { online, pending: counts.pending, failed: counts.failed, syncing };
}
