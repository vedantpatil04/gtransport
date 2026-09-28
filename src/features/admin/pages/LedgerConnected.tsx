import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownRight, ArrowUpRight, FileSpreadsheet, Fuel, Hourglass, ScrollText, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { financeApi, type LedgerFilters } from '@/features/api/resources';
import type { ApiLedgerEntry, ApiLedgerType } from '@/features/api/types';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { CursorPager, financialYearOptions, money, PaymentStatusBadge, paiseToRupees, toPaise, useCursorPages } from '@/features/finance/shared';
import { todayISO } from '@/lib/dates';
import { exportXlsx } from '@/lib/exporters';
import { fmtDate } from '@/lib/format';
import { FilterBar, PageHeader, Panel, SearchInput, StatCard, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';

const TYPES: ApiLedgerType[] = [
  'FUEL', 'RTO', 'TYRE', 'TYRE_INSURANCE', 'MAINTENANCE', 'SALARY', 'ADVANCE', 'ALLOWANCE', 'OTHER_PAYMENT', 'EMI', 'CUSTOMER_PAYMENT', 'OTHER_INCOME', 'OTHER_EXPENSE',
];
const PAGE_SIZE = 50;
const EXPORT_CAP = 10_000;

/** Negative amounts are corrections; show them with a real minus sign. */
const signed = (amount: string) => (amount.startsWith('-') ? `− ${money(amount.slice(1))}` : money(amount));

/**
 * The live ledger: every fuel entry, vehicle expense, salary, advance, payment and EMI as an
 * append-only line. Totals come from the server for the whole filter, never just this page.
 */
export function LedgerConnected() {
  const { t } = useTranslation();
  const years = useMemo(financialYearOptions, []);
  const [fy, setFy] = useState(years[0]?.code ?? '');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [direction, setDirection] = useState('');
  const [exporting, setExporting] = useState(false);
  const search = useDebounced(q);

  const filters: LedgerFilters = { fy, q: search.trim() || undefined, type: type || undefined, direction: direction || undefined };
  const filterKey = JSON.stringify(filters);
  const pages = useCursorPages(filterKey);

  const summary = useApiResource(() => financeApi.summary(fy), [fy]);
  const ledger = useApiResource(() => financeApi.ledger({ ...filters, limit: PAGE_SIZE, cursor: pages.cursor }), [filterKey, pages.cursor]);
  const nextCursor = ledger.data?.page.nextCursor ?? null;

  const payroll = summary.data ? paiseToRupees((toPaise(summary.data.salaries) ?? 0) + (toPaise(summary.data.advances) ?? 0)) : null;
  const hasIncome = summary.data ? Number(summary.data.totalIncome) > 0 : false;

  const exportData = async () => {
    setExporting(true);
    try {
      const rows: ApiLedgerEntry[] = [];
      let cursor: string | undefined;
      do {
        const page = await financeApi.ledger({ ...filters, limit: 100, cursor });
        rows.push(...page.data);
        cursor = page.page.nextCursor ?? undefined;
      } while (cursor && rows.length < EXPORT_CAP);
      const result = await exportXlsx(`ledger-${fy}-${todayISO()}.xlsx`, [
        {
          name: t('admin.ledger.title'),
          header: [
            t('admin.common.date'), t('admin.common.type'), t('admin.ledger.entity'), t('admin.financeApi.source'),
            t('admin.ledger.direction'), `${t('admin.common.amount')} (₹)`, t('admin.paymentsApi.description'),
          ],
          widths: [12, 18, 26, 18, 12, 14, 32],
          rows: rows.map((r) => [
            r.date,
            t(`admin.enum.ledgerType.${r.type}`),
            r.employee?.fullName ?? r.vehicle?.registrationNumber ?? '',
            t(`admin.enum.ledgerSource.${r.sourceType}`),
            t(`admin.enum.ledgerDirection.${r.direction}`),
            Number(r.amount),
            r.description ?? '',
          ]),
        },
      ]);
      if (cursor) toast.warning(t('admin.financeApi.exportTruncated', { count: EXPORT_CAP }));
      if (result === 'saved') toast.success(t('admin.common.exported'));
    } catch {
      toast.error(t('common.somethingWrong'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('admin.ledger.title')}
        description={t('admin.ledger.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <NativeSelect value={fy} onChange={(e) => setFy(e.target.value)} className="w-auto min-w-[130px]" aria-label={t('admin.financeApi.fy')}>
              {years.map((y) => (
                <option key={y.code} value={y.code}>{y.label}</option>
              ))}
            </NativeSelect>
            <Button variant="outline" onClick={exportData} disabled={exporting || (ledger.data?.data.length ?? 0) === 0}>
              <FileSpreadsheet />
              {t('admin.common.exportExcel')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('admin.financeApi.totalExpenses')}
          value={summary.data ? money(summary.data.totalExpenses) : '—'}
          sub={hasIncome && summary.data ? t('admin.financeApi.incomeSub', { amount: money(summary.data.totalIncome) }) : summary.data?.financialYear}
          icon={ScrollText}
          tone="danger"
        />
        <StatCard label={t('admin.financeApi.fuel')} value={summary.data ? money(summary.data.fuel) : '—'} icon={Fuel} tone="warning" />
        <StatCard label={t('admin.financeApi.payroll')} value={payroll ? money(payroll) : '—'} icon={Wallet} tone="primary" />
        <StatCard
          label={t('admin.financeApi.pendingPayments')}
          value={summary.data ? money(summary.data.pendingPayments.amount) : '—'}
          sub={summary.data ? t('admin.financeApi.pendingSub', { count: summary.data.pendingPayments.count }) : undefined}
          icon={Hourglass}
          tone="neutral"
        />
      </div>

      <div className="mt-6">
        <Panel>
          <FilterBar
            active={Boolean(q || type || direction)}
            onClear={() => {
              setQ('');
              setType('');
              setDirection('');
            }}
          >
            <SearchInput value={q} onChange={setQ} placeholder={t('admin.ledger.search')} className="w-full sm:w-72" />
            <NativeSelect value={type} onChange={(e) => setType(e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.type')}>
              <option value="">{t('admin.ledger.allTypes')}</option>
              {TYPES.map((k) => (
                <option key={k} value={k}>{t(`admin.enum.ledgerType.${k}`)}</option>
              ))}
            </NativeSelect>
            <NativeSelect value={direction} onChange={(e) => setDirection(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.ledger.direction')}>
              <option value="">{t('admin.ledger.allDirections')}</option>
              <option value="EXPENSE">{t('admin.enum.ledgerDirection.EXPENSE')}</option>
              <option value="INCOME">{t('admin.enum.ledgerDirection.INCOME')}</option>
            </NativeSelect>
          </FilterBar>

          {ledger.loading ? (
            <TableLoading rows={6} columns={6} />
          ) : ledger.error ? (
            <ErrorState error={ledger.error} onRetry={ledger.reload} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('admin.common.date')}</TH>
                    <TH>{t('admin.ledger.entity')}</TH>
                    <TH>{t('admin.common.type')}</TH>
                    <TH>{t('admin.financeApi.source')}</TH>
                    <TH>{t('admin.ledger.direction')}</TH>
                    <TH className="text-right">{t('admin.common.amount')}</TH>
                    <TH>{t('admin.common.status')}</TH>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.data?.data ?? []).map((row) => {
                    const expense = row.direction === 'EXPENSE';
                    return (
                      <TR key={row.id} className={row.reversed || row.isReversal ? 'opacity-70' : undefined}>
                        <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(row.date)}</TD>
                        <TD className="min-w-[220px]">
                          <div className="flex items-center gap-2 font-medium">
                            {row.vehicle && <Plate reg={row.vehicle.registrationNumber} size="xs" />}
                            {row.employee && <span className="truncate">{row.employee.fullName}</span>}
                          </div>
                          {row.description && <p className="truncate text-xs text-muted-foreground">{row.description}</p>}
                        </TD>
                        <TD>
                          <Badge tone={row.type === 'FUEL' ? 'warning' : row.type === 'SALARY' || row.type === 'ADVANCE' ? 'success' : 'neutral'}>
                            {t(`admin.enum.ledgerType.${row.type}`)}
                          </Badge>
                        </TD>
                        <TD className="whitespace-nowrap text-sm text-muted-foreground">{t(`admin.enum.ledgerSource.${row.sourceType}`)}</TD>
                        <TD className="whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${expense ? 'text-danger' : 'text-success'}`}>
                            {expense ? <ArrowDownRight className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                            {t(`admin.enum.ledgerDirection.${row.direction}`)}
                          </span>
                        </TD>
                        <TD className={`figure whitespace-nowrap text-right font-semibold ${expense ? 'text-danger' : 'text-success'}`}>{signed(row.amount)}</TD>
                        <TD>
                          <div className="flex flex-wrap gap-1">
                            {row.isReversal && <Badge tone="neutral">{t('admin.financeApi.correction')}</Badge>}
                            {row.reversed && <Badge tone="neutral">{t('admin.financeApi.reversed')}</Badge>}
                            {row.payment && <PaymentStatusBadge status={row.payment.status} />}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>

              {(ledger.data?.data.length ?? 0) === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.financeApi.ledgerEmpty')}</p>}

              {ledger.data && ledger.data.data.length > 0 && (
                <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                  {t('admin.financeApi.filteredTotals', { expense: money(ledger.data.totals.expense), income: money(ledger.data.totals.income) })}
                </p>
              )}
              <CursorPager index={pages.index} nextCursor={nextCursor} onPrev={pages.prev} onNext={() => pages.next(nextCursor)} />
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
