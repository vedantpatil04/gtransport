/**
 * Domain contracts shared with the Gangamata backend.
 *
 * These mirror the API presenters (backend/src/modules/**) exactly — same names, same unions —
 * so the mobile app and the server never drift into two different vocabularies.
 */

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'ACCOUNTING' | 'MANAGER' | 'DRIVER';
export type DriverStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ON_LEAVE';
export type EmploymentStatus = 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'INACTIVE' | 'EXITED';
export type VehicleKind = 'LCV' | 'PICKUP' | 'TRUCK';
export type FuelType = 'PETROL' | 'DIESEL';
export type VehicleStatus = 'ACTIVE' | 'MAINTENANCE' | 'IDLE' | 'RETIRED';
export type VehicleOwnership = 'OWNED' | 'FINANCED';
export type ApiLanguage = 'EN' | 'HI' | 'KN' | 'MR' | 'TA' | 'TE';

/** Location state stored by the backend (Phase 0 foundation). */
export type LocationStatus = 'ACTIVE' | 'PERMISSION_DENIED' | 'LOCATION_DISABLED' | 'OFFLINE' | 'STALE';
export type LocationPermissionState = 'UNKNOWN' | 'GRANTED_ALWAYS' | 'GRANTED_FOREGROUND' | 'DENIED';

export interface SessionUser {
  id: string;
  role: UserRole;
  companyId: string;
  email: string | null;
  phone: string | null;
  employee: { id: string; fullName: string } | null;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: string;
  user: SessionUser;
}

export interface AssignedVehicle {
  id: string;
  registrationNumber: string;
  kind: VehicleKind;
  fuelType: FuelType;
  status: VehicleStatus;
  ownership: VehicleOwnership;
}

/** The authenticated driver's own record, from GET /drivers/me. */
export interface DriverProfile {
  id: string;
  driverCode: string;
  status: DriverStatus;
  licenceNumber: string | null;
  licenceExpiryDate: string | null;
  homeTown: string | null;
  locationSharingEnabled: boolean;
  location: { status: LocationStatus; permission: LocationPermissionState; lastHeartbeatAt: string | null } | null;
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
  currentAssignment: { id: string; startedAt: string; vehicle: AssignedVehicle } | null;
}
