import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fuel, ReceiptIndianRupee, Wrench, CircleDot } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { ReceiptViewer } from '@/features/admin/components/ReceiptViewer';
import { Panel } from '@/features/admin/components/ui';
import { useApiResource } from '@/features/api/useApiResource';
import { reportsApi, type ExpenseCategory, type ExpenseRecord, type SplitBreakdown } from '../api';
import { C, ChartPanel, Donut, StackedTrend } from '../charts';
import { BreakdownTable, EmptyNote, Kpi, KpiGrid, RecordsTable, rupees, rupeesShort, SummaryState, useBucketLabel, useDay, type RecordColumn } from '../components';
import type { ReportViewProps } from '../ReportsConnected';
import { ReceiptButton } from './FuelReport';

export const CATEGORY_COLOR: Record<ExpenseCategory, string> = { FUEL: C(1), RTO: C(4), TYRE: C(2), TYRE_INSURANCE: C(6), MAINTENANCE: C(3) };
export const categoryLabelKey = (c: ExpenseCategory) => `enum.category.${c.toLowerCase()}`;

export function ExpenseReportView({ params, paramsKey, setFilter }: ReportViewProps) {
  const { t } = useTranslation();
  const report = useApiResource(() => reportsApi.summary('expenses', params), [paramsKey]);
  const bucketLabel = useBucketLabel(report.data?.range?.granularity);
  const day = useDay();
  const [receipt, setReceipt] = useState<ExpenseRecord | null>(null);

  const split = (categories: ExpenseCategory[], first: string): RecordColumn<SplitBreakdown>[] => [
    { key: 'label', header: first, render: (row) => row.label ?? t('admin.reportsApi.noDriver') },
    ...categories.map((c) => ({ key: c, header: t(categoryLabelKey(c)), numeric: true, render: (row: SplitBreakdown) => rupees(row.byCategory[c] ?? '0') })),
    { key: 'total', header: t('admin.reportsApi.total'), numeric: true, className: 'font-semibold', render: (row) => rupees(row.amount) },
  ];

  const columns: RecordColumn<ExpenseRecord>[] = [
    { key: 'date', header: t('admin.common.date'), sort: 'date', className: 'whitespace-nowrap', render: (r) => day(r.date) },
    { key: 'category', header: t('admin.reportsApi.filters.category'), sort: 'category', render: (r) => <Badge tone="neutral">{t(categoryLabelKey(r.category))}</Badge> },
    { key: 'vehicle', header: t('admin.common.vehicle'), sort: 'vehicle', render: (r) => (r.vehicle ? <Plate reg={r.vehicle.registrationNumber} size="xs" /> : '—') },
    { key: 'driver', header: t('admin.common.driver'), sort: 'driver', render: (r) => r.driver?.name ?? <span className="text-muted-foreground">—</span> },
    { key: 'vendor', header: t('admin.reportsApi.columns.vendor'), className: 'max-w-[200px] truncate text-muted-foreground', render: (r) => r.vendor ?? '—' },
    { key: 'amount', header: t('admin.common.amount'), sort: 'amount', numeric: true, className: 'font-semibold', render: (r) => rupees(r.amount) },
    { key: 'receipt', header: t('admin.fuel.receipt'), className: 'text-center', render: (r) => <ReceiptButton fileId={r.receiptFileId} onOpen={() => setReceipt(r)} /> },
  ];

  return (
    <>
      <SummaryState resource={report}>
        {(r) => {
          const amount = (c: ExpenseCategory) => r.byCategory.find((x) => x.category === c)?.amount ?? '0';
          const driverCategories = r.categories.filter((c) => c !== 'TYRE_INSURANCE');
          return (
            <>
              <KpiGrid>
                <Kpi hero label={t('admin.reportsApi.expenses.total')} value={rupeesShort(r.total)} sub={t('admin.reportsApi.records', { count: r.entries })} icon={ReceiptIndianRupee} testId="kpi-expense-total" definition={t('admin.reportsApi.definitions.operationalSpend')} />
                <Kpi label={t('enum.category.fuel')} value={rupeesShort(amount('FUEL'))} icon={Fuel} />
                <Kpi label={t('enum.category.maintenance')} value={rupeesShort(amount('MAINTENANCE'))} icon={Wrench} />
                <Kpi label={t('admin.reportsApi.expenses.tyreAndRto')} value={rupeesShort(Number(amount('TYRE')) + Number(amount('TYRE_INSURANCE')) + Number(amount('RTO')))} sub={`${t('enum.category.tyre_insurance')} ${rupeesShort(amount('TYRE_INSURANCE'))}`} icon={CircleDot} />
              </KpiGrid>

              <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
                <ChartPanel title={t('admin.reportsApi.expenses.trend')} height="h-80">
                  {r.entries ? (
                    <StackedTrend data={r.trend} labelFor={bucketLabel} series={r.categories.map((c) => ({ key: c, label: t(categoryLabelKey(c)), color: CATEGORY_COLOR[c] }))} />
                  ) : (
                    <EmptyNote>{t('admin.reportsApi.expenses.empty')}</EmptyNote>
                  )}
                </ChartPanel>
                <ChartPanel title={t('admin.reportsApi.expenses.distribution')} sub={t('admin.reportsApi.drillHint')} height="h-80">
                  {r.entries ? (
                    <Donut
                      data={r.byCategory.filter((c) => Number(c.amount) > 0).map((c) => ({ key: c.category, name: t(categoryLabelKey(c.category)), value: Number(c.amount), color: CATEGORY_COLOR[c.category], extra: t('admin.reportsApi.records', { count: c.entries }) }))}
                      center={rupeesShort(r.total)}
                      centerLabel={t('admin.reportsApi.total')}
                      onSelect={(key) => setFilter('category', key)}
                    />
                  ) : (
                    <EmptyNote>{t('admin.reportsApi.expenses.empty')}</EmptyNote>
                  )}
                </ChartPanel>
              </div>

              <Panel className="mt-4" title={t('admin.reportsApi.expenses.byVehicle')} action={<span className="text-xs text-muted-foreground">{t('admin.reportsApi.rowDrillHint')}</span>}>
                <BreakdownTable rows={r.byVehicle} rowKey={(row) => row.id ?? 'none'} onRowClick={(row) => row.id && setFilter('vehicleId', row.id)} emptyText={t('admin.reportsApi.expenses.empty')} columns={split(r.categories, t('admin.common.vehicle'))} />
              </Panel>
              <Panel className="mt-4" title={t('admin.reportsApi.expenses.byDriver')}>
                <BreakdownTable rows={r.byDriver} rowKey={(row) => row.id ?? 'none'} onRowClick={(row) => row.id && setFilter('driverId', row.id)} emptyText={t('admin.reportsApi.expenses.empty')} columns={split(driverCategories, t('admin.common.driver'))} />
              </Panel>
              <p className="mt-2 px-1 text-xs text-muted-foreground">{t('admin.reportsApi.expenses.categoriesNote')}</p>
            </>
          );
        }}
      </SummaryState>

      <RecordsTable
        title={t('admin.reportsApi.expenses.records')}
        type="expenses"
        params={params}
        columns={columns}
        rowKey={(row) => `${row.category}-${row.id}`}
        defaultSort={{ field: 'date', dir: 'desc' }}
        searchPlaceholder={t('admin.reportsApi.expenses.search')}
        emptyText={t('admin.reportsApi.expenses.empty')}
        testId="expense-records"
      />
      <ReceiptViewer fileId={receipt?.receiptFileId ?? null} title={receipt ? `${receipt.vehicle?.registrationNumber ?? ''} · ${day(receipt.date)}` : ''} onClose={() => setReceipt(null)} />
    </>
  );
}
