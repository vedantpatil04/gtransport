import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, HandCoins, Landmark } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { DetailList, Panel } from '@/features/admin/components/ui';
import { useApiResource } from '@/features/api/useApiResource';
import { num } from '@/lib/format';
import { reportsApi, type LedgerLine, type PaymentGroup } from '../api';
import { AreaTrend, C, ChartPanel, Donut } from '../charts';
import { BreakdownTable, EmptyNote, Kpi, KpiGrid, RecordsTable, rupees, rupeesShort, SummaryState, useBucketLabel, useDay, type RecordColumn } from '../components';
import type { ReportViewProps } from '../ReportsConnected';

const GROUP_COLOR: Record<PaymentGroup, string> = { paid: C(2), processing: C(4), pending: C(3), failed: C(5), cancelled: 'hsl(var(--muted-foreground))', reversed: C(6) };

export function FinanceReportView({ params, paramsKey, setFilter }: ReportViewProps) {
  const { t } = useTranslation();
  const report = useApiResource(() => reportsApi.summary('finance', params), [paramsKey]);
  const bucketLabel = useBucketLabel(report.data?.range?.granularity);
  const day = useDay();

  const columns: RecordColumn<LedgerLine>[] = [
    { key: 'date', header: t('admin.common.date'), sort: 'date', className: 'whitespace-nowrap', render: (r) => day(r.date) },
    {
      key: 'type', header: t('admin.common.type'), sort: 'type',
      render: (r) => (
        <span className="flex items-center gap-1.5">
          {t(`admin.enum.ledgerType.${r.type}`)}
          {r.isReversal && <Badge tone="warning">{t('admin.financeApi.reversed')}</Badge>}
        </span>
      ),
    },
    { key: 'party', header: t('admin.reportsApi.finance.party'), render: (r) => (
        <span className="flex flex-col gap-0.5">
          {(r.employee ?? r.driver) && <span>{(r.employee ?? r.driver)!.name}</span>}
          {r.vehicle && <Plate reg={r.vehicle.registrationNumber} size="xs" />}
          {!r.employee && !r.driver && !r.vehicle && '—'}
        </span>
      ) },
    { key: 'description', header: t('admin.reportsApi.columns.description'), className: 'max-w-[240px] truncate text-muted-foreground', render: (r) => r.description ?? '—' },
    { key: 'payment', header: t('admin.reportsApi.finance.paymentStatus'), render: (r) => (r.paymentStatus ? t(`admin.enum.paymentStatus.${r.paymentStatus}`) : '—') },
    {
      key: 'amount', header: t('admin.common.amount'), sort: 'amount', numeric: true,
      render: (r) => <span className={r.direction === 'INCOME' ? 'text-success' : undefined}>{r.direction === 'INCOME' ? '+' : ''}{rupees(r.amount)}</span>,
    },
  ];

  return (
    <>
      <SummaryState resource={report}>
        {(r) => {
          const groups = (Object.keys(GROUP_COLOR) as PaymentGroup[]).filter((g) => r.payments.byGroup[g].count > 0);
          return (
            <>
              <KpiGrid>
                <Kpi hero label={t('admin.reportsApi.finance.outflow')} value={rupeesShort(r.ledger.outflow)} sub={t('admin.reportsApi.finance.inflowSub', { amount: rupeesShort(r.ledger.inflow) })} icon={ArrowUpRight} definition={t('admin.reportsApi.definitions.ledger')} testId="kpi-finance-outflow" />
                <Kpi label={t('admin.reportsApi.finance.paidInPeriod')} value={rupeesShort(r.payments.paidInPeriod.amount)} sub={t('admin.reportsApi.finance.payments', { count: r.payments.paidInPeriod.count })} icon={ArrowDownLeft} definition={t('admin.reportsApi.definitions.paid')} />
                <Kpi label={t('admin.reportsApi.finance.salaries')} value={rupeesShort(r.salaries.netPayable)} sub={t('admin.reportsApi.finance.advancesSub', { amount: rupeesShort(r.advances.amount) })} icon={HandCoins} definition={t('admin.reportsApi.definitions.salaries')} />
                <Kpi
                  label={t('admin.reportsApi.vehicles.outstandingFinance')}
                  value={r.vehicleFinance.activeLoans ? rupeesShort(r.vehicleFinance.outstanding) : '—'}
                  sub={r.vehicleFinance.overdue.count ? t('admin.reportsApi.vehicles.overdue', { count: r.vehicleFinance.overdue.count }) : t('admin.reportsApi.finance.emiPaid', { amount: rupeesShort(r.vehicleFinance.paidInPeriod) })}
                  tone={r.vehicleFinance.overdue.count ? 'danger' : 'neutral'}
                  icon={Landmark}
                  definition={t('admin.reportsApi.definitions.outstandingFinance')}
                />
              </KpiGrid>

              <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
                <ChartPanel title={t('admin.reportsApi.finance.movement')} height="h-80">
                  {r.ledger.categories.length ? <AreaTrend data={r.ledger.trend} labelFor={bucketLabel} series={[{ key: 'outflow', label: t('admin.reportsApi.finance.outflowShort'), color: C(5) }, { key: 'inflow', label: t('admin.reportsApi.finance.inflowShort'), color: C(2) }]} /> : <EmptyNote>{t('admin.reportsApi.finance.empty')}</EmptyNote>}
                </ChartPanel>
                <ChartPanel title={t('admin.reportsApi.finance.paymentStatus')} sub={t('admin.reportsApi.finance.createdInPeriod')} height="h-80">
                  {groups.length ? (
                    <Donut
                      data={groups.map((g) => ({ key: g, name: t(`admin.reportsApi.paymentGroup.${g}`), value: Number(r.payments.byGroup[g].amount), color: GROUP_COLOR[g], extra: t('admin.reportsApi.finance.payments', { count: r.payments.byGroup[g].count }) }))}
                      center={num(groups.reduce((n, g) => n + r.payments.byGroup[g].count, 0), 0)}
                      centerLabel={t('admin.reportsApi.finance.paymentsLabel')}
                    />
                  ) : (
                    <EmptyNote>{t('admin.reportsApi.finance.noPayments')}</EmptyNote>
                  )}
                </ChartPanel>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel title={t('admin.reportsApi.finance.byCategory')}>
                  <BreakdownTable
                    rows={r.ledger.categories}
                    rowKey={(row) => `${row.type}-${row.direction}`}
                    onRowClick={(row) => setFilter('type', row.type)}
                    emptyText={t('admin.reportsApi.finance.empty')}
                    columns={[
                      { key: 'type', header: t('admin.common.type'), render: (row) => t(`admin.enum.ledgerType.${row.type}`) },
                      { key: 'direction', header: t('admin.reportsApi.finance.direction'), render: (row) => t(`admin.enum.ledgerDirection.${row.direction}`) },
                      { key: 'entries', header: t('admin.reportsApi.columns.entries'), numeric: true, render: (row) => num(row.entries, 0) },
                      { key: 'amount', header: t('admin.common.amount'), numeric: true, render: (row) => rupees(row.amount) },
                    ]}
                  />
                </Panel>
                <Panel title={t('admin.reportsApi.finance.payrollTitle')}>
                  <div className="p-4">
                    <DetailList
                      rows={[
                        [t('admin.financeApi.base'), rupees(r.salaries.baseSalary)],
                        [t('admin.financeApi.allowances'), rupees(r.salaries.allowances)],
                        [t('admin.financeApi.recovery'), `− ${rupees(r.salaries.advanceRecovery)}`],
                        [t('admin.financeApi.deductions'), `− ${rupees(r.salaries.deductions)}`],
                        [t('admin.financeApi.net'), rupees(r.salaries.netPayable)],
                        [t('admin.reportsApi.finance.salaryStatus'), t('admin.reportsApi.finance.salaryStatusValue', { paid: r.salaries.paid.count, pending: r.salaries.pending.count, cancelled: r.salaries.cancelled.count })],
                        [t('admin.reportsApi.finance.advances'), t('admin.reportsApi.finance.advancesValue', { amount: rupees(r.advances.amount), count: r.advances.count })],
                      ]}
                    />
                  </div>
                </Panel>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel title={t('admin.reportsApi.finance.paymentStatusTable')}>
                  <BreakdownTable
                    rows={Object.entries(r.payments.byStatus).filter(([, v]) => v.count > 0)}
                    rowKey={([status]) => status}
                    onRowClick={([status]) => setFilter('paymentStatus', status)}
                    emptyText={t('admin.reportsApi.finance.noPayments')}
                    columns={[
                      { key: 'status', header: t('admin.common.status'), render: ([status]) => t(`admin.enum.paymentStatus.${status}`) },
                      { key: 'count', header: t('admin.reportsApi.columns.count'), numeric: true, render: ([, v]) => num(v.count, 0) },
                      { key: 'amount', header: t('admin.common.amount'), numeric: true, render: ([, v]) => rupees(v.amount) },
                    ]}
                  />
                </Panel>
                <Panel title={t('admin.reportsApi.finance.emiTitle')}>
                  <BreakdownTable
                    rows={r.vehicleFinance.loans}
                    rowKey={(row) => row.vehicle.id}
                    onRowClick={(row) => setFilter('vehicleId', row.vehicle.id)}
                    emptyText={t('admin.reportsApi.finance.noLoans')}
                    columns={[
                      { key: 'vehicle', header: t('admin.common.vehicle'), render: (row) => <Plate reg={row.vehicle.registrationNumber} size="xs" /> },
                      { key: 'lender', header: t('admin.reportsApi.finance.lender'), render: (row) => row.lender ?? '—' },
                      { key: 'paid', header: t('admin.reportsApi.finance.emiPaidShort'), numeric: true, render: (row) => rupees(row.paidInPeriod.amount) },
                      { key: 'overdue', header: t('admin.reportsApi.finance.overdue'), numeric: true, render: (row) => (row.overdue.count ? <span className="text-danger">{rupees(row.overdue.amount)}</span> : '—') },
                      { key: 'outstanding', header: t('admin.reportsApi.finance.outstanding'), numeric: true, render: (row) => rupees(row.outstanding) },
                    ]}
                  />
                </Panel>
              </div>

              <Panel className="mt-4" title={t('admin.reportsApi.finance.byEmployee')}>
                <BreakdownTable
                  rows={r.byEmployee}
                  rowKey={(row) => row.id}
                  onRowClick={(row) => setFilter('employeeId', row.id)}
                  emptyText={t('admin.reportsApi.finance.empty')}
                  columns={[
                    { key: 'employee', header: t('admin.reportsApi.filters.employee'), render: (row) => <span>{row.label} <span className="text-xs text-muted-foreground">{row.code}</span></span> },
                    { key: 'salary', header: t('admin.reportsApi.finance.salaryNet'), numeric: true, render: (row) => rupees(row.salaryNet) },
                    { key: 'advances', header: t('admin.reportsApi.finance.advances'), numeric: true, render: (row) => rupees(row.advances) },
                    { key: 'total', header: t('admin.reportsApi.total'), numeric: true, className: 'font-semibold', render: (row) => rupees(row.total) },
                  ]}
                />
              </Panel>
              <p className="mt-2 px-1 text-xs text-muted-foreground">{t('admin.reportsApi.definitions.notAccounts')}</p>
            </>
          );
        }}
      </SummaryState>

      <RecordsTable
        title={t('admin.reportsApi.finance.records')}
        type="finance"
        params={params}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ field: 'date', dir: 'desc' }}
        searchPlaceholder={t('admin.reportsApi.finance.search')}
        emptyText={t('admin.reportsApi.finance.empty')}
        testId="ledger-records"
      />
    </>
  );
}
