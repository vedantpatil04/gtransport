import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useApp } from '@/store';
import { useUi } from '@/store/ui';

/**
 * Simulates the offline-first queue: when the device comes back online, queued updates
 * "upload" after a short delay and the driver sees a confirmation.
 */
export function SyncWatcher() {
  const { t } = useTranslation();
  const offline = useApp((s) => s.offline);
  const setSync = useUi((s) => s.setSync);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
    if (offline) {
      clear();
      setSync('idle');
      return;
    }
    const pending = useApp.getState().pendingSyncCount();
    if (!pending) return;
    setSync('syncing');
    timers.current.push(
      window.setTimeout(() => {
        const count = useApp.getState().syncPending();
        setSync('synced', count);
        toast.success(t('offline.synced'), { description: t('offline.syncedCount', { count }) });
        timers.current.push(window.setTimeout(() => setSync('idle'), 4000));
      }, 1800),
    );
    return clear;
  }, [offline, setSync, t]);

  return null;
}
