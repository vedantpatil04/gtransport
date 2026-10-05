import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, NoAccessState } from '@/features/admin/components/states';
import { FilterBar, PageHeader, Panel, SearchInput } from '@/features/admin/components/ui';
import { driversApi, employeesApi, vehiclesApi } from '@/features/api/resources';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { docTypeLabelKey, type ApiDocumentType } from '@/features/documents/compliance';
import { fmtDate } from '@/lib/format';
import { REPORT_TYPES, reportsApi, type ReportMeta, type ReportParams, type ReportType } from './api';
import { ExportMenu, FilterSelect, PeriodFilter, ReportTabs } from './components';
import { REPORT_FILTERS, useReportParams, usesPeriod, type FilterKey } from './params';
import { OverviewReportView } from './views/OverviewReport';
import { FuelReportView } from './views/FuelReport';
import { ExpenseReportView } from './views/ExpenseReport';
import { VehicleReportView } from './views/VehicleReport';
import { DriverReportView } from './views/DriverReport';
import { FinanceReportView } from './views/FinanceReport';
import { MaintenanceReportView } from './views/MaintenanceReport';
import { TyreReportView } from './views/TyreReport';
import { ComplianceReportView } from './views/ComplianceReport';
import { LocationReportView } from './views/LocationReport';

export interface ReportViewProps {
  params: ReportParams;
  paramsKey: string;
  meta: ReportMeta;
  setFilter: (key: FilterKey, value: string | undefined) => void;
}

const VIEWS: Record<ReportType, (props: ReportViewProps) => JSX.Element> = {
  overview: OverviewReportView,
  fuel: FuelReportView,
  vehicles: VehicleReportView,
  drivers: DriverReportView,
  finance: FinanceReportView,
  expenses: ExpenseReportView,
  maintenance: MaintenanceReportView,
  tyres: TyreReportView,
  compliance: ComplianceReportView,
  location: LocationReportView,
};

/**
 * Reports & Management in real mode. Which reports appear comes from the server (`/reports/meta`),
 * which applies the same role policy as every report and export route — the tabs are a courtesy,
 * the API is the authority.
 */
export function ReportsConnected() {
  const { t } = useTranslation();
  const { report } = useParams();
  const meta = useApiResource(() => reportsApi.meta(), []);

  if (meta.error) {
    return (
      <div>
        <PageHeader title={t('admin.reportsApi.title')} />
        <Panel>
          <ErrorState error={meta.error} onRetry={meta.reload} />
        </Panel>
      </div>
    );
  }
  if (meta.loading || !meta.data) {
    return (
      <div aria-busy="true">
        <PageHeader title={t('admin.reportsApi.title')} />
        <Skeleton className="mb-4 h-9 w-full max-w-3xl" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }

  const type = (report ?? 'overview') as ReportType;
  if (!REPORT_TYPES.includes(type)) return <Navigate to="/admin/reports" replace />;
  if (!meta.data.reports.includes(type)) {
    // A role without the overview still lands on the first report it may open.
    if (!report && meta.data.reports[0]) return <Navigate to={`/admin/reports/${meta.data.reports[0]}`} replace />;
    return (
      <div>
        <PageHeader title={t('admin.reportsApi.title')} />
        <ReportTabs allowed={meta.data.reports} current={type} />
        <NoAccessState />
      </div>
    );
  }
  return <ReportScreen key={type} type={type} meta={meta.data} />;
}

function ReportScreen({ type, meta }: { type: ReportType; meta: ReportMeta }) {
  const { t, i18n } = useTranslation();
  const { period, filters, params, key, setPeriod, setFilter, clearFilters, ready } = useReportParams(type);
  const View = VIEWS[type];
  const description = usesPeriod(type) ? t(`admin.reportsApi.descriptions.${type}`) : t('admin.reportsApi.asOf', { date: fmtDate(meta.today, i18n.language) });

  return (
    <div data-testid={`report-${type}`}>
      <PageHeader title={t('admin.reportsApi.title')} description={description} actions={<ExportMenu type={type} params={params} disabled={!ready} />} />
      <ReportTabs allowed={meta.reports} current={type} />

      <Panel className="mb-4">
        <FilterBar active={Object.keys(filters).length > 0} onClear={clearFilters}>
          {usesPeriod(type) && <PeriodFilter period={period} meta={meta} onChange={setPeriod} />}
          <ReportFilters type={type} meta={meta} filters={filters} setFilter={setFilter} />
        </FilterBar>
        {!ready && <p className="px-4 py-3 text-sm text-muted-foreground">{t('admin.reportsApi.period.chooseDates')}</p>}
      </Panel>

      {ready && <View params={params} paramsKey={key} meta={meta} setFilter={setFilter} />}
    </div>
  );
}

const LEDGER_TYPES = ['FUEL', 'RTO', 'TYRE', 'TYRE_INSURANCE', 'MAINTENANCE', 'SALARY', 'ADVANCE', 'ALLOWANCE', 'OTHER_PAYMENT', 'EMI', 'CUSTOMER_PAYMENT', 'OTHER_INCOME', 'OTHER_EXPENSE'];
const PAYMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'STATUS_REVIEW_REQUIRED', 'PAID', 'FAILED', 'CANCELLED', 'REVERSED'];
const AI_STATUSES = ['NOT_PROCESSED', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'NEEDS_REVIEW', 'FAILED', 'RETRYING', 'VERIFIED', 'REJECTED'];
const DOCUMENT_TYPES: ApiDocumentType[] = ['RC', 'INSURANCE', 'PUC', 'DRIVING_LICENCE', 'TYRE_INSURANCE', 'FITNESS', 'PERMIT', 'OTHER'];
const STATUS_OPTIONS: Partial<Record<ReportType, { values: string[]; labelKey: (v: string) => string }>> = {
  vehicles: { values: ['ACTIVE', 'MAINTENANCE', 'IDLE', 'RETIRED'], labelKey: (v) => `admin.enum.vehicleStatus.${v}` },
  drivers: { values: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ON_LEAVE'], labelKey: (v) => `admin.enum.driverStatus.${v}` },
  compliance: { values: ['VALID', 'EXPIRING', 'EXPIRED', 'MISSING', 'PENDING_VERIFICATION'], labelKey: (v) => `admin.reportsApi.health.${v}` },
  location: { values: ['ACTIVE', 'STALE', 'OFFLINE', 'PERMISSION_DENIED', 'LOCATION_DISABLED'], labelKey: (v) => `admin.fleet.status.${v}` },
};

/** The filters this report understands, and only those. */
function ReportFilters({ type, meta, filters, setFilter }: { type: ReportType; meta: ReportMeta; filters: Partial<Record<FilterKey, string>>; setFilter: (key: FilterKey, value: string | undefined) => void }) {
  const { t } = useTranslation();
  const has = (key: FilterKey) => REPORT_FILTERS[type].includes(key);
  const vehicles = useApiResource(() => vehiclesApi.list({ limit: 100 }), [], has('vehicleId'));
  const drivers = useApiResource(() => driversApi.list({ limit: 100 }), [], has('driverId'));
  const employees = useApiResource(() => employeesApi.list({ limit: 100 }), [], has('employeeId'));

  const [station, setStation] = useState(filters.station ?? '');
  const stationSearch = useDebounced(station);
  useEffect(() => {
    if (has('station') && (stationSearch || undefined) !== filters.station) setFilter('station', stationSearch || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationSearch]);
  useEffect(() => {
    if (!filters.station) setStation('');
  }, [filters.station]);

  const status = STATUS_OPTIONS[type];
  return (
    <>
      {has('category') && (
        <FilterSelect value={filters.category} onChange={(v) => setFilter('category', v)} label={t('admin.reportsApi.filters.category')} allLabel={t('admin.reportsApi.filters.allCategories')} options={meta.expenseCategories.map((c) => ({ value: c, label: t(`enum.category.${c.toLowerCase()}`) }))} testId="filter-category" />
      )}
      {has('documentType') && (
        <FilterSelect value={filters.documentType} onChange={(v) => setFilter('documentType', v)} label={t('admin.reportsApi.filters.documentType')} allLabel={t('admin.reportsApi.filters.allDocuments')} options={DOCUMENT_TYPES.map((d) => ({ value: d, label: t(docTypeLabelKey(d)) }))} />
      )}
      {has('owner') && (
        <FilterSelect value={filters.owner} onChange={(v) => setFilter('owner', v)} label={t('admin.reportsApi.filters.owner')} allLabel={t('admin.reportsApi.filters.allOwners')} options={[{ value: 'VEHICLE', label: t('admin.reportsApi.owner.VEHICLE') }, { value: 'EMPLOYEE', label: t('admin.reportsApi.owner.EMPLOYEE') }]} />
      )}
      {has('window') && (
        <FilterSelect value={filters.window} onChange={(v) => setFilter('window', v)} label={t('admin.reportsApi.filters.window')} allLabel={t('admin.reportsApi.filters.windowDays', { days: meta.defaultExpiryWindow })} options={meta.expiryWindows.filter((w) => w !== meta.defaultExpiryWindow).map((w) => ({ value: String(w), label: t('admin.reportsApi.filters.windowDays', { days: w }) }))} testId="filter-window" />
      )}
      {has('vehicleId') && (
        <FilterSelect value={filters.vehicleId} onChange={(v) => setFilter('vehicleId', v)} label={t('admin.common.vehicle')} allLabel={t('admin.common.allVehicles')} options={(vehicles.data?.data ?? []).map((v) => ({ value: v.id, label: v.registrationNumber }))} testId="filter-vehicle" />
      )}
      {has('driverId') && (
        <FilterSelect value={filters.driverId} onChange={(v) => setFilter('driverId', v)} label={t('admin.common.driver')} allLabel={t('admin.common.allDrivers')} options={(drivers.data?.data ?? []).map((d) => ({ value: d.id, label: d.employee.fullName }))} testId="filter-driver" />
      )}
      {has('employeeId') && (
        <FilterSelect value={filters.employeeId} onChange={(v) => setFilter('employeeId', v)} label={t('admin.reportsApi.filters.employee')} allLabel={t('admin.reportsApi.filters.allEmployees')} options={(employees.data?.data ?? []).map((e) => ({ value: e.id, label: e.fullName }))} />
      )}
      {has('fuelType') && (
        <FilterSelect value={filters.fuelType} onChange={(v) => setFilter('fuelType', v)} label={t('admin.fuel.type')} allLabel={t('admin.fuel.allTypes')} options={[{ value: 'PETROL', label: t('enum.fuelType.petrol') }, { value: 'DIESEL', label: t('enum.fuelType.diesel') }]} testId="filter-fuel-type" />
      )}
      {has('station') && <SearchInput value={station} onChange={setStation} placeholder={t('admin.fuel.station')} className="w-full sm:w-48" />}
      {has('ownership') && (
        <FilterSelect value={filters.ownership} onChange={(v) => setFilter('ownership', v)} label={t('admin.vehiclesApi.ownership')} allLabel={t('admin.vehiclesApi.allOwnership')} options={['OWNED', 'FINANCED'].map((o) => ({ value: o, label: t(`admin.enum.ownership.${o}`) }))} />
      )}
      {has('kind') && (
        <FilterSelect value={filters.kind} onChange={(v) => setFilter('kind', v)} label={t('admin.reportsApi.filters.kind')} allLabel={t('admin.reportsApi.filters.allKinds')} options={['LCV', 'PICKUP', 'TRUCK'].map((k) => ({ value: k, label: t(`enum.vehicleKind.${k.toLowerCase()}`) }))} />
      )}
      {has('type') && (
        <FilterSelect value={filters.type} onChange={(v) => setFilter('type', v)} label={t('admin.reportsApi.filters.ledgerType')} allLabel={t('admin.reportsApi.filters.allLedgerTypes')} options={LEDGER_TYPES.map((v) => ({ value: v, label: t(`admin.enum.ledgerType.${v}`) }))} />
      )}
      {has('paymentStatus') && (
        <FilterSelect value={filters.paymentStatus} onChange={(v) => setFilter('paymentStatus', v)} label={t('admin.reportsApi.filters.paymentStatus')} allLabel={t('admin.reportsApi.filters.allPaymentStatuses')} options={PAYMENT_STATUSES.map((v) => ({ value: v, label: t(`admin.enum.paymentStatus.${v}`) }))} />
      )}
      {has('aiStatus') && (
        <FilterSelect value={filters.aiStatus} onChange={(v) => setFilter('aiStatus', v)} label={t('admin.reportsApi.filters.receiptStatus')} allLabel={t('admin.reportsApi.filters.allReceiptStatuses')} options={AI_STATUSES.map((v) => ({ value: v, label: t(`admin.receiptAi.status.${v}`) }))} />
      )}
      {has('status') && status && (
        <FilterSelect value={filters.status} onChange={(v) => setFilter('status', v)} label={t('admin.common.status')} allLabel={t('admin.reportsApi.filters.allStatuses')} options={status.values.map((v) => ({ value: v, label: t(status.labelKey(v)) }))} testId="filter-status" />
      )}
    </>
  );
}
