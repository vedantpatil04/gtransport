import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Fuel, MapPin, Phone, Plus, Route, UserX, Wallet } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Plate } from '@/components/Plate';
import { ExpiryChip, MotionDot, MotionLabel, PaymentStatusChip, VerificationChip } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { positionFor } from '@/data/geo';
import { AssignTripDialog, AssignVehicleDialog } from '@/features/drivers/DriverDialogs';
import { ExpenseSheet, EXPENSE_STATUS_TONE } from '@/features/expenses/ExpenseSheet';
import { FuelEntrySheet } from '@/features/fuel/FuelEntrySheet';
import { CreatePaymentDialog } from '@/features/payments/CreatePaymentDialog';
import { PaymentActionsMenu } from '@/features/payments/PaymentActions';
import { PaymentSheet } from '@/features/payments/PaymentSheet';
import { useNow } from '@/hooks/useNow';
import { nativeName } from '@/i18n';
import { monthKey, todayISO } from '@/lib/dates';
import { fmtDate, fmtDateTime, fmtTime, inr, num } from '@/lib/format';
import { relTime } from '@/lib/relative';
import { driverMonthTotals, paymentDate } from '@/lib/selectors';
import { cn, initials, sum } from '@/lib/utils';
import { useApp } from '@/store';
import { DetailList, PageHeader, Panel, StatCard, Table, TD, TH, TR } from '../components/ui';
import { useSyncedData } from '../useAdminData';
import { DriverMenu } from './DriversPage';

const TABS = ['overview', 'fuel', 'expenses', 'payments', 'documents', 'trips', 'location'] as const;
type Tab = (typeof TABS)[number];

export function DriverDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const driver = useApp((s) => s.drivers.find((d) => d.id === id));
  const vehicles = useApp((s) => s.vehicles);
  const documents = useApp((s) => s.documents);
  const trips = useApp((s) => s.trips);
  const { fuel, expenses, payments } = useSyncedData();
  const now = useNow(10_000);
  const [assign, setAssign] = useState(false);
  const [trip, setTrip] = useState(false);
  const [create, setCreate] = useState(false);
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'overview') as Tab;
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: k !== 'tab' });
  };

  const mine = useMemo(() => {
    if (!driver) return null;
    const vehicle = vehicles.find((v) => v.id === driver.vehicleId) ?? null;
    return {
      vehicle,
      fuel: fuel.filter((f) => f.driverId === driver.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      expenses: expenses.filter((e) => e.driverId === driver.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      payments: payments.filter((p) => p.driverId === driver.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      documents: documents.filter((d) => (d.ownerType === 'driver' && d.ownerId === driver.id) || (vehicle && d.ownerType === 'vehicle' && d.ownerId === vehicle.id)),
      trips: trips.filter((tr) => tr.driverId === driver.id).sort((a, b) => b.startedOn.localeCompare(a.startedOn)),
      month: driverMonthTotals(driver.id, monthKey(todayISO()), fuel, expenses, payments),
    };
  }, [driver, vehicles, fuel, expenses, payments, documents, trips]);

  if (!driver || !mine)
    return (
      <div>
        <PageHeader title={t('admin.drivers.title')} back={{ to: '/admin/drivers', label: t('admin.drivers.title') }} />
        <EmptyState icon={UserX} title={t('admin.drivers.notFound')} />
      </div>
    );

  const pos = positionFor(driver, now);
  const motion = mine.vehicle ? pos.motion : 'none';
  const pending = sum(mine.payments.filter((p) => p.status === 'pending' || p.status === 'processing'), (p) => p.amount);

  // Location trail: the simulation runs 40× faster, so 30 s of sim equals ~20 minutes on the road.
  const trail =
    motion === 'none'
      ? []
      : Array.from({ length: 12 }, (_, k) => {
          const at = motion === 'offline' ? new Date(pos.updatedAt!).getTime() - k * 20 * 60_000 : now - k * 20 * 60_000;
          const p = positionFor(driver, now - k * 30_000);
          return { at, city: p.near, towards: p.towards, speed: p.speedKmh, lat: p.lat, lng: p.lng };
        });

  return (
    <div>
      <PageHeader title="" back={{ to: '/admin/drivers', label: t('admin.drivers.title') }} />
      <div className="-mt-4 mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">{initials(driver.name)}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight" data-testid="driver-detail-name">
                {driver.name}
              </h1>
              <Badge tone={driver.status === 'active' ? 'success' : 'neutral'}>{t(`enum.driverStatus.${driver.status}`)}</Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              <span className="font-mono">{driver.code}</span>
              <span className="figure flex items-center gap-1">
                <Phone className="size-3.5" />
                {driver.phone}
              </span>
              <span lang={driver.language}>{nativeName(driver.language)}</span>
              {mine.vehicle ? <Plate reg={mine.vehicle.reg} size="xs" /> : <span>{t('admin.drivers.noVehicle')}</span>}
              <MotionLabel motion={motion} pulse />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setCreate(true)} data-testid="driver-create-payment">
            <Plus />
            {t('admin.payments.create')}
          </Button>
          <Button variant="outline" onClick={() => setTrip(true)}>
            <Route />
            {t('admin.drivers.assignTrip')}
          </Button>
          <DriverMenu driver={driver} onAssign={() => setAssign(true)} triggerVariant="button" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('admin.drivers.fuelMonth')} value={inr(mine.month.fuel)} icon={Fuel} sub={t('admin.dashboard.fuelUpdates', { count: mine.fuel.filter((f) => monthKey(f.date) === monthKey(todayISO())).length })} />
        <StatCard label={t('admin.drivers.expensesMonth')} value={inr(mine.month.other)} />
        <StatCard label={t('admin.drivers.receivedMonth')} value={inr(mine.month.paid)} tone="success" icon={Wallet} />
        <StatCard label={t('admin.drivers.pendingPayments')} value={inr(pending)} tone={pending ? 'warning' : 'neutral'} icon={CalendarClock} />
      </div>

      <div className="scroll-thin mt-6 flex gap-1 overflow-x-auto border-b" role="tablist">
        {TABS.map((tb) => (
          <button
            key={tb}
            role="tab"
            aria-selected={tab === tb}
            onClick={() => setParam('tab', tb === 'overview' ? '' : tb)}
            className={cn('-mb-px shrink-0 border-b-2 px-3.5 pb-2.5 pt-1 text-sm font-medium transition-colors', tab === tb ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            data-testid={`driver-tab-${tb}`}
          >
            {t(`admin.drivers.tab.${tb}`)}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'overview' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('admin.drivers.profile')} bodyClass="p-4">
              <DetailList
                rows={[
                  [t('admin.drivers.code'), <span className="font-mono">{driver.code}</span>],
                  [t('admin.drivers.phone'), <span className="figure">{driver.phone}</span>],
                  [t('admin.drivers.homeTown'), driver.homeTown],
                  [t('admin.drivers.joined'), fmtDate(driver.joinedOn, i18n.language)],
                  [t('admin.drivers.salary'), inr(driver.baseSalary)],
                  [t('admin.drivers.language'), <span lang={driver.language}>{nativeName(driver.language)}</span>],
                  [t('admin.drivers.locationSharing'), driver.locationSharing ? <Badge tone="success">{t('common.on')}</Badge> : <Badge tone="neutral">{t('common.off')}</Badge>],
                  [t('admin.common.vehicle'), mine.vehicle ? <Link to={`/admin/vehicles/${mine.vehicle.id}`}><Plate reg={mine.vehicle.reg} size="xs" /></Link> : '—'],
                ]}
              />
            </Panel>
            <div className="space-y-4">
              <Panel title={t('admin.drivers.currentLocation')} action={<Link to={`/admin/fleet?driver=${driver.id}`} className="text-sm font-semibold text-primary hover:underline">{t('admin.dashboard.openMap')}</Link>} bodyClass="p-4">
                {motion === 'none' ? (
                  <p className="text-sm text-muted-foreground">{mine.vehicle ? t('admin.fleet.sharingOff') : t('admin.drivers.noVehicle')}</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <MotionLabel motion={motion} pulse className="text-base" />
                    <p className="flex items-center gap-1.5">
                      <MapPin className="size-4 text-muted-foreground" />
                      {t('admin.fleet.near', { city: t(`city.${pos.near}`) })}
                      {motion === 'moving' && <span className="text-muted-foreground">· {t('units.kmh', { value: pos.speedKmh })}</span>}
                    </p>
                    <p className="text-muted-foreground">{t('admin.fleet.lastUpdated')}: {relTime(pos.updatedAt, i18n.language, now)}</p>
                    <p className="text-muted-foreground">{driver.sim.route.map((c) => t(`city.${c}`)).join(' – ')}</p>
                  </div>
                )}
              </Panel>
              <Panel title={t('admin.drivers.recentActivity')}>
                <ul className="divide-y text-sm">
                  {[
                    ...mine.fuel.slice(0, 4).map((f) => ({ at: f.createdAt, text: `${t('enum.category.fuel')} · ${inr(f.amount)}`, sub: f.station, onClick: () => setParam('entry', f.id) })),
                    ...mine.expenses.slice(0, 3).map((e) => ({ at: e.createdAt, text: `${t(`enum.category.${e.category}`)} · ${inr(e.amount)}`, sub: e.note, onClick: () => setParam('expense', e.id) })),
                    ...mine.payments.slice(0, 3).map((p) => ({ at: p.updatedAt, text: `${t(`enum.paymentType.${p.type}`)} · ${inr(p.amount)}`, sub: t(`enum.paymentStatus.${p.status}`), onClick: () => setParam('payment', p.id) })),
                  ]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .slice(0, 7)
                    .map((a, i) => (
                      <li key={i}>
                        <button onClick={a.onClick} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-accent/50">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{a.text}</span>
                            <span className="block truncate text-xs text-muted-foreground">{a.sub}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{relTime(a.at, i18n.language)}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </Panel>
            </div>
          </div>
        )}

        {tab === 'fuel' && (
          <Panel>
            <Table>
              <thead>
                <tr>
                  <TH>{t('admin.common.date')}</TH>
                  <TH>{t('admin.common.vehicle')}</TH>
                  <TH>{t('admin.fuel.type')}</TH>
                  <TH className="text-right">{t('admin.common.amount')}</TH>
                  <TH className="text-right">{t('admin.fuel.litres')}</TH>
                  <TH>{t('admin.fuel.station')}</TH>
                </tr>
              </thead>
              <tbody>
                {mine.fuel.map((f) => (
                  <TR key={f.id} onClick={() => setParam('entry', f.id)}>
                    <TD className="whitespace-nowrap">
                      {fmtDate(f.date, i18n.language)} <span className="text-xs text-muted-foreground">{fmtTime(f.createdAt, i18n.language)}</span>
                    </TD>
                    <TD>
                      <Plate reg={vehicles.find((v) => v.id === f.vehicleId)?.reg} size="xs" />
                    </TD>
                    <TD>
                      <Badge tone={f.fuelType === 'petrol' ? 'success' : 'info'}>{t(`enum.fuelType.${f.fuelType}`)}</Badge>
                    </TD>
                    <TD className="figure text-right font-semibold">{inr(f.amount)}</TD>
                    <TD className="figure text-right">{num(f.litres, 2)}</TD>
                    <TD className="text-muted-foreground">{f.station}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            {mine.fuel.length === 0 && <EmptyState icon={Fuel} title={t('admin.common.noResults')} />}
          </Panel>
        )}

        {tab === 'expenses' && (
          <Panel>
            <Table>
              <thead>
                <tr>
                  <TH>{t('admin.common.date')}</TH>
                  <TH>{t('admin.expenses.category')}</TH>
                  <TH className="text-right">{t('admin.common.amount')}</TH>
                  <TH>{t('common.note')}</TH>
                  <TH>{t('admin.common.status')}</TH>
                </tr>
              </thead>
              <tbody>
                {mine.expenses.map((e) => (
                  <TR key={e.id} onClick={() => setParam('expense', e.id)}>
                    <TD className="whitespace-nowrap">{fmtDate(e.date, i18n.language)}</TD>
                    <TD>{t(`enum.category.${e.category}`)}</TD>
                    <TD className="figure text-right font-semibold">{inr(e.amount)}</TD>
                    <TD className="max-w-[260px] truncate text-muted-foreground">{e.note}</TD>
                    <TD>
                      <Badge tone={EXPENSE_STATUS_TONE[e.status]}>{t(`enum.expenseStatus.${e.status}`)}</Badge>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            {mine.expenses.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.common.noResults')}</p>}
          </Panel>
        )}

        {tab === 'payments' && (
          <Panel
            title={t('admin.nav.payments')}
            action={
              <Button size="sm" onClick={() => setCreate(true)}>
                <Plus />
                {t('admin.payments.create')}
              </Button>
            }
          >
            <Table>
              <thead>
                <tr>
                  <TH>{t('admin.common.date')}</TH>
                  <TH>{t('admin.common.type')}</TH>
                  <TH className="text-right">{t('admin.common.amount')}</TH>
                  <TH>{t('admin.common.status')}</TH>
                  <TH>{t('admin.payments.reference')}</TH>
                  <TH className="w-12" />
                </tr>
              </thead>
              <tbody>
                {mine.payments.map((p) => (
                  <TR key={p.id} onClick={() => setParam('payment', p.id)} data-testid="driver-payment-admin-row">
                    <TD className="whitespace-nowrap">{fmtDate(paymentDate(p), i18n.language)}</TD>
                    <TD>{t(`enum.paymentType.${p.type}`)}</TD>
                    <TD className="figure text-right font-semibold">{inr(p.amount)}</TD>
                    <TD>
                      <PaymentStatusChip status={p.status} />
                    </TD>
                    <TD className="font-mono text-xs text-muted-foreground">{p.reference ?? '—'}</TD>
                    <TD>
                      <PaymentActionsMenu payment={p} onView={() => setParam('payment', p.id)} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}

        {tab === 'documents' && (
          <Panel>
            <ul className="divide-y">
              {mine.documents.map((d) => (
                <li key={d.id}>
                  <Link to={`/admin/documents?doc=${d.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent/50">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{d.customName || t(`enum.docTypeLong.${d.type}`)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {d.ownerType === 'vehicle' ? mine.vehicle?.reg : driver.name} · {d.number}
                      </span>
                    </span>
                    <VerificationChip value={d.verification} />
                    <ExpiryChip doc={d} long />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {tab === 'trips' && (
          <Panel
            title={t('admin.drivers.tab.trips')}
            action={
              <Button size="sm" variant="outline" onClick={() => setTrip(true)}>
                <Route />
                {t('admin.drivers.assignTrip')}
              </Button>
            }
          >
            <ul className="divide-y">
              {mine.trips.map((tr) => (
                <li key={tr.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {t(`city.${tr.from}`)} → {t(`city.${tr.to}`)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tr.goods} · {num(tr.weightT, 1)} t · {num(tr.distanceKm, 0)} km · {fmtDate(tr.startedOn, i18n.language)}
                    </span>
                  </span>
                  <Badge tone={tr.status === 'delivered' ? 'success' : tr.status === 'in_transit' ? 'info' : 'neutral'}>{t(`enum.tripStatus.${tr.status}`)}</Badge>
                </li>
              ))}
              {mine.trips.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">{t('admin.drivers.noTrips')}</li>}
            </ul>
          </Panel>
        )}

        {tab === 'location' && (
          <Panel title={t('admin.drivers.tab.location')}>
            {trail.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('admin.fleet.sharingOff')}</p>
            ) : (
              <ol className="px-4 py-3">
                {trail.map((p, i) => (
                  <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < trail.length - 1 && <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-border" />}
                    <span className="relative z-10 mt-1.5">
                      <MotionDot motion={motion} />
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium">
                        {t('admin.fleet.near', { city: t(`city.${p.city}`) })}
                        {motion === 'moving' && <span className="font-normal text-muted-foreground"> · {t('units.kmh', { value: p.speed })}</span>}
                      </p>
                      <p className="figure text-xs text-muted-foreground">
                        {fmtDateTime(new Date(p.at), i18n.language)} · {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        )}
      </div>

      {assign && <AssignVehicleDialog driver={driver} onOpenChange={(v) => !v && setAssign(false)} />}
      {trip && <AssignTripDialog driver={driver} onOpenChange={(v) => !v && setTrip(false)} />}
      <CreatePaymentDialog open={create} onOpenChange={setCreate} driverId={driver.id} onCreated={() => setParam('tab', 'payments')} />
      <FuelEntrySheet entryId={params.get('entry')} onClose={() => setParam('entry', '')} />
      <ExpenseSheet expenseId={params.get('expense')} onClose={() => setParam('expense', '')} />
      <PaymentSheet paymentId={params.get('payment')} onClose={() => setParam('payment', '')} />
    </div>
  );
}
