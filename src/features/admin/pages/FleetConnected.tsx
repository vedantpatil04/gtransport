import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BatteryLow, ExternalLink, Gauge, MapPin, Navigation, Phone, RefreshCw, TriangleAlert, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { MotionDot } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FleetMap } from '@/features/map/FleetMap';
import type { MapMarker, MarkerTone } from '@/features/map/provider';
import { fleetApi } from '@/features/api/resources';
import { canManageFleet, useSession } from '@/features/api/session';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import type { ApiFleetLocation, ApiLocationPing } from '@/features/api/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { nearestCity } from '@/data/geo';
import { relTime } from '@/lib/relative';
import { cn } from '@/lib/utils';
import { ErrorState } from '../components/states';
import { PageHeader, SearchInput } from '../components/ui';

/**
 * Live Fleet, on real data.
 *
 * What it answers, in the order the office asks: where is everyone, who has stopped for too long,
 * and whose phone has stopped telling us anything. A driver whose tracking is broken is as
 * important as one on the road, so they stay in the list — with the reason — rather than quietly
 * vanishing because there is no pin to draw.
 *
 * Every number here comes from the API. The polling interval comes from the API too, so it can be
 * tuned per deployment without a new bundle, and one request serves every marker.
 */

type FleetFilter = 'all' | 'active' | 'stale' | 'offline' | 'unavailable' | 'alerting';

const FILTERS: FleetFilter[] = ['all', 'active', 'stale', 'offline', 'unavailable', 'alerting'];

/** How far in from the map's left edge the driver panel reaches (its `left-3` plus its `w-[340px]`). */
const PANEL_INSET = 352;

/**
 * How a driver's state colours their marker and dot.
 *
 * Reuses the prototype's existing four-tone vocabulary so the map, the legend and the status dots
 * keep saying the same thing: green is reporting, amber is stopped or falling behind, red is not
 * reporting, grey is nothing to plot.
 */
function toneFor(row: ApiFleetLocation): MarkerTone {
  if (!row.position) return 'none';
  if (row.status === 'OFFLINE' || row.status === 'PERMISSION_DENIED' || row.status === 'LOCATION_DISABLED') return 'offline';
  if (row.status === 'STALE' || row.stale) return 'stopped';
  // Reporting and moving. A parked-but-reporting vehicle is amber, which is also what makes a
  // four-hour stop visible at a glance before the alert even fires.
  return (row.position.speedKmh ?? 0) > 3 ? 'moving' : 'stopped';
}

function matchesFilter(row: ApiFleetLocation, filter: FleetFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return row.status === 'ACTIVE';
    case 'stale':
      return row.status === 'STALE';
    case 'offline':
      return row.status === 'OFFLINE';
    case 'unavailable':
      return row.status === 'PERMISSION_DENIED' || row.status === 'LOCATION_DISABLED';
    case 'alerting':
      return row.alert?.status === 'ACTIVE';
    default:
      return true;
  }
}

/** Sort order: whoever needs attention first, then the most recently heard from. */
const urgency = (row: ApiFleetLocation): number => {
  if (row.alert?.status === 'ACTIVE') return 0;
  if (row.status === 'PERMISSION_DENIED' || row.status === 'LOCATION_DISABLED') return 1;
  if (row.status === 'OFFLINE') return 2;
  if (row.status === 'STALE') return 3;
  return 4;
};

export function FleetConnected() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const role = useSession((s) => s.user?.role);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const [query, setQuery] = useState('');
  const search = useDebounced(query, 300);
  const filter = (params.get('status') as FleetFilter | null) ?? 'all';
  const selectedId = params.get('driver');

  // Ticks the clock so "4 minutes ago" stays honest between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const fleet = useApiResource(() => fleetApi.locations(search ? { q: search } : {}), [search]);

  /**
   * Polling, at the interval the server asks for.
   *
   * HTTP polling rather than a socket: one lightweight request per interval is enough for a fleet
   * this size, it survives the flaky connections an office actually has, and it needs no new
   * infrastructure. The interval is served, so raising it later costs a configuration change.
   */
  const refreshSeconds = fleet.data?.refreshSeconds ?? 30;
  const reload = fleet.reload;
  const paused = useRef(false);
  useEffect(() => {
    // A background tab polls nobody: the office often leaves this open all day.
    const onVisibility = () => {
      paused.current = document.hidden;
      if (!document.hidden) reload();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (!paused.current) reload();
    }, Math.max(5, refreshSeconds) * 1_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [refreshSeconds, reload]);

  const rows = fleet.data?.data ?? [];
  const summary = fleet.data?.summary;

  const list = useMemo(
    () =>
      rows
        .filter((row) => matchesFilter(row, filter))
        .sort((a, b) => urgency(a) - urgency(b) || a.employee.fullName.localeCompare(b.employee.fullName)),
    [rows, filter],
  );

  const markers = useMemo<MapMarker[]>(
    () =>
      rows.map((row) => ({
        id: row.driverId,
        latitude: row.position?.latitude ?? 0,
        longitude: row.position?.longitude ?? 0,
        headingDeg: row.position?.headingDeg ?? null,
        tone: toneFor(row),
        label: row.vehicle?.registrationNumber ?? null,
        flagged: row.alert?.status === 'ACTIVE',
      })),
    [rows],
  );

  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params);
      if (id) next.set('driver', id);
      else next.delete('driver');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const setFilter = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('status');
    else next.set('status', value);
    setParams(next, { replace: true });
  };

  const selected = rows.find((row) => row.driverId === selectedId) ?? null;

  const counts: Record<FleetFilter, number> = {
    all: summary?.total ?? rows.length,
    active: summary?.active ?? 0,
    stale: summary?.stale ?? 0,
    offline: summary?.offline ?? 0,
    unavailable: summary?.unavailable ?? 0,
    alerting: summary?.alerting ?? 0,
  };

  if (fleet.error && !fleet.data) {
    return (
      <div>
        <PageHeader title={t('admin.nav.fleet')} />
        <section className="panel">
          <ErrorState error={fleet.error} onRetry={fleet.reload} />
        </section>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('admin.nav.fleet')}
        description={
          summary
            ? t('admin.fleet.liveSubtitle', { active: summary.active, total: summary.total })
            : fleet.loading
              ? t('admin.api.loading')
              : undefined
        }
        actions={
          <Button variant="outline" size="sm" onClick={fleet.reload} disabled={fleet.refreshing} data-testid="fleet-refresh">
            <RefreshCw className={cn('size-4', fleet.refreshing && 'animate-spin')} />
            {t('admin.fleet.refresh')}
          </Button>
        }
      />

      {counts.alerting > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm" data-testid="fleet-alert-banner">
          <TriangleAlert className="size-4 shrink-0 text-danger" />
          <span className="font-medium">{t('admin.fleet.alertBanner', { count: counts.alerting })}</span>
          {filter !== 'alerting' && (
            <button className="ml-auto shrink-0 font-semibold underline" onClick={() => setFilter('alerting')}>
              {t('admin.fleet.showAlerting')}
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className="panel order-2 flex flex-col overflow-hidden lg:order-1 lg:h-[calc(100dvh-215px)] lg:min-h-[560px]">
          <div className="space-y-2.5 border-b p-3">
            <SearchInput value={query} onChange={setQuery} placeholder={t('admin.fleet.search')} />
            <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              {FILTERS.map((option) => (
                <button
                  key={option}
                  onClick={() => setFilter(option)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                    filter === option ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                  )}
                >
                  {option === 'alerting' && <TriangleAlert className="size-3" />}
                  {t(`admin.fleet.filter.${option}`)}
                  <span className="figure opacity-70">{counts[option]}</span>
                </button>
              ))}
            </div>
          </div>

          <ul className="scroll-thin max-h-[420px] flex-1 divide-y overflow-y-auto lg:max-h-none" data-testid="fleet-list">
            {list.map((row) => (
              <li key={row.driverId}>
                <button
                  onClick={() => select(row.driverId)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/60',
                    selectedId === row.driverId && 'bg-accent',
                  )}
                  data-testid="fleet-row"
                >
                  <MotionDot motion={toneFor(row)} pulse={toneFor(row) === 'moving'} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{row.employee.fullName}</span>
                      {row.alert?.status === 'ACTIVE' && <TriangleAlert className="size-3.5 shrink-0 text-danger" />}
                      {row.pendingUploads > 0 && <UploadCloud className="size-3.5 shrink-0 text-warning" />}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{summaryLine(row, t, i18n.language, now)}</span>
                  </span>
                  <Plate reg={row.vehicle?.registrationNumber} size="xs" />
                </button>
              </li>
            ))}
            {!list.length && (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground" data-testid="fleet-empty-state">
                {fleet.loading
                  ? t('admin.api.loading')
                  : !rows.length
                    ? t('admin.fleet.noLiveLocation')
                    : t('admin.common.noResults')}
              </li>
            )}
          </ul>
        </section>

        <div className="relative order-1 lg:order-2">
          {/* The map is a convenience, not the record. If it cannot draw it says so, and the list
              beside it still answers every question. */}
          <FleetMap
            markers={markers}
            selectedId={selectedId}
            onSelect={select}
            loading={fleet.loading}
            focusInsetLeft={selected && isDesktop ? PANEL_INSET : 0}
            className="h-[58vh] min-h-[380px] rounded-lg border lg:h-[calc(100dvh-215px)] lg:min-h-[560px]"
          />
          {selected && isDesktop && (
            <div className="absolute left-3 top-3 w-[340px] animate-in fade-in slide-in-from-left-2 duration-200">
              <DriverLocationPanel row={selected} now={now} canManage={canManageFleet(role)} onClose={() => select(null)} onChanged={fleet.reload} />
            </div>
          )}
        </div>
      </div>

      {!isDesktop && (
        <Sheet open={!!selected} onOpenChange={(open) => !open && select(null)}>
          <SheetContent side="bottom" hideClose>
            <SheetTitle className="sr-only">{selected?.employee.fullName}</SheetTitle>
            {selected && (
              <div className="p-3">
                <DriverLocationPanel row={selected} now={now} canManage={canManageFleet(role)} onClose={() => select(null)} onChanged={fleet.reload} flat />
              </div>
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** One line under each name: the most useful thing about this driver right now. */
function summaryLine(row: ApiFleetLocation, t: (key: string, options?: Record<string, unknown>) => string, language: string, now: number): string {
  if (row.alert?.status === 'ACTIVE') return t('admin.fleet.stoppedFor', { duration: hoursAndMinutes(row.alert.durationMinutes, t) });
  if (row.status === 'PERMISSION_DENIED') return t('admin.fleet.state.permissionDenied');
  if (row.status === 'LOCATION_DISABLED') return t('admin.fleet.state.servicesOff');
  if (!row.position) return t('admin.fleet.state.noPosition');
  if (row.status === 'OFFLINE') return t('admin.fleet.lastSeen', { when: relTime(row.lastSeenAt, language, now) });
  if (row.pendingUploads > 0) return t('admin.fleet.state.syncPending', { count: row.pendingUploads });

  const near = t(`city.${nearestCity(row.position.latitude, row.position.longitude)}`);

  // A stale fix is a last known position, not a current one. Reporting the speed from it would
  // read as "doing 70 right now" when the truth is that nothing has been heard for a while — so a
  // stale driver always gets the place and the age of the reading instead.
  const current = !row.stale && row.status !== 'STALE';
  if (current && (row.position.speedKmh ?? 0) > 3) {
    return `${t('units.kmh', { value: Math.round(row.position.speedKmh ?? 0) })} · ${t('admin.fleet.near', { city: near })}`;
  }
  return `${t('admin.fleet.near', { city: near })} · ${relTime(row.capturedAt, language, now)}`;
}

function hoursAndMinutes(minutes: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return t('admin.fleet.minutes', { count: rest });
  if (!rest) return t('admin.fleet.hours', { count: hours });
  return `${t('admin.fleet.hours', { count: hours })} ${t('admin.fleet.minutes', { count: rest })}`;
}

/**
 * The driver detail panel, on live API data.
 *
 * Shows what the office needs in order to act: who, which vehicle, where, how fresh that is, and
 * whether the phone is able to report at all. Acknowledging is offered only to the roles the API
 * permits — and the API decides either way, so a hidden button is a courtesy, not the control.
 */
function DriverLocationPanel({
  row,
  now,
  canManage,
  onClose,
  onChanged,
  flat,
}: {
  row: ApiFleetLocation;
  now: number;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  flat?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [working, setWorking] = useState(false);

  const history = useApiResource(() => fleetApi.driverHistory(row.driverId, { limit: 5 }), [row.driverId]);

  const acknowledge = async () => {
    if (!row.alert || working) return;
    setWorking(true);
    try {
      await fleetApi.acknowledgeAlert(row.alert.id);
      toast.success(t('admin.fleet.acknowledged'));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('admin.api.errorTitle'));
    } finally {
      setWorking(false);
    }
  };

  const tone = toneFor(row);

  return (
    <div className={cn('rounded-xl bg-card', !flat && 'border shadow-xl')} data-testid="fleet-detail">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{row.employee.fullName}</p>
          <p className="text-xs text-muted-foreground">
            {row.employee.employeeCode} · {row.driverCode}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Plate reg={row.vehicle?.registrationNumber} size="sm" />
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <MotionDot motion={tone} pulse={tone === 'moving'} />
              {t(`admin.fleet.status.${row.status}`)}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent" aria-label={t('common.close')}>
          <X className="size-4" />
        </button>
      </div>

      {row.alert?.status === 'ACTIVE' && (
        <div className="mx-4 mb-3 rounded-lg border border-danger/30 bg-danger-soft p-3" data-testid="fleet-detail-alert">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
            <TriangleAlert className="size-4" />
            {t('admin.fleet.stationaryAlert')}
          </p>
          <p className="mt-1 text-xs">
            {t('admin.fleet.stationarySince', {
              duration: hoursAndMinutes(row.alert.durationMinutes, t),
              when: relTime(row.alert.stationarySince, i18n.language, now),
            })}
          </p>
          {canManage && (
            <Button size="sm" variant="outline" className="mt-2 w-full" onClick={acknowledge} disabled={working} data-testid="fleet-acknowledge">
              {t('admin.fleet.acknowledge')}
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border-y bg-border text-sm">
        <div className="bg-card px-4 py-2.5">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Gauge className="size-3.5" />
            {t('admin.fleet.speed')}
          </p>
          <p className="figure mt-0.5 text-lg font-bold">
            {/* Withheld for a stale fix: an old speed reading is not the vehicle's speed now. */}
            {row.position === null || row.position.speedKmh === null || row.stale
              ? '—'
              : t('units.kmh', { value: Math.round(row.position.speedKmh) })}
          </p>
        </div>
        <div className="bg-card px-4 py-2.5">
          <p className="text-xs text-muted-foreground">{t('admin.fleet.lastUpdated')}</p>
          <p className="mt-0.5 text-lg font-bold">{row.capturedAt ? relTime(row.capturedAt, i18n.language, now) : '—'}</p>
        </div>

        {row.position ? (
          <div className="col-span-2 space-y-1.5 bg-card px-4 py-2.5">
            <p className="flex items-center gap-1.5">
              <MapPin className="size-4 text-muted-foreground" />
              {t('admin.fleet.near', { city: t(`city.${nearestCity(row.position.latitude, row.position.longitude)}`) })}
              {row.position.headingDeg !== null && (row.position.speedKmh ?? 0) > 3 && (
                <span className="text-muted-foreground">
                  · <Navigation className="inline size-3.5" /> {Math.round(row.position.headingDeg)}°
                </span>
              )}
            </p>
            <p className="figure text-xs text-muted-foreground">
              {row.position.latitude.toFixed(5)}, {row.position.longitude.toFixed(5)}
              {row.position.accuracyMeters !== null && ` · ${t('admin.fleet.accuracy', { metres: Math.round(row.position.accuracyMeters) })}`}
            </p>
          </div>
        ) : (
          <div className="col-span-2 bg-card px-4 py-2.5 text-sm text-muted-foreground">{t('admin.fleet.state.noPosition')}</div>
        )}

        <div className="col-span-2 space-y-1 bg-card px-4 py-2.5 text-xs">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={row.trackingState === 'TRACKING_ACTIVE' ? 'success' : row.trackingState === 'SYNC_PENDING' ? 'warning' : 'danger'}>
              {t(`admin.fleet.tracking.${row.trackingState}`)}
            </Badge>
            {row.pendingUploads > 0 && (
              <span className="inline-flex items-center gap-1 text-warning">
                <UploadCloud className="size-3.5" />
                {t('admin.fleet.state.syncPending', { count: row.pendingUploads })}
              </span>
            )}
            {row.batteryPct !== null && row.batteryPct <= 20 && (
              <span className="inline-flex items-center gap-1 text-danger">
                <BatteryLow className="size-3.5" />
                {row.batteryPct}%
              </span>
            )}
          </p>
          <p className="text-muted-foreground">{t('admin.fleet.lastSeen', { when: relTime(row.lastSeenAt, i18n.language, now) })}</p>
          {row.stationarySince && !row.alert && (
            <p className="text-muted-foreground">
              {t('admin.fleet.stoppedFor', { duration: hoursAndMinutes(row.stationaryMinutes ?? 0, t) })}
            </p>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.fleet.recentFixes')}</p>
        {history.loading ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{t('admin.api.loading')}</p>
        ) : history.data?.data.length ? (
          <ul className="mt-1.5 space-y-1 text-xs" data-testid="fleet-history">
            {history.data.data.map((ping: ApiLocationPing) => (
              <li key={ping.id} className="flex items-center justify-between gap-2">
                <span className="figure truncate text-muted-foreground">
                  {ping.latitude.toFixed(4)}, {ping.longitude.toFixed(4)}
                </span>
                <span className="shrink-0 text-muted-foreground">{relTime(ping.capturedAt, i18n.language, now)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">{t('admin.fleet.noFixes')}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t p-3">
        <Button asChild className="flex-1 min-w-[120px]" data-testid="fleet-view-driver">
          <Link to={`/admin/drivers/${row.driverId}`}>{t('admin.fleet.viewDriver')}</Link>
        </Button>
        {row.position && (
          <Button asChild variant="outline" data-testid="fleet-open-google-maps">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${row.position.latitude},${row.position.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5"
            >
              <ExternalLink className="size-4" />
              <span>{t('admin.fleet.openGoogleMaps')}</span>
            </a>
          </Button>
        )}
        {row.employee.phone && (
          <Button asChild variant="outline" size="icon" aria-label={t('admin.drivers.call')}>
            <a href={`tel:${row.employee.phone}`}>
              <Phone className="size-4" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
