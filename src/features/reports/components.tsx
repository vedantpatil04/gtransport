import { useState } from 'react';
import type * as React from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, FileText, Info, Loader2, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, TableLoading } from '@/features/admin/components/states';
import { FilterBar, Panel, SearchInput, StatCard, Table, TD, TH, TR } from '@/features/admin/components/ui';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { fmtDate, fmtDayMonth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { downloadReport, reportsApi, type ExportFormat, type Preset, type ReportMeta, type ReportPage, type ReportParams, type ReportType } from './api';
import { carryOver, type PeriodState } from './params';

// ───────────────────────────── Formatting ─────────────────────────────

const rupeeFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Exact rupees for tables and statements: ₹1,25,450.00. */
export const rupees = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return `${n < 0 ? '−' : ''}₹${rupeeFormat.format(Math.abs(n))}`;
};
/** Rounded rupees for headline cards: ₹1,25,450. */
export const rupeesShort = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Math.round(Number(value));
  return `${n < 0 ? '−' : ''}₹${new Intl.NumberFormat('en-IN').format(Math.abs(n))}`;
};
export const litresText = (value: string | number) => `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value))} L`;

/** Chart axis label for a bucket: "5 Oct" for days, "Oct 26" for months. */
export function useBucketLabel(granularity: 'day' | 'month' | undefined) {
  const { i18n } = useTranslation();
  return (bucket: string) => (granularity === 'month' ? fmtDate(`${bucket}-01`, i18n.language, { month: 'short', year: '2-digit' }) : fmtDayMonth(bucket, i18n.language));
}

export function useDay() {
  const { i18n } = useTranslation();
  return (iso: string | null | undefined) => (iso ? fmtDate(iso.slice(0, 10), i18n.language) : '—');
}

// ───────────────────────────── Navigation ─────────────────────────────

const TAB_ORDER: ReportType[] = ['overview', 'fuel', 'vehicles', 'drivers', 'finance', 'expenses', 'maintenance', 'tyres', 'compliance', 'location'];

/** The reports this role may open, as one row of tabs inside the existing Reports page. */
export function ReportTabs({ allowed, current }: { allowed: ReportType[]; current: ReportType }) {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  return (
    <nav className="scroll-thin -mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1" aria-label={t('admin.reportsApi.navLabel')}>
      {TAB_ORDER.filter((type) => allowed.includes(type)).map((type) => (
        <NavLink
          key={type}
          to={`/admin/reports/${type}${carryOver(search, type)}`}
          className={cn(
            'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            type === current ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          aria-current={type === current ? 'page' : undefined}
          data-testid={`report-tab-${type}`}
        >
          {t(`admin.reportsApi.tabs.${type}`)}
        </NavLink>
      ))}
    </nav>
  );
}

// ───────────────────────────── Period ─────────────────────────────

const PRESET_ORDER: Preset[] = ['today', 'yesterday', 'this_week', 'this_month', 'previous_month', 'this_quarter', 'this_fy', 'previous_fy', 'fy', 'custom'];

export function PeriodFilter({ period, meta, onChange }: { period: PeriodState; meta: ReportMeta; onChange: (preset: Preset, extra?: { fy?: string; from?: string; to?: string }) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <NativeSelect
        value={period.preset}
        onChange={(e) => {
          const preset = e.target.value as Preset;
          onChange(preset, preset === 'fy' ? { fy: period.fy || meta.currentFinancialYear.code } : {});
        }}
        className="w-auto min-w-[170px]"
        aria-label={t('admin.reportsApi.period.label')}
        data-testid="report-period"
      >
        {PRESET_ORDER.map((preset) => (
          <option key={preset} value={preset}>
            {preset === 'this_fy' ? `${t('admin.reportsApi.period.this_fy')} (${meta.currentFinancialYear.label})` : t(`admin.reportsApi.period.${preset}`)}
          </option>
        ))}
      </NativeSelect>
      {period.preset === 'fy' && (
        <NativeSelect value={period.fy || meta.currentFinancialYear.code} onChange={(e) => onChange('fy', { fy: e.target.value })} className="w-auto min-w-[130px]" aria-label={t('admin.reportsApi.period.fy')} data-testid="report-fy">
          {meta.financialYears.map((fy) => (
            <option key={fy.code} value={fy.code}>
              {fy.label}
            </option>
          ))}
        </NativeSelect>
      )}
      {period.preset === 'custom' && (
        <>
          <Input type="date" value={period.from} max={period.to || meta.today} onChange={(e) => onChange('custom', { from: e.target.value })} className="w-auto" aria-label={t('admin.reportsApi.period.from')} data-testid="report-from" />
          <Input type="date" value={period.to} min={period.from || undefined} onChange={(e) => onChange('custom', { to: e.target.value })} className="w-auto" aria-label={t('admin.reportsApi.period.to')} data-testid="report-to" />
        </>
      )}
    </>
  );
}

export function FilterSelect({ value, onChange, label, allLabel, options, className, testId }: { value: string | undefined; onChange: (value: string | undefined) => void; label: string; allLabel: string; options: { value: string; label: string }[]; className?: string; testId?: string }) {
  return (
    <NativeSelect value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className={cn('w-auto min-w-[140px]', className)} aria-label={label} data-testid={testId}>
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

// ───────────────────────────── Figures ─────────────────────────────

/** "How is this calculated?" — shown beside any figure whose definition is not obvious. */
export function Definition({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-label={t('admin.reportsApi.definition')}>
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-sm leading-snug">{text}</PopoverContent>
    </Popover>
  );
}

export function Kpi({ label, value, sub, icon, tone, hero, definition, testId, to }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: LucideIcon; tone?: 'neutral' | 'success' | 'warning' | 'danger'; hero?: boolean; definition?: string; testId?: string; to?: string }) {
  return (
    <StatCard
      hero={hero}
      to={to}
      label={definition ? <span className="inline-flex items-center gap-1">{label}<Definition text={definition} /></span> : label}
      value={value}
      sub={sub}
      icon={icon}
      tone={tone}
      testId={testId}
    />
  );
}

export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>;
}

/** Loading / error wrapper for a report's summary. An error is an error — never a row of ₹0. */
export function SummaryState<T>({ resource, children, cards = 4 }: { resource: { data: T | null; loading: boolean; error: ApiError | null; reload: () => void }; children: (data: T) => React.ReactNode; cards?: number }) {
  if (resource.error) {
    return (
      <Panel>
        <ErrorState error={resource.error} onRetry={resource.reload} />
      </Panel>
    );
  }
  if (resource.loading || !resource.data) {
    return (
      <div className="space-y-4" aria-busy="true" data-testid="report-loading">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }
  return <>{children(resource.data)}</>;
}

/** A clean empty state for a chart or list whose (successful) query found nothing. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="flex h-full min-h-[120px] items-center justify-center px-4 text-center text-sm text-muted-foreground">{children}</p>;
}

// ───────────────────────────── Export ─────────────────────────────

/** Server-built exports. "Ready" is announced only once the file has fully arrived. */
export function ExportMenu({ type, params, disabled }: { type: ReportType; params: ReportParams; disabled?: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const run = async (format: ExportFormat) => {
    setBusy(format);
    const pending = toast.loading(t('admin.reportsApi.export.preparing'));
    try {
      const result = await downloadReport(type, params, format);
      if (result === 'saved') toast.success(t('admin.reportsApi.export.ready'), { id: pending, description: t(`admin.reportsApi.export.readyBody.${format}`) });
      else if (result === 'declined') toast.message(t('admin.reportsApi.export.declined'), { id: pending });
      else toast.error(t('admin.reportsApi.export.failed'), { id: pending });
    } catch (error) {
      toast.error(t('admin.reportsApi.export.failed'), { id: pending, description: error instanceof ApiError ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const items: { format: ExportFormat; icon: LucideIcon }[] = [
    { format: 'pdf', icon: FileText },
    { format: 'xlsx', icon: FileSpreadsheet },
    { format: 'csv', icon: FileDown },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled || Boolean(busy)} data-testid="report-export">
          {busy ? <Loader2 className="animate-spin" /> : <FileDown />}
          {busy ? t('admin.reportsApi.export.preparing') : t('admin.reportsApi.export.button')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {items.map(({ format, icon: Icon }) => (
          <DropdownMenuItem key={format} onSelect={() => void run(format)} data-testid={`report-export-${format}`}>
            <Icon />
            {t(`admin.reportsApi.export.${format}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ───────────────────────────── Records ─────────────────────────────

export interface RecordColumn<T> {
  key: string;
  header: string;
  /** The API's sort key for this column, when it is sortable. */
  sort?: string;
  numeric?: boolean;
  className?: string;
  render: (row: T) => React.ReactNode;
}

const PAGE_SIZE = 25;

/**
 * One server-side page of a report's records: sorted, searched and paged by the API, so the
 * browser never holds more than a page however long the history is.
 */
export function RecordsTable<T>({
  title, type, params, columns, rowKey, section, defaultSort, onRowClick, searchPlaceholder, emptyText, testId, action,
}: {
  title: React.ReactNode;
  type: ReportType;
  params: ReportParams;
  columns: RecordColumn<T>[];
  rowKey: (row: T) => string;
  section?: string;
  defaultSort?: { field: string; dir: 'asc' | 'desc' };
  onRowClick?: (row: T) => void;
  searchPlaceholder?: string;
  emptyText: string;
  testId?: string;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | undefined>(defaultSort);
  const scope = JSON.stringify([params, section, query, sort]);
  // The page belongs to one set of filters: change any of them and it is page 1 again, without
  // a wasted request for a page number that no longer means anything.
  const [paging, setPaging] = useState({ scope, page: 1 });
  const page = paging.scope === scope ? paging.page : 1;

  const resource = useApiResource<ReportPage<T>>(
    () => reportsApi.records<T>(type, { ...params, section, page, pageSize: PAGE_SIZE, sort: sort?.field, dir: sort?.dir, q: query || undefined }),
    [type, scope, page],
  );
  const data = resource.data;

  const toggleSort = (field: string) =>
    setSort((current) => (current?.field === field ? { field, dir: current.dir === 'desc' ? 'asc' : 'desc' } : { field, dir: 'desc' }));

  return (
    <Panel title={title} action={action} className="mt-4">
      {searchPlaceholder && (
        <FilterBar>
          <SearchInput value={q} onChange={setQ} placeholder={searchPlaceholder} className="w-full sm:w-72" />
          {data && <span className="ml-auto text-sm text-muted-foreground">{t('admin.common.records', { count: data.page.total })}</span>}
        </FilterBar>
      )}
      {resource.loading ? (
        <TableLoading columns={Math.min(columns.length, 7)} />
      ) : resource.error ? (
        <ErrorState error={resource.error} onRetry={resource.reload} />
      ) : data && data.data.length === 0 ? (
        <EmptyNote>{query ? t('admin.common.noResults') : emptyText}</EmptyNote>
      ) : data ? (
        <>
          <Table data-testid={testId}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <TH key={column.key} className={cn(column.numeric && 'text-right', column.className)} aria-sort={sort && column.sort && sort.field === column.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {column.sort ? (
                      <button type="button" onClick={() => toggleSort(column.sort as string)} className={cn('inline-flex items-center gap-1 hover:text-foreground', column.numeric && 'flex-row-reverse')}>
                        {column.header}
                        {sort?.field === column.sort && (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                      </button>
                    ) : (
                      column.header
                    )}
                  </TH>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((row) => (
                <TR key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {columns.map((column) => (
                    <TD key={column.key} className={cn(column.numeric && 'figure text-right', column.className)}>
                      {column.render(row)}
                    </TD>
                  ))}
                </TR>
              ))}
            </tbody>
          </Table>
          {data.page.pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
              <span>{t('admin.common.records', { count: data.page.total })}</span>
              <div className="flex items-center gap-2">
                <span className="figure">{t('admin.common.pageOf', { page: data.page.page, total: data.page.pageCount })}</span>
                <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPaging({ scope, page: page - 1 })} aria-label={t('admin.common.prev')}>
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon-sm" disabled={page >= data.page.pageCount} onClick={() => setPaging({ scope, page: page + 1 })} aria-label={t('admin.common.next')}>
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </Panel>
  );
}

/** A compact table for a breakdown that is already fully aggregated by the server. */
export function BreakdownTable<T>({ rows, columns, rowKey, onRowClick, emptyText }: { rows: T[]; columns: RecordColumn<T>[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void; emptyText: string }) {
  if (!rows.length) return <EmptyNote>{emptyText}</EmptyNote>;
  return (
    <Table>
      <thead>
        <tr>
          {columns.map((column) => (
            <TH key={column.key} className={cn(column.numeric && 'text-right', column.className)}>
              {column.header}
            </TH>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <TR key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
            {columns.map((column) => (
              <TD key={column.key} className={cn('h-11', column.numeric && 'figure text-right', column.className)}>
                {column.render(row)}
              </TD>
            ))}
          </TR>
        ))}
      </tbody>
    </Table>
  );
}
