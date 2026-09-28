import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCheck, FileSpreadsheet, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { EXPENSE_CATEGORIES } from '@/data/constants';
import { UPDATE_META } from '@/features/driver/updateMeta';
import { AddExpenseDialog } from '@/features/expenses/AddExpenseDialog';
import { ExpenseSheet, EXPENSE_STATUS_TONE } from '@/features/expenses/ExpenseSheet';
import { monthKey, todayISO } from '@/lib/dates';
import { exportXlsx } from '@/lib/exporters';
import { fmtDate, inr } from '@/lib/format';
import { cn, normalize, sum } from '@/lib/utils';
import { useApp } from '@/store';
import { useConnected } from '@/features/api/mode';
import { OperationsConnected } from './OperationsConnected';
import type { ExpenseCategory } from '@/types';
import { ConfirmDialog, DriverCell, FilterBar, PageHeader, Pagination, Panel, SearchInput, Table, TD, TH, TR, usePaged } from '../components/ui';
import { DATE_RANGES, inRange, type DateRange } from '../filters';
import { useSyncedData } from '../useAdminData';

function ExpensesDemo() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const drivers = useApp((s) => s.drivers);
  const vehicles = useApp((s) => s.vehicles);
  const { expenses } = useSyncedData();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [range, setRange] = useState<DateRange>(params.get('driver') || params.get('vehicle') || params.get('q') ? 'all' : 'month');
  const [category, setCategory] = useState<ExpenseCategory | ''>((params.get('category') as ExpenseCategory) ?? '');
  const [status, setStatus] = useState('');
  const [add, setAdd] = useState(false);
  const [approveAll, setApproveAll] = useState(false);
  const driverId = params.get('driver') ?? '';
  const vehicleId = params.get('vehicle') ?? '';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const month = monthKey(todayISO());
  const byCategory = useMemo(() => {
    const mo = expenses.filter((e) => monthKey(e.date) === month && e.status !== 'rejected');
    return EXPENSE_CATEGORIES.map((c) => ({ c, total: sum(mo.filter((e) => e.category === c), (e) => e.amount), count: mo.filter((e) => e.category === c).length }));
  }, [expenses, month]);
  const monthTotal = sum(byCategory, (x) => x.total);
  const colorOf = (c: ExpenseCategory) => {
    const i = byCategory.filter((x) => x.total > 0).findIndex((x) => x.c === c);
    return i < 0 ? 'hsl(var(--muted))' : `hsl(var(--chart-${(i % 6) + 1}))`;
  };

  const dName = (id: string) => drivers.find((d) => d.id === id)?.name ?? '';
  const reg = (id: string) => vehicles.find((v) => v.id === id)?.reg ?? '';
  const rows = useMemo(() => {
    const nq = normalize(q);
    return expenses
      .filter((e) => inRange(e.date, range))
      .filter((e) => !category || e.category === category)
      .filter((e) => !status || e.status === status)
      .filter((e) => !driverId || e.driverId === driverId)
      .filter((e) => !vehicleId || e.vehicleId === vehicleId)
      .filter((e) => !nq || normalize(`${dName(e.driverId)} ${reg(e.vehicleId)} ${e.note}`).includes(nq))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, q, range, category, status, driverId, vehicleId, drivers, vehicles]);
  const paged = usePaged(rows, 25, `${q}${range}${category}${status}${driverId}${vehicleId}`);
  const submitted = rows.filter((e) => e.status === 'submitted');

  const exportRows = async () => {
    const res = await exportXlsx(`expenses-${todayISO()}.xlsx`, [
      {
        name: t('admin.nav.expenses'),
        header: [t('admin.common.date'), t('admin.expenses.category'), t('admin.common.driver'), t('admin.common.vehicle'), `${t('admin.common.amount')} (₹)`, t('common.note'), t('admin.common.status')],
        widths: [12, 16, 22, 16, 14, 34, 14],
        rows: rows.map((e) => [e.date, t(`enum.category.${e.category}`), dName(e.driverId), reg(e.vehicleId), e.amount, e.note, t(`enum.expenseStatus.${e.status}`)]),
      },
    ]);
    if (res === 'saved') toast.success(t('admin.common.exported'));
  };

  return (
    <div>
      <PageHeader
        title={t('admin.expenses.title')}
        description={t('admin.expenses.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={exportRows}>
              <FileSpreadsheet />
              {t('admin.common.exportExcel')}
            </Button>
            <Button onClick={() => setAdd(true)}>
              <Plus />
              {t('admin.expenses.add')}
            </Button>
          </>
        }
      />
      <div className="panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">{t('admin.expenses.monthByCategory')}</p>
          <p className="figure text-xl font-bold">{inr(monthTotal)}</p>
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
          {byCategory
            .filter((x) => x.total > 0)
            .map((x) => (
              <span key={x.c} style={{ width: `${(x.total / monthTotal) * 100}%`, background: colorOf(x.c) }} title={t(`enum.category.${x.c}`)} />
            ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {byCategory.map((x) => {
            const meta = UPDATE_META[x.c];
            const Icon = meta.icon;
            const active = category === x.c;
            return (
              <button key={x.c} onClick={() => setCategory(active ? '' : x.c)} className={cn('rounded-lg border p-3 text-left transition-colors', active ? 'border-primary bg-primary/5' : 'hover:bg-accent/50')} aria-pressed={active} data-testid={`expense-cat-${x.c}`}>
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ background: colorOf(x.c) }} />
                  <Icon className="size-3.5" />
                  {t(`enum.category.${x.c}`)}
                </span>
                <span className="figure mt-1 block text-lg font-bold">{inr(x.total)}</span>
                <span className="text-xs text-muted-foreground">{t('admin.dashboard.entries', { count: x.count })}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Panel className="mt-6">
        <FilterBar
          active={Boolean(q || range !== 'month' || category || status || driverId || vehicleId)}
          onClear={() => {
            setQ('');
            setRange('month');
            setCategory('');
            setStatus('');
            setParams({}, { replace: true });
          }}
        >
          <SearchInput value={q} onChange={setQ} placeholder={t('admin.expenses.search')} className="w-full sm:w-72" />
          <NativeSelect value={range} onChange={(e) => setRange(e.target.value as DateRange)} className="w-auto min-w-[140px]" aria-label={t('admin.common.date')}>
            {DATE_RANGES.map((r) => (
              <option key={r} value={r}>
                {t(`admin.range.${r}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className="w-auto min-w-[140px]" aria-label={t('admin.expenses.category')}>
            <option value="">{t('admin.expenses.allCategories')}</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`enum.category.${c}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.common.status')}>
            <option value="">{t('admin.expenses.allStatus')}</option>
            {(['submitted', 'approved', 'rejected'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`enum.expenseStatus.${s}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={driverId} onChange={(e) => setParam('driver', e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.driver')}>
            <option value="">{t('admin.common.allDrivers')}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={vehicleId} onChange={(e) => setParam('vehicle', e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.vehicle')}>
            <option value="">{t('admin.common.allVehicles')}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.reg}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            {t('admin.common.records', { count: rows.length })} · <span className="figure font-semibold text-foreground">{inr(sum(rows, (e) => e.amount))}</span>
          </span>
          {submitted.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setApproveAll(true)}>
              <CheckCheck />
              {t('admin.expenses.approveAll', { count: submitted.length })}
            </Button>
          )}
        </div>
        <Table>
          <thead>
            <tr>
              <TH>{t('admin.common.date')}</TH>
              <TH>{t('admin.expenses.category')}</TH>
              <TH>{t('admin.common.driver')}</TH>
              <TH>{t('admin.common.vehicle')}</TH>
              <TH className="text-right">{t('admin.common.amount')}</TH>
              <TH>{t('common.note')}</TH>
              <TH>{t('admin.common.status')}</TH>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((e) => {
              const meta = UPDATE_META[e.category];
              const Icon = meta.icon;
              return (
                <TR key={e.id} onClick={() => setParam('expense', e.id)} data-testid="expense-row">
                  <TD className="whitespace-nowrap">{fmtDate(e.date, i18n.language, { day: 'numeric', month: 'short' })}</TD>
                  <TD className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <span className={cn('flex size-7 items-center justify-center rounded-md', meta.tint)}>
                        <Icon className="size-3.5" />
                      </span>
                      {t(`enum.category.${e.category}`)}
                    </span>
                  </TD>
                  <TD className="min-w-[170px]">{e.driverId ? <DriverCell driver={drivers.find((d) => d.id === e.driverId)} /> : <span className="text-muted-foreground">{t('admin.expenses.office')}</span>}</TD>
                  <TD>
                    <Plate reg={reg(e.vehicleId)} size="xs" />
                  </TD>
                  <TD className="figure text-right font-semibold">{inr(e.amount)}</TD>
                  <TD className="max-w-[240px] text-muted-foreground">
                    <span className="flex items-center gap-1.5 truncate">
                      {e.receipt && <Paperclip className="size-3.5 shrink-0" />}
                      <span className="truncate">{e.note}</span>
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={EXPENSE_STATUS_TONE[e.status]}>{t(`enum.expenseStatus.${e.status}`)}</Badge>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.common.noResults')}</p>}
        <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} onPage={paged.setPage} />
      </Panel>
      <AddExpenseDialog open={add} onOpenChange={setAdd} />
      <ExpenseSheet expenseId={params.get('expense')} onClose={() => setParam('expense', '')} />
      <ConfirmDialog
        open={approveAll}
        onOpenChange={setApproveAll}
        title={t('admin.expenses.approveAllTitle', { count: submitted.length })}
        description={t('admin.expenses.approveAllBody', { amount: inr(sum(submitted, (e) => e.amount)) })}
        confirmLabel={t('admin.expenses.approve')}
        onConfirm={() => {
          submitted.forEach((e) => useApp.getState().setExpenseStatus(e.id, 'approved'));
          toast.success(t('admin.expenses.approvedMany', { count: submitted.length }));
        }}
      />
    </div>
  );
}


/**
 * Demo mode keeps the approved prototype exactly as it was; connected mode reads the real
 * Phase 3 data from the API. Same route, no additional tabs.
 */
export function ExpensesPage() {
  return useConnected() ? <OperationsConnected /> : <ExpensesDemo />;
}
