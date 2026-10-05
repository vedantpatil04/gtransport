import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Droplets, Fuel, Gauge, ImageIcon, Scale } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { ReceiptViewer } from '@/features/admin/components/ReceiptViewer';
import { Panel } from '@/features/admin/components/ui';
import { useApiResource } from '@/features/api/useApiResource';
import { num } from '@/lib/format';
import { reportsApi, type Breakdown, type FuelRecord } from '../api';
import { C, ChartPanel, Donut, HBar, StackedTrend } from '../charts';
import { BreakdownTable, EmptyNote, Kpi, KpiGrid, litresText, RecordsTable, rupees, rupeesShort, SummaryState, useBucketLabel, useDay, type RecordColumn } from '../components';
import type { ReportViewProps } from '../ReportsConnected';

/** A receipt link that opens the existing receipt viewer — the report adds no viewer of its own. */
export function ReceiptButton({ fileId, onOpen }: { fileId: string | null; onOpen: () => void }) {
  const { t } = useTranslation();
  if (!fileId) return <span className="text-muted-foreground/60">—</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={t('admin.fuelApi.openReceipt')}
      className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted"
    >
      <ImageIcon className="size-4 text-success" />
    </button>
  );
}

export function FuelReportView({ params, paramsKey, setFilter }: ReportViewProps) {
  const { t } = useTranslation();
  const report = useApiResource(() => reportsApi.summary('fuel', params), [paramsKey]);
  const bucketLabel = useBucketLabel(report.data?.range?.granularity);
  const day = useDay();
  const [receipt, setReceipt] = useState<FuelRecord | null>(null);

  const figureColumns: RecordColumn<Breakdown>[] = [
    { key: 'entries', header: t('admin.reportsApi.columns.entries'), numeric: true, render: (r) => num(r.entries, 0) },
    { key: 'litres', header: t('admin.fuel.litres'), numeric: true, render: (r) => num(Number(r.litres), 1) },
    { key: 'rate', header: t('admin.fuelApi.rate'), numeric: true, render: (r) => (r.averageRate ? `₹${r.averageRate}` : '—') },
    { key: 'amount', header: t('admin.common.amount'), numeric: true, render: (r) => rupees(r.amount) },
  ];

  const columns: RecordColumn<FuelRecord>[] = [
    { key: 'date', header: t('admin.common.date'), sort: 'date', className: 'whitespace-nowrap', render: (r) => day(r.date) },
    { key: 'vehicle', header: t('admin.common.vehicle'), sort: 'vehicle', render: (r) => <Plate reg={r.vehicle.registrationNumber} size="xs" /> },
    { key: 'driver', header: t('admin.common.driver'), sort: 'driver', className: 'min-w-[140px]', render: (r) => r.driver.name },
    { key: 'type', header: t('admin.fuel.type'), render: (r) => <Badge tone={r.fuelType === 'PETROL' ? 'success' : 'info'}>{t(`enum.fuelType.${r.fuelType.toLowerCase()}`)}</Badge> },
    { key: 'litres', header: t('admin.fuel.litres'), sort: 'litres', numeric: true, render: (r) => num(Number(r.litres), 2) },
    { key: 'rate', header: t('admin.fuelApi.rate'), numeric: true, render: (r) => (r.rate ? `₹${r.rate}` : '—') },
    { key: 'amount', header: t('admin.common.amount'), sort: 'amount', numeric: true, className: 'font-semibold', render: (r) => rupees(r.amount) },
    { key: 'station', header: t('admin.fuel.station'), sort: 'station', className: 'max-w-[220px] truncate text-muted-foreground', render: (r) => r.station },
    { key: 'receipt', header: t('admin.fuel.receipt'), className: 'text-center', render: (r) => <ReceiptButton fileId={r.receiptFileId} onOpen={() => setReceipt(r)} /> },
  ];

  return (
    <>
      <SummaryState resource={report}>
        {(r) => (
          <>
            <KpiGrid>
              <Kpi hero label={t('admin.reportsApi.fuel.total')} value={rupeesShort(r.totals.amount)} sub={t('admin.reportsApi.entries', { count: r.totals.entries })} icon={Fuel} testId="kpi-fuel-amount" />
              <Kpi label={t('admin.reportsApi.fuel.litres')} value={litresText(r.totals.litres)} icon={Droplets} testId="kpi-fuel-litres" />
              <Kpi label={t('admin.reportsApi.fuel.rate')} value={r.totals.averageRate ? `₹${r.totals.averageRate}/L` : '—'} icon={Gauge} definition={t('admin.reportsApi.definitions.fuelRate')} testId="kpi-fuel-rate" />
              <Kpi
                label={t('enum.fuelType.diesel')}
                value={rupeesShort(r.byFuelType.DIESEL.amount)}
                sub={`${t('enum.fuelType.petrol')} ${rupeesShort(r.byFuelType.PETROL.amount)}`}
                icon={Scale}
              />
            </KpiGrid>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
              <ChartPanel title={t('admin.reportsApi.fuel.spendTrend')} height="h-72">
                {r.totals.entries ? <StackedTrend data={r.trend} labelFor={bucketLabel} series={[{ key: 'amount', label: t('admin.common.amount'), color: C(1) }]} /> : <EmptyNote>{t('admin.reportsApi.fuel.empty')}</EmptyNote>}
              </ChartPanel>
              <ChartPanel title={t('admin.reportsApi.fuel.byType')} sub={t('admin.reportsApi.drillHint')}>
                {r.totals.entries ? (
                  <Donut
                    data={(['DIESEL', 'PETROL'] as const).map((type) => ({ key: type, name: t(`enum.fuelType.${type.toLowerCase()}`), value: Number(r.byFuelType[type].amount), color: type === 'PETROL' ? C(2) : C(1), extra: litresText(r.byFuelType[type].litres) }))}
                    center={rupeesShort(r.totals.amount)}
                    centerLabel={t('admin.reportsApi.tabs.fuel')}
                    onSelect={(key) => setFilter('fuelType', key)}
                  />
                ) : (
                  <EmptyNote>{t('admin.reportsApi.fuel.empty')}</EmptyNote>
                )}
              </ChartPanel>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <ChartPanel title={t('admin.reportsApi.fuel.litresTrend')}>
                {r.totals.entries ? <StackedTrend data={r.trend} labelFor={bucketLabel} format={(n) => litresText(n)} series={[{ key: 'litres', label: t('admin.fuel.litres'), color: C(4) }]} /> : <EmptyNote>{t('admin.reportsApi.fuel.empty')}</EmptyNote>}
              </ChartPanel>
              <ChartPanel title={t('admin.reportsApi.fuel.byVehicle')} sub={t('admin.reportsApi.topDrill', { count: 10 })} height="h-72">
                {r.byVehicle.length ? <HBar data={r.byVehicle.slice(0, 10).map((v) => ({ id: v.id, name: v.label, value: Number(v.amount) }))} color={C(1)} onSelect={(id) => setFilter('vehicleId', id)} /> : <EmptyNote>{t('admin.reportsApi.fuel.empty')}</EmptyNote>}
              </ChartPanel>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <Panel title={t('admin.reportsApi.fuel.byDriver')}>
                <BreakdownTable rows={r.byDriver} rowKey={(row) => row.id} onRowClick={(row) => setFilter('driverId', row.id)} emptyText={t('admin.reportsApi.fuel.empty')} columns={[{ key: 'label', header: t('admin.common.driver'), render: (row) => row.label }, ...figureColumns]} />
              </Panel>
              <Panel title={t('admin.reportsApi.fuel.byStation')}>
                <BreakdownTable rows={r.byStation} rowKey={(row) => row.id} onRowClick={(row) => setFilter('station', row.label)} emptyText={t('admin.reportsApi.fuel.empty')} columns={[{ key: 'label', header: t('admin.fuel.station'), className: 'max-w-[200px] truncate', render: (row) => row.label }, ...figureColumns]} />
              </Panel>
            </div>
          </>
        )}
      </SummaryState>

      <RecordsTable
        title={t('admin.reportsApi.fuel.records')}
        type="fuel"
        params={params}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ field: 'date', dir: 'desc' }}
        searchPlaceholder={t('admin.reportsApi.fuel.search')}
        emptyText={t('admin.reportsApi.fuel.empty')}
        testId="fuel-records"
      />

      <ReceiptViewer fileId={receipt?.receiptFileId ?? null} title={receipt ? `${receipt.vehicle.registrationNumber} · ${day(receipt.date)}` : ''} onClose={() => setReceipt(null)} />
    </>
  );
}
