import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TONE_ICON } from '@/features/driver/pages/DriverNotifications';
import { notifText } from '@/lib/notifications';
import { relTime } from '@/lib/relative';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';

export function NotificationsPopover() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const all = useApp((s) => s.notifications);
  const items = all.filter((n) => n.audience === 'admin').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = items.filter((n) => !n.read).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t('admin.nav.notifications')} data-testid="admin-bell">
          <Bell />
          {unread > 0 && <span className="figure absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(380px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-semibold">{t('admin.nav.notifications')}</p>
          {unread > 0 && (
            <button onClick={() => useApp.getState().markAllRead('admin')} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              <CheckCheck className="size-3.5" />
              {t('admin.top.markAllRead')}
            </button>
          )}
        </div>
        <ul className="scroll-thin max-h-[420px] divide-y overflow-y-auto">
          {items.slice(0, 8).map((n) => {
            const { title, body, tone } = notifText(n, t, i18n.language);
            const ic = TONE_ICON[tone];
            const Icon = ic.icon;
            return (
              <li key={n.id}>
                <PopoverClose asChild>
                  <button
                    onClick={() => {
                      useApp.getState().markRead(n.id);
                      if (n.link) navigate(n.link);
                    }}
                    className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/60', !n.read && 'bg-primary/[0.035]')}
                  >
                    <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', ic.cls)}>
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm leading-snug', !n.read ? 'font-semibold' : 'font-medium')}>{title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{body}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{relTime(n.createdAt, i18n.language)}</span>
                    </span>
                    {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                </PopoverClose>
              </li>
            );
          })}
          {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">{t('admin.top.noNotifications')}</li>}
        </ul>
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
