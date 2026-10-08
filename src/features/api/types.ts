import type { ApiAccountStatus, ApiRole } from './session';
/** Response shapes returned by the Phase 1 API. Mirrors the backend presenters. */

export type EmployeeRole = 'DRIVER' | 'ACCOUNTING' | 'MANAGER' | 'ADMIN' | 'OTHER';
export type EmploymentStatus = 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'INACTIVE' | 'EXITED';
export type ApiDriverStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ON_LEAVE';
export type ApiVehicleStatus = 'ACTIVE' | 'MAINTENANCE' | 'IDLE' | 'RETIRED';
export type ApiVehicleKind = 'LCV' | 'PICKUP' | 'TRUCK';
export type ApiFuelType = 'PETROL' | 'DIESEL';
export type VehicleOwnership = 'OWNED' | 'FINANCED';
export type FinanceStatus = 'ACTIVE' | 'COMPLETED' | 'CLOSED' | 'DEFAULTED';
export type ApiLanguage = 'EN' | 'HI' | 'KN' | 'MR' | 'TA' | 'TE';

export interface ApiEmployee {
  id: string;
  employeeCode: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  role: EmployeeRole;
  designation: string | null;
  department: string | null;
  preferredLanguage: ApiLanguage;
  status: EmploymentStatus;
  dateOfBirth: string | null;
  joiningDate: string | null;
  exitDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  driver: { id: string; driverCode: string; status: ApiDriverStatus } | null;
  payroll?: { baseSalary: string | null; pfApplicable: boolean; uan: string | null; pfMemberId: string | null };
  /** Sign-in access at a glance; present for administrators only, null when there is no login. */
  account?: { role: ApiRole; status: ApiAccountStatus } | null;
  /** Returned once, when the employee was created with login access. */
  temporaryPassword?: string;
}

export interface ApiAssignmentVehicle {
  id: string;
  registrationNumber: string;
  kind: ApiVehicleKind;
  fuelType: ApiFuelType;
  status: ApiVehicleStatus;
  ownership: VehicleOwnership;
}

export interface ApiDriver {
  id: string;
  driverCode: string;
  status: ApiDriverStatus;
  licenceNumber: string | null;
  licenceExpiryDate: string | null;
  homeTown: string | null;
  locationSharingEnabled: boolean;
  location: { status: string; permission: string; lastHeartbeatAt: string | null } | null;
  emergencyContact: { name: string | null; phone: string | null };
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    designation: string | null;
    department: string | null;
    preferredLanguage: ApiLanguage;
    status: EmploymentStatus;
    joiningDate: string | null;
  };
  currentAssignment: { id: string; startedAt: string; vehicle: ApiAssignmentVehicle } | null;
  pf?: { applicable: boolean; uan: string | null; memberId: string | null; baseSalary: string | null };
}

export interface ApiFinancing {
  status: FinanceStatus;
  lenderName: string | null;
  loanAccountNumber: string | null;
  loanAmount: string | null;
  downPayment: string | null;
  financeStartDate: string | null;
  tenureMonths: number | null;
  interestRatePct: string | null;
  emiAmount: string | null;
  totalInstallments: number | null;
  paidInstallments: number | null;
  remainingInstallments: number | null;
  outstandingAmount: string | null;
  nextDueDate: string | null;
  financeEndDate: string | null;
  /** Derived from the loan terms in Decimal; strings so no precision is lost. */
  calculated: { emiAmount: string; totalPayable: string; totalInterest: string; outstandingPrincipal: string } | null;
}

export interface ApiVehicle {
  id: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  kind: ApiVehicleKind;
  fuelType: ApiFuelType;
  capacityTonnes: string | null;
  manufactureYear: number | null;
  mileageKmpl: string | null;
  status: ApiVehicleStatus;
  ownership: VehicleOwnership;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  currentAssignment: {
    id: string;
    startedAt: string;
    driver: { id: string; driverCode: string; status: ApiDriverStatus; fullName: string; phone: string | null };
  } | null;
  /** Null for OWNED vehicles: a fully owned vehicle has no EMI. */
  financing: ApiFinancing | null;
  /** A closed loan on a vehicle that is now owned — history only, no EMI tools. */
  pastFinancing: ApiFinancing | null;
}

export interface ApiAssignment {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  notes: string | null;
  isCurrent: boolean;
  vehicle: { id: string; registrationNumber: string; kind: ApiVehicleKind } | null;
  driver: { id: string; driverCode: string; fullName: string; phone: string | null } | null;
}

export interface ApiDocumentSummary {
  total: number;
  expiringSoon: number;
  expired: number;
  licenceOnFile: boolean;
}

// ───────────────────────────── Phase 3: fuel & daily operations ─────────────────────────────

export type ApiFuelTypeValue = 'PETROL' | 'DIESEL';
export type RecordStatus = 'ACTIVE' | 'ARCHIVED';
export type OperationCategory = 'RTO' | 'TYRE' | 'MAINTENANCE';

export interface ApiTotals {
  entries: number;
  amount: string;
  litres: string;
  /** Weighted: total amount ÷ total litres. */
  averageRate: string | null;
}

export interface ApiFuelEntry {
  id: string;
  fuelType: ApiFuelTypeValue;
  amount: string;
  litres: string;
  /** Derived by the server from amount ÷ litres. */
  ratePerLitre: string | null;
  fuelStation: string;
  transactionDate: string;
  receiptFileId: string | null;
  status: RecordStatus;
  notes: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  createdAt: string;
  updatedAt: string;
  driver: { id: string; driverCode: string; fullName: string };
  vehicle: { id: string; registrationNumber: string };
}

export interface ApiFuelPeriod extends ApiTotals {
  from: string;
  to: string;
  byFuelType: Record<ApiFuelTypeValue, { amount: string; litres: string; entries: number }>;
}

export interface ApiFuelSummary {
  today: ApiFuelPeriod;
  month: ApiFuelPeriod;
  financialYear: ApiFuelPeriod & { label: string; code: string };
}

export interface ApiBreakdownRow extends ApiTotals {
  key: string;
  label: string;
}

export interface ApiOperation {
  id: string;
  category: OperationCategory;
  amount: string;
  expenseDate: string;
  vendorName: string | null;
  description: string | null;
  receiptFileId: string | null;
  status: RecordStatus;
  archivedAt: string | null;
  archiveReason: string | null;
  createdAt: string;
  vehicle: { id: string; registrationNumber: string };
  driver: { id: string; driverCode: string; fullName: string } | null;
}

export interface ApiTyreInsurance {
  id: string;
  insurer: string | null;
  policyNumber: string | null;
  premium: string | null;
  startDate: string | null;
  expiryDate: string | null;
  fileId: string | null;
  createdAt: string;
  vehicle: { id: string; registrationNumber: string };
}

// ───────────────────────────── Phase 4: documents & compliance ─────────────────────────────

export interface ApiDocument {
  id: string;
  type: import('@/features/documents/compliance').ApiDocumentType;
  customName: string | null;
  ownerType: 'VEHICLE' | 'EMPLOYEE' | 'COMPANY';
  vehicle: { id: string; registrationNumber: string } | null;
  employee: { id: string; fullName: string; driver: { id: string; driverCode: string } | null } | null;
  documentNumber: string | null;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  amount: string | null;
  /** Derived by the server from the expiry date and today; never stored. */
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
  daysRemaining: number | null;
  state: 'CURRENT' | 'SUPERSEDED' | 'ARCHIVED';
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verifiedAt: string | null;
  rejectionReason: string | null;
  archiveReason: string | null;
  uploadedAt: string;
  uploadedBy?: string | null;
  file: { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string } | null;
}

export interface ApiComplianceItem {
  type: ApiDocument['type'];
  status: import('@/features/documents/compliance').ComplianceStatus;
  daysRemaining: number | null;
  document: ApiDocument | null;
}

export interface ApiComplianceSummaryRow {
  type: ApiDocument['type'];
  expired: number;
  within7Days: number;
  expiringSoon: number;
  valid: number;
  pendingVerification: number;
  notUploaded: number | null;
}

// ─────────────────────────── Phase 5: finance & payments ───────────────────────────
// Money is always a two-decimal string from the API; convert with Number() only to display.

export type ApiPaymentStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PROCESSING' | 'STATUS_REVIEW_REQUIRED' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REVERSED';
export type ApiPaymentType = 'SALARY' | 'ADVANCE' | 'ALLOWANCE' | 'OTHER';
export type ApiPaymentMethod = 'UPI' | 'BANK_TRANSFER' | 'CASH' | 'CHEQUE' | 'OTHER';
/** PHONEPE is reserved: the API refuses it until a PhonePe integration is configured. */
export type ApiPaymentProvider = 'MANUAL' | 'RAZORPAY' | 'RAZORPAYX' | 'PHONEPE';
export type ApiAdvanceType = 'SALARY_ADVANCE' | 'FUEL_ADVANCE' | 'TRIP_ADVANCE' | 'OTHER_ADVANCE';
export type ApiLedgerType =
  | 'FUEL' | 'RTO' | 'TYRE' | 'TYRE_INSURANCE' | 'MAINTENANCE' | 'SALARY' | 'ADVANCE' | 'ALLOWANCE'
  | 'OTHER_PAYMENT' | 'EMI' | 'CUSTOMER_PAYMENT' | 'OTHER_INCOME' | 'OTHER_EXPENSE';

export interface ApiPersonRef {
  id: string;
  fullName: string;
  employeeCode: string;
}

export interface ApiPaymentRef {
  id: string;
  status: ApiPaymentStatus;
  method: ApiPaymentMethod;
}

export interface ApiLedgerEntry {
  id: string;
  date: string;
  type: ApiLedgerType;
  direction: 'INCOME' | 'EXPENSE';
  amount: string;
  description: string | null;
  sourceType: string;
  sourceId: string;
  isReversal: boolean;
  reversed: boolean;
  payment: (ApiPaymentRef & { provider: ApiPaymentProvider }) | null;
  employee: ApiPersonRef | null;
  vehicle: { id: string; registrationNumber: string } | null;
  /** Set for lines from a hand-kept entry: its current details and whether it can be edited. */
  manual?: { id: string; editable: boolean; paymentMethod: ApiPaymentMethod | null; reference: string | null; remarks: string | null } | null;
}

/** Ledger types the office may enter by hand (salaries, advances and EMIs have their own screens). */
export const MANUAL_LEDGER_TYPES = [
  'FUEL', 'RTO', 'TYRE', 'TYRE_INSURANCE', 'MAINTENANCE', 'ALLOWANCE', 'OTHER_PAYMENT', 'CUSTOMER_PAYMENT', 'OTHER_INCOME', 'OTHER_EXPENSE',
] as const satisfies readonly ApiLedgerType[];
export type ApiManualLedgerType = (typeof MANUAL_LEDGER_TYPES)[number];

export interface ApiManualLedgerEntry {
  id: string;
  date: string;
  type: ApiManualLedgerType;
  direction: 'INCOME' | 'EXPENSE';
  amount: string;
  description: string;
  employee: ApiPersonRef | null;
  vehicle: { id: string; registrationNumber: string } | null;
  paymentMethod: ApiPaymentMethod | null;
  reference: string | null;
  remarks: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  archivedAt: string | null;
  archiveReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiManualLedgerDetail extends ApiManualLedgerEntry {
  /** Every ledger line the entry produced, oldest first (originals, reversals, re-posts). */
  lines: ApiLedgerEntry[];
  /** Who changed what and when, oldest first. */
  history: { id: string; action: string; at: string; actor: string | null; role: string | null; changes: Record<string, unknown> | null; metadata: Record<string, unknown> | null }[];
}

export interface ApiLedgerTotals {
  income: string;
  expense: string;
  net: string;
}

export interface ApiFinanceSummary {
  financialYear: string;
  totalIncome: string;
  totalExpenses: string;
  salaries: string;
  advances: string;
  fuel: string;
  maintenance: string;
  tyres: string;
  rto: string;
  vehicleFinance: string;
  pendingPayments: { count: number; amount: string };
}

export interface ApiPayrollSummary {
  period: string;
  salaries: { count: number; amount: string };
  advances: { count: number; amount: string };
  unpaidAdvances: { count: number; amount: string };
}

export interface ApiSalary {
  id: string;
  employee: ApiPersonRef;
  payPeriod: string;
  baseSalary: string;
  allowances: string;
  advanceRecovery: string;
  deductions: string;
  netPayable: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  paidAt: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  recoveredAdvances: { id: string; type: ApiAdvanceType; amount: string; advanceDate: string }[];
  payment: ApiPaymentRef | null;
  createdAt: string;
}

export interface ApiAdvance {
  id: string;
  employee: ApiPersonRef;
  type: ApiAdvanceType;
  amount: string;
  advanceDate: string;
  reason: string | null;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  recovered: boolean;
  recoveredInSalaryId: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  payment: ApiPaymentRef | null;
  createdAt: string;
}

export interface ApiPayment {
  id: string;
  employee: ApiPersonRef;
  type: ApiPaymentType;
  amount: string;
  status: ApiPaymentStatus;
  method: ApiPaymentMethod;
  provider: ApiPaymentProvider;
  description: string | null;
  salary: { id: string; payPeriod: string } | null;
  advance: { id: string; type: ApiAdvanceType; advanceDate: string } | null;
  attempt: number;
  providerReference: string | null;
  providerStatus: string | null;
  paymentReference: string | null;
  recipientSummary: string | null;
  failureReason: string | null;
  remarks?: string | null;
  /** Proof of payment metadata; the file itself comes from paymentsApi.proofUrl. */
  proof?: { fileId: string; filename: string; mimeType: string; sizeBytes: number; uploadedAt: string | null } | null;
  submittedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  createdAt: string;
}

/** Audit trail and provider webhooks for one payment, oldest first. */
export interface ApiPaymentHistory {
  audit: { action: string; occurredAt: string; actorUserId: string | null; changes: Record<string, unknown> | null }[];
  providerEvents: { eventType: string; receivedAt: string; outcome: string | null }[];
}

/** Result of Send / Check status. `unknown` means the payment is held for a status check. */
export interface ApiPaymentOutcome {
  outcome: 'accepted' | 'rejected' | 'unknown';
  payment: ApiPayment;
}

export interface ApiPayoutAccount {
  method: ApiPaymentMethod;
  accountHolderName: string;
  ifsc: string | null;
  accountNumberLast4: string | null;
  upiIdMasked: string | null;
  provider: ApiPaymentProvider;
  updatedAt: string;
}

export interface ApiInstalment {
  id: string;
  installmentNumber: number;
  dueDate: string;
  amount: string;
  status: 'PENDING' | 'PAID';
  paidAt: string | null;
  paymentReference: string | null;
}

export interface ApiPaymentsSummary {
  byStatus: Partial<Record<ApiPaymentStatus, { count: number; amount: string }>>;
  paidThisMonth: { count: number; amount: string };
}

// ─────────────────────────── Accounts (sign-in access) ───────────────────────────

export interface ApiAccount {
  id: string;
  role: ApiRole;
  status: ApiAccountStatus;
  /** What they type to sign in: a mobile number (E.164) or an email address. */
  signInId: string;
  email: string | null;
  phone: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
}

/** The account plus what the viewer may do with it — decided by the API, not the browser. */
export interface ApiAccountAccess {
  account: ApiAccount | null;
  canManage: boolean;
  assignableRoles: ApiRole[];
}

export interface ApiTemporaryPassword {
  account: ApiAccount;
  /** Shown once; the API never returns it again. */
  temporaryPassword: string;
}

// ─────────────────────────── Fleet location (Phase 6) ───────────────────────────

/** What the server concludes about a driver's tracking, from its reports plus fix recency. */
export type ApiLocationStatus = 'ACTIVE' | 'PERMISSION_DENIED' | 'LOCATION_DISABLED' | 'OFFLINE' | 'STALE';

/** What the driver's device reports about its own tracking. */
export type ApiTrackingState =
  | 'LOCATION_PERMISSION_DENIED'
  | 'BACKGROUND_PERMISSION_MISSING'
  | 'LOCATION_SERVICES_DISABLED'
  | 'TRACKING_ACTIVE'
  | 'TRACKING_PAUSED'
  | 'TRACKING_UNAVAILABLE'
  | 'SYNC_PENDING'
  | 'LAST_LOCATION_STALE';

export type ApiLocationPermission = 'UNKNOWN' | 'GRANTED_ALWAYS' | 'GRANTED_FOREGROUND' | 'DENIED';
export type ApiFleetAlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
export type ApiFleetAlertType = 'STATIONARY';

/** One driver's current whereabouts. Coordinates are numbers: a map consumes numbers. */
export interface ApiFleetLocation {
  driverId: string;
  driverCode: string;
  driverStatus: string;
  employee: { id: string; employeeCode: string; fullName: string; phone: string | null };
  vehicle: { id: string; registrationNumber: string; kind: string } | null;
  /** Null until the driver's first accepted fix; the row still carries the tracking state. */
  position: {
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
    speedKmh: number | null;
    headingDeg: number | null;
    altitudeMeters: number | null;
  } | null;
  status: ApiLocationStatus;
  trackingState: ApiTrackingState;
  permission: ApiLocationPermission;
  locationServicesEnabled: boolean;
  pendingUploads: number;
  batteryPct: number | null;
  /** Device capture time of the newest fix. */
  capturedAt: string | null;
  /** Server time that fix was stored. */
  receivedAt: string | null;
  /** Last contact of any kind — a fix or a tracking report. */
  lastSeenAt: string | null;
  stale: boolean;
  stationarySince: string | null;
  stationaryMinutes: number | null;
  alert: { id: string; status: ApiFleetAlertStatus; triggeredAt: string; stationarySince: string; durationMinutes: number } | null;
}

export interface ApiFleetSummary {
  total: number;
  active: number;
  stale: number;
  offline: number;
  unavailable: number;
  alerting: number;
}

export interface ApiFleetResponse {
  data: ApiFleetLocation[];
  summary: ApiFleetSummary;
  /** How often to poll, decided by the server so it is tunable without a new bundle. */
  refreshSeconds: number;
  serverTime: string;
}

export interface ApiLocationPing {
  /** A bigint on the server, so it crosses the wire as a string. */
  id: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  altitudeMeters: number | null;
  batteryPct: number | null;
  provider: string | null;
  capturedAt: string;
  receivedAt: string;
  /** The vehicle assigned when this fix was captured, not the driver's vehicle today. */
  vehicleId: string | null;
}

/** History pages on the ping id, not a UUID cursor. */
export interface ApiPingPage {
  data: ApiLocationPing[];
  page: { limit: number; nextCursor: string | null };
}

export interface ApiFleetAlert {
  id: string;
  type: ApiFleetAlertType;
  status: ApiFleetAlertStatus;
  driver: { id: string; driverCode: string; fullName: string; employeeCode: string; phone: string | null };
  vehicleId: string | null;
  vehicleRegistration: string | null;
  triggeredAt: string;
  stationarySince: string;
  latitude: number;
  longitude: number;
  durationMinutes: number;
  radiusMeters: number;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  acknowledgeNote: string | null;
  resolvedAt: string | null;
  resolvedReason: string | null;
  movedAt: string | null;
}

export interface ApiFleetAlertSummary {
  active: number;
  acknowledged: number;
  needsAttention: number;
}

// ───────────────────────── Service receipt AI (Phase 7) ─────────────────────────

/**
 * The lifecycle of an uploaded service receipt, as the office sees it — the explicit Phase 7 states.
 *
 * `SUCCEEDED` means the extraction succeeded and checks out — not that anyone has agreed with it.
 * Only `VERIFIED` says a person checked the figures and put their name to them.
 */
export type ApiReceiptAIStatus =
  | 'NOT_PROCESSED' | 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'NEEDS_REVIEW'
  | 'FAILED' | 'RETRYING' | 'VERIFIED' | 'REJECTED';

/** What the driver's phone is told. Five words, no AI detail. */
export type ApiDriverReceiptState = 'uploaded' | 'processing' | 'needsReview' | 'verified' | 'failed';

/** A value the extraction offered. `missing` means the receipt did not say — never a zero. */
export interface ApiSuggestedValue<T> {
  value: T | null;
  state: 'found' | 'missing';
}

export interface ApiReceiptSuggestions {
  totalAmount: ApiSuggestedValue<number>;
  invoiceDate: ApiSuggestedValue<string>;
  vendorName: ApiSuggestedValue<string>;
  invoiceNumber: ApiSuggestedValue<string>;
  serviceType: ApiSuggestedValue<string>;
  odometerKm: ApiSuggestedValue<number>;
  nextServiceDate: ApiSuggestedValue<string>;
  nextServiceKm: ApiSuggestedValue<number>;
  labourAmount: ApiSuggestedValue<number>;
  partsAmount: ApiSuggestedValue<number>;
  taxAmount: ApiSuggestedValue<number>;
}

export type ApiLineItemKind = 'PART' | 'LABOUR' | 'OTHER';

export interface ApiReceiptLineItem {
  description: string | null;
  kind: ApiLineItemKind | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
}

export interface ApiReceiptExtraction {
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  vehicleNumber: string | null;
  serviceType: string | null;
  odometerKm: number | null;
  nextServiceDate: string | null;
  nextServiceKm: number | null;
  lineItems: ApiReceiptLineItem[];
  partsAmount: number | null;
  labourAmount: number | null;
  gstAmount: number | null;
  otherCharges: number | null;
  subtotal: number | null;
  totalAmount: number | null;
  confidence: number;
  warnings: string[];
}

export interface ApiReceiptAIResult {
  id: string;
  version: number;
  provider: string;
  model: string;
  confidence: number | null;
  /** What the model flagged about its own reading. */
  warnings: string[];
  /** What the application's checks found. These are what send a record to review. */
  validationIssues: string[];
  /** How the receipt was read: "image", "image+ocr", "pdf:text", "pdf:raster+ocr", … */
  preparation: string | null;
  sourceTextChars: number | null;
  durationMs: number | null;
  createdAt: string;
}

export interface ApiReceiptAIJob {
  id: string;
  status: ApiReceiptAIStatus;
  attempt: number;
  maxAttempts: number;
  provider: string | null;
  model: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextAttemptAt: string | null;
  failureCode: string | null;
  /** Safe to show: never the prompt and never the receipt's contents. */
  failureMessage: string | null;
}

/** A verified line, as stored on the record: money as strings, as the person entered it. */
export interface ApiVerifiedLineItem {
  description: string;
  kind: ApiLineItemKind | null;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
}

export interface ApiReceiptReview {
  /** The authoritative record, exactly as it stands now. */
  record: {
    id: string;
    category: string;
    amount: string;
    expenseDate: string | null;
    vendorName: string | null;
    description: string | null;
    status: string;
    vehicle: { id: string; registrationNumber: string };
    driver: { id: string; driverCode: string; fullName: string } | null;
    /** The structured service details. Only verification writes these. */
    service: {
      invoiceNumber: string | null;
      serviceType: string | null;
      odometerKm: number | null;
      nextServiceDate: string | null;
      nextServiceKm: number | null;
      labourAmount: string | null;
      partsAmount: string | null;
      taxAmount: string | null;
      lineItems: ApiVerifiedLineItem[];
    };
  };
  /** The original upload. Present whatever happened to processing. */
  receipt: { fileId: string; filename: string; mimeType: string; sizeBytes: number; uploadedAt: string } | null;
  ai: {
    status: ApiReceiptAIStatus;
    verifiedAt: string | null;
    verifiedById: string | null;
    rejectedAt: string | null;
    acceptedResultId: string | null;
    /** Which values matched the extraction, as the server worked it out. */
    acceptedFields: string[];
    canVerify: boolean;
    canRetry: boolean;
  };
  /** Every reading, newest first. A rerun adds a version; it never replaces one. */
  results: ApiReceiptAIResult[];
  jobs: ApiReceiptAIJob[];
  extraction: ApiReceiptExtraction | null;
  suggestions: ApiReceiptSuggestions | null;
}

export interface ApiVerifyReceiptBody {
  amount?: string;
  expenseDate?: string;
  vendorName?: string;
  description?: string;
  invoiceNumber?: string | null;
  serviceType?: string | null;
  odometerKm?: number | null;
  nextServiceDate?: string | null;
  nextServiceKm?: number | null;
  labourAmount?: string | null;
  partsAmount?: string | null;
  taxAmount?: string | null;
  lineItems?: ApiVerifiedLineItem[] | null;
  resultId?: string;
}

export interface ApiPendingReceipt {
  id: string;
  amount: string;
  expenseDate: string | null;
  vendorName: string | null;
  aiStatus: ApiReceiptAIStatus;
  createdAt: string;
  hasReceipt: boolean;
  vehicle: { id: string; registrationNumber: string };
  driver: { id: string; fullName: string } | null;
  latest: { version: number; confidence: number | null; issueCount: number; warningCount: number } | null;
}

export interface ApiReceiptQueueStatus {
  queued: number;
  processing: number;
  retrying: number;
  failed: number;
  awaitingReview: number;
  provider: string;
  model: string;
  /** Which OCR engine runs before the model, e.g. "tesseract" or "none". */
  ocr: string;
  /** False when the in-process worker is off and jobs are drained by a scheduled run instead. */
  workerEnabled: boolean;
}

export interface ApiMaintenanceObservation {
  kind: 'service_due' | 'estimated_reminder' | 'frequent_service' | 'repeated_issue' | 'recurring_vendor';
  severity: 'info' | 'attention';
  /** Plain words for the office. Always an observation, never an instruction. */
  message: string;
}

export interface ApiNextService {
  /** `workshop`: printed on a verified receipt. `estimate`: from past intervals. */
  source: 'workshop' | 'estimate';
  status: 'overdue' | 'upcoming' | 'scheduled';
  dueDate: string | null;
  daysRemaining: number | null;
  dueKm: number | null;
  lastServiceDate: string;
  lastOdometerKm: number | null;
}

export interface ApiRepeatedIssue {
  kind: 'part' | 'labour' | 'service_type';
  label: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
}

export interface ApiRecentService {
  id: string;
  vehicle: { id: string; registrationNumber: string };
  serviceDate: string;
  vendorName: string | null;
  serviceType: string | null;
  invoiceNumber: string | null;
  amount: string;
  odometerKm: number | null;
}

/** One vehicle's verified service history. Every figure here rests on verified records only. */
export interface ApiVehicleMaintenance {
  vehicleId: string;
  verifiedServices: number;
  totalSpend: string;
  lastServiceDate: string | null;
  lastOdometerKm: number | null;
  averageIntervalDays: number | null;
  servicesLast90Days: number;
  servicesLast365Days: number;
  nextService: ApiNextService | null;
  repeatedIssues: ApiRepeatedIssue[];
  recent: ApiRecentService[];
  observations: ApiMaintenanceObservation[];
  /** Says in words what the numbers were drawn from, so they can be judged rather than believed. */
  basis: string;
}

export interface ApiMaintenanceSummary {
  windowDays: number;
  verifiedServices: number;
  /** Receipts the office has still to look at. Counted separately, and excluded from every figure. */
  awaitingReview: number;
  verifiedSpend: string;
  dueServices: (ApiNextService & { vehicle: { id: string; registrationNumber: string } })[];
  repeatedIssues: (ApiRepeatedIssue & { vehicle: { id: string; registrationNumber: string } })[];
  recent: ApiRecentService[];
  basis: string;
}

// ───────────────────────────── Inbox (Phase 7) ─────────────────────────────

export type ApiInboxClassification =
  | 'VEHICLE_DOCUMENT' | 'FUEL' | 'MAINTENANCE' | 'FINANCE' | 'SALARY_PAYMENT' | 'COMPLIANCE'
  | 'VENDOR' | 'CUSTOMER' | 'GENERAL' | 'SPAM' | 'UNCLASSIFIED';

export type ApiInboxStatus = 'UNREAD' | 'READ' | 'ARCHIVED';

export type ApiInboxAIStatus = 'NOT_PROCESSED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'RETRYING' | 'FAILED' | 'SKIPPED';

export interface ApiInboxRow {
  id: string;
  from: { address: string; name: string | null };
  subject: string | null;
  receivedAt: string;
  status: ApiInboxStatus;
  classification: ApiInboxClassification;
  /** True when a person chose the category; false while it is still only a suggestion. */
  classificationConfirmed: boolean;
  aiStatus: ApiInboxAIStatus;
  attachmentCount: number;
  /** Undecided AI suggestions on this message. */
  pendingSuggestions: number;
  hasHtml: boolean;
  provider: string;
  aiSummary: string | null;
  aiConfidence: number | null;
}

export interface ApiInboxAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** False when the file was refused or not yet downloaded. It is still listed, with a reason. */
  stored: boolean;
  skipReason: string | null;
  downloadAttempts: number;
}

export type ApiSuggestionType =
  | 'CREATE_SERVICE_RECORD' | 'REVIEW_VEHICLE_DOCUMENT' | 'REVIEW_COMPLIANCE'
  | 'RECORD_FUEL_EXPENSE' | 'REVIEW_FINANCE' | 'REVIEW_PAYMENT';

export type ApiSuggestionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';

/** Something AI proposes doing about an email. Nothing happens until a person accepts it. */
export interface ApiInboxSuggestion {
  id: string;
  messageId: string;
  resultId: string;
  type: ApiSuggestionType;
  status: ApiSuggestionStatus;
  reason: string | null;
  /** What the model read from the mail — prefill for a person to check, never applied. */
  details: { vehicleRegistration: string | null; amount: number | null; date: string | null; reference: string | null };
  attachment: { id: string; filename: string; mimeType: string; stored: boolean } | null;
  decidedAt: string | null;
  decidedById: string | null;
  decisionNote: string | null;
  result: { entityType: string; entityId: string } | null;
  createdAt: string;
  message?: { id: string; subject: string | null; from: { address: string; name: string | null }; receivedAt: string };
}

export interface ApiInboxMessage {
  id: string;
  provider: string;
  mailbox: string;
  threadId: string | null;
  from: { address: string; name: string | null };
  to: string[];
  cc: string[];
  subject: string | null;
  receivedAt: string;
  filedAt: string;
  /** Plain text only: an HTML mail was flattened on the way in and is never returned as markup. */
  bodyText: string | null;
  bodyTruncated: boolean;
  hasHtml: boolean;
  labels: string[];
  sizeBytes: number | null;
  authenticationResults: string | null;
  status: ApiInboxStatus;
  classification: ApiInboxClassification;
  classificationConfirmed: boolean;
  classifiedAt: string | null;
  ai: { status: ApiInboxAIStatus; attempts: number; failureCode: string | null; failureMessage: string | null; nextAttemptAt: string | null };
  attachments: ApiInboxAttachment[];
  aiResults: {
    id: string;
    version: number;
    provider: string;
    model: string;
    classification: ApiInboxClassification;
    confidence: number | null;
    summary: string | null;
    references: { type: string; value: string }[];
    warnings: string[];
    durationMs: number | null;
    createdAt: string;
  }[];
  suggestions: ApiInboxSuggestion[];
}

export interface ApiInboxSummary {
  unread: number;
  total: number;
  needingAttention: number;
  pendingSuggestions: number;
  byClassification: Partial<Record<ApiInboxClassification, number>>;
}

export type ApiMailboxConnectionStatus = 'PENDING' | 'CONNECTED' | 'REAUTHORIZATION_REQUIRED' | 'DISCONNECTED';

export interface ApiInboxStatusInfo {
  /** True only when a mailbox can actually be read right now — not the same as "has mail". */
  configured: boolean;
  provider: string | null;
  mailbox: string | null;
  /** Why nothing can be read, in words, when `configured` is false. */
  unavailableReason: string | null;
  connection: {
    /** `oauth`: Gmail / Microsoft 365, connected from here. `imap`: set on the server. */
    mode: 'oauth' | 'imap' | 'none';
    provider: string | null;
    canConnect: boolean;
    connection: {
      status: ApiMailboxConnectionStatus;
      emailAddress: string | null;
      scopes: string[];
      connectedAt: string | null;
      connectedById: string | null;
      disconnectedAt: string | null;
      lastError: string | null;
      lastErrorAt: string | null;
      authorizationPending: boolean;
    } | null;
  };
  syncEnabled: boolean;
  aiEnabled: boolean;
  lastSyncStartedAt: string | null;
  lastSyncFinishedAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** When the scheduler will try a failing mailbox again. */
  nextAttemptAt: string | null;
  messagesSynced: number;
}

export interface ApiInboxSyncOutcome {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  retryable: boolean;
  fetched: number;
  created: number;
  duplicates: number;
  failed: number;
  pages: number;
  hasMore: boolean;
  attachmentsRecovered: number;
  notices: string[];
  classified: { processed: number; failed: number };
}
