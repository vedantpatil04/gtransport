import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BadgeIndianRupee, CalendarClock, Landmark, Pencil, ShieldCheck, UserRound } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { documentsApi, operationsApi, vehiclesApi } from '@/features/api/resources';
import { ComplianceBadge, docTypeLabelKey, VerificationBadge } from '@/features/documents/compliance';
import { DocumentDetailDialog, UploadDocumentDialog } from '@/features/documents/DocumentApiDialogs';
import { canManageFinance, canManageFleet, useSession } from '@/features/api/session';
import type { ApiFinancing } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { fmtDate } from '@/lib/format';
import { DetailList, PageHeader, Panel, StatCard, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';
import { AssignDriverToVehicleDialog, FinancingDialog, VehicleFormDialog } from '../../vehicles/VehicleApiDialogs';
import { InstalmentsPanel } from '../../vehicles/InstalmentsPanel';
import { VEHICLE_STATUS_TONE } from './VehiclesConnected';

const rupees = (value: string | number | null | undefined): string =>
  value === null || value === undefined || value === '' ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function VehicleDetailConnected() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useSession((s) => s.user?.role);

  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [financing, setFinancing] = useState(false);

  const vehicle = useApiResource(() => vehiclesApi.get(id as string), [id], Boolean(id));
  const history = useApiResource(() => vehiclesApi.assignments(id as string), [id], Boolean(id));
  const serviceHistory = useApiResource(
    () => operationsApi.list({ vehicleId: id as string, category: 'MAINTENANCE', limit: 20 }),
    [id],
    Boolean(id),
  );
  const documents = useApiResource(() => documentsApi.vehicle(id as string), [id], Boolean(id));
  const [openDocument, setOpenDocument] = useState<string | null>(null);
  const [addingDocument, setAddingDocument] = useState(false);

  const reloadAll = () => {
    vehicle.reload();
    history.reload();
  };

  if (vehicle.loading) {
    return (
      <div>
        <PageHeader title={t('admin.vehicles.title')} back={{ to: '/admin/vehicles', label: t('admin.vehicles.title') }} />
        <Panel>
          <TableLoading rows={4} columns={4} />
        </Panel>
      </div>
    );
  }

  if (vehicle.error || !vehicle.data) {
    return (
      <div>
        <PageHeader title={t('admin.vehicles.title')} back={{ to: '/admin/vehicles', label: t('admin.vehicles.title') }} />
        <Panel>
          {vehicle.error ? <ErrorState error={vehicle.error} onRetry={vehicle.reload} /> : <EmptyState icon={ShieldCheck} title={t('admin.vehiclesApi.notFound')} />}
        </Panel>
      </div>
    );
  }

  const record = vehicle.data;
  const assignment = record.currentAssignment;
  const isFinanced = record.ownership === 'FINANCED';

  return (
    <div>
      <PageHeader
        back={{ to: '/admin/vehicles', label: t('admin.vehicles.title') }}
        title={<Plate reg={record.registrationNumber} size="md" />}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{[record.make, record.model, record.variant].filter(Boolean).join(' ') || '—'}</span>
            <Badge tone={VEHICLE_STATUS_TONE[record.status]}>{t(`admin.enum.vehicleStatus.${record.status}`)}</Badge>
          </span>
        }
        actions={
          <>
            {canManageFleet(role) && (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil />
                  {t('common.edit')}
                </Button>
                <Button onClick={() => setAssigning(true)}>
                  <UserRound />
                  {t('admin.vehicles.assignDriver')}
                </Button>
              </>
            )}
            {isFinanced && canManageFinance(role) && (
              <Button variant="outline" onClick={() => setFinancing(true)}>
                <Landmark />
                {t('admin.vehiclesApi.editFinance')}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('admin.common.driver')} value={assignment ? assignment.driver.fullName : t('admin.vehiclesApi.noDriver')} icon={UserRound} />
        <StatCard label={t('admin.vehiclesApi.ownership')} value={t(`admin.enum.ownership.${record.ownership}`)} icon={ShieldCheck} tone={isFinanced ? 'warning' : 'success'} />
        {isFinanced && record.financing ? (
          <>
            <StatCard label={t('admin.vehiclesApi.emi')} value={rupees(record.financing.emiAmount)} icon={BadgeIndianRupee} hero />
            <StatCard
              label={t('admin.vehiclesApi.nextDue')}
              value={record.financing.nextDueDate ? fmtDate(record.financing.nextDueDate) : '—'}
              sub={
                record.financing.remainingInstallments !== null
                  ? t('admin.vehiclesApi.remaining', { count: record.financing.remainingInstallments })
                  : undefined
              }
              icon={CalendarClock}
            />
          </>
        ) : (
          <StatCard label={t('admin.vehiclesApi.finance')} value={t('admin.vehiclesApi.fullyOwned')} sub={t('admin.vehiclesApi.noEmi')} icon={ShieldCheck} />
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title={t('admin.vehiclesApi.information')}>
          <DetailList
            rows={[
              [t('admin.vehicles.reg'), record.registrationNumber],
              [t('admin.vehicles.kind'), t(`enum.vehicleKind.${record.kind.toLowerCase()}`)],
              [t('admin.fuel.type'), t(`enum.fuelType.${record.fuelType.toLowerCase()}`)],
              [t('admin.vehicles.year'), record.manufactureYear ?? '—'],
              [t('admin.vehicles.capacity'), record.capacityTonnes ? `${Number(record.capacityTonnes)} t` : '—'],
              [t('admin.vehicles.mileage'), record.mileageKmpl ? `${Number(record.mileageKmpl)} km/L` : '—'],
              [t('admin.vehiclesApi.notes'), record.notes ?? '—'],
            ]}
          />
        </Panel>

        <Panel title={t('admin.vehiclesApi.driverAssignment')}>
          {assignment ? (
            <DetailList
              rows={[
                [
                  t('admin.common.driver'),
                  <button key="drv" type="button" className="hover:underline" onClick={() => navigate(`/admin/drivers/${assignment.driver.id}`)}>
                    {assignment.driver.fullName}
                  </button>,
                ],
                [t('admin.driversApi.driverId'), assignment.driver.driverCode],
                [t('admin.employees.phone'), assignment.driver.phone ?? '—'],
                [t('admin.driversApi.assignedSince'), fmtDate(assignment.startedAt.slice(0, 10))],
              ]}
            />
          ) : (
            <EmptyState icon={UserRound} title={t('admin.vehiclesApi.noDriverTitle')} hint={t('admin.vehiclesApi.noDriverBody')} />
          )}
        </Panel>
      </div>

      {/* Ownership: a fully owned vehicle says so; only financed vehicles show loan details. */}
      <Panel title={isFinanced ? t('admin.vehiclesApi.finance') : t('admin.vehiclesApi.ownership')} className="mt-4">
        {!isFinanced ? (
          <div className="px-4 py-6">
            <p className="text-lg font-semibold">{t('admin.vehiclesApi.fullyOwned')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('admin.vehiclesApi.fullyOwnedBody')}</p>
          </div>
        ) : record.financing ? (
          <FinanceDetails financing={record.financing} />
        ) : (
          <EmptyState
            icon={Landmark}
            title={t('admin.vehiclesApi.financeMissingTitle')}
            hint={t('admin.vehiclesApi.financeMissingBody')}
            action={
              canManageFinance(role) ? (
                <Button onClick={() => setFinancing(true)}>
                  <Landmark />
                  {t('admin.vehiclesApi.addFinance')}
                </Button>
              ) : undefined
            }
          />
        )}
      </Panel>

      {/* EMI instalments: managed while financed; a paid-off loan stays readable as history. */}
      {isFinanced && record.financing && <InstalmentsPanel vehicleId={record.id} editable={canManageFinance(role)} onChanged={vehicle.reload} />}
      {!isFinanced && record.pastFinancing && (
        <>
          <Panel title={t('admin.vehiclesApi.pastFinancing')} className="mt-4">
            <p className="px-4 pt-4 text-sm text-muted-foreground">{t('admin.vehiclesApi.pastFinancingBody')}</p>
            <FinanceDetails financing={record.pastFinancing} />
          </Panel>
          <InstalmentsPanel vehicleId={record.id} editable={false} onChanged={vehicle.reload} />
        </>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Maintenance/service records from Phase 3, newest first. */}
        <Panel title={t('admin.opsApi.serviceHistory')}>
          {serviceHistory.loading ? (
            <TableLoading rows={3} columns={3} />
          ) : (serviceHistory.data?.data.length ?? 0) === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('admin.opsApi.noService')}</p>
          ) : (
            <ul className="divide-y">
              {serviceHistory.data?.data.map((record) => (
                <li key={record.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{fmtDate(record.expenseDate)}</p>
                    <p className="truncate text-xs text-muted-foreground">{record.description ?? record.vendorName ?? '—'}</p>
                  </div>
                  <span className="figure shrink-0 font-semibold">{rupees(record.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* The central document module: RC, insurance, PUC, tyre insurance, fitness, permit. */}
        <Panel
          title={t('admin.docsApi.documents')}
          action={
            canManageFleet(role) ? (
              <Button size="sm" variant="outline" onClick={() => setAddingDocument(true)}>
                {t('admin.docsApi.upload')}
              </Button>
            ) : undefined
          }
        >
          {documents.loading ? (
            <TableLoading rows={3} columns={2} />
          ) : (
            <ul className="divide-y">
              {documents.data?.map((item) => (
                <li key={item.type}>
                  <button
                    type="button"
                    disabled={!item.document}
                    onClick={() => item.document && setOpenDocument(item.document.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left enabled:hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t(docTypeLabelKey(item.type))}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.document?.expiryDate ? t('expiry.validTill', { date: fmtDate(item.document.expiryDate) }) : '—'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {item.document && item.document.verificationStatus !== 'VERIFIED' ? <VerificationBadge value={item.document.verificationStatus} /> : null}
                      <ComplianceBadge status={item.status} daysRemaining={item.daysRemaining} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={t('admin.vehiclesApi.assignmentHistory')} className="mt-4">
        {history.loading ? (
          <TableLoading rows={3} columns={4} />
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={history.reload} />
        ) : (history.data?.data.length ?? 0) === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('admin.vehiclesApi.noHistory')}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>{t('admin.common.driver')}</TH>
                <TH>{t('admin.driversApi.from')}</TH>
                <TH>{t('admin.driversApi.to')}</TH>
                <TH>{t('admin.driversApi.reason')}</TH>
              </tr>
            </thead>
            <tbody>
              {history.data?.data.map((row) => (
                <TR key={row.id}>
                  <TD>{row.driver?.fullName ?? '—'}</TD>
                  <TD className="whitespace-nowrap">{fmtDate(row.startedAt.slice(0, 10))}</TD>
                  <TD className="whitespace-nowrap">
                    {row.isCurrent ? <Badge tone="success">{t('admin.driversApi.current')}</Badge> : fmtDate((row.endedAt ?? '').slice(0, 10))}
                  </TD>
                  <TD className="text-muted-foreground">
                    {row.endReason ? t(`admin.enum.endReason.${row.endReason}`, { defaultValue: row.endReason }) : '—'}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <VehicleFormDialog
        vehicle={record}
        open={editing}
        onOpenChange={setEditing}
        onSaved={() => {
          setEditing(false);
          reloadAll();
        }}
      />
      <AssignDriverToVehicleDialog
        vehicle={record}
        open={assigning}
        onOpenChange={setAssigning}
        onDone={() => {
          setAssigning(false);
          reloadAll();
        }}
      />
      <DocumentDetailDialog documentId={openDocument} onClose={() => setOpenDocument(null)} onChanged={documents.reload} />
      <UploadDocumentDialog
        open={addingDocument}
        onOpenChange={setAddingDocument}
        presetVehicleId={record.id}
        onSaved={() => {
          setAddingDocument(false);
          documents.reload();
        }}
      />
      <FinancingDialog
        vehicle={record}
        open={financing}
        onOpenChange={setFinancing}
        onSaved={() => {
          setFinancing(false);
          reloadAll();
        }}
      />
    </div>
  );
}

function FinanceDetails({ financing }: { financing: ApiFinancing }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <DetailList
        rows={[
          [t('admin.vehiclesApi.lender'), financing.lenderName ?? '—'],
          [t('admin.vehiclesApi.loanAccount'), financing.loanAccountNumber ?? '—'],
          [t('admin.vehiclesApi.loanAmount'), rupees(financing.loanAmount)],
          [t('admin.vehiclesApi.downPayment'), rupees(financing.downPayment)],
          [t('admin.vehiclesApi.financeStart'), financing.financeStartDate ? fmtDate(financing.financeStartDate) : '—'],
          [
            t('admin.vehiclesApi.financeStatus'),
            <Badge key="fs" tone={financing.status === 'ACTIVE' ? 'warning' : financing.status === 'DEFAULTED' ? 'danger' : 'neutral'}>
              {t(`admin.enum.financeStatus.${financing.status}`)}
            </Badge>,
          ],
        ]}
      />
      <DetailList
        rows={[
          [t('admin.vehiclesApi.emi'), rupees(financing.emiAmount)],
          [t('admin.vehiclesApi.rate'), financing.interestRatePct ? `${Number(financing.interestRatePct)}%` : '—'],
          [t('admin.vehiclesApi.tenure'), financing.tenureMonths ? t('admin.vehiclesApi.months', { count: financing.tenureMonths }) : '—'],
          [
            t('admin.vehiclesApi.installments'),
            financing.totalInstallments !== null
              ? `${financing.paidInstallments ?? 0} / ${financing.totalInstallments}`
              : '—',
          ],
          [t('admin.vehiclesApi.outstanding'), rupees(financing.outstandingAmount)],
          [t('admin.vehiclesApi.nextDue'), financing.nextDueDate ? fmtDate(financing.nextDueDate) : '—'],
          [t('admin.vehiclesApi.financeEnd'), financing.financeEndDate ? fmtDate(financing.financeEndDate) : '—'],
        ]}
      />
      {financing.calculated && (
        <p className="text-xs text-muted-foreground lg:col-span-2">
          {t('admin.vehiclesApi.calculatedNote', {
            total: Math.round(Number(financing.calculated.totalPayable)).toLocaleString('en-IN'),
            interest: Math.round(Number(financing.calculated.totalInterest)).toLocaleString('en-IN'),
          })}
        </p>
      )}
    </div>
  );
}
