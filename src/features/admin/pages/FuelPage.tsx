import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Droplets, FileSpreadsheet, Fuel, ImageIcon, ListOrdered, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { FUEL_BRANDS } from '@/data/constants';
import { FuelEntrySheet } from '@/features/fuel/FuelEntrySheet';
import { monthKey, todayISO } from '@/lib/dates';
import { exportXlsx } from '@/lib/exporters';
import { fmtDate, fmtTime, inr, num } from '@/lib/format';
import { normalize, sum } from '@/lib/utils';
import { useApp } from '@/store';
import { useConnected } from '@/features/api/mode';
import { FuelConnected } from './FuelConnected';
import { DriverCell, FilterBar, PageHeader, Pagination, Panel, SearchInput, StatCard, Table, TD, TH, TR, usePaged } from '../components/ui';
import { DATE_RANGES, inRange, type DateRange } from '../filters';
import { useSyncedData } from '../useAdminData';

function FuelDemo() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const drivers = useApp((s) => s.drivers);
  const vehicles = useApp((s) => s.vehicles);
  const pendingOnPhones = useApp((s) => s.fuel.filter((f) => f.sync === 'pending').length);
  const { fuel } = useSyncedData();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [range, setRange] = useState<DateRange>(params.get('driver') || params.get('vehicle') || params.get('q') ? 'all' : 'month');
  const [fuelType, setFuelType] = useState('');
  const [brand, setBrand] = useState('');
  const driverId = params.get('driver') ?? '';
  const vehicleId = params.get('vehicle') ?? '';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const today = todayISO();
  const month = monthKey(today);
  const stats = useMemo(() => {
    const td = fuel.filter((f) => f.date === today);
    const mo = fuel.filter((f) => monthKey(f.date) === month);
    return { today: sum(td, (f) => f.amount), todayCount: td.length, month: sum(mo, (f) => f.amount), monthLitres: sum(mo, (f) => f.litres), monthCount: mo.length, total: fuel.length };
  }, [fuel, today, month]);

  const dName = (id: string) => drivers.find((d) => d.id === id)?.name ?? '';
  const reg = (id: string) => vehicles.find((v) => v.id === id)?.reg ?? '';
  const rows = useMemo(() => {
    const nq = normalize(q);
    return fuel
      .filter((f) => inRange(f.date, range))
      .filter((f) => !driverId || f.driverId === driverId)
      .filter((f) => !vehicleId || f.vehicleId === vehicleId)
      .filter((f) => !fuelType || f.fuelType === fuelType)
      .filter((f) => !brand || f.station.startsWith(brand))
      .filter((f) => !nq || normalize(`${dName(f.driverId)} ${reg(f.vehicleId)} ${f.station}`).includes(nq))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuel, q, range, driverId, vehicleId, fuelType, brand, drivers, vehicles]);
  const paged = usePaged(rows, 25, `${q}${range}${driverId}${vehicleId}${fuelType}${brand}`);
  const active = Boolean(q || range !== 'month' || driverId || vehicleId || fuelType || brand);

  const exportRows = async () => {
    const res = await exportXlsx(`fuel-entries-${today}.xlsx`, [
      {
        name: t('admin.nav.fuel'),
        header: [t('admin.common.date'), t('admin.common.driver'), t('admin.common.vehicle'), t('admin.fuel.type'), `${t('admin.common.amount')} (₹)`, t('admin.fuel.litres'), t('admin.fuel.station'), t('admin.fuel.receipt')],
        widths: [12, 22, 16, 10, 14, 10, 34, 10],
        rows: rows.map((f) => [f.date, dName(f.driverId), reg(f.vehicleId), t(`enum.fuelType.${f.fuelType}`), f.amount, f.litres, f.station, f.receipt ? t('common.yes') : t('common.no')]),
      },
    ]);
    if (res === 'saved') toast.success(t('admin.common.exported'));
    else if (res === 'failed') toast.error(t('common.somethingWrong'));
  };

  return (
    <div>
      <PageHeader
        title={t('admin.fuel.title')}
        description={t('admin.fuel.subtitle')}
        actions={
          <Button variant="outline" onClick={exportRows}>
            <FileSpreadsheet />
            {t('admin.common.exportExcel')}
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard hero label={t('admin.fuel.today')} value={inr(stats.today)} icon={Fuel} sub={t('admin.dashboard.fuelUpdates', { count: stats.todayCount })} className="col-span-2 lg:col-span-1" />
        <StatCard label={t('admin.fuel.month')} value={inr(stats.month)} icon={CalendarDays} sub={t('admin.dashboard.fuelUpdates', { count: stats.monthCount })} />
        <StatCard label={t('admin.fuel.litresMonth')} value={num(stats.monthLitres, 0)} icon={Droplets} sub={inr(stats.monthLitres ? stats.month / stats.monthLitres : 0, true) + ' / L'} />
        <StatCard label={t('admin.fuel.entries')} value={num(stats.total, 0)} icon={ListOrdered} sub={pendingOnPhones ? t('admin.fuel.waitingSync', { count: pendingOnPhones }) : t('admin.fuel.allSynced')} />
      </div>

      <Panel className="mt-6">
        <FilterBar
          active={active}
          onClear={() => {
            setQ('');
            setRange('month');
            setFuelType('');
            setBrand('');
            setParams({}, { replace: true });
          }}
        >
          <SearchInput value={q} onChange={setQ} placeholder={t('admin.fuel.search')} className="w-full sm:w-72" />
          <NativeSelect value={range} onChange={(e) => setRange(e.target.value as DateRange)} className="w-auto min-w-[140px]" aria-label={t('admin.common.date')}>
            {DATE_RANGES.map((r) => (
              <option key={r} value={r}>
                {t(`admin.range.${r}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={driverId} onChange={(e) => setParam('driver', e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.driver')} data-testid="fuel-filter-driver">
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
          <NativeSelect value={fuelType} onChange={(e) => setFuelType(e.target.value)} className="w-auto min-w-[120px]" aria-label={t('admin.fuel.type')}>
            <option value="">{t('admin.fuel.allTypes')}</option>
            <option value="petrol">{t('enum.fuelType.petrol')}</option>
            <option value="diesel">{t('enum.fuelType.diesel')}</option>
          </NativeSelect>
          <NativeSelect value={brand} onChange={(e) => setBrand(e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.fuel.station')}>
            <option value="">{t('admin.fuel.allStations')}</option>
            {FUEL_BRANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>
        <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
          <span className="text-muted-foreground">{t('admin.common.records', { count: rows.length })}</span>
          <span className="figure font-semibold">
            {inr(sum(rows, (f) => f.amount))} · {t('units.litresShort', { value: num(sum(rows, (f) => f.litres), 0) })}
          </span>
        </div>
        <Table>
          <thead>
            <tr>
              <TH>{t('admin.common.driver')}</TH>
              <TH>{t('admin.common.vehicle')}</TH>
              <TH>{t('admin.fuel.type')}</TH>
              <TH className="text-right">{t('admin.common.amount')}</TH>
              <TH className="text-right">{t('admin.fuel.litres')}</TH>
              <TH>{t('admin.fuel.station')}</TH>
              <TH>{t('admin.common.date')}</TH>
              <TH className="text-center">{t('admin.fuel.receipt')}</TH>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((f) => (
              <TR key={f.id} onClick={() => setParam('entry', f.id)} data-testid="fuel-row">
                <TD className="min-w-[180px]">
                  <DriverCell driver={drivers.find((d) => d.id === f.driverId)} />
                </TD>
                <TD>
                  <Plate reg={reg(f.vehicleId)} size="xs" />
                </TD>
                <TD>
                  <Badge tone={f.fuelType === 'petrol' ? 'success' : 'info'}>{t(`enum.fuelType.${f.fuelType}`)}</Badge>
                </TD>
                <TD className="figure text-right font-semibold">{inr(f.amount)}</TD>
                <TD className="figure text-right">{num(f.litres, 2)}</TD>
                <TD className="max-w-[240px] truncate text-muted-foreground">{f.station}</TD>
                <TD className="whitespace-nowrap">
                  {fmtDate(f.date, i18n.language, { day: 'numeric', month: 'short' })}
                  <span className="ml-1.5 text-xs text-muted-foreground">{fmtTime(f.createdAt, i18n.language)}</span>
                </TD>
                <TD className="text-center">
                  {f.receipt ? (
                    f.receipt.kind === 'generated' ? (
                      <ReceiptText className="mx-auto size-4 text-success" aria-label={t('common.yes')} />
                    ) : (
                      <ImageIcon className="mx-auto size-4 text-success" aria-label={t('common.yes')} />
                    )
                  ) : (
                    <span className="text-muted-foreground/60" aria-label={t('common.no')}>
                      —
                    </span>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.common.noResults')}</p>}
        <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} onPage={paged.setPage} />
      </Panel>
      <FuelEntrySheet entryId={params.get('entry')} onClose={() => setParam('entry', '')} />
    </div>
  );
}


/**
 * Demo mode keeps the approved prototype exactly as it was; connected mode reads the real
 * Phase 3 data from the API. Same route, no additional tabs.
 */
export function FuelPage() {
  return useConnected() ? <FuelConnected /> : <FuelDemo />;
}
