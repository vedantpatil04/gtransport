import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FileUp, Fuel, Users, Wrench } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { useApiResource } from '@/features/api/useApiResource';
import { fmtDateTime, num } from '@/lib/format';
import { reportsApi, type DriverActivityRow } from '../api';
import { C, ChartPanel, HBar } from '../charts';
import { EmptyNote, Kpi, KpiGrid, RecordsTable, rupees, rupeesShort, SummaryState, type RecordColumn } from '../components';
import type { ReportViewProps } from '../ReportsConnected';

const LOCATION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { ACTIVE: 'success', STALE: 'warning', OFFLINE: 'danger' };

export function DriverReportView({ params, paramsKey, setFilter }: ReportViewProps) {
  const { t, i18n } = useTranslation();
  const report = useApiResource(() => reportsApi.summary('drivers', params), [paramsKey]);
  const visibility = report.data?.visibility;

  const columns: RecordColumn<DriverActivityRow>[] = [
    {
      key: 'name', header: t('admin.common.driver'), sort: 'name',
      render: (r) => (
        <Link to={`/admin/drivers/${r.id}`} onClick={(e) => e.stopPropagation()} className="flex flex-col hover:underline">
          <span className="font-medium">{r.name}</span>
          <span className="text-xs text-muted-foreground">{r.code} · {t(`admin.enum.driverStatus.${r.status}`)}</span>
        </Link>
      ),
    },
    { key: 'vehicle', header: t('admin.common.vehicle'), render: (r) => (r.vehicle ? <Plate reg={r.vehicle.registrationNumber} size="xs" /> : <span className="text-muted-foreground">{t('admin.reportsApi.unassigned')}</span>) },
    { key: 'fuelEntries', header: t('admin.reportsApi.drivers.fuelSubmitted'), sort: 'fuelEntries', numeric: true, render: (r) => num(r.fuel.entries, 0) },
    { key: 'fuel', header: t('admin.reportsApi.drivers.fuelSpend'), sort: 'fuel', numeric: true, className: 'font-semibold', render: (r) => rupees(r.fuel.amount) },
    { key: 'expenses', header: t('admin.reportsApi.drivers.otherExpenses'), sort: 'expenses', numeric: true, render: (r) => <span title={t('admin.reportsApi.records', { count: r.expenses.entries })}>{rupees(r.expenses.amount)}</span> },
    { key: 'services', header: t('admin.reportsApi.drivers.services'), sort: 'services', numeric: true, render: (r) => num(r.services, 0) },
    { key: 'uploads', header: t('admin.reportsApi.drivers.uploads'), sort: 'uploads', numeric: true, render: (r) => num(r.documentUploads, 0) },
    ...(visibility?.payments
      ? [{
          key: 'payments', header: t('admin.reportsApi.drivers.payments'), numeric: true,
          render: (r: DriverActivityRow) =>
            r.payments ? (
              <span className="flex flex-col items-end gap-0.5">
                <span>{t('admin.reportsApi.drivers.paid', { amount: rupeesShort(r.payments.paid) })}</span>
                {r.payments.openCount > 0 && <span className="text-xs text-muted-foreground">{t('admin.reportsApi.drivers.open', { amount: rupeesShort(r.payments.open), count: r.payments.openCount })}</span>}
                {r.payments.failedCount > 0 && <Badge tone="danger">{t('admin.reportsApi.drivers.failed', { count: r.payments.failedCount })}</Badge>}
              </span>
            ) : '—',
        }]
      : []),
    ...(visibility?.location
      ? [{
          key: 'location', header: t('admin.reportsApi.drivers.location'),
          render: (r: DriverActivityRow) =>
            r.location?.status ? (
              <span className="flex flex-col gap-0.5">
                <Badge tone={LOCATION_TONE[r.location.status] ?? 'neutral'}>{t(`admin.fleet.status.${r.location.status}`)}</Badge>
                {r.location.lastSeenAt && <span className="text-xs text-muted-foreground">{fmtDateTime(r.location.lastSeenAt, i18n.language)}</span>}
                {r.location.stationaryAlerts > 0 && <span className="text-xs text-muted-foreground">{t('admin.reportsApi.drivers.stops', { count: r.location.stationaryAlerts })}</span>}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t('admin.reportsApi.drivers.neverReported')}</span>
            ),
        }]
      : []),
  ];

  return (
    <>
      <SummaryState resource={report}>
        {(r) => (
          <>
            <KpiGrid>
              <Kpi hero label={t('admin.reportsApi.drivers.fuelSpend')} value={rupeesShort(r.totals.fuel)} sub={t('admin.reportsApi.entries', { count: r.totals.fuelEntries })} icon={Fuel} testId="kpi-driver-fuel" />
              <Kpi label={t('admin.reportsApi.drivers.drivers')} value={num(r.drivers, 0)} sub={t('admin.reportsApi.drivers.active', { count: r.activeDrivers })} icon={Users} />
              <Kpi label={t('admin.reportsApi.drivers.otherExpenses')} value={rupeesShort(r.totals.expenses)} sub={t('admin.reportsApi.drivers.serviceCount', { count: r.totals.services })} icon={Wrench} />
              <Kpi label={t('admin.reportsApi.drivers.uploads')} value={num(r.totals.documentUploads, 0)} icon={FileUp} />
            </KpiGrid>
            <ChartPanel className="mt-4" title={t('admin.reportsApi.drivers.fuelByDriver')} sub={t('admin.reportsApi.topDrill', { count: 10 })} height="h-80">
              {r.fuelByDriver.length ? <HBar data={r.fuelByDriver.map((d) => ({ id: d.id, name: d.label, value: Number(d.amount) }))} color={C(4)} onSelect={(id) => setFilter('driverId', id)} /> : <EmptyNote>{t('admin.reportsApi.drivers.empty')}</EmptyNote>}
            </ChartPanel>
            <p className="mt-2 px-1 text-xs text-muted-foreground">{t('admin.reportsApi.definitions.noScores')}</p>
          </>
        )}
      </SummaryState>

      <RecordsTable
        title={t('admin.reportsApi.drivers.records')}
        type="drivers"
        params={params}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ field: 'fuel', dir: 'desc' }}
        searchPlaceholder={t('admin.driversApi.search')}
        emptyText={t('admin.reportsApi.drivers.empty')}
        testId="driver-records"
      />
    </>
  );
}
