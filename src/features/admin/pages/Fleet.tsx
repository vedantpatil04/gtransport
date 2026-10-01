import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Gauge, MapPin, Navigation, Phone, Route, X } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { MotionDot, MotionLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FleetMap } from '@/features/map/FleetMap';
import type { MapMarker } from '@/features/map/provider';
import { useFleet, type FleetItem } from '@/features/map/useFleet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { todayISO } from '@/lib/dates';
import { inr } from '@/lib/format';
import { relTime } from '@/lib/relative';
import { driverDayTotals } from '@/lib/selectors';
import { cn, normalize } from '@/lib/utils';
import type { MotionState } from '@/types';
import { PageHeader, SearchInput } from '../components/ui';
import { useSyncedData } from '../useAdminData';
import { isApiConfigured } from '@/features/api/mode';
import { useSession } from '@/features/api/session';
import { FleetConnected } from './FleetConnected';

const FILTERS: (MotionState | 'all')[] = ['all', 'moving', 'stopped', 'offline', 'none'];

/** How far in from the map's left edge the driver card reaches (its `left-3` plus its `w-[320px]`). */
const PANEL_INSET = 332;

function FleetDemo() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { items, counts, now } = useFleet(3000);
  const [q, setQ] = useState('');
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const status = (params.get('status') as MotionState | 'all' | null) ?? 'all';
  const selectedId = params.get('driver');
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('driver', id);
    else next.delete('driver');
    setParams(next, { replace: true });
  };
  const setStatus = (s: string) => {
    const next = new URLSearchParams(params);
    if (s === 'all') next.delete('status');
    else next.set('status', s);
    setParams(next, { replace: true });
  };

  const list = useMemo(() => {
    const nq = normalize(q);
    const order: Record<MotionState, number> = { moving: 0, stopped: 1, offline: 2, none: 3 };
    return items
      .filter((i) => status === 'all' || i.pos.motion === status)
      .filter((i) => !nq || normalize(i.driver.name).includes(nq) || normalize(i.vehicle?.reg ?? '').includes(nq))
      .sort((a, b) => order[a.pos.motion] - order[b.pos.motion] || a.driver.name.localeCompare(b.driver.name));
  }, [items, status, q]);
  const selected = items.find((i) => i.driver.id === selectedId) ?? null;

  // The map takes plain coordinates and a tone; the simulation's own shapes stay in this file.
  const markers = useMemo<MapMarker[]>(
    () =>
      items.map((it) => ({
        id: it.driver.id,
        latitude: it.pos.lat,
        longitude: it.pos.lng,
        // The simulation measures heading in screen space (0° = east, clockwise); the map takes compass degrees.
        headingDeg: (it.pos.heading + 90 + 360) % 360,
        tone: it.pos.motion,
        label: it.vehicle?.reg ?? null,
      })),
    [items],
  );

  return (
    <div>
      <PageHeader title={t('admin.fleet.title')} description={t('admin.fleet.subtitle', { count: counts.moving, total: items.length })} />
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className="panel order-2 flex flex-col overflow-hidden lg:order-1 lg:h-[calc(100dvh-215px)] lg:min-h-[560px]">
          <div className="space-y-2.5 border-b p-3">
            <SearchInput value={q} onChange={setQ} placeholder={t('admin.fleet.search')} />
            <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setStatus(f)}
                  className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors', status === f ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}
                >
                  {f !== 'all' && <MotionDot motion={f} />}
                  {f === 'all' ? t('common.all') : t(`enum.motion.${f}`)}
                  <span className="figure opacity-70">{f === 'all' ? items.length : counts[f]}</span>
                </button>
              ))}
            </div>
          </div>
          <ul className="scroll-thin max-h-[420px] flex-1 divide-y overflow-y-auto lg:max-h-none" data-testid="fleet-list">
            {list.map((it) => (
              <li key={it.driver.id}>
                <button onClick={() => select(it.driver.id)} className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/60', selectedId === it.driver.id && 'bg-accent')} data-testid="fleet-row">
                  <MotionDot motion={it.pos.motion} pulse />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{it.driver.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {it.pos.motion === 'moving'
                        ? `${t('units.kmh', { value: it.pos.speedKmh })} · ${t('admin.fleet.towards', { city: t(`city.${it.pos.towards}`) })}`
                        : it.pos.motion === 'none'
                          ? it.vehicle
                            ? t('admin.fleet.sharingOff')
                            : t('admin.vehicles.noVehicle')
                          : `${t('admin.fleet.near', { city: t(`city.${it.pos.near}`) })} · ${relTime(it.pos.updatedAt, i18n.language, now)}`}
                    </span>
                  </span>
                  <Plate reg={it.vehicle?.reg} size="xs" />
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">{t('admin.common.noResults')}</li>}
          </ul>
        </section>

        <div className="relative order-1 lg:order-2">
          <FleetMap
            markers={markers}
            simulated
            selectedId={selectedId}
            onSelect={select}
            focusInsetLeft={selected && isDesktop ? PANEL_INSET : 0}
            className="h-[58vh] min-h-[380px] rounded-lg border lg:h-[calc(100dvh-215px)] lg:min-h-[560px]"
          />
          {selected && isDesktop && (
            <div className="absolute left-3 top-3 w-[320px] animate-in fade-in slide-in-from-left-2 duration-200">
              <DriverLocationCard item={selected} now={now} onClose={() => select(null)} />
            </div>
          )}
        </div>
      </div>
      {!isDesktop && (
        <Sheet open={!!selected} onOpenChange={(v) => !v && select(null)}>
          <SheetContent side="bottom" hideClose>
            <SheetTitle className="sr-only">{selected?.driver.name}</SheetTitle>
            {selected && (
              <div className="p-3">
                <DriverLocationCard item={selected} now={now} onClose={() => select(null)} flat />
              </div>
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function DriverLocationCard({ item, now, onClose, flat }: { item: FleetItem; now: number; onClose: () => void; flat?: boolean }) {
  const { t, i18n } = useTranslation();
  const { fuel, expenses, payments } = useSyncedData();
  const { driver, vehicle, pos } = item;
  const today = driverDayTotals(driver.id, todayISO(), fuel, expenses, payments);
  const route = driver.sim.route;
  return (
    <div className={cn('rounded-xl bg-card', !flat && 'border shadow-xl')} data-testid="fleet-detail">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{driver.name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Plate reg={vehicle?.reg} size="sm" />
            <MotionLabel motion={pos.motion} pulse />
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent" aria-label={t('common.close')}>
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-px border-y bg-border text-sm">
        <div className="bg-card px-4 py-2.5">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Gauge className="size-3.5" />
            {t('admin.fleet.speed')}
          </p>
          <p className="figure mt-0.5 text-lg font-bold">{t('units.kmh', { value: pos.speedKmh })}</p>
        </div>
        <div className="bg-card px-4 py-2.5">
          <p className="text-xs text-muted-foreground">{t('admin.fleet.lastUpdated')}</p>
          <p className="mt-0.5 text-lg font-bold">{pos.updatedAt ? relTime(pos.updatedAt, i18n.language, now) : '—'}</p>
        </div>
        <div className="col-span-2 space-y-1.5 bg-card px-4 py-2.5">
          <p className="flex items-center gap-1.5">
            <MapPin className="size-4 text-muted-foreground" />
            {t('admin.fleet.near', { city: t(`city.${pos.near}`) })}
            {pos.motion === 'moving' && (
              <span className="text-muted-foreground">
                · <Navigation className="inline size-3.5" /> {t(`city.${pos.towards}`)}
              </span>
            )}
          </p>
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Route className="size-4" />
            {route.map((c) => t(`city.${c}`)).join(' – ')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x px-1 py-3 text-center">
        <div>
          <p className="text-[11px] text-muted-foreground">{t('admin.fleet.todayFuel')}</p>
          <p className="figure font-bold">{inr(today.fuel)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">{t('admin.fleet.todayExpenses')}</p>
          <p className="figure font-bold">{inr(today.other)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">{t('admin.fleet.todayPaid')}</p>
          <p className="figure font-bold text-success">{inr(today.received)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t p-3">
        <Button asChild className="flex-1 min-w-[120px]" data-testid="fleet-view-driver">
          <Link to={`/admin/drivers/${driver.id}`}>{t('admin.fleet.viewDriver')}</Link>
        </Button>
        <Button asChild variant="outline" data-testid="fleet-open-google-maps">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${pos.lat},${pos.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5"
          >
            <ExternalLink className="size-4" />
            <span>{t('admin.fleet.openGoogleMaps')}</span>
          </a>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label={t('admin.drivers.call')}>
          <a href="tel:+919800000000">
            <Phone className="size-4" />
          </a>
        </Button>
      </div>
    </div>
  );
}

/** Real mode shows the live fleet; without an API or valid session the approved prototype runs on its simulation. */
export function Fleet() {
  const token = useSession((s) => s.token);
  return isApiConfigured() && token ? <FleetConnected /> : <FleetDemo />;
}
