import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import { docStatus } from '@/features/documents/expiry';
import { isApiConfigured } from '@/features/api/mode';
import { documentsApi, fleetApi, inboxApi, paymentsApi } from '@/features/api/resources';
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

/** Something in the live system that needs a person, and the screen where it is dealt with. */
export interface AttentionItem {
  key: 'documentsExpired' | 'documentsDueSoon' | 'paymentsApproval' | 'paymentsCheck' | 'fleetStationary' | 'inboxAttention';
  /** The navigation module it belongs to, for its icon and label. */
  module: Extract<AdminNavKey, 'documents' | 'payments' | 'fleet' | 'inbox'>;
  count: number;
  tone: 'danger' | 'warning' | 'neutral';
  to: string;
}

export interface LiveAttention {
  items: AttentionItem[];
  badges: Badges;
  /** Nothing has answered yet. */
  loading: boolean;
  /** A source failed, so "nothing needs attention" must not be claimed. */
  failed: boolean;
  reload: () => void;
}

/**
 * Real mode: what needs the office now, from the live API — documents expired or due within a
 * week, payments waiting on the office (payroll roles only), drivers stationary past the alert
 * threshold, and mail the inbox flags. Read once for the whole console (see AttentionProvider) and
 * shown as the sidebar badges and the header's notifications, so the two can never disagree.
 */
function useLiveAttentionSource(): LiveAttention {
  const role = useSession((s) => s.user?.role);
  const payroll = canManageFinance(role);
  const [tick, setTick] = useState(0);
  // A hidden tab asks nobody (the office leaves the console open all day); it catches up the
  // moment it is shown again, so the badges are never stale on screen.
  useEffect(() => {
    let missed = false;
    const id = window.setInterval(() => {
      if (document.hidden) missed = true;
      else setTick((n) => n + 1);
    }, REFRESH_MS);
    const onVisibility = () => {
      if (!document.hidden && missed) {
        missed = false;
        setTick((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  const compliance = useApiResource(() => documentsApi.summary(), [tick]);
  const payments = useApiResource(() => paymentsApi.summary(), [tick, payroll], payroll);
  // A driver stationary past the threshold needs someone to look; this is how the office finds
  // out without keeping Live Fleet open all day.
  const fleetAlerts = useApiResource(() => fleetApi.alertSummary(), [tick]);
  const inbox = useApiResource(() => inboxApi.summary(), [tick]);

  return useMemo(() => {
    const rows = compliance.data ?? [];
    const expired = rows.reduce((n, row) => n + row.expired, 0);
    const dueSoon = rows.reduce((n, row) => n + row.within7Days, 0);
    const by = payments.data?.byStatus ?? {};
    const approval = payroll ? by.PENDING_APPROVAL?.count ?? 0 : 0;
    const check = payroll ? (by.STATUS_REVIEW_REQUIRED?.count ?? 0) + (by.FAILED?.count ?? 0) : 0;
    const stationary = fleetAlerts.data?.needsAttention ?? 0;
    const mail = inbox.data?.needingAttention ?? 0;

    const candidates: AttentionItem[] = [
      { key: 'documentsExpired', module: 'documents', count: expired, tone: 'danger', to: '/admin/documents' },
      { key: 'paymentsCheck', module: 'payments', count: check, tone: 'danger', to: '/admin/finance/payments?status=STATUS_REVIEW_REQUIRED' },
      { key: 'fleetStationary', module: 'fleet', count: stationary, tone: 'danger', to: '/admin/fleet?status=alerting' },
      { key: 'documentsDueSoon', module: 'documents', count: dueSoon, tone: 'warning', to: '/admin/documents' },
      { key: 'paymentsApproval', module: 'payments', count: approval, tone: 'warning', to: '/admin/finance/payments?status=PENDING_APPROVAL' },
      { key: 'inboxAttention', module: 'inbox', count: mail, tone: 'neutral', to: '/admin/inbox' },
    ];
    const items = candidates.filter((item) => item.count > 0);

    const urgentDocs = expired + dueSoon;
    const pendingPay = approval + check;
    const badges: Badges = {
      documents: urgentDocs ? { count: urgentDocs, tone: 'danger' } : undefined,
      payments: pendingPay ? { count: pendingPay, tone: 'warning' } : undefined,
      finance: pendingPay ? { count: pendingPay, tone: 'warning' } : undefined,
      fleet: stationary ? { count: stationary, tone: 'danger' } : undefined,
      inbox: mail ? { count: mail, tone: 'neutral' } : undefined,
    };

    const sources = [compliance, fleetAlerts, inbox, ...(payroll ? [payments] : [])];
    return {
      items,
      badges,
      loading: sources.every((source) => source.loading && !source.data),
      failed: sources.some((source) => Boolean(source.error)),
      reload: () => sources.forEach((source) => source.reload()),
    };
    // Each resource is a fresh object per render; its fields are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    payroll,
    compliance.data, compliance.error, compliance.loading,
    payments.data, payments.error, payments.loading,
    fleetAlerts.data, fleetAlerts.error, fleetAlerts.loading,
    inbox.data, inbox.error, inbox.loading,
  ]);
}

const AttentionContext = createContext<LiveAttention | null>(null);

/** Wraps the signed-in console in real mode, so every consumer shares one set of requests. */
export function AttentionProvider({ children }: { children: React.ReactNode }) {
  const value = useLiveAttentionSource();
  return createElement(AttentionContext.Provider, { value }, children);
}

const NOTHING: LiveAttention = { items: [], badges: {}, loading: false, failed: false, reload: () => undefined };

/** Real mode's attention items; empty outside an AttentionProvider. */
export function useLiveAttention(): LiveAttention {
  return useContext(AttentionContext) ?? NOTHING;
}

function useLiveBadges(): Badges {
  return useLiveAttention().badges;
}

/** Counts shown next to sidebar items. The mode is fixed at build time, so the choice is stable. */
export const useAdminBadges: () => Badges = isApiConfigured() ? useLiveBadges : useDemoBadges;
