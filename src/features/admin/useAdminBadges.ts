import { useEffect, useMemo, useState } from 'react';
import { docStatus } from '@/features/documents/expiry';
import { isApiConfigured } from '@/features/api/mode';
import { documentsApi, fleetApi, paymentsApi } from '@/features/api/resources';
import { canManageFinance, useSession } from '@/features/api/session';
import { useApiResource } from '@/features/api/useApiResource';
import { useApp } from '@/store';
import type { AdminNavKey } from './nav';

type Badges = Partial<Record<AdminNavKey, { count: number; tone: 'danger' | 'warning' | 'neutral' }>>;

/** Demo mode: counts from the prototype's local store, exactly as before. */
function useDemoBadges(): Badges {
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
      finance: pendingPay ? { count: pendingPay, tone: 'warning' } : undefined,
      inbox: unread ? { count: unread, tone: 'neutral' } : undefined,
      notifications: unread ? { count: unread, tone: 'neutral' } : undefined,
    };
  }, [documents, payments, notifications]);
}

const REFRESH_MS = 2 * 60 * 1000;

/**
 * Real mode: counts from the live API — documents expired or due within a week, payments waiting on
 * the office (payroll roles only), and unacknowledged stationary alerts. Inbox and notifications
 * have no live source yet, so they show no count rather than a sample one.
 */
function useLiveBadges(): Badges {
  const role = useSession((s) => s.user?.role);
  const payroll = canManageFinance(role);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);
  const compliance = useApiResource(() => documentsApi.summary(), [tick]);
  const payments = useApiResource(() => paymentsApi.summary(), [tick, payroll], payroll);
  // A driver stationary past the threshold needs someone to look; the badge is how the office
  // finds out without keeping Live Fleet open all day.
  const fleetAlerts = useApiResource(() => fleetApi.alertSummary(), [tick]);
  return useMemo(() => {
    const urgentDocs = (compliance.data ?? []).reduce((n, row) => n + row.expired + row.within7Days, 0);
    const by = payments.data?.byStatus ?? {};
    const pendingPay = payroll ? (by.PENDING_APPROVAL?.count ?? 0) + (by.STATUS_REVIEW_REQUIRED?.count ?? 0) + (by.FAILED?.count ?? 0) : 0;
    const stationary = fleetAlerts.data?.needsAttention ?? 0;
    return {
      documents: urgentDocs ? { count: urgentDocs, tone: 'danger' } : undefined,
      payments: pendingPay ? { count: pendingPay, tone: 'warning' } : undefined,
      finance: pendingPay ? { count: pendingPay, tone: 'warning' } : undefined,
      fleet: stationary ? { count: stationary, tone: 'danger' } : undefined,
    };
  }, [compliance.data, payments.data, fleetAlerts.data, payroll]);
}

/** Counts shown next to sidebar items. The mode is fixed at build time, so the choice is stable. */
export const useAdminBadges: () => Badges = isApiConfigured() ? useLiveBadges : useDemoBadges;
