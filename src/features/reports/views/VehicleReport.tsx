import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Fuel, Landmark, Truck, Wrench } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { useApiResource } from '@/features/api/useApiResource';
import { reportsApi, type VehicleCostRow } from '../api';
import { C, ChartPanel, StackedTrend } from '../charts';
import { EmptyNote, Kpi, KpiGrid, RecordsTable, rupees, rupeesShort, SummaryState, useBucketLabel, useDay, type RecordColumn } from '../components';
import type { ReportViewProps } from '../ReportsConnected';

const HEALTH_TONE = { VALID: 'success', EXPIRING: 'warning', EXPIRED: 'danger', MISSING: 'neutral' } as const;

export function VehicleReportView({ params, paramsKey, setFilter }: ReportViewProps) {
  const { t } = useTranslation();
  const report = useApiResource(() => reportsApi.summary('vehicles', params), [paramsKey]);
  const bucketLabel = useBucketLabel(report.data?.range?.granularity);
  const day = useDay();
  const showDocs = report.data?.visibility.compliance ?? false;

  const columns: RecordColumn<VehicleCostRow>[] = [
    {
      key: 'vehicle', header: t('admin.common.vehicle'), sort: 'registration',
      render: (r) => (
        <Link to={`/admin/vehicles/${r.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex flex-col gap-0.5 hover:underline">
          <Plate reg={r.registrationNumber} size="xs" />
          <span className="text-xs text-muted-foreground">{t(`admin.enum.ownership.${r.ownership}`)} · {t(`admin.enum.vehicleStatus.${r.status}`)}</span>
        </Link>
      ),
    },
    { key: 'driver', header: t('admin.common.driver'), render: (r) => r.driver?.name ?? <span className="text-muted-foreground">{t('admin.reportsApi.unassigned')}</span> },
    { key: 'fuel', header: t('enum.category.fuel'), sort: 'fuel', numeric: true, render: (r) => rupees(r.fuel.amount) },
    { key: 'maintenance', header: t('enum.category.maintenance'), sort: 'maintenance', numeric: true, render: (r) => rupees(r.maintenance) },
    { key: 'tyre', header: t('admin.reportsApi.vehicles.tyres'), sort: 'tyre', numeric: true, render: (r) => rupees(Number(r.tyre) + Number(r.tyreInsurance)) },
    { key: 'rto', header: t('enum.category.rto'), numeric: true, render: (r) => rupees(r.rto) },
    { key: 'total', header: t('admin.reportsApi.vehicles.operatingCost'), sort: 'total', numeric: true, className: 'font-semibold', render: (r) => rupees(r.operatingCost) },
    {
      key: 'emi', header: t('admin.reportsApi.vehicles.emi'), sort: 'outstanding', numeric: true,
      // A fully owned vehicle has no EMI, so nothing is shown — not a zero.
      render: (r) =>
        r.finance ? (
          <span className="flex flex-col items-end gap-0.5">
            <span>{rupees(r.finance.paidInPeriod)}</span>
            <span className="text-xs text-muted-foreground">{t('admin.reportsApi.vehicles.outstanding', { amount: rupeesShort(r.finance.outstanding) })}</span>
            {r.finance.overdueCount > 0 && <Badge tone="danger">{t('admin.reportsApi.vehicles.overdue', { count: r.finance.overdueCount })}</Badge>}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('admin.vehiclesApi.noEmi')}</span>
        ),
    },
    ...(showDocs
      ? [{
          key: 'documents', header: t('admin.reportsApi.vehicles.documents'),
          render: (r: VehicleCostRow) =>
            r.documents ? (
              <Badge tone={HEALTH_TONE[r.documents.health]}>
                {r.documents.health === 'VALID'
                  ? t('admin.reportsApi.health.VALID')
                  : (['expired', 'missing', 'expiring'] as const).filter((k) => r.documents![k] > 0).map((k) => t(`admin.reportsApi.vehicles.doc.${k}`, { count: r.documents![k] })).join(' · ')}
              </Badge>
            ) : '—',
        }]
      : []),
  ];

  return (
    <>
      <SummaryState resource={report}>
        {(r) => (
          <>
            <KpiGrid>
              <Kpi hero label={t('admin.reportsApi.vehicles.operatingCost')} value={rupeesShort(r.totals.operatingCost)} sub={t('admin.reportsApi.vehicles.count', { count: r.vehicles })} icon={Truck} definition={t('admin.reportsApi.definitions.operatingCost')} testId="kpi-vehicle-cost" />
              <Kpi label={t('enum.category.fuel')} value={rupeesShort(r.totals.fuel)} icon={Fuel} />
              <Kpi label={t('admin.reportsApi.vehicles.otherExpenses')} value={rupeesShort(r.totals.otherExpenses)} sub={`${t('enum.category.maintenance')} ${rupeesShort(r.totals.maintenance)}`} icon={Wrench} />
              <Kpi
                label={t('admin.reportsApi.vehicles.outstandingFinance')}
                value={r.finance.financedVehicles ? rupeesShort(r.finance.outstanding) : '—'}
                sub={r.finance.financedVehicles ? t('admin.reportsApi.vehicles.financed', { count: r.finance.financedVehicles }) : t('admin.reportsApi.vehicles.noFinanced')}
                icon={Landmark}
                tone={r.finance.overdueInstallments ? 'danger' : 'neutral'}
                definition={t('admin.reportsApi.definitions.outstandingFinance')}
              />
            </KpiGrid>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {(['operatingCost', 'fuel', 'maintenance'] as const).map((k) => (
                <div key={k} className="rounded-lg border bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">{t(`admin.reportsApi.vehicles.highest.${k}`)}</p>
                  {r.highest[k] ? (
                    <button type="button" onClick={() => setFilter('vehicleId', r.highest[k]!.id)} className="mt-1 flex w-full items-center justify-between gap-2 text-left hover:underline">
                      <Plate reg={r.highest[k]!.label} size="xs" />
                      <span className="figure font-semibold">{rupeesShort(r.highest[k]!.amount)}</span>
                    </button>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">—</p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <ChartPanel title={t('admin.reportsApi.vehicles.comparison')} sub={t('admin.reportsApi.top', { count: 10 })} height="h-80">
                {r.comparison.length ? (
                  <StackedTrend
                    data={r.comparison.map((c) => ({ ...c, bucket: c.label }))}
                    labelFor={(label) => label}
                    series={[
                      { key: 'fuel', label: t('enum.category.fuel'), color: C(1) },
                      { key: 'maintenance', label: t('enum.category.maintenance'), color: C(3) },
                      { key: 'tyre', label: t('admin.reportsApi.vehicles.tyres'), color: C(2) },
                      { key: 'rto', label: t('enum.category.rto'), color: C(4) },
                    ]}
                  />
                ) : (
                  <EmptyNote>{t('admin.reportsApi.vehicles.empty')}</EmptyNote>
                )}
              </ChartPanel>
              <ChartPanel title={r.trendScope ? t('admin.reportsApi.vehicles.trendFor', { vehicle: r.trendScope }) : t('admin.reportsApi.vehicles.trend')} height="h-80">
                {Number(r.totals.operatingCost) > 0 ? (
                  <StackedTrend data={r.trend} labelFor={bucketLabel} series={[{ key: 'fuel', label: t('enum.category.fuel'), color: C(1) }, { key: 'other', label: t('admin.reportsApi.vehicles.otherRecords'), color: C(3) }]} />
                ) : (
                  <EmptyNote>{t('admin.reportsApi.vehicles.empty')}</EmptyNote>
                )}
              </ChartPanel>
            </div>
          </>
        )}
      </SummaryState>

      <RecordsTable
        title={t('admin.reportsApi.vehicles.records')}
        type="vehicles"
        params={params}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ field: 'total', dir: 'desc' }}
        onRowClick={(row) => setFilter('vehicleId', row.id)}
        searchPlaceholder={t('admin.vehiclesApi.search')}
        emptyText={t('admin.reportsApi.vehicles.empty')}
        testId="vehicle-records"
        action={<span className="text-xs text-muted-foreground">{t('admin.reportsApi.rowDrillHint')}</span>}
      />
      {report.data && <p className="mt-2 px-1 text-xs text-muted-foreground">{t('admin.reportsApi.asOfNote', { date: day(report.data.asOf) })}</p>}
    </>
  );
}
