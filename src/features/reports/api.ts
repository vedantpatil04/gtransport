import { API_BASE_URL, ApiError, type Query } from '@/lib/api/client';
import { authedRequest, useSession } from '@/features/api/session';
import { saveFile, type SaveResult } from '@/lib/download';

/**
 * The Reports & Management API (Phase 8). Every figure is computed by the server from the
 * source records; the console only renders what comes back — it never totals a list itself.
 * Money arrives as two-decimal strings and dates as YYYY-MM-DD, exactly as stored.
 */

export const REPORT_TYPES = ['overview', 'fuel', 'vehicles', 'drivers', 'finance', 'expenses', 'maintenance', 'tyres', 'compliance', 'location'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const PRESETS = ['today', 'yesterday', 'this_week', 'this_month', 'previous_month', 'this_quarter', 'this_fy', 'previous_fy', 'fy', 'custom'] as const;
export type Preset = (typeof PRESETS)[number];

export type ExportFormat = 'pdf' | 'xlsx' | 'csv';
export type ExpenseCategory = 'FUEL' | 'RTO' | 'TYRE' | 'TYRE_INSURANCE' | 'MAINTENANCE';
export type Money = string;

export interface ReportRange {
  preset: Preset;
  from: string;
  to: string;
  days: number;
  granularity: 'day' | 'month';
  label: string;
  financialYears: { code: string; label: string }[];
}

export interface ReportHead {
  report: ReportType;
  range: ReportRange | null;
  asOf: string;
  filters: Record<string, string>;
  generatedAt: string;
}

export interface ReportVisibility {
  payments: boolean;
  compliance: boolean;
  location: boolean;
}

export interface ReportMeta {
  reports: ReportType[];
  visibility: ReportVisibility;
  today: string;
  currentFinancialYear: { code: string; label: string };
  financialYears: { code: string; label: string; from: string; to: string }[];
  presets: Preset[];
  maxRangeDays: number;
  expenseCategories: ExpenseCategory[];
  expiryWindows: number[];
  defaultExpiryWindow: number;
}

export interface ReportPage<T> {
  data: T[];
  page: { page: number; pageSize: number; total: number; pageCount: number };
  sort: { field: string; dir: 'asc' | 'desc' };
}

export type TrendBucket<K extends string> = { bucket: string; from: string; to: string } & Record<K, string | number>;

export interface Figures {
  entries: number;
  amount: Money;
  litres: string;
  averageRate: string | null;
  share: string | null;
}
export interface Breakdown extends Figures {
  id: string;
  label: string;
}

// ───────────────────────────── Per report ─────────────────────────────

export interface FuelReport extends ReportHead {
  totals: { entries: number; amount: Money; litres: string; averageRate: string | null };
  byFuelType: Record<'PETROL' | 'DIESEL', Omit<Figures, 'share'> & { share: string | null }>;
  trend: TrendBucket<'amount' | 'litres' | 'entries'>[];
  byVehicle: Breakdown[];
  byDriver: Breakdown[];
  byStation: Breakdown[];
  highestSpendVehicle: Breakdown | null;
}
export interface FuelRecord {
  id: string;
  date: string;
  vehicle: { id: string; registrationNumber: string };
  driver: { id: string; name: string; code: string };
  fuelType: 'PETROL' | 'DIESEL';
  litres: string;
  amount: Money;
  rate: string | null;
  station: string;
  receiptFileId: string | null;
}

export interface SplitBreakdown {
  id: string | null;
  label: string | null;
  amount: Money;
  byCategory: Partial<Record<ExpenseCategory, Money>>;
}
export interface ExpenseReport extends ReportHead {
  categories: ExpenseCategory[];
  total: Money;
  entries: number;
  byCategory: { category: ExpenseCategory; entries: number; amount: Money; share: string | null }[];
  trend: TrendBucket<ExpenseCategory | 'total'>[];
  byVehicle: SplitBreakdown[];
  byDriver: SplitBreakdown[];
}
export interface ExpenseRecord {
  id: string;
  category: ExpenseCategory;
  date: string;
  amount: Money;
  vehicle: { id: string; registrationNumber: string } | null;
  driver: { id: string; name: string } | null;
  vendor: string | null;
  description: string | null;
  receiptFileId: string | null;
}

export interface VehicleCostRow {
  id: string;
  registrationNumber: string;
  kind: string;
  ownership: 'OWNED' | 'FINANCED';
  status: string;
  makeModel: string | null;
  driver: { id: string; name: string } | null;
  fuel: { entries: number; amount: Money; litres: string };
  rto: Money;
  tyre: Money;
  tyreInsurance: Money;
  maintenance: Money;
  otherExpenses: Money;
  operatingCost: Money;
  finance: {
    status: string;
    lender: string | null;
    emiAmount: Money | null;
    outstanding: Money | null;
    nextDueDate: string | null;
    paidInPeriod: Money;
    dueInPeriod: Money;
    overdueCount: number;
    overdueAmount: Money;
  } | null;
  documents?: { expired: number; expiring: number; missing: number; health: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING' };
}
export interface VehicleReport extends ReportHead {
  visibility: ReportVisibility;
  vehicles: number;
  totals: { fuel: Money; rto: Money; tyre: Money; tyreInsurance: Money; maintenance: Money; otherExpenses: Money; operatingCost: Money };
  finance: { financedVehicles: number; outstanding: Money; outstandingRecorded: number; paidInPeriod: Money; overdueInstallments: number };
  highest: Record<'operatingCost' | 'fuel' | 'maintenance', { id: string; label: string; amount: Money } | null>;
  comparison: { id: string; label: string; fuel: Money; maintenance: Money; tyre: Money; rto: Money; total: Money }[];
  trend: TrendBucket<'fuel' | 'other' | 'total'>[];
  trendScope: string | null;
}

export interface DriverActivityRow {
  id: string;
  name: string;
  code: string;
  status: string;
  vehicle: { id: string; registrationNumber: string } | null;
  fuel: { entries: number; amount: Money; litres: string };
  expenses: { entries: number; amount: Money };
  services: number;
  documentUploads: number;
  payments?: { paid: Money; paidCount: number; open: Money; openCount: number; failedCount: number };
  location?: { status: string | null; lastSeenAt: string | null; stationaryAlerts: number };
}
export interface DriverReport extends ReportHead {
  visibility: ReportVisibility;
  drivers: number;
  activeDrivers: number;
  withFuelEntries: number;
  totals: { fuelEntries: number; fuel: Money; expenseEntries: number; expenses: Money; services: number; documentUploads: number };
  fuelByDriver: { id: string; label: string; amount: Money; entries: number }[];
}

export interface StatusTotal {
  count: number;
  amount: Money;
}
export type PaymentGroup = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled' | 'reversed';
export interface FinanceReport extends ReportHead {
  ledger: {
    inflow: Money;
    outflow: Money;
    net: Money;
    categories: { type: string; direction: 'INCOME' | 'EXPENSE'; entries: number; amount: Money }[];
    trend: TrendBucket<'inflow' | 'outflow'>[];
  };
  salaries: {
    count: number; baseSalary: Money; allowances: Money; advanceRecovery: Money; deductions: Money; netPayable: Money;
    pending: { count: number; netPayable: Money }; paid: { count: number; netPayable: Money }; cancelled: { count: number; netPayable: Money };
  };
  advances: { count: number; amount: Money; pending: StatusTotal; paid: StatusTotal; cancelled: StatusTotal; byType: { type: string; count: number; amount: Money }[] };
  payments: {
    byStatus: Record<string, StatusTotal>;
    byGroup: Record<PaymentGroup, StatusTotal>;
    byType: { type: string; count: number; paid: Money; open: Money }[];
    paidInPeriod: StatusTotal;
  };
  vehicleFinance: {
    loans: {
      vehicle: { id: string; registrationNumber: string }; status: string; lender: string | null; emiAmount: Money | null; outstanding: Money | null;
      nextDueDate: string | null; dueInPeriod: StatusTotal; paidInPeriod: StatusTotal; overdue: StatusTotal;
    }[];
    activeLoans: number;
    outstanding: Money;
    outstandingRecorded: number;
    dueInPeriod: Money;
    paidInPeriod: Money;
    overdue: StatusTotal;
  };
  byVehicle: { id: string; label: string; emi: Money; operating: Money; total: Money }[];
  byEmployee: { id: string; label: string; code: string; salaries: number; salaryNet: Money; allowances: Money; advances: Money; advanceCount: number; total: Money }[];
}
export interface LedgerLine {
  id: string;
  date: string;
  type: string;
  direction: 'INCOME' | 'EXPENSE';
  amount: Money;
  description: string | null;
  employee: { id: string; name: string } | null;
  driver: { id: string; name: string } | null;
  vehicle: { id: string; registrationNumber: string } | null;
  sourceType: string;
  isReversal: boolean;
  paymentStatus: string | null;
}

export type VerificationGroup = 'verified' | 'awaitingVerification' | 'inProgress' | 'failed' | 'rejected' | 'notProcessed';
export interface MaintenanceReport extends ReportHead {
  totals: { services: number; amount: Money };
  verification: Record<VerificationGroup, StatusTotal>;
  pendingVerification: StatusTotal;
  byStatus: { status: string; count: number; amount: Money }[];
  trend: TrendBucket<'amount' | 'services'>[];
  byVehicle: { id: string; label: string; services: number; amount: Money; share: string | null; averageDaysBetween: number | null; lastServiceDate: string | null }[];
  highestVehicle: { id: string; label: string; amount: Money } | null;
  recurring: { vehicle: { id: string; registrationNumber: string }; serviceType: string; count: number; amount: Money; lastDate: string | null }[];
}
export interface ServiceRecord {
  id: string;
  date: string;
  vehicle: { id: string; registrationNumber: string };
  driver: { id: string; name: string } | null;
  vendor: string | null;
  description: string | null;
  amount: Money;
  receiptFileId: string | null;
  aiStatus: string;
  verified: boolean;
  verifiedAt: string | null;
  serviceType: string | null;
  invoiceNumber: string | null;
  odometerKm: number | null;
}

export interface TyreReport extends ReportHead {
  expenses: { entries: number; amount: Money };
  insurance: { policies: number; premiums: Money };
  total: Money;
  cover: { valid: number; expiring: number; expired: number; missing: number; vehicles: number };
  byVehicle: { id: string; label: string; tyre: Money; tyreEntries: number; premium: Money; policies: number; total: Money }[];
  trend: TrendBucket<'tyre' | 'premium'>[];
  tyreDetailsRecorded: boolean;
}
export interface TyreExpenseRecord {
  id: string;
  date: string;
  vehicle: { id: string; registrationNumber: string };
  driver: { id: string; name: string } | null;
  vendor: string | null;
  description: string | null;
  amount: Money;
  receiptFileId: string | null;
}
export interface TyrePolicyRecord {
  id: string;
  vehicle: { id: string; registrationNumber: string } | null;
  insurer: string | null;
  policyNumber: string | null;
  premium: Money | null;
  startDate: string | null;
  recordedOn: string;
  expiryDate: string | null;
  daysRemaining: number | null;
  health: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'SUPERSEDED';
  verification: string;
  fileId: string | null;
}

export type DocumentHealth = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING';
export interface ComplianceReport extends ReportHead {
  windowDays: number;
  totals: { documents: number; valid: number; expiring: number; expired: number; missing: number; pendingVerification: number };
  bands: { expired: number; d7: number; d30: number; d60: number; d90: number };
  byType: { type: string; documents: number; valid: number; expiring: number; expired: number; missing: number; pendingVerification: number }[];
}
export interface ComplianceItem {
  documentId: string | null;
  type: string;
  owner: { kind: 'VEHICLE' | 'EMPLOYEE' | 'COMPANY'; id: string | null; label: string; driverId: string | null };
  documentNumber: string | null;
  issuer: string | null;
  expiryDate: string | null;
  daysRemaining: number | null;
  health: DocumentHealth;
  verification: string | null;
  fileId: string | null;
}

export interface LocationReport extends ReportHead {
  asOf: string;
  tracking: { drivers: number; active: number; stale: number; offline: number; unavailable: number; stationaryNow: number; neverReported: number };
  staleDrivers: { driverId: string; name: string; vehicle: string | null; status: string; lastSeenAt: string | null }[];
  alerts: { total: number; active: number; acknowledged: number; resolved: number; totalMinutes: number; longestMinutes: number | null };
  activity: { retentionDays: number; coveredFrom: string | null; days: { date: string; fixes: number; drivers: number }[] };
}
export interface DriverTrackingRow {
  driverId: string;
  name: string;
  code: string;
  vehicle: { id: string; registrationNumber: string } | null;
  status: string;
  trackingState: string;
  lastUpdate: string | null;
  lastSeenAt: string | null;
  stale: boolean;
  stationarySince: string | null;
  stationaryMinutes: number | null;
  alertsInPeriod: number;
  fixesInWindow: number;
}
export interface StopRecord {
  id: string;
  driver: { id: string; name: string };
  vehicle: { id: string; registrationNumber: string } | null;
  status: string;
  triggeredAt: string;
  stationarySince: string;
  endedAt: string | null;
  durationMinutes: number;
}

export interface Comparison {
  current: { from: string; to: string; amount: Money };
  previous: { from: string; to: string; amount: Money };
  changePct: string | null;
}
export interface OverviewReport extends ReportHead {
  visibility: ReportVisibility;
  spend: {
    total: Money; fuel: Money; otherExpenses: Money; maintenance: Money; tyre: Money; tyreInsurance: Money; rto: Money;
    byCategory: ExpenseReport['byCategory'];
    trend: ExpenseReport['trend'];
    vehicleComparison: SplitBreakdown[];
  };
  highlights: Record<'topExpenseVehicle' | 'highestFuelVehicle' | 'highestMaintenanceVehicle', { id: string | null; label: string | null; amount: Money } | null>;
  comparisons: { monthOverMonth: Comparison; financialYearOverYear: Comparison };
  fleet: { activeVehicles: number; vehicles: number; activeDrivers: number };
  finance?: { paymentsPaid: StatusTotal; pendingPayments: StatusTotal; paymentStatus: Record<PaymentGroup, StatusTotal>; emiPaid: StatusTotal; ledgerOutflow: Money };
  compliance?: ComplianceReport['totals'];
  location?: { tracked: number; active: number; stale: number; offline: number; activeAlerts: number };
}

export interface ReportSummaries {
  overview: OverviewReport;
  fuel: FuelReport;
  vehicles: VehicleReport;
  drivers: DriverReport;
  finance: FinanceReport;
  expenses: ExpenseReport;
  maintenance: MaintenanceReport;
  tyres: TyreReport;
  compliance: ComplianceReport;
  location: LocationReport;
}

/** Filters as the API names them. Empty values are dropped before the request. */
export type ReportParams = Record<string, string | number | undefined>;

export const reportsApi = {
  meta: () => authedRequest<ReportMeta>('/reports/meta'),
  summary: <T extends ReportType>(type: T, params: ReportParams) => authedRequest<ReportSummaries[T]>(`/reports/${type}`, { query: params as Query }),
  records: <R>(type: ReportType, params: ReportParams) => authedRequest<ReportPage<R> & { section?: string }>(`/reports/${type}/records`, { query: params as Query }),
};

/**
 * Downloads a server-generated export. The file is built and authorised by the API; this only
 * fetches it with the session token and hands it to the browser once it has fully arrived, so
 * "ready" is never said about a file that does not exist.
 */
export async function downloadReport(type: ReportType, params: ReportParams, format: ExportFormat): Promise<SaveResult> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  search.set('format', format);
  const token = useSession.getState().token;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/reports/${type}/export?${search.toString()}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }
  if (response.status === 401) useSession.getState().expire();
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string; requestId?: string } };
    throw new ApiError(response.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? 'The report could not be prepared.', undefined, body.error?.requestId);
  }
  const blob = await response.blob();
  const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '');
  return saveFile(match?.[1] ?? `gangamata-${type}-report.${format}`, blob);
}
