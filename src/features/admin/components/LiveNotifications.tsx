import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Bell, CheckCheck, ChevronRight, Files, Inbox, Navigation, Wallet, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useLiveAttention, type AttentionItem } from '../useAdminBadges';

/**
 * Real mode's notifications: what needs the office right now, read live from documents, payments,
 * Live Fleet and the mailbox. Every entry is a count the API reported and opens the screen where it
 * is dealt with — nothing here is a sample, and an empty list is only claimed when every source
 * answered.
 */

const MODULE_ICON: Record<AttentionItem['module'], LucideIcon> = { documents: Files, payments: Wallet, fleet: Navigation, inbox: Inbox };
const TONE_CLASS: Record<AttentionItem['tone'], string> = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  neutral: 'bg-muted text-foreground/70',
};

export function AttentionList({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { items, loading, failed, reload } = useLiveAttention();

  if (loading) {
    return (
      <div className="space-y-3 px-4 py-4" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {failed && (
        <div className="flex items-center justify-between gap-3 border-b bg-danger-soft/40 px-4 py-2.5 text-sm text-danger" role="status" data-testid="attention-failed">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            {t('admin.notifications.live.loadFailed')}
          </span>
          <Button variant="ghost" size="sm" onClick={reload}>
            {t('admin.api.retry')}
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        failed ? null : (
          <div className={cn('flex flex-col items-center gap-2 px-4 text-center', compact ? 'py-8' : 'py-14')} data-testid="attention-clear">
            <span className="flex size-10 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCheck className="size-5" />
            </span>
            <p className="text-sm font-medium">{t('admin.notifications.live.allClear')}</p>
            {!compact && <p className="max-w-sm text-sm text-muted-foreground">{t('admin.notifications.live.allClearHint')}</p>}
          </div>
        )
      ) : (
        <ul className="divide-y" data-testid="attention-list">
          {items.map((item) => {
            const Icon = MODULE_ICON[item.module];
            return (
              <li key={item.key}>
                <Link to={item.to} onClick={onNavigate} className={cn('flex items-center gap-3 px-4 text-left transition-colors hover:bg-accent/50', compact ? 'py-3' : 'py-3.5')} data-testid={`attention-${item.key}`}>
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', TONE_CLASS[item.tone])}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug">{t(`admin.notifications.live.item.${item.key}`, { count: item.count })}</span>
                    <span className="block text-xs text-muted-foreground">{t(`admin.nav.${item.module}`)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The header bell in real mode: a live count, and the list one click away. */
export function LiveNotificationsPopover() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { items } = useLiveAttention();
  const total = items.reduce((n, item) => n + item.count, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t('admin.nav.notifications')} title={t('admin.nav.notifications')} data-testid="admin-bell">
          <Bell />
          {total > 0 && (
            <span className="figure absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white" data-testid="admin-bell-count">
              {total > 99 ? '99+' : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(380px,calc(100vw-24px))] p-0">
        <div className="border-b px-4 py-3">
          <p className="font-semibold">{t('admin.notifications.live.attention')}</p>
        </div>
        <div className="scroll-thin max-h-[420px] overflow-y-auto">
          <AttentionList compact onNavigate={() => setOpen(false)} />
        </div>
        <div className="border-t p-2">
          <PopoverClose asChild>
            <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/admin/notifications')}>
              {t('admin.top.viewAll')}
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
