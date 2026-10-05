import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Disc3, ImageIcon, Landmark, MoreHorizontal, RotateCcw, ScanText, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/ui/input';
import { operationsApi, serviceReceiptsApi, vehiclesApi } from '@/features/api/resources';
import { canManageFinance, canManageFleet, useSession } from '@/features/api/session';
import type { ApiOperation, OperationCategory } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { fmtDate, inr } from '@/lib/format';
import { FilterBar, PageHeader, Panel, StatCard, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';
import { ReceiptViewer } from '../components/ReceiptViewer';
import { RECEIPT_STATUS_TONE, ReceiptReviewDrawer } from '../components/ReceiptReviewDrawer';
import { FleetMaintenancePanel } from '../components/MaintenanceIntelligence';
import { ArchiveDialog } from '../components/ArchiveDialog';

const CATEGORY_ICON = { RTO: Landmark, TYRE: Disc3, MAINTENANCE: Wrench } as const;
const CATEGORIES: OperationCategory[] = ['RTO', 'TYRE', 'MAINTENANCE'];

const PAGE_SIZE = 50;

function currentFy(): string {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Daily operations other than fuel: RTO, tyre and maintenance/service expenses, and tyre
 * insurance policies. Shown in the existing Expenses area rather than a new tab.
 */
export function OperationsConnected() {
  const { t, i18n } = useTranslation();
  const role = useSession((s) => s.user?.role);
  const mayEdit = canManageFleet(role) || canManageFinance(role);
  const fy = useMemo(currentFy, []);

  const [category, setCategory] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [receipt, setReceipt] = useState<ApiOperation | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ApiOperation | null>(null);
  /** The service record open for receipt review, if any. */
  const [reviewing, setReviewing] = useState<string | null>(null);

  const filters = {
    fy,
    category: category || undefined,
    vehicleId: vehicleId || undefined,
    status: showArchived ? 'ARCHIVED' : undefined,
  };
  const filterKey = JSON.stringify(filters);

  const vehicles = useApiResource(() => vehiclesApi.list({ limit: 100 }), []);
  const byCategory = useApiResource(() => operationsApi.breakdown('category', { fy }), [fy]);
  const byVehicle = useApiResource(() => operationsApi.breakdown('vehicle', { fy, category: category || undefined }), [fy, category]);
  const records = useApiResource(() => operationsApi.list({ ...filters, limit: PAGE_SIZE, cursor: cursors[pageIndex] }), [filterKey, cursors[pageIndex]]);
  const policies = useApiResource(() => operationsApi.tyreInsurance(vehicleId || undefined), [vehicleId]);
  // Service receipts waiting on a person, and the state of the queue reading them.
  const pending = useApiResource(() => serviceReceiptsApi.pending({ limit: 8 }), []);
  const queue = useApiResource(() => serviceReceiptsApi.queue(), []);

  const resetPaging = () => {
    setCursors([undefined]);
    setPageIndex(0);
  };

  const categoryTotal = (key: OperationCategory) => byCategory.data?.find((row) => row.key === key);
  const rows = records.data?.data ?? [];
  const nextCursor = records.data?.page.nextCursor ?? null;
  const fyLabel = `FY ${fy.replace('-', '–')}`;

  const confirmArchive = async (reason: string) => {
    if (!archiveTarget) return;
    try {
      await operationsApi.archive(archiveTarget.id, reason);
      toast.success(t('admin.fuelApi.archived'));
      records.reload();
      byCategory.reload();
      byVehicle.reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
    } finally {
      setArchiveTarget(null);
    }
  };

  const restore = async (record: ApiOperation) => {
    try {
      await operationsApi.restore(record.id);
      toast.success(t('admin.fuelApi.restored'));
      records.reload();
      byCategory.reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));
    }
  };

  return (
    <div>
      <PageHeader title={t('admin.opsApi.title')} description={t('admin.opsApi.subtitle', { fy: fyLabel })} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CATEGORIES.map((key) => {
          const total = categoryTotal(key);
          return (
            <StatCard
              key={key}
              label={t(`enum.category.${key.toLowerCase()}`)}
              value={inr(Number(total?.amount ?? 0))}
              icon={CATEGORY_ICON[key]}
              sub={t('admin.common.records', { count: total?.entries ?? 0 })}
            />
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={t('admin.opsApi.records')}>
          <FilterBar
            active={Boolean(category || vehicleId || showArchived)}
            onClear={() => {
              setCategory('');
              setVehicleId('');
              setShowArchived(false);
              resetPaging();
            }}
          >
            <NativeSelect
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                resetPaging();
              }}
              className="w-auto min-w-[160px]"
              aria-label={t('admin.opsApi.category')}
            >
              <option value="">{t('admin.opsApi.allCategories')}</option>
              {CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {t(`enum.category.${key.toLowerCase()}`)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={vehicleId}
              onChange={(e) => {
                setVehicleId(e.target.value);
                resetPaging();
              }}
              className="w-auto min-w-[150px]"
              aria-label={t('admin.common.vehicle')}
            >
              <option value="">{t('admin.common.allVehicles')}</option>
              {(vehicles.data?.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber}
                </option>
              ))}
            </NativeSelect>
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

          {records.data && (
            <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
              <span className="text-muted-foreground">{t('admin.common.records', { count: records.data.count })}</span>
              <span className="figure font-semibold">{inr(Number(records.data.total), true)}</span>
            </div>
          )}

          {records.loading ? (
            <TableLoading columns={7} />
          ) : records.error ? (
            <ErrorState error={records.error} onRetry={records.reload} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('admin.common.date')}</TH>
                    <TH>{t('admin.opsApi.category')}</TH>
                    <TH>{t('admin.common.vehicle')}</TH>
                    <TH>{t('admin.common.driver')}</TH>
                    <TH>{t('admin.opsApi.vendor')}</TH>
                    <TH className="text-right">{t('admin.common.amount')}</TH>
                    <TH className="text-center">{t('admin.fuel.receipt')}</TH>
                    <TH className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((record) => (
                    <TR key={record.id}>
                      <TD className="whitespace-nowrap">{fmtDate(record.expenseDate, i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}</TD>
                      <TD>
                        <Badge tone="neutral">{t(`enum.category.${record.category.toLowerCase()}`)}</Badge>
                      </TD>
                      <TD>
                        <Plate reg={record.vehicle.registrationNumber} size="xs" />
                      </TD>
                      <TD className="text-muted-foreground">{record.driver?.fullName ?? t('admin.opsApi.office')}</TD>
                      <TD className="max-w-[200px] truncate text-muted-foreground">{record.vendorName ?? record.description ?? '—'}</TD>
                      <TD className="figure text-right font-semibold">{inr(Number(record.amount), true)}</TD>
                      <TD className="text-center">
                        {record.receiptFileId ? (
                          <button type="button" onClick={() => setReceipt(record)} aria-label={t('admin.fuelApi.openReceipt')} className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted">
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
                              {record.category === 'MAINTENANCE' && record.receiptFileId && (
                                <DropdownMenuItem onSelect={() => setReviewing(record.id)}>
                                  <ScanText />
                                  {t('admin.receiptAi.reviewReceipt')}
                                </DropdownMenuItem>
                              )}
                              {record.status === 'ACTIVE' ? (
                                <DropdownMenuItem destructive onSelect={() => setArchiveTarget(record)}>
                                  <Archive />
                                  {t('admin.fuelApi.archive')}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => void restore(record)}>
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
              {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.opsApi.empty')}</p>}
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

        <div className="space-y-4">
          <Panel
            title={t('admin.receiptAi.queueTitle')}
            action={
              queue.data && (
                <span className="text-xs text-muted-foreground">
                  {queue.data.workerEnabled
                    ? t('admin.receiptAi.queueMeta', { pending: queue.data.queued + queue.data.retrying, model: queue.data.model })
                    : t('admin.receiptAi.workerOff')}
                </span>
              )
            }
          >
            {pending.loading ? (
              <TableLoading rows={3} columns={2} />
            ) : pending.error ? (
              <ErrorState error={pending.error} onRetry={pending.reload} />
            ) : (pending.data?.data.length ?? 0) === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('admin.receiptAi.queueEmpty')}</p>
            ) : (
              <ul className="divide-y">
                {pending.data?.data.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setReviewing(row.id)}
                      className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
                    >
                      <ScanText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <Plate reg={row.vehicle.registrationNumber} size="xs" />
                          <span className="figure text-sm font-semibold">{inr(Number(row.amount), true)}</span>
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.vendorName ?? t('admin.receiptAi.noVendor')}
                          {row.expenseDate ? ` · ${fmtDate(row.expenseDate, i18n.language)}` : ''}
                        </span>
                      </span>
                      <Badge tone={RECEIPT_STATUS_TONE[row.aiStatus]} className="shrink-0">
                        {t(`admin.receiptAi.status.${row.aiStatus}`)}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="flex items-start gap-1.5 border-t px-4 py-2.5 text-[11px] text-muted-foreground">
              <Sparkles className="mt-px size-3 shrink-0" />
              {t('admin.receiptAi.queueNote')}
            </p>
          </Panel>

          <FleetMaintenancePanel />

          <Panel title={t('admin.opsApi.byVehicle')}>
            {byVehicle.loading ? (
              <TableLoading rows={3} columns={2} />
            ) : (byVehicle.data?.length ?? 0) === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('admin.opsApi.empty')}</p>
            ) : (
              <ul className="divide-y">
                {byVehicle.data?.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <Plate reg={row.label} size="xs" />
                    <span className="figure font-semibold">{inr(Number(row.amount), true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t('enum.category.tyre_insurance')}>
            {policies.loading ? (
              <TableLoading rows={2} columns={2} />
            ) : (policies.data?.length ?? 0) === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('admin.opsApi.noPolicies')}</p>
            ) : (
              <ul className="divide-y">
                {policies.data?.map((policy) => (
                  <li key={policy.id} className="flex items-start gap-3 px-4 py-2.5">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Plate reg={policy.vehicle.registrationNumber} size="xs" />
                        <span className="truncate text-sm font-medium">{policy.insurer ?? '—'}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {policy.expiryDate ? t('admin.opsApi.expires', { date: fmtDate(policy.expiryDate) }) : '—'}
                        {policy.premium ? ` · ${inr(Number(policy.premium), true)}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <ReceiptViewer
        fileId={receipt?.receiptFileId ?? null}
        title={receipt ? `${receipt.vehicle.registrationNumber} · ${fmtDate(receipt.expenseDate)}` : ''}
        onClose={() => setReceipt(null)}
      />
      <ReceiptReviewDrawer
        expenseId={reviewing}
        onClose={() => setReviewing(null)}
        onChanged={() => {
          pending.reload();
          queue.reload();
          records.reload();
          byCategory.reload();
          byVehicle.reload();
        }}
      />
      <ArchiveDialog
        open={Boolean(archiveTarget)}
        title={t('admin.fuelApi.confirmArchive')}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        onConfirm={confirmArchive}
      />
    </div>
  );
}
