import type { EmploymentStatus, Page, VehicleOwnership, VehicleStatus } from '../../types/domain';
import { apiRequest } from './client';

/**
 * Read-only office endpoints for the office app. Each is guarded by role on the server
 * (office roles only; payroll for SUPER_ADMIN, ADMIN and ACCOUNTING) and scoped to the signed-in
 * company. Shapes mirror the API presenters used by the web console.
 */

export interface OfficeEmployee {
  id: string;
  employeeCode: string;
  fullName: string;
  phone: string | null;
  role: string;
  designation: string | null;
  status: EmploymentStatus;
  driver: { id: string; driverCode: string; status: string } | null;
}

export interface OfficeVehicle {
  id: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  status: VehicleStatus;
  ownership: VehicleOwnership;
  currentAssignment: { driver: { fullName: string } } | null;
}

export interface FuelPeriodTotals {
  entries: number;
  amount: string;
  litres: string;
}

export interface FuelSummary {
  today: FuelPeriodTotals;
  month: FuelPeriodTotals;
  financialYear: FuelPeriodTotals & { label: string };
}

export interface OfficeFuelEntry {
  id: string;
  fuelType: 'PETROL' | 'DIESEL';
  amount: string;
  litres: string;
  fuelStation: string;
  transactionDate: string;
  driver: { fullName: string };
  vehicle: { registrationNumber: string };
}

export interface ComplianceRow {
  type: string;
  expired: number;
  within7Days: number;
  expiringSoon: number;
  valid: number;
  pendingVerification: number;
  notUploaded: number | null;
}

export interface FinanceSummary {
  financialYear: string;
  totalIncome: string;
  totalExpenses: string;
  salaries: string;
  advances: string;
  fuel: string;
  pendingPayments: { count: number; amount: string };
}

export type OfficePaymentStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PROCESSING' | 'STATUS_REVIEW_REQUIRED' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REVERSED';

export interface PaymentsSummary {
  byStatus: Partial<Record<OfficePaymentStatus, { count: number; amount: string }>>;
  paidThisMonth: { count: number; amount: string };
}

export interface OfficePayment {
  id: string;
  employee: { fullName: string };
  type: 'SALARY' | 'ADVANCE' | 'ALLOWANCE' | 'OTHER';
  amount: string;
  status: OfficePaymentStatus;
  createdAt: string;
}

const qs = (query: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  const out = params.toString();
  return out ? `?${out}` : '';
};

export interface OfficeFleetLocation {
  driverId: string;
  driverCode: string;
  employee: { fullName: string; employeeCode: string; phone: string | null };
  vehicle: { registrationNumber: string; make: string | null; model: string | null } | null;
  status: 'ACTIVE' | 'STALE' | 'OFFLINE' | 'PERMISSION_DENIED' | 'LOCATION_DISABLED';
  trackingState: string;
  position: {
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
    speedKmh: number | null;
    headingDeg: number | null;
  } | null;
  capturedAt: string | null;
  lastSeenAt: string | null;
  stale: boolean;
  alert: {
    id: string;
    type: string;
    status: string;
    triggeredAt: string;
    stationarySince: string;
    durationMinutes: number;
  } | null;
}

export interface OfficeFleetResponse {
  data: OfficeFleetLocation[];
  summary: {
    total: number;
    active: number;
    stale: number;
    offline: number;
    unavailable: number;
    alerting: number;
  };
  refreshSeconds: number;
}

export interface OfficeLocationPing {
  id: string;
  latitude: number;
  longitude: number;
  capturedAt: string;
  speedKmh: number | null;
  accuracyMeters: number | null;
}

export interface OfficeInboxMessage {
  id: string;
  subject: string | null;
  from: { name: string | null; address: string };
  receivedAt: string;
  status: 'UNREAD' | 'READ' | 'ARCHIVED';
  classification: string;
  classificationConfirmed: boolean;
  aiStatus: string;
  attachmentCount: number;
  /** Undecided AI suggestions on this message (decided in the office console). */
  pendingSuggestions?: number;
  hasHtml: boolean;
  provider: string;
  aiSummary: string | null;
  aiConfidence: number | null;
}

export interface OfficeInboxDetail {
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
  bodyText: string | null;
  bodyTruncated: boolean;
  hasHtml: boolean;
  labels: string[];
  status: string;
  classification: string;
  classificationConfirmed: boolean;
  classifiedAt: string | null;
  ai: {
    status: string;
    attempts: number;
    failureCode: string | null;
    failureMessage: string | null;
    nextAttemptAt?: string | null;
  };
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    stored: boolean;
    skipReason: string | null;
  }[];
  aiResults?: {
    summary: string | null;
    confidence: number | null;
  }[];
}

export interface OfficeInboxStatus {
  /** True only when a mailbox can actually be read right now — not the same as "has mail". */
  configured: boolean;
  mailbox: string | null;
  provider?: string | null;
  /** Why nothing can be read, in the server's words, when `configured` is false. */
  unavailableReason?: string | null;
  lastSyncFinishedAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextAttemptAt?: string | null;
}

/** What a sync actually did. `ok: false` carries the reason; it is never shown as success. */
export interface OfficeInboxSyncOutcome {
  ok: boolean;
  reason?: string;
  created: number;
  fetched: number;
  failed?: number;
}

export const officeApi = {
  fleet: (token: string, query: { q?: string; status?: string } = {}) =>
    apiRequest<OfficeFleetResponse>(`/locations/fleet${qs(query)}`, { token }),
  driverHistory: (token: string, driverId: string, query: { limit?: number; cursor?: string } = {}) =>
    apiRequest<{ data: OfficeLocationPing[]; page: { limit: number; nextCursor: string | null } }>(
      `/locations/drivers/${driverId}/history${qs(query)}`,
      { token },
    ),
  acknowledgeAlert: (token: string, alertId: string, note?: string) =>
    apiRequest<void>(`/locations/alerts/${alertId}/acknowledge`, { method: 'POST', body: note ? { note } : {}, token }),
  employees: (token: string, query: { q?: string; cursor?: string; limit?: number } = {}) =>
    apiRequest<Page<OfficeEmployee>>(`/employees${qs(query)}`, { token }),
  vehicles: (token: string, query: { q?: string; cursor?: string; limit?: number } = {}) =>
    apiRequest<Page<OfficeVehicle>>(`/vehicles${qs(query)}`, { token }),
  fuelSummary: (token: string) => apiRequest<FuelSummary>('/fuel/summary', { token }),
  fuel: (token: string, query: { cursor?: string; limit?: number } = {}) => apiRequest<Page<OfficeFuelEntry>>(`/fuel${qs(query)}`, { token }),
  compliance: (token: string) => apiRequest<ComplianceRow[]>('/documents/summary', { token }),
  financeSummary: (token: string) => apiRequest<FinanceSummary>('/finance/summary', { token }),
  paymentsSummary: (token: string) => apiRequest<PaymentsSummary>('/payments/summary', { token }),
  payments: (token: string, query: { status?: string; cursor?: string; limit?: number } = {}) =>
    apiRequest<Page<OfficePayment>>(`/payments${qs(query)}`, { token }),
  inboxStatus: (token: string) => apiRequest<OfficeInboxStatus>('/inbox/status', { token }),
  inboxMessages: (token: string, query: { q?: string; status?: string; classification?: string; limit?: number; cursor?: string } = {}) =>
    apiRequest<Page<OfficeInboxMessage>>(`/inbox/messages${qs(query)}`, { token }),
  inboxMessage: (token: string, id: string) => apiRequest<OfficeInboxDetail>(`/inbox/messages/${id}`, { token }),
  inboxSync: (token: string) => apiRequest<OfficeInboxSyncOutcome>('/inbox/sync', { method: 'POST', body: {}, token }),
  inboxSetStatus: (token: string, id: string, status: 'UNREAD' | 'READ' | 'ARCHIVED') =>
    apiRequest<void>(`/inbox/messages/${id}/status`, { method: 'PATCH', body: { status }, token }),
};


