import { useTranslation } from 'react-i18next';
import { MapPin, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { relTime } from '@/lib/relative';
import { cn } from '@/lib/utils';
import { useApp, useCurrentDriver } from '@/store';
import { useMyPosition } from '../useDriverData';

export function LocationStatusLine({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const { t, i18n } = useTranslation();
  const driver = useCurrentDriver();
  const { position, now } = useMyPosition();
  const on = driver.locationSharing;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm', className)}>
      <span className={cn('inline-flex items-center gap-1.5 font-semibold', on ? (tone === 'light' ? 'text-[#7fe0a8]' : 'text-success') : tone === 'light' ? 'text-white/70' : 'text-muted-foreground')}>
        <span className="relative inline-flex size-2.5">
          {on && <span className="absolute inset-0 animate-ring-pulse rounded-full bg-current" />}
          <span className={cn('relative inline-flex size-full rounded-full', on ? 'bg-current' : 'bg-white/40')} />
        </span>
        {on ? t('driver.location.on') : t('driver.location.off')}
      </span>
      {on && position.updatedAt && <span className={tone === 'light' ? 'text-white/60' : 'text-muted-foreground'}>{t('driver.location.updated', { time: relTime(position.updatedAt, i18n.language, now) })}</span>}
    </span>
  );
}

export function LocationSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const driver = useCurrentDriver();
  const { position, now } = useMyPosition(10_000);
  const on = driver.locationSharing;
  const route = driver.sim.route;

  const toggle = () => {
    useApp.getState().updateDriver(driver.id, { locationSharing: !on });
    toast.success(on ? t('driver.location.turnedOff') : t('driver.location.turnedOn'));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[440px]">
        <div className="space-y-5 px-5 pb-7 pt-3">
          <SheetTitle>{t('driver.location.title')}</SheetTitle>
          <div className={cn('rounded-xl border p-4', on ? 'border-success/30 bg-success-soft' : 'bg-muted')}>
            <p className="text-sm text-muted-foreground">{t('driver.location.currentStatus')}</p>
            <p className={cn('mt-1 text-2xl font-bold', on ? 'text-success' : 'text-muted-foreground')}>{on ? t('driver.location.on') : t('driver.location.off')}</p>
            {!on && <p className="mt-1 text-sm text-muted-foreground">{t('driver.location.offHint')}</p>}
          </div>
          {on && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="panel p-3">
                <dt className="text-muted-foreground">{t('driver.location.lastUpdated')}</dt>
                <dd className="mt-1 font-semibold">{relTime(position.updatedAt, i18n.language, now)}</dd>
              </div>
              <div className="panel p-3">
                <dt className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="size-3.5" />
                  {t('driver.location.near')}
                </dt>
                <dd className="mt-1 font-semibold">{t(`city.${position.near}`)}</dd>
              </div>
              <div className="panel col-span-2 flex items-center gap-2 p-3">
                <Navigation className="size-4 text-primary" />
                <span className="font-semibold">{t('driver.location.onTheWay', { from: t(`city.${route[0]}`), to: t(`city.${route[route.length - 1]}`) })}</span>
              </div>
            </dl>
          )}
          <Button size="xl" variant={on ? 'outline' : 'success'} className="w-full" onClick={toggle} data-testid="location-toggle">
            {on ? t('driver.location.turnOff') : t('driver.location.turnOn')}
          </Button>
          <p className="text-center text-xs text-muted-foreground">{t('driver.location.demoNote')}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
