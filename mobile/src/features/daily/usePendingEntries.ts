import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../lib/auth/session-store';
import { offlineQueue, visibleTo, type QueuedAction } from '../../lib/offline/queue';
import { toPendingEntry, type PendingEntry } from './submissions';

/**
 * The driver's entries still on the phone, live: Syncing while one is being sent, Waiting to sync
 * while it retries by itself, Failed when it needs them. Only this account's entries are listed.
 */
export function usePendingEntries(kind?: PendingEntry['kind']): PendingEntry[] {
  const ownerId = useSession((s) => s.user?.id);
  const [items, setItems] = useState<QueuedAction[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => offlineQueue.subscribe(setItems), []);
  useEffect(() => offlineQueue.subscribeActivity(setActiveId), []);

  return useMemo(
    () =>
      visibleTo(items, ownerId)
        .map((item) => toPendingEntry(item, activeId))
        .filter((entry): entry is PendingEntry => entry !== null && (!kind || entry.kind === kind)),
    [items, activeId, ownerId, kind],
  );
}
