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

export const officeApi = {
  fleet: (token: string, query: { q?: string; status?: string } = {}) =>
    apiRequest<OfficeFleetResponse>(`/locations/fleet${qs(query)}`, { token }),
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
};

