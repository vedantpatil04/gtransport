import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, CircleDot, Fuel, Hourglass, Landmark, Navigation, ReceiptIndianRupee, TrendingDown, TrendingUp, Truck, Users, Wallet, Wrench } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Panel } from '@/features/admin/components/ui';
import { useApiResource } from '@/features/api/useApiResource';
import { num } from '@/lib/format';
import { cn } from '@/lib/utils';
import { reportsApi, type Comparison, type OverviewReport } from '../api';
import { ChartPanel, Donut, StackedTrend } from '../charts';
import { EmptyNote, Kpi, KpiGrid, rupeesShort, SummaryState, useBucketLabel, useDay } from '../components';
import { carryOver } from '../params';
import type { ReportViewProps } from '../ReportsConnected';
import { CATEGORY_COLOR, categoryLabelKey } from './ExpenseReport';

function ComparisonCard({ title, comparison }: { title: string; comparison: Comparison }) {
  const { t } = useTranslation();
  const day = useDay();
  const change = comparison.changePct === null ? null : Number(comparison.changePct);
  const Icon = change !== null && change < 0 ? TrendingDown : TrendingUp;
  return (
    <div className="rounded-lg border bg-card p-4" data-testid="comparison">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="figure text-2xl font-bold">{rupeesShort(comparison.current.amount)}</p>
        {change === null ? (
          <span className="text-xs text-muted-foreground">{t('admin.reportsApi.overview.noBase')}</span>
        ) : (
          <span className={cn('inline-flex items-center gap-1 text-sm font-semibold', change > 0 ? 'text-danger' : 'text-success')}>
            <Icon className="size-4" />
            {change > 0 ? '+' : ''}
            {comparison.changePct}%
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {day(comparison.current.from)} – {day(comparison.current.to)} · {t('admin.reportsApi.overview.vs', { amount: rupeesShort(comparison.previous.amount), from: day(comparison.previous.from), to: day(comparison.previous.to) })}
      </p>
    </div>
  );
}

function Highlight({ label, item }: { label: string; item: OverviewReport['highlights']['topExpenseVehicle'] }) {
  const [search] = useSearchParams();
  const drill = new URLSearchParams(carryOver(search, 'vehicles').slice(1));
  if (item?.id) drill.set('vehicleId', item.id);
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {item?.id && item.label ? (
        <Link to={`/admin/reports/vehicles?${drill.toString()}`} className="mt-1 flex items-center justify-between gap-2 hover:underline">
          <Plate reg={item.label} size="xs" />
          <span className="figure font-semibold">{rupeesShort(item.amount)}</span>
        </Link>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

export function OverviewReportView({ params, paramsKey }: ReportViewProps) {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const report = useApiResource(() => reportsApi.summary('overview', params), [paramsKey]);
  const bucketLabel = useBucketLabel(report.data?.range?.granularity);
  const link = (type: 'fuel' | 'expenses' | 'finance' | 'compliance' | 'location' | 'maintenance' | 'tyres' | 'vehicles' | 'drivers') => `/admin/reports/${type}${carryOver(search, type)}`;

  return (
    <SummaryState resource={report} cards={8}>
      {(r) => (
        <>
          <KpiGrid>
            <Kpi hero label={t('admin.reportsApi.overview.fuel')} value={rupeesShort(r.spend.fuel)} icon={Fuel} to={link('fuel')} testId="kpi-overview-fuel" />
            <Kpi label={t('admin.reportsApi.overview.otherExpenses')} value={rupeesShort(r.spend.otherExpenses)} sub={t('admin.reportsApi.overview.totalSpend', { amount: rupeesShort(r.spend.total) })} icon={ReceiptIndianRupee} to={link('expenses')} testId="kpi-overview-other" />
            <Kpi label={t('admin.reportsApi.overview.maintenance')} value={rupeesShort(r.spend.maintenance)} icon={Wrench} to={link('maintenance')} />
            <Kpi label={t('admin.reportsApi.overview.tyres')} value={rupeesShort(r.spend.tyre)} sub={t('admin.reportsApi.overview.tyreInsurance', { amount: rupeesShort(r.spend.tyreInsurance) })} icon={CircleDot} to={link('tyres')} />
            {r.finance && (
              <>
                <Kpi label={t('admin.reportsApi.overview.paymentsPaid')} value={rupeesShort(r.finance.paymentsPaid.amount)} sub={t('admin.reportsApi.finance.payments', { count: r.finance.paymentsPaid.count })} icon={Wallet} to={link('finance')} testId="kpi-overview-paid" />
                <Kpi label={t('admin.reportsApi.overview.pendingPayments')} value={rupeesShort(r.finance.pendingPayments.amount)} sub={t('admin.reportsApi.overview.pendingNow', { count: r.finance.pendingPayments.count })} icon={Hourglass} tone={r.finance.pendingPayments.count ? 'warning' : 'neutral'} definition={t('admin.reportsApi.definitions.pending')} testId="kpi-overview-pending" />
              </>
            )}
            {r.compliance && (
              <Kpi
                label={t('admin.reportsApi.overview.documents')}
                value={num(r.compliance.expired + r.compliance.expiring, 0)}
                sub={t('admin.reportsApi.overview.documentsSub', { expired: r.compliance.expired, expiring: r.compliance.expiring, missing: r.compliance.missing })}
                icon={CalendarClock}
                tone={r.compliance.expired ? 'danger' : r.compliance.expiring ? 'warning' : 'neutral'}
                to={link('compliance')}
                testId="kpi-overview-documents"
              />
            )}
            <Kpi label={t('admin.reportsApi.overview.activeVehicles')} value={`${num(r.fleet.activeVehicles, 0)} / ${num(r.fleet.vehicles, 0)}`} icon={Truck} to={link('vehicles')} />
            <Kpi label={t('admin.reportsApi.overview.activeDrivers')} value={num(r.fleet.activeDrivers, 0)} icon={Users} to={link('drivers')} />
            {r.finance && <Kpi label={t('admin.reportsApi.overview.emiPaid')} value={rupeesShort(r.finance.emiPaid.amount)} icon={Landmark} />}
            {r.location && <Kpi label={t('admin.reportsApi.overview.tracking')} value={`${num(r.location.active, 0)} / ${num(r.location.tracked, 0)}`} sub={t('admin.reportsApi.overview.alerts', { count: r.location.activeAlerts })} icon={Navigation} to={link('location')} />}
          </KpiGrid>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ComparisonCard title={t('admin.reportsApi.overview.monthOverMonth')} comparison={r.comparisons.monthOverMonth} />
            <ComparisonCard title={t('admin.reportsApi.overview.yearOverYear')} comparison={r.comparisons.financialYearOverYear} />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Highlight label={t('admin.reportsApi.overview.topExpenseVehicle')} item={r.highlights.topExpenseVehicle} />
            <Highlight label={t('admin.reportsApi.overview.highestFuelVehicle')} item={r.highlights.highestFuelVehicle} />
            <Highlight label={t('admin.reportsApi.overview.highestMaintenanceVehicle')} item={r.highlights.highestMaintenanceVehicle} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <ChartPanel title={t('admin.reportsApi.overview.trend')} height="h-80">
              {Number(r.spend.total) > 0 ? (
                <StackedTrend data={r.spend.trend} labelFor={bucketLabel} series={r.spend.byCategory.map((c) => ({ key: c.category, label: t(categoryLabelKey(c.category)), color: CATEGORY_COLOR[c.category] }))} />
              ) : (
                <EmptyNote>{t('admin.reportsApi.expenses.empty')}</EmptyNote>
              )}
            </ChartPanel>
            <ChartPanel title={t('admin.reportsApi.expenses.distribution')} height="h-80">
              {Number(r.spend.total) > 0 ? (
                <Donut data={r.spend.byCategory.filter((c) => Number(c.amount) > 0).map((c) => ({ key: c.category, name: t(categoryLabelKey(c.category)), value: Number(c.amount), color: CATEGORY_COLOR[c.category] }))} center={rupeesShort(r.spend.total)} centerLabel={t('admin.reportsApi.total')} />
              ) : (
                <EmptyNote>{t('admin.reportsApi.expenses.empty')}</EmptyNote>
              )}
            </ChartPanel>
          </div>

          <ChartPanel className="mt-4" title={t('admin.reportsApi.vehicles.comparison')} sub={t('admin.reportsApi.top', { count: 10 })} height="h-80">
            {r.spend.vehicleComparison.length ? (
              <StackedTrend
                data={r.spend.vehicleComparison.map((v) => ({ bucket: v.label ?? '—', ...Object.fromEntries(Object.entries(v.byCategory).map(([k, a]) => [k, Number(a)])) }))}
                labelFor={(label) => label}
                series={r.spend.byCategory.map((c) => ({ key: c.category, label: t(categoryLabelKey(c.category)), color: CATEGORY_COLOR[c.category] }))}
              />
            ) : (
              <EmptyNote>{t('admin.reportsApi.vehicles.empty')}</EmptyNote>
            )}
          </ChartPanel>
          {r.finance && (
            <Panel className="mt-4" title={t('admin.reportsApi.finance.paymentStatus')} action={<Link to={link('finance')} className="text-sm text-muted-foreground hover:text-foreground">{t('admin.reportsApi.overview.openFinance')}</Link>}>
              <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
                {(Object.keys(r.finance.paymentStatus) as (keyof typeof r.finance.paymentStatus)[]).map((g) => (
                  <div key={g} className="bg-card p-3">
                    <p className="text-xs text-muted-foreground">{t(`admin.reportsApi.paymentGroup.${g}`)}</p>
                    <p className="figure mt-1 font-semibold">{rupeesShort(r.finance!.paymentStatus[g].amount)}</p>
                    <p className="text-xs text-muted-foreground">{t('admin.reportsApi.finance.payments', { count: r.finance!.paymentStatus[g].count })}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <p className="mt-2 px-1 text-xs text-muted-foreground">{t('admin.reportsApi.definitions.operationalSpend')}</p>
        </>
      )}
    </SummaryState>
  );
}
