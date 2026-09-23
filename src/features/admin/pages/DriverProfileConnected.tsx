import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, FileText, IdCard, Pencil, Phone, Truck } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { driversApi } from '@/features/api/resources';
import { canManageFleet, useSession } from '@/features/api/session';
import { useApiResource } from '@/features/api/useApiResource';
import { fmtDate } from '@/lib/format';
import { initials } from '@/lib/utils';
import { DetailList, PageHeader, Panel, StatCard, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';
import { AssignVehicleToDriverDialog, EditDriverDialog } from '../../drivers/DriverProfileDialogs';
import { DRIVER_STATUS_TONE, LocationReadiness } from './DriversConnected';

/**
 * Driver profile for Phase 1. Only the sections that have real data in this phase are shown:
 * fuel, expenses, payments and full document management arrive with their own phases, so no
 * empty placeholder tabs are created for them here.
 */
export function DriverProfileConnected() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useSession((s) => s.user?.role);
  const mayManage = canManageFleet(role);

  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const driver = useApiResource(() => driversApi.get(id as string), [id], Boolean(id));
  const history = useApiResource(() => driversApi.assignments(id as string), [id], Boolean(id));
  const documents = useApiResource(() => driversApi.documentSummary(id as string), [id], Boolean(id));

  const reloadAll = () => {
    driver.reload();
    history.reload();
  };

  if (driver.loading) {
    return (
      <div>
        <PageHeader title={t('admin.drivers.title')} back={{ to: '/admin/drivers', label: t('admin.drivers.title') }} />
        <Panel>
          <TableLoading rows={4} columns={4} />
        </Panel>
      </div>
    );
  }

  if (driver.error || !driver.data) {
    return (
      <div>
        <PageHeader title={t('admin.drivers.title')} back={{ to: '/admin/drivers', label: t('admin.drivers.title') }} />
        <Panel>
          {driver.error ? (
            <ErrorState error={driver.error} onRetry={driver.reload} />
          ) : (
            <EmptyState icon={IdCard} title={t('admin.driversApi.notFound')} />
          )}
        </Panel>
      </div>
    );
  }

  const record = driver.data;
  const assignment = record.currentAssignment;

  return (
    <div>
      <PageHeader
        back={{ to: '/admin/drivers', label: t('admin.drivers.title') }}
        title={
          <span className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
              {initials(record.employee.fullName)}
            </span>
            {record.employee.fullName}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="figure">{record.driverCode}</span>
            <Badge tone={DRIVER_STATUS_TONE[record.status]}>{t(`admin.enum.driverStatus.${record.status}`)}</Badge>
          </span>
        }
        actions={
          mayManage && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil />
                {t('common.edit')}
              </Button>
              <Button onClick={() => setAssigning(true)}>
                <Truck />
                {t('admin.drivers.assignVehicle')}
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('admin.common.vehicle')} value={assignment ? assignment.vehicle.registrationNumber : t('admin.drivers.noVehicle')} icon={Truck} />
        <StatCard label={t('admin.driversApi.licence')} value={record.licenceNumber ?? '—'} sub={record.licenceExpiryDate ? t('admin.driversApi.licenceExpiryOn', { date: fmtDate(record.licenceExpiryDate) }) : undefined} icon={IdCard} />
        <StatCard label={t('admin.employees.joined')} value={record.employee.joiningDate ? fmtDate(record.employee.joiningDate) : '—'} icon={CalendarClock} />
        <StatCard
          label={t('admin.driversApi.documents')}
          value={documents.data ? String(documents.data.total) : '—'}
          sub={
            documents.data
              ? documents.data.expired > 0
                ? t('admin.driversApi.docsExpired', { count: documents.data.expired })
                : documents.data.expiringSoon > 0
                  ? t('admin.driversApi.docsExpiring', { count: documents.data.expiringSoon })
                  : t('admin.driversApi.docsFine')
              : undefined
          }
          icon={FileText}
          tone={documents.data && documents.data.expired > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title={t('admin.driversApi.overview')}>
          <DetailList
            rows={[
              [t('admin.employees.phone'), record.employee.phone ?? '—'],
              [t('admin.employees.email'), record.employee.email ?? '—'],
              [t('admin.driversApi.homeTown'), record.homeTown ?? '—'],
              [t('admin.drivers.language'), t(`admin.enum.language.${record.employee.preferredLanguage}`)],
              [
                t('admin.driversApi.emergency'),
                record.emergencyContact.name ? (
                  <span className="inline-flex items-center gap-1.5">
                    {record.emergencyContact.name}
                    {record.emergencyContact.phone && (
                      <span className="figure text-muted-foreground">
                        <Phone className="mr-1 inline size-3.5" />
                        {record.emergencyContact.phone}
                      </span>
                    )}
                  </span>
                ) : (
                  '—'
                ),
              ],
              [t('admin.driversApi.locationReadiness'), <LocationReadiness key="loc" driver={record} />],
            ]}
          />
        </Panel>

        <Panel title={t('admin.driversApi.employment')}>
          <DetailList
            rows={[
              [t('admin.employees.employeeId'), record.employee.employeeCode],
              [t('admin.employees.designation'), record.employee.designation ?? '—'],
              [t('admin.employees.department'), record.employee.department ?? '—'],
              [
                t('admin.driversApi.employmentStatus'),
                <Badge key="st" tone={record.employee.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {t(`admin.enum.employmentStatus.${record.employee.status}`)}
                </Badge>,
              ],
              [t('admin.employees.joined'), record.employee.joiningDate ? fmtDate(record.employee.joiningDate) : '—'],
            ]}
          />
        </Panel>

        {/* PF is payroll data: the API omits it entirely for roles that may not see it. */}
        {record.pf && (
          <Panel title={t('admin.driversApi.pfSummary')}>
            <DetailList
              rows={[
                [
                  t('admin.employees.pfApplicable'),
                  <Badge key="pf" tone={record.pf.applicable ? 'success' : 'neutral'}>
                    {t(record.pf.applicable ? 'admin.employees.pfYes' : 'admin.employees.pfNo')}
                  </Badge>,
                ],
                [t('admin.employees.uan'), record.pf.uan ?? '—'],
                [t('admin.employees.pfMemberId'), record.pf.memberId ?? '—'],
                [t('admin.employees.baseSalary'), record.pf.baseSalary ? `₹${Number(record.pf.baseSalary).toLocaleString('en-IN')}` : '—'],
              ]}
            />
          </Panel>
        )}

        <Panel title={t('admin.driversApi.currentVehicle')}>
          {assignment ? (
            <DetailList
              rows={[
                [
                  t('admin.common.vehicle'),
                  <button key="veh" type="button" className="hover:underline" onClick={() => navigate(`/admin/vehicles/${assignment.vehicle.id}`)}>
                    <Plate reg={assignment.vehicle.registrationNumber} size="xs" />
                  </button>,
                ],
                [t('admin.vehicles.kind'), t(`enum.vehicleKind.${assignment.vehicle.kind.toLowerCase()}`)],
                [t('admin.vehiclesApi.ownership'), t(`admin.enum.ownership.${assignment.vehicle.ownership}`)],
                [t('admin.driversApi.assignedSince'), fmtDate(assignment.startedAt.slice(0, 10))],
              ]}
            />
          ) : (
            <EmptyState icon={Truck} title={t('admin.driversApi.noVehicleTitle')} hint={t('admin.driversApi.noVehicleBody')} />
          )}
        </Panel>
      </div>

      <Panel title={t('admin.driversApi.assignmentHistory')} className="mt-4">
        {history.loading ? (
          <TableLoading rows={3} columns={4} />
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={history.reload} />
        ) : (history.data?.data.length ?? 0) === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('admin.driversApi.noHistory')}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>{t('admin.common.vehicle')}</TH>
                <TH>{t('admin.driversApi.from')}</TH>
                <TH>{t('admin.driversApi.to')}</TH>
                <TH>{t('admin.driversApi.reason')}</TH>
              </tr>
            </thead>
            <tbody>
              {history.data?.data.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <Plate reg={row.vehicle?.registrationNumber ?? null} size="xs" />
                  </TD>
                  <TD className="whitespace-nowrap">{fmtDate(row.startedAt.slice(0, 10))}</TD>
                  <TD className="whitespace-nowrap">
                    {row.isCurrent ? <Badge tone="success">{t('admin.driversApi.current')}</Badge> : fmtDate((row.endedAt ?? '').slice(0, 10))}
                  </TD>
                  <TD className="text-muted-foreground">{row.endReason ? t(`admin.enum.endReason.${row.endReason}`, { defaultValue: row.endReason }) : '—'}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <EditDriverDialog
        driver={record}
        open={editing}
        onOpenChange={setEditing}
        onSaved={() => {
          setEditing(false);
          reloadAll();
        }}
      />
      <AssignVehicleToDriverDialog
        driver={record}
        open={assigning}
        onOpenChange={setAssigning}
        onDone={() => {
          setAssigning(false);
          reloadAll();
        }}
      />
    </div>
  );
}
