import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, CalendarDays, Droplets, FileSpreadsheet, FileText, Fuel, Gauge, ImageIcon, MoreHorizontal, Pencil, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { driversApi, fuelApi, vehiclesApi, type FuelFilters } from '@/features/api/resources';
import { canManageFinance, canManageFleet, useSession } from '@/features/api/session';
import type { ApiFuelEntry, ApiFuelPeriod } from '@/features/api/types';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { exportPdf, exportXlsx } from '@/lib/exporters';
import { fmtDate, inr, num } from '@/lib/format';
import { FilterBar, PageHeader, Panel, SearchInput, StatCard, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';
import { ReceiptViewer } from '../components/ReceiptViewer';
import { ArchiveDialog } from '../components/ArchiveDialog';
import { FuelEditDialog } from '../../fuel/FuelEditDialog';

/** Financial years offered in the statement: the current one and the five before it. */
function financialYearOptions(): { code: string; label: string }[] {
  const now = new Date();
  const current = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 6 }, (_, i) => {
    const start = current - i;
    const end = String((start + 1) % 100).padStart(2, '0');
    return { code: `${start}-${end}`, label: `FY ${start}–${end}` };
  });
}

const PAGE_SIZE = 50;
type Period = 'today' | 'month' | 'financialYear';

export function FuelConnected() {
  const { t, i18n } = useTranslation();
  const role = useSession((s) => s.user?.role);
  const mayEdit = canManageFleet(role) || canManageFinance(role);
  const years = useMemo(financialYearOptions, []);

  const [period, setPeriod] = useState<Period>('financialYear');
  const [fy, setFy] = useState(years[0]?.code ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [fuelType, setFuelType] = useState('');
  const [station, setStation] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [receipt, setReceipt] = useState<ApiFuelEntry | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ApiFuelEntry | null>(null);
  const [editing, setEditing] = useState<ApiFuelEntry | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

  const stationSearch = useDebounced(station);
  const filters: FuelFilters = {
    // Explicit dates override the financial year; otherwise the statement is the selected FY.
    ...(from || to ? { from: from || undefined, to: to || undefined } : { fy }),
    driverId: driverId || undefined,
    vehicleId: vehicleId || undefined,
    fuelType: fuelType || undefined,
    station: stationSearch || undefined,
    status: showArchived ? 'ARCHIVED' : undefined,
  };
  const filterKey = JSON.stringify(filters);

  const summary = useApiResource(() => fuelApi.summary(), []);
  const drivers = useApiResource(() => driversApi.list({ limit: 100 }), []);
  const vehicles = useApiResource(() => vehiclesApi.list({ limit: 100 }), []);
  const statement = useApiResource(
    () => fuelApi.list({ ...filters, limit: PAGE_SIZE, cursor: cursors[pageIndex] }),
    [filterKey, cursors[pageIndex]],
  );

  const resetPaging = () => {
    setCursors([undefined]);
    setPageIndex(0);
  };
  const setFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    resetPaging();
  };

  const rows = statement.data?.data ?? [];
  const totals = statement.data?.totals;
  const nextCursor = statement.data?.page.nextCursor ?? null;
  const filtersActive = Boolean(from || to || driverId || vehicleId || fuelType || station || showArchived);
  const selected: ApiFuelPeriod | undefined = summary.data?.[period];
  const periodTitle = selected
    ? period === 'financialYear'
      ? summary.data?.financialYear.label ?? ''
      : t(period === 'today' ? 'admin.fuel.today' : 'admin.fuel.month')
    : '';

  const statementTitle = from || to ? `${from ? fmtDate(from) : '…'} – ${to ? fmtDate(to) : '…'}` : years.find((y) => y.code === fy)?.label ?? '';

  const doExport = async (kind: 'pdf' | 'xlsx') => {
    setExporting(kind);
    try {
      const { rows: all, totals: allTotals, truncated } = await fuelApi.all(filters);
      if (truncated) toast.warning(t('admin.fuelApi.exportTruncated'));

      const header = [
        t('admin.common.date'), t('admin.common.vehicle'), t('admin.common.driver'), t('admin.fuel.type'),
        t('admin.fuel.litres'), t('admin.fuelApi.rate'), `${t('admin.common.amount')} (₹)`, t('admin.fuel.station'),
      ];
      const typeLabel = (type: string) => t(`enum.fuelType.${type.toLowerCase()}`);
      const stamp = new Date().toISOString().slice(0, 10);

      if (kind === 'xlsx') {
        const res = await exportXlsx(`gangamata-fuel-statement-${fy || stamp}.xlsx`, [
          {
            name: t('admin.fuelApi.statement'),
            header,
            widths: [12, 16, 22, 10, 10, 12, 14, 30],
            rows: [
              ...all.map((e) => [
                e.transactionDate, e.vehicle.registrationNumber, e.driver.fullName, typeLabel(e.fuelType),
                Number(e.litres), e.ratePerLitre ? Number(e.ratePerLitre) : null, Number(e.amount), e.fuelStation,
              ]),
              // Totals row: the average is total amount ÷ total litres, as the API computes it.
              [
                t('admin.fuelApi.totals'), '', '', '', Number(allTotals.litres),
                allTotals.averageRate ? Number(allTotals.averageRate) : null, Number(allTotals.amount), '',
              ],
            ],
          },
        ]);
        if (res === 'failed') toast.error(t('common.somethingWrong'));
        else if (res === 'saved') toast.success(t('admin.common.exported'));
      } else {
        const res = await exportPdf(`gangamata-fuel-statement-${fy || stamp}.pdf`, {
          company: 'Gangamata Transport',
          title: t('admin.fuelApi.statement'),
          subtitle: statementTitle,
          generated: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          footer: 'Gangamata Transport',
          sections: [
            {
              heading: statementTitle,
              head: header,
              numeric: [4, 5, 6],
              body: all.map((e) => [
                fmtDate(e.transactionDate), e.vehicle.registrationNumber, e.driver.fullName, typeLabel(e.fuelType),
                num(Number(e.litres), 2), e.ratePerLitre ? `Rs ${e.ratePerLitre}` : '-',
                `Rs ${Number(e.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, e.fuelStation,
              ]),
              foot: [
                t('admin.fuelApi.totals'), '', '', '', num(Number(allTotals.litres), 2),
                allTotals.averageRate ? `Rs ${allTotals.averageRate}` : '-',
                `Rs ${Number(allTotals.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, '',
              ],
            },
          ],
        });
        if (res === 'failed') toast.error(t('common.somethingWrong'));
        else if (res === 'saved') toast.success(t('admin.common.exported'));
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
    } finally {
      setExporting(null);
    }
  };

  const confirmArchive = async (reason: string) => {
    if (!archiveTarget) return;
    try {
      await fuelApi.archive(archiveTarget.id, reason);
      toast.success(t('admin.fuelApi.archived'));
      statement.reload();
      summary.reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
    } finally {
      setArchiveTarget(null);
    }
  };

  const restore = async (entry: ApiFuelEntry) => {
    try {
      await fuelApi.restore(entry.id);
      toast.success(t('admin.fuelApi.restored'));
      statement.reload();
      summary.reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
    }
  };

  return (
    <div>
      <PageHeader
        title={t('admin.fuel.title')}
        description={t('admin.fuel.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => void doExport('pdf')} disabled={Boolean(exporting)}>
              <FileText />
              {exporting === 'pdf' ? t('common.loading') : t('admin.reports.exportPdf')}
            </Button>
            <Button variant="outline" onClick={() => void doExport('xlsx')} disabled={Boolean(exporting)}>
              <FileSpreadsheet />
              {exporting === 'xlsx' ? t('common.loading') : t('admin.common.exportExcel')}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={t('admin.fuelApi.period')}>
        {(['today', 'month', 'financialYear'] as Period[]).map((key) => (
          <Button key={key} size="sm" variant={period === key ? 'default' : 'outline'} onClick={() => setPeriod(key)} role="tab" aria-selected={period === key}>
            {key === 'financialYear' ? summary.data?.financialYear.label ?? t('admin.fuelApi.financialYear') : t(key === 'today' ? 'admin.fuel.today' : 'admin.fuel.month')}
          </Button>
        ))}
      </div>

      {summary.error ? (
        <Panel>
          <ErrorState error={summary.error} onRetry={summary.reload} />
        </Panel>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            hero
            label={periodTitle}
            value={selected ? inr(Number(selected.amount)) : '—'}
            icon={Fuel}
            sub={selected ? t('admin.dashboard.fuelUpdates', { count: selected.entries }) : undefined}
            className="col-span-2 lg:col-span-1"
          />
          <StatCard label={t('admin.fuelApi.totalLitres')} value={selected ? num(Number(selected.litres), 0) : '—'} icon={Droplets} />
          <StatCard
            label={t('admin.fuelApi.averageRate')}
            value={selected?.averageRate ? `₹${selected.averageRate}` : '—'}
            icon={Gauge}
            sub={t('admin.fuelApi.weightedHint')}
          />
          <StatCard
            label={t('admin.fuelApi.split')}
            value={selected ? inr(Number(selected.byFuelType.DIESEL.amount)) : '—'}
            icon={CalendarDays}
            sub={selected ? `${t('enum.fuelType.diesel')} · ${t('enum.fuelType.petrol')} ${inr(Number(selected.byFuelType.PETROL.amount))}` : undefined}
          />
        </div>
      )}

      <Panel className="mt-6" title={`${t('admin.fuelApi.statement')} · ${statementTitle}`}>
        <FilterBar
          active={filtersActive}
          onClear={() => {
            setFrom('');
            setTo('');
            setDriverId('');
            setVehicleId('');
            setFuelType('');
            setStation('');
            setShowArchived(false);
            resetPaging();
          }}
        >
          <NativeSelect value={fy} onChange={(e) => setFilter(setFy)(e.target.value)} className="w-auto min-w-[130px]" aria-label={t('admin.fuelApi.financialYear')} disabled={Boolean(from || to)}>
            {years.map((y) => (
              <option key={y.code} value={y.code}>
                {y.label}
              </option>
            ))}
          </NativeSelect>
          <Input type="date" value={from} onChange={(e) => setFilter(setFrom)(e.target.value)} className="w-auto" aria-label={t('admin.fuelApi.from')} />
          <Input type="date" value={to} onChange={(e) => setFilter(setTo)(e.target.value)} className="w-auto" aria-label={t('admin.fuelApi.to')} />
          <NativeSelect value={driverId} onChange={(e) => setFilter(setDriverId)(e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.driver')}>
            <option value="">{t('admin.common.allDrivers')}</option>
            {(drivers.data?.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.employee.fullName}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={vehicleId} onChange={(e) => setFilter(setVehicleId)(e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.vehicle')}>
            <option value="">{t('admin.common.allVehicles')}</option>
            {(vehicles.data?.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.registrationNumber}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={fuelType} onChange={(e) => setFilter(setFuelType)(e.target.value)} className="w-auto min-w-[120px]" aria-label={t('admin.fuel.type')}>
            <option value="">{t('admin.fuel.allTypes')}</option>
            <option value="PETROL">{t('enum.fuelType.petrol')}</option>
            <option value="DIESEL">{t('enum.fuelType.diesel')}</option>
          </NativeSelect>
          <SearchInput value={station} onChange={setFilter(setStation)} placeholder={t('admin.fuel.station')} className="w-full sm:w-48" />
          <NativeSelect
            value={showArchived ? 'ARCHIVED' : 'ACTIVE'}
            onChange={(e) => {
              setShowArchived(e.target.value === 'ARCHIVED');
              resetPaging();
            }}
            className="w-auto min-w-[120px]"
            aria-label={t('admin.common.status')}
          >
            <option value="ACTIVE">{t('admin.fuelApi.active')}</option>
            <option value="ARCHIVED">{t('admin.fuelApi.archivedFilter')}</option>
          </NativeSelect>
        </FilterBar>

        {totals && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm">
            <span className="text-muted-foreground">{t('admin.common.records', { count: totals.entries })}</span>
            <span className="figure font-semibold" data-testid="fuel-totals">
              {inr(Number(totals.amount), true)} · {t('units.litresShort', { value: num(Number(totals.litres), 1) })}
              {totals.averageRate ? ` · ₹${totals.averageRate}/L` : ''}
            </span>
          </div>
        )}

        {statement.loading ? (
          <TableLoading columns={9} />
        ) : statement.error ? (
          <ErrorState error={statement.error} onRetry={statement.reload} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <TH>{t('admin.common.date')}</TH>
                  <TH>{t('admin.common.vehicle')}</TH>
                  <TH>{t('admin.common.driver')}</TH>
                  <TH>{t('admin.fuel.type')}</TH>
                  <TH className="text-right">{t('admin.fuel.litres')}</TH>
                  <TH className="text-right">{t('admin.fuelApi.rate')}</TH>
                  <TH className="text-right">{t('admin.common.amount')}</TH>
                  <TH>{t('admin.fuel.station')}</TH>
                  <TH className="text-center">{t('admin.fuel.receipt')}</TH>
                  <TH className="w-12" />
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <TR key={entry.id} data-testid="fuel-row">
                    <TD className="whitespace-nowrap">{fmtDate(entry.transactionDate, i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}</TD>
                    <TD>
                      <Plate reg={entry.vehicle.registrationNumber} size="xs" />
                    </TD>
                    <TD className="min-w-[150px]">{entry.driver.fullName}</TD>
                    <TD>
                      <Badge tone={entry.fuelType === 'PETROL' ? 'success' : 'info'}>{t(`enum.fuelType.${entry.fuelType.toLowerCase()}`)}</Badge>
                    </TD>
                    <TD className="figure text-right">{num(Number(entry.litres), 2)}</TD>
                    <TD className="figure text-right text-muted-foreground">{entry.ratePerLitre ? `₹${entry.ratePerLitre}` : '—'}</TD>
                    <TD className="figure text-right font-semibold">{inr(Number(entry.amount), true)}</TD>
                    <TD className="max-w-[220px] truncate text-muted-foreground">{entry.fuelStation}</TD>
                    <TD className="text-center">
                      {entry.receiptFileId ? (
                        <button type="button" onClick={() => setReceipt(entry)} aria-label={t('admin.fuelApi.openReceipt')} className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted">
                          <ImageIcon className="size-4 text-success" />
                        </button>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </TD>
                    <TD>
                      {mayEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={t('admin.common.actions')}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {entry.status === 'ACTIVE' ? (
                              <>
                                <DropdownMenuItem onSelect={() => setEditing(entry)} data-testid="fuel-edit">
                                  <Pencil />
                                  {t('common.edit')}
                                </DropdownMenuItem>
                                <DropdownMenuItem destructive onSelect={() => setArchiveTarget(entry)}>
                                  <Archive />
                                  {t('admin.fuelApi.archive')}
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <DropdownMenuItem onSelect={() => void restore(entry)}>
                                <RotateCcw />
                                {t('admin.fuelApi.restore')}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>

            {rows.length === 0 && (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {filtersActive ? t('admin.common.noResults') : t('admin.fuelApi.empty')}
              </p>
            )}

            {(pageIndex > 0 || nextCursor) && (
              <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                <Button variant="outline" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))}>
                  {t('admin.common.prev')}
                </Button>
                <Button
                  variant="outline"
                  disabled={!nextCursor}
                  onClick={() => {
                    if (!nextCursor) return;
                    setCursors((all) => (all[pageIndex + 1] ? all : [...all.slice(0, pageIndex + 1), nextCursor]));
                    setPageIndex((p) => p + 1);
                  }}
                >
                  {t('admin.common.next')}
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>

      <ReceiptViewer
        fileId={receipt?.receiptFileId ?? null}
        title={receipt ? `${receipt.vehicle.registrationNumber} · ${fmtDate(receipt.transactionDate)}` : ''}
        onClose={() => setReceipt(null)}
      />

      <ArchiveDialog
        open={Boolean(archiveTarget)}
        title={t('admin.fuelApi.confirmArchive')}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        onConfirm={confirmArchive}
      />

      <FuelEditDialog
        entry={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => {
          statement.reload();
          summary.reload();
        }}
      />
    </div>
  );
}
