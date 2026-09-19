import { useTranslation } from 'react-i18next';
import { CloudOff } from 'lucide-react';
import { useApp } from '@/store';

export function OfflineBanner() {
  const { t } = useTranslation();
  const offline = useApp((s) => s.offline);
  const waiting = useApp((s) => s.fuel.filter((f) => f.sync === 'pending').length + s.expenses.filter((e) => e.sync === 'pending').length + s.payments.filter((p) => p.sync === 'pending').length);
  if (!offline) return null;
  return (
    <div role="status" className="flex items-start gap-2.5 bg-[#3b2a06] px-4 py-2.5 text-sm text-amber-100" data-testid="offline-banner">
      <CloudOff className="mt-0.5 size-5 shrink-0 text-amber-300" />
      <div>
        <p className="font-semibold">{t('offline.banner')}</p>
        {waiting > 0 && <p className="text-amber-200/80">{t('offline.waiting', { count: waiting })}</p>}
      </div>
    </div>
  );
}
