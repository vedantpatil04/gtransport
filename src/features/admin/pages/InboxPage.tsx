import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, CheckCheck, Eye, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TONE_ICON } from '@/features/driver/pages/DriverNotifications';
import { fmtDateTime } from '@/lib/format';
import { notifText } from '@/lib/notifications';
import { relTime } from '@/lib/relative';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import type { NotificationKind } from '@/types';
import { FilterBar, PageHeader, Panel, SearchInput } from '../components/ui';
import { isApiConfigured } from '@/features/api/mode';
import { InboxConnected } from './InboxConnected';

type FilterTab = 'all' | 'unread' | 'docs' | 'payments' | 'fleet';

const GROUP: Record<Exclude<FilterTab, 'all' | 'unread'>, NotificationKind[]> = {
  docs: ['doc_expiring', 'doc_expired', 'doc_uploaded', 'doc_verified', 'doc_rejected', 'doc_reminder', 'insurer_notified'],
  payments: ['payment_created', 'payment_processing', 'payment_paid', 'payment_failed', 'payment_pending', 'advance_reported', 'expense_approved', 'expense_rejected'],
  fleet: ['fuel_added', 'driver_offline', 'trip_assigned'],
};

function InboxDemo() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const allNotifications = useApp((s) => s.notifications);

  const [tab, setTab] = useState<FilterTab>('all');
  const [q, setQ] = useState('');

  const adminNotifications = useMemo(() => {
    return allNotifications.filter((n) => n.audience === 'admin').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [allNotifications]);

  const unreadCount = useMemo(() => adminNotifications.filter((n) => !n.read).length, [adminNotifications]);

  const countForTab = (f: FilterTab) => {
    if (f === 'all') return adminNotifications.length;
    if (f === 'unread') return unreadCount;
    return adminNotifications.filter((n) => GROUP[f].includes(n.kind)).length;
  };

  const filtered = useMemo(() => {
    return adminNotifications
      .filter((n) => {
        if (tab === 'all') return true;
        if (tab === 'unread') return !n.read;
        return GROUP[tab].includes(n.kind);
      })
      .filter((n) => {
        if (!q.trim()) return true;
        const text = notifText(n, t, i18n.language);
        return `${text.title} ${text.body}`.toLowerCase().includes(q.toLowerCase());
      });
  }, [adminNotifications, tab, q, t, i18n.language]);

  const markAllRead = () => {
    useApp.getState().markAllRead('admin');
    toast.success(t('admin.inbox.allMarkedRead'));
  };

  const handleOpen = (id: string, link?: string) => {
    useApp.getState().markRead(id);
    if (link) {
      navigate(link);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('admin.inbox.title')}
        description={t('admin.inbox.subtitle')}
        actions={
          unreadCount > 0 && (
            <Button variant="outline" onClick={markAllRead}>
              <CheckCheck />
              {t('admin.inbox.markAllRead')}
            </Button>
          )
        }
      />

      <Panel>
        <div className="scroll-thin flex gap-1 overflow-x-auto border-b px-2 pt-2" role="tablist">
          {(['all', 'unread', 'docs', 'payments', 'fleet'] as FilterTab[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={tab === f}
              onClick={() => setTab(f)}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1.5 text-sm font-medium transition-colors',
                tab === f ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`admin.inbox.tab.${f}`)}
              <span className="figure rounded-full bg-muted px-1.5 text-xs">{countForTab(f)}</span>
            </button>
          ))}
        </div>

        <FilterBar active={Boolean(q)} onClear={() => setQ('')}>
          <SearchInput value={q} onChange={setQ} placeholder={t('common.search')} className="w-full sm:w-80" />
        </FilterBar>

        <ul className="divide-y" data-testid="admin-inbox-list">
          {filtered.map((n) => {
            const { title, body, tone } = notifText(n, t, i18n.language);
            const ic = TONE_ICON[tone];
            const Icon = ic.icon;

            return (
              <li key={n.id} className={cn('transition-colors hover:bg-accent/40', !n.read && 'bg-primary/[0.03]')}>
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full', ic.cls)}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={cn('text-sm', !n.read ? 'font-semibold text-foreground' : 'font-medium text-foreground/90')}>{title}</p>
                        {!n.read && <Badge tone="info" className="text-[10px] uppercase tracking-wider">New</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
                      <span className="mt-1 block text-[11px] text-muted-foreground" title={fmtDateTime(n.createdAt, i18n.language)}>
                        {relTime(n.createdAt, i18n.language)}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
                    {!n.read && (
                      <Button variant="ghost" size="sm" onClick={() => useApp.getState().markRead(n.id)}>
                        <CheckCheck className="size-3.5" />
                        {t('common.done')}
                      </Button>
                    )}
                    {n.link && (
                      <Button variant="outline" size="sm" onClick={() => handleOpen(n.id, n.link)}>
                        <Eye className="size-3.5" />
                        <ArrowUpRight className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}

          {filtered.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-4 py-16 text-sm text-muted-foreground">
              <Inbox className="size-8 opacity-40" />
              <p>{t('admin.inbox.empty')}</p>
            </li>
          )}
        </ul>
      </Panel>
    </div>
  );
}

/**
 * Real mode shows the company mailbox; the prototype keeps its notification feed.
 *
 * The two are different things that happen to share a nav entry: with a server there is an actual
 * inbound mailbox to read, and that is what the office wants behind "Inbox". Without one, the
 * approved prototype's feed stays exactly as it was.
 */
export function InboxPage() {
  return isApiConfigured() ? <InboxConnected /> : <InboxDemo />;
}
