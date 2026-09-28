import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDownRight, FileSpreadsheet, Fuel, ReceiptIndianRupee, ScrollText, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { todayISO } from '@/lib/dates';
import { exportXlsx } from '@/lib/exporters';
import { fmtDate, inr } from '@/lib/format';
import { paymentDate } from '@/lib/selectors';
import { normalize, sum } from '@/lib/utils';
import { useApp } from '@/store';
import { DriverCell, FilterBar, PageHeader, Pagination, Panel, SearchInput, StatCard, Table, TD, TH, TR, usePaged } from '../components/ui';
import { DATE_RANGES, inRange, type DateRange } from '../filters';
import { useSyncedData } from '../useAdminData';
import { useConnected } from '@/features/api/mode';
import { LedgerConnected } from './LedgerConnected';

export interface LedgerEntry {
  id: string;
  date: string;
  sourceType: 'fuel' | 'expense' | 'payment';
  categoryLabel: string;
  description: string;
  reference: string;
  driverId?: string;
  vehicleId?: string;
  partyName?: string;
  direction: 'DEBIT' | 'CREDIT';
  channel: string;
  amount: number;
  status: string;
}

function LedgerDemo() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const drivers = useApp((s) => s.drivers);
  const vehicles = useApp((s) => s.vehicles);
  const { fuel, expenses, payments } = useSyncedData();

  const [q, setQ] = useState(params.get('q') ?? '');
  const [range, setRange] = useState<DateRange>((params.get('range') as DateRange) ?? 'month');
  const [typeFilter, setTypeFilter] = useState(params.get('type') ?? '');
  const [directionFilter, setDirectionFilter] = useState(params.get('dir') ?? '');

  const driverName = (id?: string) => drivers.find((d) => d.id === id);
  const vehicleReg = (id?: string) => vehicles.find((v) => v.id === id)?.reg;

  // Unify fuel, expenses, and payments into a ledger view without modifying underlying models
  const allEntries = useMemo<LedgerEntry[]>(() => {
    const list: LedgerEntry[] = [];

    // Fuel entries (Debits)
    for (const f of fuel) {
      list.push({
        id: `fuel-${f.id}`,
        date: f.date,
        sourceType: 'fuel',
        categoryLabel: t(`enum.fuelType.${f.fuelType}`),
        description: `${f.station} · ${f.litres}L`,
        reference: f.id.slice(0, 8).toUpperCase(),
        driverId: f.driverId,
        vehicleId: f.vehicleId,
        partyName: f.station,
        direction: 'DEBIT',
        channel: 'Fuel Card / Pump',
        amount: f.amount,
        status: 'synced',
      });
    }

    // Expense entries (Debits)
    for (const e of expenses) {
      if (e.status === 'rejected') continue;
      list.push({
        id: `exp-${e.id}`,
        date: e.date,
        sourceType: 'expense',
        categoryLabel: t(`enum.category.${e.category}`),
        description: e.note || t(`enum.category.${e.category}`),
        reference: e.id.slice(0, 8).toUpperCase(),
        driverId: e.driverId,
        vehicleId: e.vehicleId,
        direction: 'DEBIT',
        channel: e.enteredBy === 'admin' ? 'Office Cash / Bank' : 'Driver Advance',
        amount: e.amount,
        status: e.status,
      });
    }

    // Payment entries (Debits to company, disbursements)
    for (const p of payments) {
      if (p.status === 'cancelled') continue;
      list.push({
        id: `pay-${p.id}`,
        date: paymentDate(p),
        sourceType: 'payment',
        categoryLabel: t(`enum.paymentType.${p.type}`),
        description: p.note || t(`enum.paymentType.${p.type}`),
        reference: p.reference || p.id.slice(0, 8).toUpperCase(),
        driverId: p.driverId,
        direction: 'DEBIT',
        channel: t(`enum.paymentMethod.${p.method}`),
        amount: p.amount,
        status: p.status,
      });
    }

    // Sort newest first
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [fuel, expenses, payments, t]);

  // Date filtered entries
  const dateFiltered = useMemo(() => allEntries.filter((item) => inRange(item.date, range)), [allEntries, range]);

  // Stats across the chosen date range
  const stats = useMemo(() => {
    const totalDebit = sum(dateFiltered, (x) => x.amount);
    const fuelSpend = sum(dateFiltered.filter((x) => x.sourceType === 'fuel'), (x) => x.amount);
    const expenseSpend = sum(dateFiltered.filter((x) => x.sourceType === 'expense'), (x) => x.amount);
    const paymentSpend = sum(dateFiltered.filter((x) => x.sourceType === 'payment'), (x) => x.amount);
    return { totalDebit, fuelSpend, expenseSpend, paymentSpend, totalCount: dateFiltered.length };
  }, [dateFiltered]);

  // Filtered rows by search, type, and direction
  const rows = useMemo(() => {
    const nq = normalize(q);
    return dateFiltered
      .filter((item) => !typeFilter || item.sourceType === typeFilter)
      .filter((item) => !directionFilter || item.direction === directionFilter)
      .filter((item) => {
        if (!nq) return true;
        const d = driverName(item.driverId)?.name ?? '';
        const v = vehicleReg(item.vehicleId) ?? '';
        return normalize(`${item.reference} ${item.description} ${item.categoryLabel} ${item.channel} ${item.partyName ?? ''} ${d} ${v}`).includes(nq);
      });
  }, [dateFiltered, q, typeFilter, directionFilter, drivers, vehicles]);

  const paged = usePaged(rows, 25);

  const exportData = async () => {
    const res = await exportXlsx(`ledger-${todayISO()}.xlsx`, [
      {
        name: t('admin.ledger.title'),
        header: [
          t('admin.common.date'),
          t('admin.common.type'),
          t('admin.ledger.entity'),
          t('admin.ledger.channel'),
          t('admin.ledger.direction'),
          `${t('admin.common.amount')} (₹)`,
          t('admin.common.status'),
        ],
        widths: [14, 16, 26, 18, 14, 14, 14],
        rows: rows.map((r) => [
          r.date,
          r.categoryLabel,
          driverName(r.driverId)?.name ?? r.partyName ?? r.description,
          r.channel,
          r.direction,
          r.amount,
          r.status,
        ]),
      },
    ]);
    if (res === 'saved') toast.success(t('admin.common.exported'));
  };

  return (
    <div>
      <PageHeader
        title={t('admin.ledger.title')}
        description={t('admin.ledger.subtitle')}
        actions={
          <Button variant="outline" onClick={exportData} disabled={rows.length === 0}>
            <FileSpreadsheet />
            {t('admin.common.exportExcel')}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('admin.ledger.totalDebits')} value={inr(stats.totalDebit)} sub={t('admin.common.records', { count: stats.totalCount })} icon={ScrollText} tone="danger" />
        <StatCard label={t('admin.ledger.fuelSpend')} value={inr(stats.fuelSpend)} icon={Fuel} tone="warning" />
        <StatCard label={t('admin.ledger.expensesTotal')} value={inr(stats.expenseSpend)} icon={ReceiptIndianRupee} tone="neutral" />
        <StatCard label={t('admin.ledger.payoutsTotal')} value={inr(stats.paymentSpend)} icon={Wallet} tone="primary" />
      </div>

      <div className="mt-6">
        <Panel>
          <FilterBar
            active={Boolean(q || range !== 'month' || typeFilter || directionFilter)}
            onClear={() => {
              setQ('');
              setRange('month');
              setTypeFilter('');
              setDirectionFilter('');
            }}
          >
            <SearchInput value={q} onChange={setQ} placeholder={t('admin.ledger.search')} className="w-full sm:w-72" />
            <NativeSelect value={range} onChange={(e) => setRange(e.target.value as DateRange)} className="w-auto min-w-[130px]" aria-label={t('admin.common.date')}>
              {DATE_RANGES.map((r) => (
                <option key={r} value={r}>
                  {t(`admin.range.${r}`)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.common.type')}>
              <option value="">{t('admin.ledger.allTypes')}</option>
              <option value="fuel">{t('admin.nav.fuel')}</option>
              <option value="expense">{t('admin.nav.expenses')}</option>
              <option value="payment">{t('admin.nav.payments')}</option>
            </NativeSelect>
            <NativeSelect value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.ledger.direction')}>
              <option value="">{t('admin.ledger.allDirections')}</option>
              <option value="DEBIT">{t('admin.ledger.debit')}</option>
              <option value="CREDIT">{t('admin.ledger.credit')}</option>
            </NativeSelect>
          </FilterBar>

          <Table>
            <thead>
              <tr>
                <TH>{t('admin.common.date')}</TH>
                <TH>{t('admin.ledger.entity')}</TH>
                <TH>{t('admin.common.type')}</TH>
                <TH>{t('admin.ledger.channel')}</TH>
                <TH>{t('admin.ledger.direction')}</TH>
                <TH className="text-right">{t('admin.common.amount')}</TH>
                <TH>{t('admin.common.status')}</TH>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((row) => {
                const d = driverName(row.driverId);
                const reg = vehicleReg(row.vehicleId);
                return (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(row.date)}</TD>
                    <TD className="min-w-[220px]">
                      {d ? (
                        <DriverCell driver={d} sub={reg ? `Vehicle: ${reg}` : row.description} link={false} />
                      ) : (
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            {reg && <Plate reg={reg} size="xs" />}
                            <span className="truncate">{row.partyName || row.description}</span>
                          </div>
                          <span className="figure text-xs text-muted-foreground">REF: {row.reference}</span>
                        </div>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={row.sourceType === 'fuel' ? 'warning' : row.sourceType === 'payment' ? 'success' : 'neutral'}>
                        {row.categoryLabel}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-sm text-muted-foreground">{row.channel}</TD>
                    <TD className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger">
                        <ArrowDownRight className="size-3.5" />
                        {row.direction}
                      </span>
                    </TD>
                    <TD className="figure text-right font-semibold text-danger">{inr(row.amount)}</TD>
                    <TD>
                      <Badge tone={row.status === 'paid' || row.status === 'approved' || row.status === 'synced' ? 'success' : 'warning'}>
                        {row.status}
                      </Badge>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>

          {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.ledger.empty')}</p>}

          <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} onPage={paged.setPage} />
        </Panel>
      </div>
    </div>
  );
}

/** Live data when the API is configured and an office user is signed in; the approved prototype otherwise. */
export function LedgerPage() {
  return useConnected() ? <LedgerConnected /> : <LedgerDemo />;
}
