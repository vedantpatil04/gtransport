import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, CircleX, Fuel, Navigation, ReceiptIndianRupee, ShieldAlert, Siren, Truck, Users, Wallet, WifiOff, Hourglass, TriangleAlert } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { MotionDot } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { docOwnerLabel, docStatus } from '@/features/documents/expiry';
import { useFleet } from '@/features/map/useFleet';
import { addDays, todayISO } from '@/lib/dates';
import { fmtDate, fmtDayMonth, inr, inrCompact, num } from '@/lib/format';
import { relTime } from '@/lib/relative';
import { sum, cn } from '@/lib/utils';
import { useApp } from '@/store';
import { DriverCell, PageHeader, Panel, StatCard } from '../components/ui';
import { useSyncedData, useTodayOverview } from '../useAdminData';
import { isApiConfigured } from '@/features/api/mode';
import { DashboardConnected } from './DashboardConnected';

function DashboardDemo() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const drivers = useApp((s) => s.drivers);
  const vehicles = useApp((s) => s.vehicles);
  const documents = useApp((s) => s.documents);
  const { fuel, payments } = useSyncedData();
  const overview = useTodayOverview();
  const { counts, items: fleet } = useFleet(5000);

  const expiredDocs = documents.filter((d) => docStatus(d).state === 'expired');
  const soonDocs = documents.filter((d) => docStatus(d).state === 'expiring' && (docStatus(d).days ?? 99) <= 7);
  const failed = payments.filter((p) => p.status === 'failed');
  const offline = fleet.filter((f) => f.pos.motion === 'offline');
  const alertCount = expiredDocs.length + failed.length + offline.length;

  const recent = useMemo(() => [...fuel].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8), [fuel]);
  const trend = useMemo(() => {
    const today = todayISO();
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i - 13);
      return { d, label: fmtDayMonth(d, i18n.language), fuel: sum(fuel.filter((f) => f.date === d), (f) => f.amount) };
    });
  }, [fuel, i18n.language]);

  const activeVehicles = vehicles.filter((v) => v.status === 'active').length;
  const workshop = vehicles.filter((v) => v.status === 'maintenance').length;
  const activeDrivers = drivers.filter((d) => d.status === 'active').length;
  const driverName = (id: string) => drivers.find((d) => d.id === id);
  const reg = (id: string) => vehicles.find((v) => v.id === id)?.reg;

  return (
    <div>
      <PageHeader title={t('admin.dashboard.title')} description={`${fmtDate(new Date(), i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${t('admin.dashboard.office')}`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('admin.dashboard.vehicles')} value={vehicles.length} icon={Truck} to="/admin/vehicles" sub={t('admin.dashboard.vehiclesSub', { active: activeVehicles, workshop })} testId="stat-vehicles" />
        <StatCard label={t('admin.dashboard.drivers')} value={drivers.length} icon={Users} to="/admin/drivers" sub={t('admin.dashboard.driversSub', { count: activeDrivers })} />
        <StatCard label={t('admin.dashboard.moving')} value={counts.moving} icon={Navigation} tone="success" to="/admin/fleet" sub={t('admin.dashboard.movingSub', { stopped: counts.stopped, offline: counts.offline })} />
        <StatCard label={t('admin.dashboard.alerts')} value={alertCount} icon={Siren} tone={alertCount ? 'danger' : 'neutral'} to="/admin/documents" sub={t('admin.dashboard.alertsSub', { docs: expiredDocs.length, payments: failed.length, offline: offline.length })} />
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold">{t('admin.dashboard.todayOverview')}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <StatCard
          hero
          label={t('admin.dashboard.fuelToday')}
          value={inr(overview.fuel)}
          icon={Fuel}
          to="/admin/fuel"
          testId="dash-fuel-today"
          sub={
            <span className="flex flex-wrap gap-x-3">
              <span className="font-semibold text-white">{t('admin.dashboard.fuelUpdates', { count: overview.fuelCount })}</span>
              <span>{t('units.litres', { value: num(overview.fuelLitres, 0) })}</span>
            </span>
          }
        />
        <StatCard label={t('admin.dashboard.otherToday')} value={inr(overview.other)} icon={ReceiptIndianRupee} to="/admin/finance/expenses" sub={t('admin.dashboard.entries', { count: overview.otherCount })} />
        <StatCard label={t('admin.dashboard.paymentsToday')} value={inr(overview.paid)} icon={Wallet} tone="success" to="/admin/finance/payments" sub={t('admin.dashboard.paidCount', { count: overview.paidCount })} />
        <StatCard label={t('admin.dashboard.pending')} value={inr(overview.pending)} icon={Hourglass} tone="warning" to="/admin/finance/payments?status=pending" sub={t('admin.dashboard.pendingSub', { count: overview.pendingCount })} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Panel
          title={t('admin.dashboard.recentFuel')}
          action={
            <Link to="/admin/fuel" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              {t('admin.top.viewAll')}
              <ArrowUpRight className="size-4" />
            </Link>
          }
        >
          <ul className="divide-y" data-testid="recent-fuel">
            {recent.map((f) => (
              <li key={f.id}>
                <button onClick={() => navigate(`/admin/fuel?entry=${f.id}`)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 sm:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)_auto]">
                  <DriverCell driver={driverName(f.driverId)} sub={f.station} link={false} />
                  <span className="hidden sm:block">
                    <Plate reg={reg(f.vehicleId)} size="xs" />
                  </span>
                  <span className="hidden text-sm sm:block">
                    <Badge tone={f.fuelType === 'petrol' ? 'success' : 'info'}>{t(`enum.fuelType.${f.fuelType}`)}</Badge>
                    <span className="figure ml-2 text-muted-foreground">{t('units.litresShort', { value: num(f.litres) })}</span>
                  </span>
                  <span className="text-right">
                    <span className="figure block font-semibold">{inr(f.amount)}</span>
                    <span className="block text-xs text-muted-foreground">{relTime(f.createdAt, i18n.language)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel title={t('admin.dashboard.attention')}>
            <ul className="divide-y text-sm">
              {expiredDocs.map((d) => (
                <AttentionRow key={d.id} icon={ShieldAlert} tone="danger" to={`/admin/documents?doc=${d.id}`} title={t('expiry.docExpired', { doc: t(`enum.docType.${d.type}`) })} sub={docOwnerLabel(d, vehicles, drivers)} />
              ))}
              {soonDocs.map((d) => (
                <AttentionRow key={d.id} icon={TriangleAlert} tone="warning" to={`/admin/documents?doc=${d.id}`} title={t('expiry.docInDays', { doc: t(`enum.docType.${d.type}`), count: docStatus(d).days ?? 0 })} sub={docOwnerLabel(d, vehicles, drivers)} />
              ))}
              {failed.map((p) => (
                <AttentionRow key={p.id} icon={CircleX} tone="danger" to={`/admin/finance/payments?payment=${p.id}`} title={t('admin.dashboard.paymentFailed', { amount: inr(p.amount) })} sub={`${driverName(p.driverId)?.name ?? ''} · ${t(`enum.paymentType.${p.type}`)}`} />
              ))}
              {offline.map((f) => (
                <AttentionRow key={f.driver.id} icon={WifiOff} tone="danger" to={`/admin/fleet?driver=${f.driver.id}`} title={t('admin.dashboard.driverOffline', { name: f.driver.name })} sub={`${f.vehicle?.reg ?? ''} · ${relTime(f.pos.updatedAt, i18n.language)}`} />
              ))}
            </ul>
          </Panel>
          <Panel title={t('admin.dashboard.fuelTrend')}>
            <div className="h-44 px-2 pb-2 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval={2} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tickFormatter={inrCompact} tickLine={false} axisLine={false} fontSize={11} width={48} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [inr(v), t('enum.category.fuel')]} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="fuel" radius={[3, 3, 0, 0]} fill="hsl(var(--chart-1))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title={t('admin.nav.fleet')} action={<Link to="/admin/fleet" className="text-sm font-semibold text-primary hover:underline">{t('admin.dashboard.openMap')}</Link>}>
            <div className="grid grid-cols-4 divide-x text-center">
              {(['moving', 'stopped', 'offline', 'none'] as const).map((m) => (
                <Link key={m} to={`/admin/fleet?status=${m}`} className="px-2 py-3 hover:bg-accent/50">
                  <span className="figure block text-xl font-bold">{counts[m]}</span>
                  <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MotionDot motion={m} />
                    {t(`enum.motion.${m}`)}
                  </span>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function AttentionRow({ icon: Icon, tone, title, sub, to }: { icon: typeof Fuel; tone: 'danger' | 'warning'; title: string; sub: string; to: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{sub}</span>
        </span>
      </Link>
    </li>
  );
}

/** Live figures in real mode; the approved prototype on demo data otherwise. */
export function Dashboard() {
  return isApiConfigured() ? <DashboardConnected /> : <DashboardDemo />;
}
