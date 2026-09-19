import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Check, ChevronRight, CircleHelp, Hash, Languages, LogOut, MapPin, Phone, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { LANGUAGES, nativeName } from '@/i18n';
import i18n from '@/i18n';
import { initials, cn } from '@/lib/utils';
import { useApp, useCurrentDriver } from '@/store';
import type { Lang } from '@/types';
import { DriverHeader } from '../components/DriverHeader';
import { LocationSheet, LocationStatusLine } from '../components/LocationSheet';
import { useMyVehicle } from '../useDriverData';

type Panel = 'language' | 'prefs' | 'help' | 'location' | 'logout' | null;

export function DriverProfile() {
  const { t } = useTranslation();
  const driver = useCurrentDriver();
  const vehicle = useMyVehicle();
  const [panel, setPanel] = useState<Panel>(null);
  const prefsOn = Object.values(driver.notificationPrefs).filter(Boolean).length;

  const Row = ({ icon: Icon, label, value, onClick, testId }: { icon: typeof Bell; label: string; value?: React.ReactNode; onClick?: () => void; testId?: string }) => {
    const inner = (
      <>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-muted-foreground">{label}</span>
          <span className="block truncate font-semibold">{value}</span>
        </span>
        {onClick && <ChevronRight className="size-5 shrink-0 text-muted-foreground" />}
      </>
    );
    return onClick ? (
      <button onClick={onClick} className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/60" data-testid={testId}>
        {inner}
      </button>
    ) : (
      <div className="flex min-h-[64px] items-center gap-3 px-3 py-2.5">{inner}</div>
    );
  };

  return (
    <div>
      <DriverHeader title={t('driver.profile.title')} />
      <div className="space-y-5 px-4 py-5">
        <div className="flex items-center gap-4 px-1">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-white">{initials(driver.name)}</span>
          <div className="min-w-0">
            <p className="truncate text-xl font-bold">{driver.name}</p>
            <p className="text-sm text-muted-foreground">
              {t('driver.profile.driverId')}: <span className="font-mono font-semibold text-foreground">{driver.code}</span>
            </p>
          </div>
        </div>

        <div className="panel divide-y overflow-hidden">
          <Row icon={Hash} label={t('driver.profile.driverId')} value={driver.code} />
          <Row icon={Phone} label={t('driver.profile.phone')} value={<span className="figure">{driver.phone}</span>} />
          <Row icon={Truck} label={t('driver.profile.vehicle')} value={vehicle ? <Plate reg={vehicle.reg} size="sm" className="mt-0.5" /> : t('driver.home.noVehicle')} />
        </div>

        <div className="panel divide-y overflow-hidden">
          <Row icon={Languages} label={t('driver.profile.language')} value={nativeName(driver.language)} onClick={() => setPanel('language')} testId="profile-language" />
          <div className="flex min-h-[64px] items-center gap-3 px-3 py-2.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70">
              <MapPin className="size-5" />
            </span>
            <button onClick={() => setPanel('location')} className="min-w-0 flex-1 text-left">
              <span className="block text-sm text-muted-foreground">{t('driver.profile.location')}</span>
              <LocationStatusLine className="text-[13px]" />
            </button>
            <Switch
              size="lg"
              checked={driver.locationSharing}
              aria-label={t('driver.profile.location')}
              onCheckedChange={(v) => {
                useApp.getState().updateDriver(driver.id, { locationSharing: v });
                toast.success(v ? t('driver.location.turnedOn') : t('driver.location.turnedOff'));
              }}
              data-testid="profile-location-switch"
            />
          </div>
          <Row icon={Bell} label={t('driver.profile.notificationPrefs')} value={prefsOn === 3 ? t('driver.profile.allOn') : t('driver.profile.someOn', { count: prefsOn })} onClick={() => setPanel('prefs')} />
          <Row icon={CircleHelp} label={t('driver.profile.help')} value={t('driver.help.callOffice')} onClick={() => setPanel('help')} />
        </div>

        <Button variant="outline" size="xl" className="w-full text-danger hover:text-danger" onClick={() => setPanel('logout')}>
          <LogOut />
          {t('driver.profile.logout')}
        </Button>
      </div>

      <LanguageSheet open={panel === 'language'} onOpenChange={(v) => setPanel(v ? 'language' : null)} />
      <PrefsSheet open={panel === 'prefs'} onOpenChange={(v) => setPanel(v ? 'prefs' : null)} />
      <HelpSheet open={panel === 'help'} onOpenChange={(v) => setPanel(v ? 'help' : null)} />
      <LocationSheet open={panel === 'location'} onOpenChange={(v) => setPanel(v ? 'location' : null)} />
      <Dialog open={panel === 'logout'} onOpenChange={(v) => setPanel(v ? 'logout' : null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('driver.profile.logoutConfirm')}</DialogTitle>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="lg" onClick={() => setPanel(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" size="lg" onClick={() => { setPanel(null); useApp.getState().logout('driver'); }}>
              {t('driver.profile.logout')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function LanguageSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const driver = useCurrentDriver();
  const choose = (code: Lang) => {
    useApp.getState().updateDriver(driver.id, { language: code });
    onOpenChange(false);
    // Confirm in the newly chosen language.
    window.setTimeout(() => toast.success(i18n.t('driver.profile.languageChanged', { lng: code }), { description: nativeName(code) }), 50);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[440px]">
        <div className="overflow-y-auto px-5 pb-7 pt-3">
          <SheetTitle>{t('driver.profile.changeLanguage')}</SheetTitle>
          <div className="mt-4 grid grid-cols-2 gap-2.5" role="radiogroup">
            {LANGUAGES.map((l) => {
              const active = l.code === driver.language;
              return (
                <button
                  key={l.code}
                  role="radio"
                  aria-checked={active}
                  lang={l.code}
                  onClick={() => choose(l.code)}
                  data-testid={`lang-${l.code}`}
                  className={cn('relative flex h-[76px] flex-col items-start justify-center rounded-xl border-2 px-4 text-left transition-colors', active ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent')}
                >
                  <span className="text-xl font-bold">{l.native}</span>
                  <span className="text-xs text-muted-foreground">{l.english}</span>
                  {active && (
                    <span className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-primary text-white">
                      <Check className="size-4" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PrefsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const driver = useCurrentDriver();
  const items = [
    { key: 'payments', label: t('driver.profile.prefPayments') },
    { key: 'documents', label: t('driver.profile.prefDocuments') },
    { key: 'trips', label: t('driver.profile.prefTrips') },
  ] as const;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[440px]">
        <div className="px-5 pb-7 pt-3">
          <SheetTitle>{t('driver.profile.notificationPrefs')}</SheetTitle>
          <div className="panel mt-4 divide-y">
            {items.map((it) => (
              <label key={it.key} className="flex min-h-16 cursor-pointer items-center justify-between gap-3 px-4">
                <span className="font-semibold">{it.label}</span>
                <Switch
                  size="lg"
                  checked={driver.notificationPrefs[it.key]}
                  onCheckedChange={(v) => useApp.getState().updateDriver(driver.id, { notificationPrefs: { ...driver.notificationPrefs, [it.key]: v } })}
                />
              </label>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function HelpSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const [openQ, setOpenQ] = useState<number | null>(0);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[440px]">
        <div className="overflow-y-auto px-5 pb-7 pt-3">
          <SheetTitle>{t('driver.help.title')}</SheetTitle>
          <Button asChild size="xl" variant="success" className="mt-4 h-14 w-full">
            <a href="tel:+918312400000">
              <Phone />
              {t('driver.help.callOffice')}
            </a>
          </Button>
          <p className="mt-2 text-center text-sm text-muted-foreground">{t('driver.help.hours')}</p>
          <h3 className="mb-2 mt-6 text-[15px] font-bold">{t('driver.help.faq')}</h3>
          <div className="panel divide-y">
            {[1, 2, 3, 4].map((n) => (
              <div key={n}>
                <button className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left font-semibold" onClick={() => setOpenQ(openQ === n ? null : n)} aria-expanded={openQ === n}>
                  {t(`driver.help.q${n}`)}
                  <ChevronRight className={cn('size-4 shrink-0 transition-transform', openQ === n && 'rotate-90')} />
                </button>
                {openQ === n && <p className="px-4 pb-4 text-[15px] text-muted-foreground">{t(`driver.help.a${n}`)}</p>}
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
