import type { ReportType } from './report-access';

/**
 * The format-neutral shape of an exported report. Each report service describes itself once in
 * these terms, and the PDF, Excel and CSV writers render the same description — so the three
 * files can never disagree about what a report contains.
 *
 * Values keep their type until the writer: money as a two-decimal string, dates as YYYY-MM-DD.
 * Excel then stores real numbers and dates (summable, sortable) while PDF prints ₹1,25,450.00.
 */

export type CellKind = 'text' | 'date' | 'datetime' | 'inr' | 'number' | 'litres' | 'rate' | 'count' | 'percent';
export type Cell = string | number | null;

export interface ReportColumn {
  header: string;
  kind: CellKind;
  /** Relative width hint for PDF/Excel. */
  width?: number;
}

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Cell[][];
  totals?: Cell[];
  /** The full number of records, when `rows` is a capped excerpt (PDF). */
  totalRecords?: number;
  /** True for record-level tables (Excel's data sheet, CSV); false for summaries/breakdowns. */
  detail?: boolean;
  /** Shown under the table, e.g. why a column is blank. */
  note?: string;
}

export interface ReportDocument {
  type: ReportType;
  title: string;
  company: string;
  /** Null for point-in-time reports (compliance), which describe "as of" a moment instead. */
  period: { label: string; from: string; to: string } | null;
  asOf?: string;
  financialYears: string[];
  filters: { label: string; value: string }[];
  generatedAt: Date;
  generatedBy: string;
  summary: { label: string; value: Cell; kind: CellKind }[];
  tables: ReportTable[];
  /** How the less obvious figures are calculated. Printed on the last page / metadata sheet. */
  definitions: string[];
}

export const REPORT_TITLES: Record<ReportType, string> = {
  overview: 'Management Overview',
  fuel: 'Fuel Report',
  vehicles: 'Vehicle Cost Report',
  drivers: 'Driver Activity Report',
  finance: 'Financial Summary',
  expenses: 'Operational Expense Report',
  maintenance: 'Maintenance & Service Report',
  tyres: 'Tyre Report',
  compliance: 'Documents & Compliance Report',
  location: 'Fleet Location Report',
};

// ───────────────────────────── English labels ─────────────────────────────

export const LABELS = {
  fuelType: { PETROL: 'Petrol', DIESEL: 'Diesel' } as Record<string, string>,
  expenseCategory: { FUEL: 'Fuel', RTO: 'RTO', TYRE: 'Tyre', TYRE_INSURANCE: 'Tyre insurance', MAINTENANCE: 'Maintenance / service' } as Record<string, string>,
  ledgerType: {
    FUEL: 'Fuel', RTO: 'RTO', TYRE: 'Tyre', TYRE_INSURANCE: 'Tyre insurance', MAINTENANCE: 'Maintenance / service',
    SALARY: 'Salary', ADVANCE: 'Advance', ALLOWANCE: 'Allowance', OTHER_PAYMENT: 'Other payment', EMI: 'Vehicle EMI',
    CUSTOMER_PAYMENT: 'Customer payment', OTHER_INCOME: 'Other income', OTHER_EXPENSE: 'Other expense',
  } as Record<string, string>,
  paymentStatus: {
    DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', APPROVED: 'Approved', PROCESSING: 'Processing',
    STATUS_REVIEW_REQUIRED: 'Status check needed', PAID: 'Paid', FAILED: 'Failed', CANCELLED: 'Cancelled', REVERSED: 'Reversed',
  } as Record<string, string>,
  paymentGroup: { pending: 'Pending', processing: 'Processing', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled', reversed: 'Reversed' } as Record<string, string>,
  paymentType: { SALARY: 'Salary', ADVANCE: 'Advance', ALLOWANCE: 'Allowance', OTHER: 'Other' } as Record<string, string>,
  advanceType: { SALARY_ADVANCE: 'Salary advance', FUEL_ADVANCE: 'Fuel advance', TRIP_ADVANCE: 'Trip advance', OTHER_ADVANCE: 'Other advance' } as Record<string, string>,
  documentType: {
    RC: 'RC', INSURANCE: 'Insurance', PUC: 'PUC', DRIVING_LICENCE: 'Driving licence', TYRE_INSURANCE: 'Tyre insurance',
    FITNESS: 'Fitness', PERMIT: 'Permit', OTHER: 'Other',
  } as Record<string, string>,
  documentHealth: { VALID: 'Valid', EXPIRING: 'Expiring soon', EXPIRED: 'Expired', MISSING: 'Missing' } as Record<string, string>,
  verification: { PENDING: 'Pending verification', VERIFIED: 'Verified', REJECTED: 'Rejected' } as Record<string, string>,
  /** Plain wording that never lets an AI reading pass for a verified record. */
  aiStatus: {
    NOT_PROCESSED: 'Not read by AI', QUEUED: 'Queued for AI', PROCESSING: 'AI reading', SUCCEEDED: 'AI read · awaiting verification',
    NEEDS_REVIEW: 'AI read · needs review', FAILED: 'AI failed', RETRYING: 'AI retrying', VERIFIED: 'Verified by office', REJECTED: 'AI reading rejected',
  } as Record<string, string>,
  vehicleStatus: { ACTIVE: 'Active', MAINTENANCE: 'In maintenance', IDLE: 'Idle', RETIRED: 'Retired' } as Record<string, string>,
  vehicleKind: { LCV: 'LCV', PICKUP: 'Pickup', TRUCK: 'Truck' } as Record<string, string>,
  ownership: { OWNED: 'Owned', FINANCED: 'Financed' } as Record<string, string>,
  financeStatus: { ACTIVE: 'Active', COMPLETED: 'Completed', CLOSED: 'Closed', DEFAULTED: 'Defaulted' } as Record<string, string>,
  driverStatus: { ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended', ON_LEAVE: 'On leave' } as Record<string, string>,
  locationStatus: {
    ACTIVE: 'Active', STALE: 'Stale', OFFLINE: 'Offline', PERMISSION_DENIED: 'Permission denied', LOCATION_DISABLED: 'Location off',
  } as Record<string, string>,
  alertStatus: { ACTIVE: 'Active', ACKNOWLEDGED: 'Acknowledged', RESOLVED: 'Resolved' } as Record<string, string>,
  owner: { VEHICLE: 'Vehicle', EMPLOYEE: 'Driver', COMPANY: 'Company' } as Record<string, string>,
};

export const label = (map: Record<string, string>, value: string | null | undefined): string => (value ? (map[value] ?? value) : '');

const inrFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormat = (digits: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "₹1,25,450.00" — Indian digit grouping, always two decimals. */
export function formatInr(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  const formatted = inrFormat.format(Math.abs(n));
  return n < 0 ? `−₹${formatted}` : `₹${formatted}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "05 Oct 2026" from a YYYY-MM-DD string — never through a local-time Date. */
export function formatIsoDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** A trend bucket as people read it: "Apr 2026" for a month, "05 Oct 2026" for a day. */
export function bucketText(bucket: string): string {
  if (/^\d{4}-\d{2}$/.test(bucket)) return `${MONTHS[Number(bucket.slice(5, 7)) - 1]} ${bucket.slice(0, 4)}`;
  return formatIsoDay(bucket);
}

/** Instants print in India time, the business's clock. */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  const ist = new Date(date.getTime() + 330 * 60_000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${formatIsoDay(ist.toISOString())} ${hh}:${mm} IST`;
}

/** A cell as text, for PDF and summaries. */
export function formatCell(value: Cell, kind: CellKind): string {
  if (value === null || value === '') return '—';
  switch (kind) {
    case 'inr':
      return formatInr(value);
    case 'date':
      return formatIsoDay(String(value));
    case 'datetime':
      return formatInstant(String(value));
    case 'litres':
      return `${numberFormat(2).format(Number(value))} L`;
    case 'rate':
      return `₹${numberFormat(2).format(Number(value))}/L`;
    case 'number':
      return numberFormat(Number.isInteger(Number(value)) ? 0 : 2).format(Number(value));
    case 'count':
      return numberFormat(0).format(Number(value));
    case 'percent':
      return `${value}%`;
    default:
      return String(value);
  }
}
