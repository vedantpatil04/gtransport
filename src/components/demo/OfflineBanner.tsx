import { CloudUpload, LoaderCircle, WifiOff, CircleCheckBig } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import { useUi } from '@/store/ui';

export function OfflineBanner({ className }: { className?: string }) {
  const { t } = useTranslation();
  const offline = useApp((s) => s.offline);
  const pending = useApp((s) => s.fuel.filter((f) => f.sync === 'pending').length + s.expenses.filter((e) => e.sync === 'pending').length + s.payments.filter((p) => p.sync === 'pending').length);
  const sync = useUi((s) => s.sync);

  if (offline)
    return (
      <div role="status" className={cn('flex items-start gap-3 bg-[#2b2f36] px-4 py-3 text-white', className)}>
        <WifiOff className="mt-0.5 size-5 shrink-0 text-[#F4C430]" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{t('offline.banner')}</p>
          {pending > 0 && (
            <p className="mt-0.5 flex items-center gap-1.5 text-white/70">
              <CloudUpload className="size-4" />
              {t('offline.waiting', { count: pending })}
            </p>
          )}
        </div>
      </div>
    );
  if (sync === 'syncing')
    return (
      <div role="status" className={cn('flex items-center gap-3 bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground', className)}>
        <LoaderCircle className="size-5 animate-spin" />
        {t('offline.syncing')}
      </div>
    );
  if (sync === 'synced')
    return (
      <div role="status" className={cn('flex items-center gap-3 bg-success px-4 py-3 text-sm font-semibold text-white animate-in fade-in', className)}>
        <CircleCheckBig className="size-5" />
        {t('offline.synced')}
      </div>
    );
  return null;
}
