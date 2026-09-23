import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { offlineQueue, type QueuedAction } from './queue';

export interface NetworkState {
  online: boolean;
  pending: number;
  syncing: boolean;
}

/**
 * Connectivity plus queue depth, which together drive the small offline/sync indicator.
 * Reaching the internet is what counts, not merely being attached to a network.
 */
export function useNetwork(): NetworkState {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const reachable = Boolean(state.isConnected) && state.isInternetReachable !== false;
      setOnline(reachable);

      if (reachable) {
        setSyncing(true);
        void offlineQueue.drain().finally(() => setSyncing(false));
      }
    });

    const unsubscribeQueue = offlineQueue.subscribe((items: QueuedAction[]) => setPending(items.length));

    return () => {
      unsubscribeNet();
      unsubscribeQueue();
    };
  }, []);

  return { online, pending, syncing };
}
