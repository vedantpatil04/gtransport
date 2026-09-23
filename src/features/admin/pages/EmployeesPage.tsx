import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Power, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/ui/input';
import { employeesApi } from '@/features/api/resources';
import { canManageFleet, useSession } from '@/features/api/session';
import type { ApiEmployee, EmployeeRole, EmploymentStatus } from '@/features/api/types';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { fmtDate } from '@/lib/format';
import { initials } from '@/lib/utils';
import { ConfirmDialog, FilterBar, PageHeader, Panel, SearchInput, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, SignedOutState, TableLoading } from '../components/states';
import { EmployeeFormDialog } from '../../employees/EmployeeFormDialog';

const EMPLOYEE_ROLES: EmployeeRole[] = ['DRIVER', 'ACCOUNTING', 'MANAGER', 'ADMIN', 'OTHER'];
const EMPLOYEE_STATUSES: EmploymentStatus[] = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'INACTIVE', 'EXITED'];

const STATUS_TONE: Record<EmploymentStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  ON_LEAVE: 'warning',
  SUSPENDED: 'danger',
  INACTIVE: 'neutral',
  EXITED: 'neutral',
};

const PAGE_SIZE = 25;

export function EmployeesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useSession((s) => s.token);
  const role = useSession((s) => s.user?.role);
  const mayManage = canManageFleet(role);

  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [status, setStatus] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ApiEmployee | null>(null);
  const [statusTarget, setStatusTarget] = useState<ApiEmployee | null>(null);

  const search = useDebounced(q);
  const cursor = cursors[pageIndex];

  const employees = useApiResource(
    () => employeesApi.list({ q: search || undefined, role: roleFilter || undefined, status: status || undefined, limit: PAGE_SIZE, cursor }),
    [search, roleFilter, status, cursor],
    Boolean(token),
  );

  const rows = employees.data?.data ?? [];
  const nextCursor = employees.data?.page.nextCursor ?? null;
  const filtersActive = Boolean(q || roleFilter || status);

  /** Any filter change starts a fresh cursor chain. */
  const resetPaging = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setCursors([undefined]);
    setPageIndex(0);
  };

  const activeCount = useMemo(() => rows.filter((e) => e.status === 'ACTIVE').length, [rows]);

  const toggleStatus = async (employee: ApiEmployee) => {
    const next = employee.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await employeesApi.setStatus(employee.id, next);
      toast.success(t(next === 'ACTIVE' ? 'admin.employees.activated' : 'admin.employees.deactivated', { name: employee.fullName }));
      employees.reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin.api.errorTitle'));
    } finally {
      setStatusTarget(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('admin.employees.title')}
        description={t('admin.employees.subtitle', { active: activeCount, total: rows.length })}
        actions={
          mayManage && (
            <Button onClick={() => setAdding(true)} disabled={!token}>
              <UserPlus />
              {t('admin.employees.add')}
            </Button>
          )
        }
      />
      <Panel>
        <FilterBar
          active={filtersActive}
          onClear={() => {
            setQ('');
            setRoleFilter('');
            setStatus('');
            setCursors([undefined]);
            setPageIndex(0);
          }}
        >
          <SearchInput value={q} onChange={resetPaging(setQ)} placeholder={t('admin.employees.search')} className="w-full sm:w-72" />
          <NativeSelect
            value={roleFilter}
            onChange={(e) => resetPaging(setRoleFilter)(e.target.value)}
            className="w-auto min-w-[150px]"
            aria-label={t('admin.employees.role')}
          >
            <option value="">{t('admin.employees.allRoles')}</option>
            {EMPLOYEE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`admin.enum.employeeRole.${r}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={status}
            onChange={(e) => resetPaging(setStatus)(e.target.value)}
            className="w-auto min-w-[150px]"
            aria-label={t('admin.common.status')}
          >
            <option value="">{t('admin.employees.allStatus')}</option>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.enum.employmentStatus.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>

        {!token ? (
          <SignedOutState onSignIn={() => navigate('/admin')} />
        ) : employees.loading ? (
          <TableLoading columns={7} />
        ) : employees.error ? (
          <ErrorState error={employees.error} onRetry={employees.reload} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <TH>{t('admin.employees.employee')}</TH>
                  <TH>{t('admin.employees.employeeId')}</TH>
                  <TH>{t('admin.employees.role')}</TH>
                  <TH>{t('admin.employees.phone')}</TH>
                  <TH>{t('admin.common.status')}</TH>
                  <TH>{t('admin.employees.joined')}</TH>
                  <TH>{t('admin.employees.pf')}</TH>
                  <TH className="w-12" />
                </tr>
              </thead>
              <tbody>
                {rows.map((employee) => (
                  <TR key={employee.id} onClick={() => (employee.driver ? navigate(`/admin/drivers/${employee.driver.id}`) : setEditing(employee))}>
                    <TD className="min-w-[200px]">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {initials(employee.fullName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{employee.fullName}</p>
                          <p className="truncate text-xs text-muted-foreground">{employee.designation ?? employee.department ?? '—'}</p>
                        </div>
                      </div>
                    </TD>
                    <TD className="figure whitespace-nowrap text-muted-foreground">{employee.employeeCode}</TD>
                    <TD>{t(`admin.enum.employeeRole.${employee.role}`)}</TD>
                    <TD className="figure whitespace-nowrap text-muted-foreground">{employee.phone ?? '—'}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[employee.status]}>{t(`admin.enum.employmentStatus.${employee.status}`)}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{employee.joiningDate ? fmtDate(employee.joiningDate) : '—'}</TD>
                    <TD>
                      {employee.payroll ? (
                        <Badge tone={employee.payroll.pfApplicable ? 'success' : 'neutral'}>
                          {t(employee.payroll.pfApplicable ? 'admin.employees.pfYes' : 'admin.employees.pfNo')}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD>
                      {mayManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()} aria-label={t('admin.common.actions')}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} className="w-52">
                            <DropdownMenuItem onSelect={() => setEditing(employee)}>{t('admin.employees.edit')}</DropdownMenuItem>
                            {employee.driver && (
                              <DropdownMenuItem onSelect={() => navigate(`/admin/drivers/${employee.driver?.id}`)}>
                                {t('admin.employees.openDriver')}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem destructive={employee.status === 'ACTIVE'} onSelect={() => setStatusTarget(employee)}>
                              <Power />
                              {employee.status === 'ACTIVE' ? t('admin.employees.deactivate') : t('admin.employees.activate')}
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
                {filtersActive ? t('admin.common.noResults') : t('admin.employees.empty')}
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

      <EmployeeFormDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={() => {
          setAdding(false);
          employees.reload();
        }}
      />
      <EmployeeFormDialog
        employee={editing ?? undefined}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => {
          setEditing(null);
          employees.reload();
        }}
      />
      <ConfirmDialog
        open={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={
          statusTarget?.status === 'ACTIVE'
            ? t('admin.employees.confirmDeactivate', { name: statusTarget?.fullName ?? '' })
            : t('admin.employees.confirmActivate', { name: statusTarget?.fullName ?? '' })
        }
        description={statusTarget?.status === 'ACTIVE' ? t('admin.employees.deactivateNote') : undefined}
        confirmLabel={statusTarget?.status === 'ACTIVE' ? t('admin.employees.deactivate') : t('admin.employees.activate')}
        destructive={statusTarget?.status === 'ACTIVE'}
        onConfirm={() => statusTarget && void toggleStatus(statusTarget)}
      />
    </div>
  );
}
