import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, ChevronRight, CircleCheckBig, Fuel, Plus, TriangleAlert, Truck } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Plate } from '@/components/Plate';
import { PAYMENT_TONE, PaymentStatusChip, useExpiryLabel } from '@/components/status';
import { HOME_UPDATE_TYPES } from '@/data/constants';
import { docStatus, LEVEL_STYLES } from '@/features/documents/expiry';
import { fmtDayMonth, inr } from '@/lib/format';
import { todayISO } from '@/lib/dates';
import { driverDayTotals } from '@/lib/selectors';
import { cn } from '@/lib/utils';
import { useApp, useCurrentDriver } from '@/store';
import type { UpdateType } from '@/types';
import { AddUpdateSheet } from '../components/AddUpdateSheet';
import { SectionTitle } from '../components/DriverHeader';
import { LocationSheet, LocationStatusLine } from '../components/LocationSheet';
import { UPDATE_META } from '../updateMeta';
import { useMyDocuments, useMyVehicle, useUnreadCount } from '../useDriverData';

let hasShownDriverSplash = false;

function greetingKey(hour: number) {
  if (hour < 12) return 'greeting.morning';
  if (hour < 17) return 'greeting.afternoon';
  return 'greeting.evening';
}

export function DriverHome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const driver = useCurrentDriver();
  const vehicle = useMyVehicle();
  const fuel = useApp((s) => s.fuel);
  const expenses = useApp((s) => s.expenses);
  const payments = useApp((s) => s.payments);
  const unread = useUnreadCount(driver.id);
  const [updateType, setUpdateType] = useState<UpdateType | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(() => !hasShownDriverSplash);
  const [splashFading, setSplashFading] = useState(false);

  useEffect(() => {
    if (!showSplash) return;
    const fadeTimer = setTimeout(() => {
      setSplashFading(true);
    }, 1100);

    const doneTimer = setTimeout(() => {
      setShowSplash(false);
      hasShownDriverSplash = true;
    }, 1450);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [showSplash]);

  const today = useMemo(() => driverDayTotals(driver.id, todayISO(), fuel, expenses, payments), [driver.id, fuel, expenses, payments]);
  const firstName = driver.name.split(' ')[0];

  return (
    <div className="relative animate-in fade-in duration-300">
      {showSplash && (
        <div
          className={cn(
            'fixed inset-y-0 inset-x-0 mx-auto max-w-[440px] z-50 flex flex-col items-center justify-center bg-white transition-opacity duration-350 ease-out',
            splashFading ? 'pointer-events-none opacity-0' : 'opacity-100',
          )}
          aria-hidden="true"
        >
          <div className="flex flex-col items-center justify-center px-6 text-center animate-in zoom-in-95 fade-in duration-500 ease-out">
            <img
              src="/branding/gangamata-mark.png"
              alt="Gangamata Transport Mark"
              className="h-24 w-auto object-contain drop-shadow-sm"
              style={{ maxHeight: '100px' }}
            />
            <div className="mt-4 flex flex-col items-center leading-none">
              <span
                className="font-serif text-2xl font-bold tracking-[0.03em] text-[#0B2545]"
                style={{ fontFamily: "'Cinzel', Georgia, serif" }}
              >
                GANGAMATA
              </span>
              <span className="mt-1.5 font-sans text-xs font-semibold tracking-[0.22em] text-[#D97706]">
                TRANSPORT
              </span>
            </div>
            <div className="mt-6 flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[#0B2545]/40 animate-pulse" />
              <span className="size-1.5 rounded-full bg-[#D97706]/70 animate-pulse [animation-delay:150ms]" />
              <span className="size-1.5 rounded-full bg-[#138808]/70 animate-pulse [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}
      <header className="relative overflow-hidden bg-primary px-5 pb-[4.5rem] pt-3 text-white">
        <svg aria-hidden viewBox="0 0 200 200" className="pointer-events-none absolute -right-10 top-6 h-56 w-56 opacity-[0.09]">
          <path d="M10 190 C60 120 120 110 190 10" stroke="#F4C430" strokeWidth="26" fill="none" strokeLinecap="round" />
          <path d="M10 190 C60 120 120 110 190 10" stroke="#fff" strokeWidth="3" strokeDasharray="14 12" fill="none" />
        </svg>
        <div className="flex items-center justify-between">
          <Logo tone="light" size="sm" />
          <Link to="/driver/notifications" className="relative flex size-12 items-center justify-center rounded-full hover:bg-white/10" aria-label={t('driver.home.notifications')} data-testid="driver-bell">
            <Bell className="size-6" />
            {unread > 0 && (
              <span className="figure absolute right-1.5 top-1.5 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold ring-2 ring-primary">{unread}</span>
            )}
          </Link>
        </div>
        <h1 className="mt-3 text-[26px] font-bold leading-tight" data-testid="driver-greeting">
          {t(greetingKey(new Date().getHours()), { name: firstName })} <span aria-hidden>👋</span>
        </h1>
        <div className="mt-4 flex items-center gap-3">
          {vehicle ? (
            <>
              <Plate reg={vehicle.reg} size="lg" />
              <div className="min-w-0 text-sm leading-tight">
                <p className="text-white/60">{t('driver.home.yourVehicle')}</p>
                <p className="truncate font-medium text-white/90">{vehicle.model}</p>
              </div>
            </>
          ) : (
            <p className="flex items-center gap-2 text-white/80">
              <Truck className="size-5" />
              {t('driver.home.noVehicle')}
            </p>
          )}
        </div>
        <button onClick={() => setLocationOpen(true)} className="-mx-2 mt-3 flex min-h-11 items-center rounded-lg px-2 text-left hover:bg-white/5" data-testid="home-location">
          <LocationStatusLine tone="light" />
        </button>
      </header>

      <div className="relative -mt-14 space-y-6 px-4">
        <section className="panel p-4 shadow-[0_6px_24px_rgba(15,30,50,0.10)]" aria-labelledby="today-title">
          <div className="flex items-baseline justify-between">
            <h2 id="today-title" className="text-[15px] font-bold">
              {t('driver.home.todaySummary')}
            </h2>
            <span className="text-xs text-muted-foreground">{fmtDayMonth(todayISO(), driver.language)}</span>
          </div>
          <dl className="mt-3 grid grid-cols-3 divide-x">
            {[
              { key: 'fuel', label: t('driver.home.fuel'), value: today.fuel, cls: '', testId: 'today-fuel' },
              { key: 'other', label: t('driver.home.otherExpenses'), value: today.other, cls: '', testId: 'today-other' },
              { key: 'received', label: t('driver.home.received'), value: today.received, cls: 'text-success', testId: 'today-received' },
            ].map((c, i) => (
              <div key={c.key} className={cn('flex flex-col justify-between gap-1.5', i === 0 ? 'pr-3' : i === 1 ? 'px-3' : 'pl-3')}>
                <dt className="text-xs font-medium leading-tight text-muted-foreground">{c.label}</dt>
                <dd className={cn('figure text-[22px] font-bold leading-none', c.cls)} data-testid={c.testId}>
                  {inr(c.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {vehicle ? (
          <button
            onClick={() => navigate('/driver/fuel/new')}
            className="group flex w-full items-center gap-4 rounded-2xl bg-primary px-4 py-4 text-left text-white shadow-[0_10px_24px_-8px_rgba(27,43,68,0.55)] transition-transform active:scale-[0.99]"
            data-testid="add-fuel"
          >
            <span className="flex size-[60px] shrink-0 items-center justify-center rounded-2xl bg-plate text-[#1a1a1a]">
              <Fuel className="size-8" strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-[26px] font-extrabold uppercase leading-none tracking-wide">
                <Plus className="size-6 shrink-0" strokeWidth={3} />
                <span className="truncate">{t('driver.home.addFuel')}</span>
              </span>
              <span className="mt-1.5 block truncate text-sm text-white/70">
                {t('driver.home.addFuelHint')} · {t('driver.home.fuelToday', { count: today.fuelCount })}
              </span>
            </span>
            <ChevronRight className="size-6 shrink-0 text-white/60 transition-transform group-hover:translate-x-0.5" />
          </button>
        ) : (
          <div className="panel flex items-start gap-3 p-4">
            <Truck className="mt-0.5 size-6 text-muted-foreground" />
            <div>
              <p className="font-semibold">{t('driver.home.noVehicle')}</p>
              <p className="text-sm text-muted-foreground">{t('driver.home.noVehicleHint')}</p>
            </div>
          </div>
        )}

        <section aria-labelledby="updates-title">
          <SectionTitle>
            <span id="updates-title">{t('driver.home.otherUpdates')}</span>
          </SectionTitle>
          <div className="grid grid-cols-3 gap-2.5">
            {HOME_UPDATE_TYPES.map((type) => {
              const meta = UPDATE_META[type];
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  onClick={() => (vehicle || type === 'advance' ? setUpdateType(type) : undefined)}
                  disabled={!vehicle && type !== 'advance'}
                  className="panel flex h-[92px] flex-col items-center justify-center gap-2 px-1 transition-colors hover:bg-accent active:bg-accent disabled:opacity-50"
                  data-testid={`update-tile-${type}`}
                >
                  <span className={cn('flex size-11 items-center justify-center rounded-xl', meta.tint)}>
                    <Icon className="size-6" />
                  </span>
                  <span className="max-w-full truncate px-1 text-[13px] font-semibold leading-tight">{t(`enum.categoryShort.${type}`)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <LatestPayment />
        <DocumentStatus />
        <div className="h-2" />
      </div>

      <AddUpdateSheet type={updateType} onClose={() => setUpdateType(null)} />
      <LocationSheet open={locationOpen} onOpenChange={setLocationOpen} />
    </div>
  );
}

function LatestPayment() {
  const { t } = useTranslation();
  const driver = useCurrentDriver();
  const payment = useApp((s) =>
    s.payments.filter((p) => p.driverId === driver.id && p.status !== 'cancelled').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0],
  );
  if (!payment) return null;
  const tone = PAYMENT_TONE[payment.status];
  const Icon = tone.icon;
  return (
    <section>
      <SectionTitle
        action={
          <Link to="/driver/payments" className="flex min-h-9 items-center text-sm font-semibold text-primary">
            {t('common.seeAll')}
          </Link>
        }
      >
        {t('driver.home.latestPayment')}
      </SectionTitle>
      <Link to={`/driver/payments/${payment.id}`} className="panel flex items-center gap-3 p-4 hover:bg-accent/50" data-testid="home-payment">
        <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-full', tone.bg, tone.text)}>
          <Icon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="figure text-xl font-bold leading-tight">{inr(payment.amount)}</p>
            <PaymentStatusChip status={payment.status} driver size="lg" />
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {t(`enum.paymentType.${payment.type}`)} · {fmtDayMonth(payment.paidAt ?? payment.updatedAt, driver.language)}
          </p>
        </div>
      </Link>
    </section>
  );
}

function DocumentStatus() {
  const { t } = useTranslation();
  const { urgent, all } = useMyDocuments();
  const vehicles = useApp((s) => s.vehicles);
  const expiryLabel = useExpiryLabel();
  return (
    <section>
      <SectionTitle
        action={
          <Link to="/driver/documents" className="flex min-h-9 items-center text-sm font-semibold text-primary">
            {t('common.seeAll')}
          </Link>
        }
      >
        {t('driver.home.documentStatus')}
      </SectionTitle>
      {urgent.length === 0 ? (
        <Link to="/driver/documents" className="panel flex items-center gap-3 p-4 text-success">
          <CircleCheckBig className="size-6" />
          <span className="font-semibold">{t('driver.home.allDocsValid')}</span>
          <span className="ml-auto text-sm text-muted-foreground">{all.length}</span>
        </Link>
      ) : (
        <div className="space-y-2">
          {urgent.slice(0, 2).map((doc) => {
            const s = docStatus(doc);
            const style = LEVEL_STYLES[s.level];
            const owner = doc.ownerType === 'vehicle' ? vehicles.find((v) => v.id === doc.ownerId)?.reg : null;
            return (
              <Link key={doc.id} to={`/driver/documents/${doc.id}`} className={cn('flex items-center gap-3 rounded-lg border p-4', style.banner)} data-testid="home-doc-alert">
                <TriangleAlert className="size-6 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-snug">
                    {t(`enum.docType.${doc.type}`)} · {expiryLabel(doc)}
                  </p>
                  {owner && <p className="text-sm opacity-80">{owner}</p>}
                </div>
                <ChevronRight className="size-5 shrink-0 opacity-70" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
