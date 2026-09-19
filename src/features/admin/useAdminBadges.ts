import { useMemo } from 'react';
import { docStatus } from '@/features/documents/expiry';
import { useApp } from '@/store';
import type { AdminNavKey } from './nav';

/** Counts shown next to sidebar items. */
export function useAdminBadges(): Partial<Record<AdminNavKey, { count: number; tone: 'danger' | 'warning' | 'neutral' }>> {
  const documents = useApp((s) => s.documents);
  const payments = useApp((s) => s.payments);
  const notifications = useApp((s) => s.notifications);
  return useMemo(() => {
    const urgentDocs = documents.filter((d) => docStatus(d).level >= 3).length;
    const pendingPay = payments.filter((p) => p.sync === 'synced' && (p.status === 'pending' || p.status === 'failed')).length;
    const unread = notifications.filter((n) => n.audience === 'admin' && !n.read).length;
    return {
      documents: urgentDocs ? { count: urgentDocs, tone: 'danger' } : undefined,
      payments: pendingPay ? { count: pendingPay, tone: 'warning' } : undefined,
      notifications: unread ? { count: unread, tone: 'neutral' } : undefined,
    };
  }, [documents, payments, notifications]);
}
