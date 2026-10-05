import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Bot, Hourglass, Wrench } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { ReceiptViewer } from '@/features/admin/components/ReceiptViewer';
import { Panel } from '@/features/admin/components/ui';
import { useApiResource } from '@/features/api/useApiResource';
import { num } from '@/lib/format';
import { reportsApi, type ServiceRecord, type VerificationGroup } from '../api';
import { C, ChartPanel, Donut, StackedTrend } from '../charts';
import { BreakdownTable, EmptyNote, Kpi, KpiGrid, RecordsTable, rupees, rupeesShort, SummaryState, useBucketLabel, useDay, type RecordColumn } from '../components';
import type { ReportViewProps } from '../ReportsConnected';
import { ReceiptButton } from './FuelReport';

const GROUP_COLOR: Record<VerificationGroup, string> = { verified: C(2), awaitingVerification: C(3), inProgress: C(4), failed: C(5), rejected: C(6), notProcessed: 'hsl(var(--muted-foreground))' };
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  VERIFIED: 'success', SUCCEEDED: 'warning', NEEDS_REVIEW: 'warning', FAILED: 'danger', QUEUED: 'info', PROCESSING: 'info', RETRYING: 'info', REJECTED: 'neutral', NOT_PROCESSED: 'neutral',
};

export function MaintenanceReportView({ params, paramsKey, setFilter }: ReportViewProps) {
  const { t } = useTranslation();
  const report = useApiResource(() => reportsApi.summary('maintenance', params), [paramsKey]);
  const bucketLabel = useBucketLabel(report.data?.range?.granularity);
  const day = useDay();
  const [receipt, setReceipt] = useState<ServiceRecord | null>(null);

  const columns: RecordColumn<ServiceRecord>[] = [
    { key: 'date', header: t('admin.common.date'), sort: 'date', className: 'whitespace-nowrap', render: (r) => day(r.date) },
    { key: 'vehicle', header: t('admin.common.vehicle'), sort: 'vehicle', render: (r) => <Plate reg={r.vehicle.registrationNumber} size="xs" /> },
    { key: 'driver', header: t('admin.common.driver'), render: (r) => r.driver?.name ?? <span className="text-muted-foreground">—</span> },
    {
      key: 'service', header: t('admin.reportsApi.maintenance.serviceType'),
      // Service details exist only once a person verified the record; an AI reading is never shown as fact.
      render: (r) => (r.verified ? r.serviceType ?? '—' : <span className="text-xs text-muted-foreground">{t('admin.reportsApi.maintenance.notVerified')}</span>),
    },
    { key: 'vendor', header: t('admin.reportsApi.columns.vendor'), className: 'max-w-[200px] truncate text-muted-foreground', render: (r) => r.vendor ?? '—' },
    { key: 'amount', header: t('admin.common.amount'), sort: 'amount', numeric: true, className: 'font-semibold', render: (r) => rupees(r.amount) },
    { key: 'status', header: t('admin.reportsApi.maintenance.receiptStatus'), sort: 'status', render: (r) => <Badge tone={STATUS_TONE[r.aiStatus] ?? 'neutral'}>{t(`admin.receiptAi.status.${r.aiStatus}`)}</Badge> },
    { key: 'receipt', header: t('admin.fuel.receipt'), className: 'text-center', render: (r) => <ReceiptButton fileId={r.receiptFileId} onOpen={() => setReceipt(r)} /> },
  ];

  return (
    <>
      <SummaryState resource={report}>
        {(r) => {
          const groups = (Object.keys(GROUP_COLOR) as VerificationGroup[]).filter((g) => r.verification[g].count > 0);
          return (
            <>
              <KpiGrid>
                <Kpi hero label={t('admin.reportsApi.maintenance.total')} value={rupeesShort(r.totals.amount)} sub={t('admin.reportsApi.maintenance.services', { count: r.totals.services })} icon={Wrench} testId="kpi-maintenance-total" />
                <Kpi label={t('admin.reportsApi.maintenance.verified')} value={num(r.verification.verified.count, 0)} sub={rupeesShort(r.verification.verified.amount)} icon={BadgeCheck} tone="success" definition={t('admin.reportsApi.definitions.verified')} />
                <Kpi label={t('admin.reportsApi.maintenance.awaiting')} value={num(r.verification.awaitingVerification.count, 0)} sub={t('admin.reportsApi.maintenance.aiOnly')} icon={Bot} tone={r.verification.awaitingVerification.count ? 'warning' : 'neutral'} definition={t('admin.reportsApi.definitions.aiReading')} />
                <Kpi label={t('admin.reportsApi.maintenance.pending')} value={num(r.pendingVerification.count, 0)} sub={rupeesShort(r.pendingVerification.amount)} icon={Hourglass} definition={t('admin.reportsApi.definitions.pendingVerification')} />
              </KpiGrid>

              <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
                <ChartPanel title={t('admin.reportsApi.maintenance.trend')} height="h-72">
                  {r.totals.services ? <StackedTrend data={r.trend} labelFor={bucketLabel} series={[{ key: 'amount', label: t('admin.common.amount'), color: C(3) }]} /> : <EmptyNote>{t('admin.reportsApi.maintenance.empty')}</EmptyNote>}
                </ChartPanel>
                <ChartPanel title={t('admin.reportsApi.maintenance.verification')} height="h-72">
                  {groups.length ? (
                    <Donut
                      data={groups.map((g) => ({ key: g, name: t(`admin.reportsApi.verification.${g}`), value: Number(r.verification[g].amount), color: GROUP_COLOR[g], extra: t('admin.reportsApi.records', { count: r.verification[g].count }) }))}
                      center={num(r.totals.services, 0)}
                      centerLabel={t('admin.reportsApi.maintenance.servicesLabel')}
                    />
                  ) : (
                    <EmptyNote>{t('admin.reportsApi.maintenance.empty')}</EmptyNote>
                  )}
                </ChartPanel>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel title={t('admin.reportsApi.maintenance.byVehicle')} action={<span className="text-xs text-muted-foreground">{t('admin.reportsApi.rowDrillHint')}</span>}>
                  <BreakdownTable
                    rows={r.byVehicle}
                    rowKey={(row) => row.id}
                    onRowClick={(row) => setFilter('vehicleId', row.id)}
                    emptyText={t('admin.reportsApi.maintenance.empty')}
                    columns={[
                      { key: 'vehicle', header: t('admin.common.vehicle'), render: (row) => <Plate reg={row.label} size="xs" /> },
                      { key: 'services', header: t('admin.reportsApi.maintenance.servicesLabel'), numeric: true, render: (row) => num(row.services, 0) },
                      { key: 'gap', header: t('admin.reportsApi.maintenance.averageGap'), numeric: true, render: (row) => (row.averageDaysBetween === null ? '—' : t('admin.reportsApi.days', { count: row.averageDaysBetween })) },
                      { key: 'amount', header: t('admin.common.amount'), numeric: true, render: (row) => rupees(row.amount) },
                    ]}
                  />
                </Panel>
                <Panel title={t('admin.reportsApi.maintenance.recurring')}>
                  <BreakdownTable
                    rows={r.recurring}
                    rowKey={(row) => `${row.vehicle.id}-${row.serviceType}`}
                    emptyText={t('admin.reportsApi.maintenance.noRecurring')}
                    columns={[
                      { key: 'vehicle', header: t('admin.common.vehicle'), render: (row) => <Plate reg={row.vehicle.registrationNumber} size="xs" /> },
                      { key: 'type', header: t('admin.reportsApi.maintenance.serviceType'), render: (row) => row.serviceType },
                      { key: 'count', header: t('admin.reportsApi.maintenance.times'), numeric: true, render: (row) => num(row.count, 0) },
                      { key: 'last', header: t('admin.reportsApi.maintenance.last'), render: (row) => day(row.lastDate) },
                    ]}
                  />
                </Panel>
              </div>
            </>
          );
        }}
      </SummaryState>

      <RecordsTable
        title={t('admin.reportsApi.maintenance.records')}
        type="maintenance"
        params={params}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ field: 'date', dir: 'desc' }}
        searchPlaceholder={t('admin.reportsApi.maintenance.search')}
        emptyText={t('admin.reportsApi.maintenance.empty')}
        testId="maintenance-records"
      />
      <ReceiptViewer fileId={receipt?.receiptFileId ?? null} title={receipt ? `${receipt.vehicle.registrationNumber} · ${day(receipt.date)}` : ''} onClose={() => setReceipt(null)} />
    </>
  );
}
