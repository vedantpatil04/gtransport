import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Plus, Power } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/ui/input';
import { vehiclesApi } from '@/features/api/resources';
import { canManageFleet, useSession } from '@/features/api/session';
import type { ApiVehicle, ApiVehicleStatus } from '@/features/api/types';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { ConfirmDialog, FilterBar, PageHeader, Panel, SearchInput, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';
import { VehicleFormDialog } from '../../vehicles/VehicleApiDialogs';

const VEHICLE_STATUSES: ApiVehicleStatus[] = ['ACTIVE', 'MAINTENANCE', 'IDLE', 'RETIRED'];

export const VEHICLE_STATUS_TONE: Record<ApiVehicleStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  ACTIVE: 'success',
  MAINTENANCE: 'warning',
  IDLE: 'neutral',
  RETIRED: 'danger',
};

/**
 * Finance state for the list: fully owned vehicles say so plainly rather than showing an
 * empty EMI column.
 */
export function FinanceCell({ vehicle }: { vehicle: ApiVehicle }) {
  const { t } = useTranslation();
  if (vehicle.ownership === 'OWNED') return <span className="text-sm text-muted-foreground">{t('admin.vehiclesApi.noEmi')}</span>;
  if (!vehicle.financing) return <span className="text-sm text-warning">{t('admin.vehiclesApi.financeMissing')}</span>;
  const tone = vehicle.financing.status === 'ACTIVE' ? 'warning' : vehicle.financing.status === 'DEFAULTED' ? 'danger' : 'neutral';
  return <Badge tone={tone}>{t(`admin.enum.financeStatus.${vehicle.financing.status}`)}</Badge>;
}

const PAGE_SIZE = 25;

export function VehiclesConnected() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const role = useSession((s) => s.user?.role);
  const mayManage = canManageFleet(role);

  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [ownership, setOwnership] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [statusTarget, setStatusTarget] = useState<ApiVehicle | null>(null);

  const driverId = params.get('driver') ?? undefined;
  const search = useDebounced(q);

  const vehicles = useApiResource(
    () =>
      vehiclesApi.list({
        q: search || undefined,
        status: status || undefined,
        ownership: ownership || undefined,
        driverId,
        limit: PAGE_SIZE,
        cursor: cursors[pageIndex],
      }),
    [search, status, ownership, driverId, cursors[pageIndex]],
  );

  const rows = vehicles.data?.data ?? [];
  const nextCursor = vehicles.data?.page.nextCursor ?? null;
  const filtersActive = Boolean(q || status || ownership);

  const resetPaging = () => {
    setCursors([undefined]);
    setPageIndex(0);
  };

  const toggleStatus = async (vehicle: ApiVehicle) => {
    const next = vehicle.status === 'ACTIVE' ? 'IDLE' : 'ACTIVE';
    try {
      await vehiclesApi.setStatus(vehicle.id, next);
      toast.success(t('admin.vehiclesApi.statusChanged', { reg: vehicle.registrationNumber }));
      vehicles.reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin.api.errorTitle'));
    } finally {
      setStatusTarget(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('admin.vehicles.title')}
        description={t('admin.vehiclesApi.subtitle', { count: rows.length })}
        actions={
          mayManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus />
              {t('admin.vehicles.add')}
            </Button>
          )
        }
      />
      <Panel>
        <FilterBar
          active={filtersActive}
          onClear={() => {
            setQ('');
            setStatus('');
            setOwnership('');
            resetPaging();
          }}
        >
          <SearchInput
            value={q}
            onChange={(value) => {
              setQ(value);
              resetPaging();
            }}
            placeholder={t('admin.vehiclesApi.search')}
            className="w-full sm:w-72"
          />
          <NativeSelect
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              resetPaging();
            }}
            className="w-auto min-w-[140px]"
            aria-label={t('admin.common.status')}
          >
            <option value="">{t('admin.vehicles.allStatus')}</option>
            {VEHICLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.enum.vehicleStatus.${s}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={ownership}
            onChange={(e) => {
              setOwnership(e.target.value);
              resetPaging();
            }}
            className="w-auto min-w-[150px]"
            aria-label={t('admin.vehiclesApi.ownership')}
          >
            <option value="">{t('admin.vehiclesApi.allOwnership')}</option>
            <option value="OWNED">{t('admin.enum.ownership.OWNED')}</option>
            <option value="FINANCED">{t('admin.enum.ownership.FINANCED')}</option>
          </NativeSelect>
        </FilterBar>

        {vehicles.loading ? (
          <TableLoading columns={6} />
        ) : vehicles.error ? (
          <ErrorState error={vehicles.error} onRetry={vehicles.reload} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <TH>{t('admin.vehicles.reg')}</TH>
                  <TH>{t('admin.vehicles.kind')}</TH>
                  <TH>{t('admin.common.driver')}</TH>
                  <TH>{t('admin.vehiclesApi.ownership')}</TH>
                  <TH>{t('admin.vehiclesApi.finance')}</TH>
                  <TH>{t('admin.common.status')}</TH>
                  <TH className="w-12" />
                </tr>
              </thead>
              <tbody>
                {rows.map((vehicle) => (
                  <TR key={vehicle.id} onClick={() => navigate(`/admin/vehicles/${vehicle.id}`)} data-testid="vehicle-row">
                    <TD>
                      <div className="flex flex-col gap-1">
                        <Plate reg={vehicle.registrationNumber} size="xs" />
                        <span className="text-xs text-muted-foreground">{[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'}</span>
                      </div>
                    </TD>
                    <TD>{t(`enum.vehicleKind.${vehicle.kind.toLowerCase()}`)}</TD>
                    <TD>
                      {vehicle.currentAssignment ? (
                        <span className="truncate">{vehicle.currentAssignment.driver.fullName}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">{t('admin.vehiclesApi.noDriver')}</span>
                      )}
                    </TD>
                    <TD>{t(`admin.enum.ownership.${vehicle.ownership}`)}</TD>
                    <TD>
                      <FinanceCell vehicle={vehicle} />
                    </TD>
                    <TD>
                      <Badge tone={VEHICLE_STATUS_TONE[vehicle.status]}>{t(`admin.enum.vehicleStatus.${vehicle.status}`)}</Badge>
                    </TD>
                    <TD>
                      {mayManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()} aria-label={t('admin.common.actions')}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} className="w-56">
                            <DropdownMenuItem onSelect={() => navigate(`/admin/vehicles/${vehicle.id}`)}>{t('common.view')}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive={vehicle.status === 'ACTIVE'} onSelect={() => setStatusTarget(vehicle)}>
                              <Power />
                              {vehicle.status === 'ACTIVE' ? t('admin.vehiclesApi.park') : t('admin.vehiclesApi.activate')}
                            </DropdownMenuItem>
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
                {filtersActive ? t('admin.common.noResults') : t('admin.vehiclesApi.empty')}
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

      <VehicleFormDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={(vehicle) => {
          setAdding(false);
          navigate(`/admin/vehicles/${vehicle.id}`);
        }}
      />
      <ConfirmDialog
        open={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={t('admin.vehiclesApi.confirmStatus', { reg: statusTarget?.registrationNumber ?? '' })}
        confirmLabel={t('common.confirm')}
        destructive={statusTarget?.status === 'ACTIVE'}
        onConfirm={() => statusTarget && void toggleStatus(statusTarget)}
      />
    </div>
  );
}
