import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck, CircleCheckBig, Info, TriangleAlert, CircleX } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { notifText, type NotifTone } from '@/lib/notifications';
import { relTime } from '@/lib/relative';
import { cn } from '@/lib/utils';
import { useApp, useCurrentDriver } from '@/store';
import { DriverHeader } from '../components/DriverHeader';

export const TONE_ICON: Record<NotifTone, { icon: typeof Bell; cls: string }> = {
  success: { icon: CircleCheckBig, cls: 'bg-success-soft text-success' },
  warning: { icon: TriangleAlert, cls: 'bg-warning-soft text-warning' },
  danger: { icon: CircleX, cls: 'bg-danger-soft text-danger' },
  info: { icon: Info, cls: 'bg-secondary text-foreground/70' },
};

export function DriverNotifications() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const driver = useCurrentDriver();
  const all = useApp((s) => s.notifications);
  const items = useMemo(() => all.filter((n) => n.audience === driver.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [all, driver.id]);
  const unread = items.filter((n) => !n.read).length;
  return (
    <div>
      <DriverHeader
        title={t('driver.notifications.title')}
        back="/driver"
        right={
          unread > 0 ? (
            <button onClick={() => useApp.getState().markAllRead(driver.id)} className="flex h-12 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold hover:bg-white/10">
              <CheckCheck className="size-5" />
              <span className="hidden min-[380px]:inline">{t('driver.notifications.markAllRead')}</span>
            </button>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={Bell} title={t('driver.notifications.empty')} />
      ) : (
        <ul className="divide-y">
          {items.map((n) => {
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
                  className={cn('flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-accent/60', !n.read && 'bg-primary/[0.04]')}
                  data-testid="driver-notification"
                >
                  <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', ic.cls)}>
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={cn('font-semibold leading-snug', !n.read && 'font-bold')}>{title}</span>
                      {!n.read && <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" aria-label={t('driver.notifications.new')} />}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{body}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{relTime(n.createdAt, i18n.language)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
