import { useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDownRight, ArrowUpRight, FileSpreadsheet, FileText, Fuel, Hourglass, Pencil, Plus, ScrollText, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { canManageFinance, useSession } from '@/features/api/session';
import { financeApi, type LedgerFilters } from '@/features/api/resources';
import type { ApiLedgerEntry, ApiLedgerType } from '@/features/api/types';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { ManualEntryDialog, ManualEntrySheet } from '@/features/finance/LedgerEntryDialogs';
import { CursorPager, financialYearOptions, money, PaymentStatusBadge, paiseToRupees, toPaise, useCursorPages } from '@/features/finance/shared';
import { todayISO } from '@/lib/dates';
import { exportPdf, exportXlsx } from '@/lib/exporters';
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
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [adding, setAdding] = useState(false);
  const search = useDebounced(q);
  const user = useSession((s) => s.user);
  const mayEdit = canManageFinance(user?.role);

  // A custom period and the open entry live in the address, so a dashboard card can open this
  // screen on the same days, and a link to an entry can be shared.
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const openEntry = params.get('entry');
  // Built from the latest address (kept in a ref: react-router hands updaters this render's
  // params), so two quick changes — from, then to — never overwrite each other.
  const latestParams = useRef(params);
  latestParams.current = params;
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(latestParams.current);
    if (value) next.set(key, value);
    else next.delete(key);
    latestParams.current = next;
    setParams(next, { replace: true });
  };

  // Explicit days win over the financial year (the API applies the same rule).
  const filters: LedgerFilters = {
    ...(from || to ? { from: from || undefined, to: to || undefined } : { fy }),
    q: search.trim() || undefined,
    type: type || undefined,
    direction: direction || undefined,
  };
  const filterKey = JSON.stringify(filters);
  const pages = useCursorPages(filterKey);

  const summary = useApiResource(() => financeApi.summary(fy), [fy]);
  const ledger = useApiResource(() => financeApi.ledger({ ...filters, limit: PAGE_SIZE, cursor: pages.cursor }), [filterKey, pages.cursor]);
  const nextCursor = ledger.data?.page.nextCursor ?? null;

  const payroll = summary.data ? paiseToRupees((toPaise(summary.data.salaries) ?? 0) + (toPaise(summary.data.advances) ?? 0)) : null;
  const hasIncome = summary.data ? Number(summary.data.totalIncome) > 0 : false;

  const periodLabel = from || to ? `${from ? fmtDate(from) : '…'} – ${to ? fmtDate(to) : '…'}` : (years.find((y) => y.code === fy)?.label ?? fy);

  /** Every line matching the filters (not just this page), up to the export cap. */
  const allRows = async () => {
    const rows: ApiLedgerEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await financeApi.ledger({ ...filters, limit: 100, cursor });
      rows.push(...page.data);
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor && rows.length < EXPORT_CAP);
    if (cursor) toast.warning(t('admin.financeApi.exportTruncated', { count: EXPORT_CAP }));
    return rows;
  };
  const party = (r: ApiLedgerEntry) => [r.vehicle?.registrationNumber, r.employee?.fullName].filter(Boolean).join(' · ');
  const methodOf = (r: ApiLedgerEntry) => (r.manual?.paymentMethod ? t(`admin.enum.paymentMethod.${r.manual.paymentMethod}`) : r.payment ? t(`admin.enum.paymentMethod.${r.payment.method}`) : '');

  const exportData = async (format: 'xlsx' | 'pdf') => {
    setExporting(format);
    try {
      const rows = await allRows();
      const stamp = from || to ? `${from || 'start'}-to-${to || todayISO()}` : fy;
      const result =
        format === 'xlsx'
          ? await exportXlsx(`ledger-${stamp}-${todayISO()}.xlsx`, [
              {
                name: t('admin.ledger.title'),
                header: [
                  t('admin.common.date'), t('admin.common.type'), t('admin.ledger.entity'), t('admin.financeApi.source'),
                  t('admin.ledger.direction'), `${t('admin.common.amount')} (₹)`, t('admin.paymentsApi.description'),
                  t('admin.payments.method'), t('admin.paymentsApi.reference'), t('admin.paymentsApi.remarks'),
                ],
                widths: [12, 18, 26, 18, 12, 14, 32, 16, 20, 30],
                rows: rows.map((r) => [
                  r.date, t(`admin.enum.ledgerType.${r.type}`), party(r), t(`admin.enum.ledgerSource.${r.sourceType}`),
                  t(`admin.enum.ledgerDirection.${r.direction}`), Number(r.amount), r.description ?? '',
                  methodOf(r), r.manual?.reference ?? '', r.manual?.remarks ?? '',
                ]),
              },
            ])
          : await exportPdf(`gangamata-ledger-${stamp}.pdf`, {
              company: 'Gangamata Transport',
              title: t('admin.ledger.title'),
              subtitle: periodLabel,
              generated: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
              footer: 'Gangamata Transport',
              sections: [
                {
                  heading: periodLabel,
                  head: [t('admin.common.date'), t('admin.common.type'), t('admin.ledger.entity'), t('admin.paymentsApi.description'), t('admin.ledger.direction'), t('admin.common.amount')],
                  numeric: [5],
                  body: rows.map((r) => [
                    fmtDate(r.date), t(`admin.enum.ledgerType.${r.type}`), party(r) || '-', r.description ?? '-',
                    t(`admin.enum.ledgerDirection.${r.direction}`), `Rs ${Number(r.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
                  ]),
                  foot: ledger.data
                    ? ['', '', '', t('admin.financeApi.filteredTotalsShort'), '', `Rs ${Number(ledger.data.totals.expense).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / Rs ${Number(ledger.data.totals.income).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`]
                    : undefined,
                },
              ],
            });
      if (result === 'saved') toast.success(t('admin.common.exported'));
      else if (result === 'failed') toast.error(t('common.somethingWrong'));
    } catch {
      toast.error(t('common.somethingWrong'));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('admin.ledger.title')}
        description={t('admin.ledger.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={fy} onChange={(e) => setFy(e.target.value)} disabled={Boolean(from || to)} className="w-auto min-w-[130px]" aria-label={t('admin.financeApi.fy')}>
              {years.map((y) => (
                <option key={y.code} value={y.code}>{y.label}</option>
              ))}
            </NativeSelect>
            <Button variant="outline" onClick={() => void exportData('pdf')} disabled={exporting !== null || (ledger.data?.data.length ?? 0) === 0}>
              <FileText />
              {exporting === 'pdf' ? t('common.loading') : t('admin.common.exportPdf')}
            </Button>
            <Button variant="outline" onClick={() => void exportData('xlsx')} disabled={exporting !== null || (ledger.data?.data.length ?? 0) === 0}>
              <FileSpreadsheet />
              {exporting === 'xlsx' ? t('common.loading') : t('admin.common.exportExcel')}
            </Button>
            {mayEdit && (
              <Button onClick={() => setAdding(true)} data-testid="ledger-add">
                <Plus />
                {t('admin.ledgerEdit.add')}
              </Button>
            )}
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
            active={Boolean(q || type || direction || from || to)}
            onClear={() => {
              setQ('');
              setType('');
              setDirection('');
              const next = new URLSearchParams(params);
              next.delete('from');
              next.delete('to');
              setParams(next, { replace: true });
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
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setParam('from', e.target.value || null)} className="w-auto" aria-label={t('admin.reportsApi.period.from')} />
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setParam('to', e.target.value || null)} className="w-auto" aria-label={t('admin.reportsApi.period.to')} />
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
                    <TH className="relative w-10"><span className="sr-only">{t('admin.common.actions')}</span></TH>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.data?.data ?? []).map((row) => {
                    const expense = row.direction === 'EXPENSE';
                    return (
                      <TR
                        key={row.id}
                        className={row.reversed || row.isReversal ? 'opacity-70' : undefined}
                        onClick={row.manual ? () => setParam('entry', row.manual!.id) : undefined}
                      >
                        <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(row.date)}</TD>
                        <TD className="min-w-[220px]">
                          <div className="flex items-center gap-2 font-medium">
                            {row.vehicle && <Plate reg={row.vehicle.registrationNumber} size="xs" />}
                            {row.employee && <span className="truncate">{row.employee.fullName}</span>}
                          </div>
                          {row.description && <p className="truncate text-xs text-muted-foreground">{row.description}</p>}
                          {row.manual?.reference && <p className="truncate font-mono text-xs text-muted-foreground">{row.manual.reference}</p>}
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
                        <TD>
                          {row.manual && mayEdit && !row.isReversal && (
                            <Button variant="ghost" size="icon-sm" aria-label={t('admin.ledgerEdit.open')} onClick={(e) => { e.stopPropagation(); setParam('entry', row.manual!.id); }}>
                              <Pencil />
                            </Button>
                          )}
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

      <ManualEntryDialog
        entry={null}
        open={adding}
        onOpenChange={setAdding}
        onSaved={(id) => {
          setAdding(false);
          summary.reload();
          ledger.reload();
          setParam('entry', id);
        }}
      />
      <ManualEntrySheet
        entryId={openEntry}
        onClose={() => setParam('entry', null)}
        onChanged={() => {
          summary.reload();
          ledger.reload();
        }}
      />
    </div>
  );
}
