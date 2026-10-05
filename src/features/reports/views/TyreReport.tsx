import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDot, Info, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReceiptViewer } from '@/features/admin/components/ReceiptViewer';
import { Panel } from '@/features/admin/components/ui';
import { useApiResource } from '@/features/api/useApiResource';
import { num } from '@/lib/format';
import { reportsApi, type TyreExpenseRecord, type TyrePolicyRecord } from '../api';
import { C, ChartPanel, StackedTrend } from '../charts';
import { BreakdownTable, EmptyNote, Kpi, KpiGrid, RecordsTable, rupees, rupeesShort, SummaryState, useBucketLabel, useDay, type RecordColumn } from '../components';
import type { ReportViewProps } from '../ReportsConnected';
import { ReceiptButton } from './FuelReport';

const HEALTH_TONE = { VALID: 'success', EXPIRING: 'warning', EXPIRED: 'danger', SUPERSEDED: 'neutral' } as const;

export function TyreReportView({ params, paramsKey, setFilter }: ReportViewProps) {
  const { t } = useTranslation();
  const report = useApiResource(() => reportsApi.summary('tyres', params), [paramsKey]);
  const bucketLabel = useBucketLabel(report.data?.range?.granularity);
  const day = useDay();
  const [section, setSection] = useState<'expenses' | 'policies'>('expenses');
  const [file, setFile] = useState<{ id: string | null; title: string } | null>(null);

  const expenseColumns: RecordColumn<TyreExpenseRecord>[] = [
    { key: 'date', header: t('admin.common.date'), sort: 'date', className: 'whitespace-nowrap', render: (r) => day(r.date) },
    { key: 'vehicle', header: t('admin.common.vehicle'), sort: 'vehicle', render: (r) => <Plate reg={r.vehicle.registrationNumber} size="xs" /> },
    { key: 'driver', header: t('admin.common.driver'), render: (r) => r.driver?.name ?? <span className="text-muted-foreground">—</span> },
    { key: 'vendor', header: t('admin.reportsApi.columns.vendor'), className: 'max-w-[200px] truncate', render: (r) => r.vendor ?? '—' },
    { key: 'description', header: t('admin.reportsApi.columns.description'), className: 'max-w-[240px] truncate text-muted-foreground', render: (r) => r.description ?? '—' },
    { key: 'amount', header: t('admin.common.amount'), sort: 'amount', numeric: true, className: 'font-semibold', render: (r) => rupees(r.amount) },
    { key: 'receipt', header: t('admin.fuel.receipt'), className: 'text-center', render: (r) => <ReceiptButton fileId={r.receiptFileId} onOpen={() => setFile({ id: r.receiptFileId, title: `${r.vehicle.registrationNumber} · ${day(r.date)}` })} /> },
  ];
  const policyColumns: RecordColumn<TyrePolicyRecord>[] = [
    { key: 'vehicle', header: t('admin.common.vehicle'), sort: 'vehicle', render: (r) => (r.vehicle ? <Plate reg={r.vehicle.registrationNumber} size="xs" /> : '—') },
    { key: 'insurer', header: t('admin.reportsApi.tyres.insurer'), render: (r) => r.insurer ?? '—' },
    { key: 'policy', header: t('admin.reportsApi.tyres.policyNumber'), className: 'text-muted-foreground', render: (r) => r.policyNumber ?? '—' },
    { key: 'start', header: t('admin.reportsApi.tyres.start'), sort: 'date', render: (r) => day(r.startDate) },
    { key: 'expiry', header: t('admin.reportsApi.tyres.expiry'), sort: 'expiry', render: (r) => day(r.expiryDate) },
    { key: 'status', header: t('admin.common.status'), render: (r) => <Badge tone={HEALTH_TONE[r.health]}>{t(`admin.reportsApi.health.${r.health}`)}</Badge> },
    { key: 'premium', header: t('admin.reportsApi.tyres.premium'), sort: 'amount', numeric: true, className: 'font-semibold', render: (r) => rupees(r.premium) },
    { key: 'file', header: t('admin.fuel.receipt'), className: 'text-center', render: (r) => <ReceiptButton fileId={r.fileId} onOpen={() => setFile({ id: r.fileId, title: r.insurer ?? '' })} /> },
  ];

  return (
    <>
      <SummaryState resource={report}>
        {(r) => (
          <>
            <KpiGrid>
              <Kpi hero label={t('admin.reportsApi.tyres.total')} value={rupeesShort(r.total)} icon={CircleDot} definition={t('admin.reportsApi.definitions.tyres')} testId="kpi-tyre-total" />
              <Kpi label={t('admin.reportsApi.tyres.purchases')} value={rupeesShort(r.expenses.amount)} sub={t('admin.reportsApi.records', { count: r.expenses.entries })} />
              <Kpi label={t('admin.reportsApi.tyres.premiums')} value={rupeesShort(r.insurance.premiums)} sub={t('admin.reportsApi.tyres.policies', { count: r.insurance.policies })} icon={ShieldCheck} />
              <Kpi
                label={t('admin.reportsApi.tyres.cover')}
                value={`${num(r.cover.valid, 0)} / ${num(r.cover.vehicles, 0)}`}
                sub={t('admin.reportsApi.tyres.coverSub', { expiring: r.cover.expiring, expired: r.cover.expired, missing: r.cover.missing })}
                icon={ShieldAlert}
                tone={r.cover.expired || r.cover.missing ? 'danger' : r.cover.expiring ? 'warning' : 'success'}
              />
            </KpiGrid>
            {!r.tyreDetailsRecorded && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" />
                {t('admin.reportsApi.tyres.noDetails')}
              </p>
            )}
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <ChartPanel title={t('admin.reportsApi.tyres.trend')} height="h-72">
                {Number(r.total) > 0 ? <StackedTrend data={r.trend} labelFor={bucketLabel} series={[{ key: 'tyre', label: t('admin.reportsApi.tyres.purchases'), color: C(2) }, { key: 'premium', label: t('admin.reportsApi.tyres.premiums'), color: C(6) }]} /> : <EmptyNote>{t('admin.reportsApi.tyres.empty')}</EmptyNote>}
              </ChartPanel>
              <Panel title={t('admin.reportsApi.tyres.byVehicle')}>
                <BreakdownTable
                  rows={r.byVehicle}
                  rowKey={(row) => row.id}
                  onRowClick={(row) => setFilter('vehicleId', row.id)}
                  emptyText={t('admin.reportsApi.tyres.empty')}
                  columns={[
                    { key: 'vehicle', header: t('admin.common.vehicle'), render: (row) => <Plate reg={row.label} size="xs" /> },
                    { key: 'tyre', header: t('admin.reportsApi.tyres.purchases'), numeric: true, render: (row) => rupees(row.tyre) },
                    { key: 'premium', header: t('admin.reportsApi.tyres.premiums'), numeric: true, render: (row) => rupees(row.premium) },
                    { key: 'total', header: t('admin.reportsApi.total'), numeric: true, className: 'font-semibold', render: (row) => rupees(row.total) },
                  ]}
                />
              </Panel>
            </div>
          </>
        )}
      </SummaryState>

      <div className="mt-4 flex gap-2" role="tablist" aria-label={t('admin.reportsApi.tyres.sections')}>
        {(['expenses', 'policies'] as const).map((s) => (
          <Button key={s} size="sm" variant={section === s ? 'default' : 'outline'} onClick={() => setSection(s)} role="tab" aria-selected={section === s}>
            {t(`admin.reportsApi.tyres.section.${s}`)}
          </Button>
        ))}
      </div>
      {section === 'expenses' ? (
        <RecordsTable key="expenses" title={t('admin.reportsApi.tyres.section.expenses')} type="tyres" section="expenses" params={params} columns={expenseColumns} rowKey={(row) => row.id} defaultSort={{ field: 'date', dir: 'desc' }} searchPlaceholder={t('admin.reportsApi.tyres.search')} emptyText={t('admin.reportsApi.tyres.empty')} testId="tyre-records" />
      ) : (
        <RecordsTable key="policies" title={t('admin.reportsApi.tyres.section.policies')} type="tyres" section="policies" params={params} columns={policyColumns} rowKey={(row) => row.id} defaultSort={{ field: 'date', dir: 'desc' }} searchPlaceholder={t('admin.reportsApi.tyres.search')} emptyText={t('admin.reportsApi.tyres.noPolicies')} testId="tyre-policies" />
      )}
      <ReceiptViewer fileId={file?.id ?? null} title={file?.title ?? ''} onClose={() => setFile(null)} />
    </>
  );
}
