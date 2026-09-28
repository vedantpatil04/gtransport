import type { Page } from '@/lib/api/client';
import { authedRequest, type ApiRole } from './session';
import type {
  ApiAssignment, ApiBreakdownRow, ApiDocumentSummary, ApiDriver, ApiEmployee, ApiFuelEntry, ApiFuelSummary,
  ApiOperation, ApiTotals, ApiTyreInsurance, ApiVehicle, ApiComplianceItem, ApiComplianceSummaryRow, ApiDocument,
  ApiAdvance, ApiAdvanceType, ApiFinanceSummary, ApiInstalment, ApiLedgerEntry, ApiLedgerTotals, ApiPayment, ApiPaymentHistory,
  ApiPaymentMethod, ApiPaymentOutcome, ApiPaymentProvider, ApiPaymentType, ApiPayoutAccount, ApiPayrollSummary, ApiSalary, ApiPaymentsSummary,
  ApiAccount, ApiAccountAccess, ApiTemporaryPassword,
  ApiFleetAlert, ApiFleetAlertSummary, ApiFleetLocation, ApiFleetResponse, ApiPingPage,
  ApiInboxClassification, ApiInboxMessage, ApiInboxRow, ApiInboxStatus, ApiInboxStatusInfo, ApiInboxSummary,
  ApiInboxSyncOutcome, ApiMaintenanceSummary, ApiPendingReceipt, ApiReceiptAIStatus, ApiVehicleMaintenance,
  ApiReceiptQueueStatus, ApiReceiptReview,
} from './types';
import { API_BASE_URL } from '@/lib/api/client';
import { useSession } from './session';

/** Typed wrappers around the Phase 1 endpoints. One place that knows the URLs. */

export interface EmployeeFilters {
  q?: string;
  role?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export const employeesApi = {
  list: (filters: EmployeeFilters = {}) => authedRequest<Page<ApiEmployee>>('/employees', { query: { ...filters } }),
  get: (id: string) => authedRequest<ApiEmployee>(`/employees/${id}`),
  create: (body: Record<string, unknown>) => authedRequest<ApiEmployee>('/employees', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) => authedRequest<ApiEmployee>(`/employees/${id}`, { method: 'PATCH', body }),
  setStatus: (id: string, status: string, reason?: string) =>
    authedRequest<ApiEmployee>(`/employees/${id}/status`, { method: 'PATCH', body: { status, reason } }),
};

export interface DriverFilters {
  q?: string;
  status?: string;
  assigned?: number;
  limit?: number;
  cursor?: string;
}

export const driversApi = {
  list: (filters: DriverFilters = {}) => authedRequest<Page<ApiDriver>>('/drivers', { query: { ...filters } }),
  get: (id: string) => authedRequest<ApiDriver>(`/drivers/${id}`),
  create: (body: Record<string, unknown>) => authedRequest<ApiDriver & { temporaryPassword?: string }>('/drivers', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) => authedRequest<ApiDriver>(`/drivers/${id}`, { method: 'PATCH', body }),
  setStatus: (id: string, status: string, reason?: string) =>
    authedRequest<ApiDriver>(`/drivers/${id}/status`, { method: 'PATCH', body: { status, reason } }),
  documentSummary: (id: string) => authedRequest<ApiDocumentSummary>(`/drivers/${id}/documents/summary`),
  assignments: (id: string) => authedRequest<Page<ApiAssignment>>(`/drivers/${id}/assignments`),
};

export interface VehicleFilters {
  q?: string;
  status?: string;
  kind?: string;
  fuelType?: string;
  ownership?: string;
  financeStatus?: string;
  driverId?: string;
  assigned?: number;
  limit?: number;
  cursor?: string;
}

export const vehiclesApi = {
  list: (filters: VehicleFilters = {}) => authedRequest<Page<ApiVehicle>>('/vehicles', { query: { ...filters } }),
  get: (id: string) => authedRequest<ApiVehicle>(`/vehicles/${id}`),
  create: (body: Record<string, unknown>) => authedRequest<ApiVehicle>('/vehicles', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) => authedRequest<ApiVehicle>(`/vehicles/${id}`, { method: 'PATCH', body }),
  setStatus: (id: string, status: string, reason?: string) =>
    authedRequest<ApiVehicle>(`/vehicles/${id}/status`, { method: 'PATCH', body: { status, reason } }),
  saveFinancing: (id: string, body: Record<string, unknown>) =>
    authedRequest<ApiVehicle>(`/vehicles/${id}/financing`, { method: 'PUT', body }),
  assignments: (id: string) => authedRequest<Page<ApiAssignment>>(`/vehicles/${id}/assignments`),
  assignDriver: (id: string, driverId: string, notes?: string) =>
    authedRequest<ApiAssignment>(`/vehicles/${id}/assignment`, { method: 'POST', body: { driverId, notes } }),
  unassignDriver: (id: string, reason?: string) =>
    authedRequest<ApiAssignment>(`/vehicles/${id}/assignment`, { method: 'DELETE', body: { reason } }),
};

// ───────────────────────────── Phase 3 ─────────────────────────────

export interface FuelFilters {
  fy?: string;
  from?: string;
  to?: string;
  driverId?: string;
  vehicleId?: string;
  fuelType?: string;
  station?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export const fuelApi = {
  summary: () => authedRequest<ApiFuelSummary>('/fuel/summary'),
  /** Doubles as the statement: totals cover every matching entry, not only this page. */
  list: (filters: FuelFilters = {}) =>
    authedRequest<Page<ApiFuelEntry> & { totals: ApiTotals }>('/fuel', { query: { ...filters } }),
  breakdown: (by: 'vehicle' | 'driver' | 'day' | 'station', filters: FuelFilters = {}) =>
    authedRequest<ApiBreakdownRow[]>('/fuel/breakdown', { query: { by, ...filters } }),
  update: (id: string, body: Record<string, unknown>) => authedRequest<ApiFuelEntry>(`/fuel/${id}`, { method: 'PATCH', body }),
  archive: (id: string, reason: string) => authedRequest<ApiFuelEntry>(`/fuel/${id}/archive`, { method: 'POST', body: { reason } }),
  restore: (id: string) => authedRequest<ApiFuelEntry>(`/fuel/${id}/restore`, { method: 'POST' }),

  /**
   * Every page of a statement, for export. Capped so a mis-set filter cannot pull ten years of
   * rows into the browser; the caller is told when the cap was hit.
   */
  async all(filters: FuelFilters, cap = 10_000): Promise<{ rows: ApiFuelEntry[]; totals: ApiTotals; truncated: boolean }> {
    const rows: ApiFuelEntry[] = [];
    let cursor: string | undefined;
    let totals: ApiTotals | null = null;
    do {
      const page = await fuelApi.list({ ...filters, limit: 100, cursor });
      totals = page.totals;
      rows.push(...page.data);
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor && rows.length < cap);
    return { rows, totals: totals as ApiTotals, truncated: Boolean(cursor) };
  },
};

export interface OperationFilters {
  category?: string;
  fy?: string;
  from?: string;
  to?: string;
  vehicleId?: string;
  driverId?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export const operationsApi = {
  list: (filters: OperationFilters = {}) =>
    authedRequest<Page<ApiOperation> & { total: string; count: number }>('/operations', { query: { ...filters } }),
  breakdown: (by: 'vehicle' | 'category', filters: OperationFilters = {}) =>
    authedRequest<{ key: string; label: string; entries: number; amount: string }[]>('/operations/breakdown', { query: { by, ...filters } }),
  tyreInsurance: (vehicleId?: string) => authedRequest<ApiTyreInsurance[]>('/operations/tyre-insurance', { query: { vehicleId } }),
  archive: (id: string, reason: string) => authedRequest<ApiOperation>(`/operations/${id}/archive`, { method: 'POST', body: { reason } }),
  restore: (id: string) => authedRequest<ApiOperation>(`/operations/${id}/restore`, { method: 'POST' }),
};

/**
 * Receipts are private, so they cannot be linked to directly: the bytes are fetched with the
 * session token and handed to the browser as an object URL. Caller revokes it when done.
 */
export async function fetchReceiptUrl(fileId: string): Promise<{ url: string; mimeType: string }> {
  const token = useSession.getState().token;
  const response = await fetch(`${API_BASE_URL}/api/v1/files/${fileId}/content`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (response.status === 401) useSession.getState().expire();
  if (!response.ok) throw new Error('Could not open the receipt.');
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob), mimeType: blob.type };
}

// ───────────────────────────── Phase 4 ─────────────────────────────

export interface DocumentFilters {
  type?: string;
  vehicleId?: string;
  driverId?: string;
  status?: string;
  verificationStatus?: string;
  expiryFrom?: string;
  expiryTo?: string;
  limit?: number;
  cursor?: string;
}

export const documentsApi = {
  summary: () => authedRequest<ApiComplianceSummaryRow[]>('/documents/summary'),
  list: (filters: DocumentFilters = {}) => authedRequest<Page<ApiDocument>>('/documents', { query: { ...filters } }),
  get: (id: string) => authedRequest<ApiDocument>(`/documents/${id}`),
  history: (id: string) => authedRequest<ApiDocument[]>(`/documents/${id}/history`),
  vehicle: (vehicleId: string) => authedRequest<ApiComplianceItem[]>(`/documents/vehicle/${vehicleId}`),
  person: (employeeId: string) => authedRequest<ApiComplianceItem[]>(`/documents/person/${employeeId}`),
  create: (body: Record<string, unknown>) => authedRequest<ApiDocument>('/documents', { method: 'POST', body }),
  replace: (id: string, body: Record<string, unknown>) => authedRequest<ApiDocument>(`/documents/${id}/replace`, { method: 'POST', body }),
  verify: (id: string) => authedRequest<ApiDocument>(`/documents/${id}/verify`, { method: 'POST' }),
  reject: (id: string, reason: string) => authedRequest<ApiDocument>(`/documents/${id}/reject`, { method: 'POST', body: { reason } }),
  archive: (id: string, reason: string) => authedRequest<ApiDocument>(`/documents/${id}/archive`, { method: 'POST', body: { reason } }),
};

/** Uploads an official document file exactly as chosen — no resizing or recompression. */
export async function uploadDocumentFile(file: File): Promise<string> {
  const token = useSession.getState().token;
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_BASE_URL}/api/v1/files/documents`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (response.status === 401) useSession.getState().expire();
  const body = (await response.json().catch(() => ({}))) as { fileId?: string; error?: { message?: string } };
  if (!response.ok || !body.fileId) throw new Error(body.error?.message ?? 'Could not upload the file.');
  return body.fileId;
}

// ─────────────────────────── Phase 5: finance & payments ───────────────────────────

export interface LedgerFilters {
  fy?: string;
  from?: string;
  to?: string;
  type?: string;
  direction?: string;
  vehicleId?: string;
  employeeId?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export const financeApi = {
  ledger: (filters: LedgerFilters = {}) => authedRequest<Page<ApiLedgerEntry> & { totals: ApiLedgerTotals }>('/finance/ledger', { query: { ...filters } }),
  summary: (fy?: string) => authedRequest<ApiFinanceSummary>('/finance/summary', { query: { fy } }),
  payrollSummary: (period?: string) => authedRequest<ApiPayrollSummary>('/finance/payroll-summary', { query: { period } }),

  salaries: (query: { payPeriod?: string; employeeId?: string; status?: string; q?: string; limit?: number; cursor?: string } = {}) =>
    authedRequest<Page<ApiSalary>>('/finance/salaries', { query: { ...query } }),
  createSalary: (body: { employeeId: string; payPeriod: string; baseSalary: number; allowances?: number; deductions?: number; recoverAdvanceIds?: string[]; notes?: string }) =>
    authedRequest<ApiSalary>('/finance/salaries', { method: 'POST', body }),
  cancelSalary: (id: string, reason: string) => authedRequest<ApiSalary>(`/finance/salaries/${id}/cancel`, { method: 'POST', body: { reason } }),

  advances: (query: { employeeId?: string; status?: string; type?: string; recoverable?: boolean; limit?: number; cursor?: string } = {}) =>
    authedRequest<Page<ApiAdvance>>('/finance/advances', { query: { ...query } }),
  createAdvance: (body: { employeeId: string; type: ApiAdvanceType; amount: number; advanceDate: string; reason?: string; notes?: string }) =>
    authedRequest<ApiAdvance>('/finance/advances', { method: 'POST', body }),
  cancelAdvance: (id: string, reason: string) => authedRequest<ApiAdvance>(`/finance/advances/${id}/cancel`, { method: 'POST', body: { reason } }),

  instalments: (vehicleId: string) => authedRequest<ApiInstalment[]>(`/vehicles/${vehicleId}/financing/installments`),
  generateInstalments: (vehicleId: string) => authedRequest<ApiInstalment[]>(`/vehicles/${vehicleId}/financing/installments/generate`, { method: 'POST' }),
  payInstalment: (vehicleId: string, number: number, body: { paidOn: string; reference?: string }) =>
    authedRequest<{ installmentNumber: number; paidInstallments: number; loanCompleted: boolean }>(`/vehicles/${vehicleId}/financing/installments/${number}/pay`, { method: 'POST', body }),
};

export const paymentsApi = {
  config: () => authedRequest<{ payoutsEnabled: boolean }>('/payments/config'),
  summary: () => authedRequest<ApiPaymentsSummary>('/payments/summary'),
  list: (query: { status?: string; type?: string; employeeId?: string; limit?: number; cursor?: string } = {}) =>
    authedRequest<Page<ApiPayment>>('/payments', { query: { ...query } }),
  get: (id: string) => authedRequest<ApiPayment>(`/payments/${id}`),
  history: (id: string) => authedRequest<ApiPaymentHistory>(`/payments/${id}/history`),
  create: (body: {
    employeeId: string; type: ApiPaymentType; method: ApiPaymentMethod; provider: ApiPaymentProvider;
    salaryRecordId?: string; advanceId?: string; amount?: number; description?: string;
  }) => authedRequest<ApiPayment>('/payments', { method: 'POST', body }),
  approve: (id: string) => authedRequest<ApiPayment>(`/payments/${id}/approve`, { method: 'POST' }),
  send: (id: string) => authedRequest<ApiPaymentOutcome>(`/payments/${id}/send`, { method: 'POST' }),
  checkStatus: (id: string) => authedRequest<ApiPaymentOutcome>(`/payments/${id}/check-status`, { method: 'POST' }),
  recordManual: (id: string, body: { reference?: string; paidOn?: string }) => authedRequest<ApiPayment>(`/payments/${id}/record-manual`, { method: 'POST', body }),
  cancel: (id: string, reason: string) => authedRequest<ApiPayment>(`/payments/${id}/cancel`, { method: 'POST', body: { reason } }),
  payoutAccount: (employeeId: string) => authedRequest<{ account: ApiPayoutAccount | null }>(`/payments/payout-accounts/${employeeId}`),
  savePayoutAccount: (employeeId: string, body: { method: ApiPaymentMethod; accountHolderName: string; ifsc?: string; accountNumber?: string; upiId?: string }) =>
    authedRequest<{ account: ApiPayoutAccount | null }>(`/payments/payout-accounts/${employeeId}`, { method: 'PUT', body }),
};

// ─────────────────────────── Accounts (sign-in access) ───────────────────────────

export const accountsApi = {
  get: (employeeId: string) => authedRequest<ApiAccountAccess>(`/employees/${employeeId}/account`),
  create: (employeeId: string, body: { role: ApiRole; phone?: string; email?: string }) =>
    authedRequest<ApiTemporaryPassword>(`/employees/${employeeId}/account`, { method: 'POST', body }),
  changeRole: (employeeId: string, role: ApiRole) => authedRequest<ApiAccount>(`/employees/${employeeId}/account/role`, { method: 'PATCH', body: { role } }),
  activate: (employeeId: string) => authedRequest<ApiAccount>(`/employees/${employeeId}/account/activate`, { method: 'POST' }),
  suspend: (employeeId: string, reason: string) => authedRequest<ApiAccount>(`/employees/${employeeId}/account/suspend`, { method: 'POST', body: { reason } }),
  disable: (employeeId: string, reason: string) => authedRequest<ApiAccount>(`/employees/${employeeId}/account/disable`, { method: 'POST', body: { reason } }),
  resetPassword: (employeeId: string) => authedRequest<ApiTemporaryPassword>(`/employees/${employeeId}/account/reset-password`, { method: 'POST' }),
};

// ─────────────────────────── Fleet location (Phase 6) ───────────────────────────

export interface FleetFilters {
  status?: string;
  trackingState?: string;
  /** 1 keeps only drivers with an active stationary alert. */
  alerting?: number;
  q?: string;
}

/**
 * Live fleet. Every call is scoped to the signed-in company by the API; the console never asks
 * for a driver it was not given, and a restricted role gets less back rather than a 200 it
 * should not have had.
 */
export const fleetApi = {
  locations: (filters: FleetFilters = {}) => authedRequest<ApiFleetResponse>('/locations/fleet', { query: { ...filters } }),
  driver: (driverId: string) => authedRequest<ApiFleetLocation>(`/locations/drivers/${driverId}`),
  driverHistory: (driverId: string, query: { limit?: number; cursor?: string; from?: string; to?: string } = {}) =>
    authedRequest<ApiPingPage>(`/locations/drivers/${driverId}/history`, { query: { ...query } }),
  vehicleHistory: (vehicleId: string, query: { limit?: number; cursor?: string; from?: string; to?: string } = {}) =>
    authedRequest<ApiPingPage>(`/locations/vehicles/${vehicleId}/history`, { query: { ...query } }),
  alerts: (query: { status?: string; type?: string; driverId?: string; limit?: number; cursor?: string } = {}) =>
    authedRequest<Page<ApiFleetAlert>>('/locations/alerts', { query: { ...query } }),
  alertSummary: () => authedRequest<ApiFleetAlertSummary>('/locations/alerts/summary'),
  acknowledgeAlert: (id: string, note?: string) =>
    authedRequest<ApiFleetAlert>(`/locations/alerts/${id}/acknowledge`, { method: 'POST', body: { note } }),
  resolveAlert: (id: string, reason?: string) =>
    authedRequest<ApiFleetAlert>(`/locations/alerts/${id}/resolve`, { method: 'POST', body: { reason } }),
};

// ─────────────────────── Service receipt AI (Phase 7) ───────────────────────

/**
 * Receipt review and verification.
 *
 * There is no upload call here on purpose: a service receipt arrives through the ordinary
 * operations flow, which already stores the file and creates the maintenance record. What this
 * adds is the reading of it, and the office's decision about whether to trust that reading.
 */
export const serviceReceiptsApi = {
  pending: (query: { status?: ApiReceiptAIStatus; limit?: number; cursor?: string } = {}) =>
    authedRequest<Page<ApiPendingReceipt>>('/service-receipts/pending', { query: { ...query } }),
  queue: () => authedRequest<ApiReceiptQueueStatus>('/service-receipts/queue'),
  review: (id: string) => authedRequest<ApiReceiptReview>(`/service-receipts/${id}`),
  /**
   * Confirms the record with the values the office submits.
   *
   * Whatever is sent here is what gets saved. The server never reads figures out of the
   * extraction on the office's behalf, so an empty body confirms the record exactly as it stands.
   */
  verify: (
    id: string,
    body: { amount?: string; expenseDate?: string; vendorName?: string; description?: string; acceptedFields?: string[]; resultId?: string },
  ) => authedRequest<{ id: string; aiStatus: ApiReceiptAIStatus; aiVerifiedAt: string | null }>(`/service-receipts/${id}/verify`, { method: 'POST', body }),
  reject: (id: string, reason?: string) =>
    authedRequest<{ id: string; aiStatus: ApiReceiptAIStatus; aiRejectedAt: string | null }>(`/service-receipts/${id}/reject`, { method: 'POST', body: { reason } }),
  /** Re-opening a settled record is a deliberate act, so the reason is required. */
  reopen: (id: string, reason: string) =>
    authedRequest<{ id: string; aiStatus: ApiReceiptAIStatus }>(`/service-receipts/${id}/reopen`, { method: 'POST', body: { reason } }),
  retry: (id: string) => authedRequest<{ jobId: string; status: ApiReceiptAIStatus }>(`/service-receipts/${id}/retry`, { method: 'POST' }),
  maintenanceSummary: () => authedRequest<ApiMaintenanceSummary>('/service-receipts/maintenance/summary'),
  vehicleMaintenance: (vehicleId: string) =>
    authedRequest<ApiVehicleMaintenance>(`/service-receipts/maintenance/vehicles/${vehicleId}`),
};

// ───────────────────────────── Inbox (Phase 7) ─────────────────────────────

export interface InboxFilters {
  status?: ApiInboxStatus;
  classification?: ApiInboxClassification;
  q?: string;
  limit?: number;
  cursor?: string;
}

/**
 * The company mailbox.
 *
 * Read-only towards the mailbox itself: there is no send, reply, forward or delete, because the
 * server offers none. The only writes are the office's own — a status, a category, or asking for
 * the mail to be read again.
 */
export const inboxApi = {
  status: () => authedRequest<ApiInboxStatusInfo>('/inbox/status'),
  summary: () => authedRequest<ApiInboxSummary>('/inbox/summary'),
  list: (filters: InboxFilters = {}) => authedRequest<Page<ApiInboxRow>>('/inbox/messages', { query: { ...filters } }),
  get: (id: string) => authedRequest<ApiInboxMessage>(`/inbox/messages/${id}`),
  /** Contacts the mailbox now and reports what actually happened, never a bare success. */
  sync: (limit?: number) => authedRequest<ApiInboxSyncOutcome>('/inbox/sync', { method: 'POST', body: { limit } }),
  verifyConnection: () =>
    authedRequest<{ ok: boolean; reason?: string; mailbox?: string; messageCount?: number }>('/inbox/verify-connection', { method: 'POST' }),
  setStatus: (id: string, status: ApiInboxStatus) =>
    authedRequest<{ id: string; status: ApiInboxStatus }>(`/inbox/messages/${id}/status`, { method: 'PATCH', body: { status } }),
  /** A person setting the category. From here on no AI run will change it. */
  classify: (id: string, classification: ApiInboxClassification) =>
    authedRequest<{ id: string; classification: ApiInboxClassification }>(`/inbox/messages/${id}/classification`, { method: 'PATCH', body: { classification } }),
  retryAI: (id: string) => authedRequest<{ ok: boolean; applied: boolean }>(`/inbox/messages/${id}/retry-ai`, { method: 'POST' }),
};

/**
 * Downloads an inbound attachment through the API, with the session token.
 *
 * Fetched rather than linked: the file is never public, and the browser must not be handed a URL
 * that would render an untrusted document inline.
 */
export async function fetchInboxAttachment(messageId: string, attachmentId: string): Promise<{ url: string; filename: string }> {
  const token = useSession.getState().token;
  const response = await fetch(`${API_BASE_URL}/api/v1/inbox/messages/${messageId}/attachments/${attachmentId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (response.status === 401) useSession.getState().expire();
  if (!response.ok) throw new Error('Could not open the attachment.');
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob), filename: match ? decodeURIComponent(match[1]) : 'attachment' };
}
