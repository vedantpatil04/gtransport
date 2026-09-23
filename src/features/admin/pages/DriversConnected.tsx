import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Power, Truck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/ui/input';
import { driversApi } from '@/features/api/resources';
import { canManageFleet, useSession } from '@/features/api/session';
import type { ApiDriver, ApiDriverStatus } from '@/features/api/types';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { initials } from '@/lib/utils';
import { ConfirmDialog, FilterBar, PageHeader, Panel, SearchInput, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';
import { CreateDriverProfileDialog } from '../../drivers/DriverProfileDialogs';

const DRIVER_STATUSES: ApiDriverStatus[] = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'INACTIVE'];

export const DRIVER_STATUS_TONE: Record<ApiDriverStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  ON_LEAVE: 'warning',
  SUSPENDED: 'danger',
  INACTIVE: 'neutral',
};

/** Location readiness, from the Phase 0 foundation. Live tracking arrives in a later phase. */
export function LocationReadiness({ driver }: { driver: ApiDriver }) {
  const { t } = useTranslation();
  if (!driver.locationSharingEnabled) return <span className="text-sm text-muted-foreground">{t('admin.driversApi.locationOff')}</span>;
  const status = driver.location?.status ?? 'OFFLINE';
  const tone = status === 'ACTIVE' ? 'text-success' : status === 'STALE' ? 'text-warning' : 'text-muted-foreground';
  return <span className={`text-sm ${tone}`}>{t(`admin.driversApi.location.${status}`)}</span>;
}

const PAGE_SIZE = 25;

export function DriversConnected() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useSession((s) => s.user?.role);
  const mayManage = canManageFleet(role);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [statusTarget, setStatusTarget] = useState<ApiDriver | null>(null);

  const search = useDebounced(q);
  const drivers = useApiResource(
    () =>
      driversApi.list({
        q: search || undefined,
        status: status || undefined,
        assigned: assigned === '' ? undefined : Number(assigned),
        limit: PAGE_SIZE,
        cursor: cursors[pageIndex],
      }),
    [search, status, assigned, cursors[pageIndex]],
  );

  const rows = drivers.data?.data ?? [];
  const nextCursor = drivers.data?.page.nextCursor ?? null;
  const filtersActive = Boolean(q || status || assigned);

  const resetPaging = () => {
    setCursors([undefined]);
    setPageIndex(0);
  };

  const toggleStatus = async (driver: ApiDriver) => {
    const next = driver.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await driversApi.setStatus(driver.id, next);
      toast.success(t(next === 'ACTIVE' ? 'admin.drivers.activated' : 'admin.drivers.deactivated', { name: driver.employee.fullName }));
      drivers.reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin.api.errorTitle'));
    } finally {
      setStatusTarget(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('admin.drivers.title')}
        description={t('admin.driversApi.subtitle', { count: rows.length })}
        actions={
          mayManage && (
            <Button onClick={() => setAdding(true)}>
              <UserPlus />
              {t('admin.driversApi.add')}
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
            setAssigned('');
            resetPaging();
          }}
        >
          <SearchInput
            value={q}
            onChange={(value) => {
              setQ(value);
              resetPaging();
            }}
            placeholder={t('admin.driversApi.search')}
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
            <option value="">{t('admin.drivers.allStatus')}</option>
            {DRIVER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.enum.driverStatus.${s}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={assigned}
            onChange={(e) => {
              setAssigned(e.target.value);
              resetPaging();
            }}
            className="w-auto min-w-[150px]"
            aria-label={t('admin.common.vehicle')}
          >
            <option value="">{t('admin.driversApi.anyVehicle')}</option>
            <option value="1">{t('admin.driversApi.withVehicle')}</option>
            <option value="0">{t('admin.driversApi.withoutVehicle')}</option>
          </NativeSelect>
        </FilterBar>

        {drivers.loading ? (
          <TableLoading columns={6} />
        ) : drivers.error ? (
          <ErrorState error={drivers.error} onRetry={drivers.reload} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <TH>{t('admin.common.driver')}</TH>
                  <TH>{t('admin.driversApi.driverId')}</TH>
                  <TH>{t('admin.common.vehicle')}</TH>
                  <TH>{t('admin.drivers.language')}</TH>
                  <TH>{t('admin.drivers.location')}</TH>
                  <TH>{t('admin.common.status')}</TH>
                  <TH className="w-12" />
                </tr>
              </thead>
              <tbody>
                {rows.map((driver) => (
                  <TR key={driver.id} onClick={() => navigate(`/admin/drivers/${driver.id}`)} data-testid="driver-row">
                    <TD className="min-w-[200px]">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {initials(driver.employee.fullName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{driver.employee.fullName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {driver.employee.phone ?? driver.homeTown ?? driver.employee.employeeCode}
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD className="figure whitespace-nowrap text-muted-foreground">{driver.driverCode}</TD>
                    <TD>
                      {driver.currentAssignment ? (
                        <Plate reg={driver.currentAssignment.vehicle.registrationNumber} size="xs" />
                      ) : (
                        <span className="text-sm text-muted-foreground">{t('admin.drivers.noVehicle')}</span>
                      )}
                    </TD>
                    <TD>{t(`admin.enum.language.${driver.employee.preferredLanguage}`)}</TD>
                    <TD className="whitespace-nowrap">
                      <LocationReadiness driver={driver} />
                    </TD>
                    <TD>
                      <Badge tone={DRIVER_STATUS_TONE[driver.status]}>{t(`admin.enum.driverStatus.${driver.status}`)}</Badge>
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
                            <DropdownMenuItem onSelect={() => navigate(`/admin/drivers/${driver.id}`)}>
                              {t('admin.drivers.view')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => navigate(`/admin/vehicles?driver=${driver.id}`)}>
                              <Truck />
                              {t('admin.driversApi.findVehicle')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive={driver.status === 'ACTIVE'} onSelect={() => setStatusTarget(driver)}>
                              <Power />
                              {driver.status === 'ACTIVE' ? t('admin.drivers.deactivate') : t('admin.drivers.activate')}
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
                {filtersActive ? t('admin.common.noResults') : t('admin.driversApi.empty')}
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

      <CreateDriverProfileDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(driver) => {
          setAdding(false);
          navigate(`/admin/drivers/${driver.id}`);
        }}
      />
      <ConfirmDialog
        open={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={
          statusTarget?.status === 'ACTIVE'
            ? t('admin.driversApi.confirmDeactivate', { name: statusTarget?.employee.fullName ?? '' })
            : t('admin.driversApi.confirmActivate', { name: statusTarget?.employee.fullName ?? '' })
        }
        description={statusTarget?.status === 'ACTIVE' ? t('admin.driversApi.deactivateNote') : undefined}
        confirmLabel={statusTarget?.status === 'ACTIVE' ? t('admin.drivers.deactivate') : t('admin.drivers.activate')}
        destructive={statusTarget?.status === 'ACTIVE'}
        onConfirm={() => statusTarget && void toggleStatus(statusTarget)}
      />
    </div>
  );
}
