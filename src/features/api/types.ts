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
  calculated: { emiAmount: number; totalPayable: number; totalInterest: number; outstandingPrincipal: number } | null;
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
