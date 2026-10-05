import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TONE_ICON } from '@/features/driver/pages/DriverNotifications';
import { notifText } from '@/lib/notifications';
import { relTime } from '@/lib/relative';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import type { NotificationKind } from '@/types';
import { PageHeader, Panel } from '../components/ui';
import { isApiConfigured } from '@/features/api/mode';
import { AttentionList } from '../components/LiveNotifications';

type Filter = 'all' | 'unread' | 'documents' | 'payments' | 'fleet';
const GROUP: Record<Exclude<Filter, 'all' | 'unread'>, NotificationKind[]> = {
  documents: ['doc_expiring', 'doc_expired', 'doc_uploaded', 'doc_verified', 'doc_rejected', 'doc_reminder', 'insurer_notified'],
  payments: ['payment_created', 'payment_processing', 'payment_paid', 'payment_failed', 'payment_pending', 'advance_reported', 'expense_approved', 'expense_rejected'],
  fleet: ['fuel_added', 'driver_offline', 'trip_assigned'],
};

function NotificationsDemo() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const all = useApp((s) => s.notifications);
  const [filter, setFilter] = useState<Filter>('all');
  const items = useMemo(() => all.filter((n) => n.audience === 'admin').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [all]);
  const unread = items.filter((n) => !n.read).length;
  const shown = items.filter((n) => (filter === 'all' ? true : filter === 'unread' ? !n.read : GROUP[filter].includes(n.kind)));
  const count = (f: Filter) => (f === 'all' ? items.length : f === 'unread' ? unread : items.filter((n) => GROUP[f].includes(n.kind)).length);

  return (
    <div>
      <PageHeader
        title={t('admin.notifications.title')}
        description={t('admin.notifications.subtitle', { count: unread })}
        actions={
          unread > 0 && (
            <Button variant="outline" onClick={() => useApp.getState().markAllRead('admin')}>
              <CheckCheck />
              {t('admin.top.markAllRead')}
            </Button>
          )
        }
      />
      <Panel>
        <div className="scroll-thin flex gap-1 overflow-x-auto border-b px-2 pt-2" role="tablist">
          {(['all', 'unread', 'documents', 'payments', 'fleet'] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1.5 text-sm font-medium', filter === f ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {t(`admin.notifications.filter.${f}`)}
              <span className="figure rounded-full bg-muted px-1.5 text-xs">{count(f)}</span>
            </button>
          ))}
        </div>
        <ul className="divide-y" data-testid="admin-notifications">
          {shown.map((n) => {
            const { title, body, tone } = notifText(n, t, i18n.language);
            const ic = TONE_ICON[tone];
            const Icon = ic.icon;
            return (
              <li key={n.id}>
                <button
                  onClick={() => {
                    useApp.getState().markRead(n.id);
                    if (n.link) navigate(n.link);
                  }}
                  className={cn('flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-accent/50', !n.read && 'bg-primary/[0.035]')}
                >
                  <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full', ic.cls)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', !n.read ? 'font-semibold' : 'font-medium')}>{title}</span>
                    <span className="block text-sm text-muted-foreground">{body}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground" title={fmtDateTime(n.createdAt, i18n.language)}>
                    {relTime(n.createdAt, i18n.language)}
                    {!n.read && <span className="ml-auto mt-1.5 block size-2 rounded-full bg-primary" />}
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-4 py-14 text-sm text-muted-foreground">
              <Bell className="size-6" />
              {t('admin.top.noNotifications')}
            </li>
          )}
        </ul>
      </Panel>
    </div>
  );
}

/** Real mode: what needs the office now, from the live API — the header bell's list in full. */
function NotificationsLive() {
  const { t } = useTranslation();
  return (
    <div data-testid="notifications-live">
      <PageHeader title={t('admin.notifications.title')} description={t('admin.notifications.live.subtitle')} />
      <Panel title={t('admin.notifications.live.attention')}>
        <AttentionList />
      </Panel>
    </div>
  );
}

export function NotificationsPage() {
  return isApiConfigured() ? <NotificationsLive /> : <NotificationsDemo />;
}
