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

/** What the server concludes about a driver's tracking, from its reports plus fix recency. */
export type LocationStatus = 'ACTIVE' | 'PERMISSION_DENIED' | 'LOCATION_DISABLED' | 'OFFLINE' | 'STALE';
export type LocationPermissionState = 'UNKNOWN' | 'GRANTED_ALWAYS' | 'GRANTED_FOREGROUND' | 'DENIED';

/**
 * What this device reports about its own tracking. Distinct from LocationStatus: this is the
 * device's account of itself, which the server reconciles against the permissions it reports —
 * the app can never assert that tracking is active when the OS has refused it.
 */
export type DriverTrackingState =
  | 'LOCATION_PERMISSION_DENIED'
  | 'BACKGROUND_PERMISSION_MISSING'
  | 'LOCATION_SERVICES_DISABLED'
  | 'TRACKING_ACTIVE'
  | 'TRACKING_PAUSED'
  | 'TRACKING_UNAVAILABLE'
  | 'SYNC_PENDING'
  | 'LAST_LOCATION_STALE';

/** How often and how far apart to report. Served by the API so it is tunable without a release. */
export interface TrackingPolicy {
  movingIntervalSeconds: number;
  stationaryIntervalSeconds: number;
  distanceMeters: number;
  /** Fixes this device may hold offline before the oldest are dropped. */
  bufferLimit: number;
  maxBatchSize: number;
  staleAfterMinutes: number;
}

/** One captured position, as the API accepts it. No driver or vehicle id: the server resolves both. */
export interface LocationFixPayload {
  latitude: number;
  longitude: number;
  /** Device clock at capture, preserved through any amount of offline buffering. */
  capturedAt: string;
  accuracyMeters?: number;
  speedKmh?: number;
  headingDeg?: number;
  altitudeMeters?: number;
  batteryPct?: number;
  provider?: string;
  /** Stable per fix, and identical on every retry: this is what makes a re-upload safe. */
  clientSubmissionId: string;
}

/** Per-fix outcome. 'rejected' is final — the app must stop retrying that fix. */
export type FixOutcome = 'stored' | 'duplicate' | 'rejected';

export interface FixResult {
  clientSubmissionId: string;
  outcome: FixOutcome;
  reason?: string;
  message?: string;
}

export interface SubmitLocationsResponse {
  stored: number;
  duplicates: number;
  rejected: number;
  results: FixResult[];
  state: { status: LocationStatus; trackingState: DriverTrackingState; lastSeenAt: string | null };
  alertRaised: boolean;
}

export interface TrackingStateResponse {
  status: LocationStatus;
  permission: LocationPermissionState;
  trackingState: DriverTrackingState;
  pendingUploads: number;
  trackingPolicy: TrackingPolicy;
}

export type AccountStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type OfficeRole = Exclude<UserRole, 'DRIVER'>;

/**
 * The signed-in account, for every role — exactly what the API returns from login and
 * /auth/me (backend UsersService.profile). A contract test pins this shape.
 */
export interface SessionUser {
  id: string;
  role: UserRole;
  companyId: string;
  employeeId: string | null;
  driverId: string | null;
  status: AccountStatus;
  /** A temporary password is in use: the API allows nothing but a password change. */
  mustChangePassword: boolean;
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface LoginResponse {
  accessToken: string;
  /** Absolute expiry (ISO 8601). The authoritative value. */
  expiresAt: string | null;
  /** Relative lifetime, e.g. "12h". Present for older clients. */
  expiresIn?: string;
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
  /**
   * Tracking as of the driver's last contact, or null before the app has reported once. The
   * fields beyond the original three are optional so a response from a server that predates
   * Phase 6 still parses; coordinates are deliberately absent — positions come from the fleet
   * endpoints, which have their own role checks.
   */
  location:
    | {
        status: LocationStatus;
        permission: LocationPermissionState;
        lastHeartbeatAt: string | null;
        trackingState?: DriverTrackingState;
        locationServicesEnabled?: boolean;
        pendingUploads?: number;
        lastSeenAt?: string | null;
        capturedAt?: string | null;
        hasPosition?: boolean;
        stationarySince?: string | null;
      }
    | null;
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

// ───────────────────────────── Phase 3: fuel & daily operations ─────────────────────────────

export type FuelTypeValue = 'PETROL' | 'DIESEL';
export type OperationCategory = 'RTO' | 'TYRE' | 'MAINTENANCE';

/** A fill-up as the API returns it (backend fuel.presenter.ts). */
export interface FuelEntry {
  id: string;
  fuelType: FuelTypeValue;
  amount: string;
  litres: string;
  /** Derived by the server; never computed or stored on the phone. */
  ratePerLitre: string | null;
  fuelStation: string;
  transactionDate: string;
  receiptFileId: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  clientSubmissionId: string | null;
  createdAt: string;
  driver: { id: string; driverCode: string; fullName: string };
  vehicle: { id: string; registrationNumber: string };
}

export interface FuelTotals {
  entries: number;
  amount: string;
  litres: string;
  averageRate: string | null;
}

export interface OperationRecord {
  id: string;
  category: OperationCategory;
  amount: string;
  expenseDate: string;
  vendorName: string | null;
  description: string | null;
  receiptFileId: string | null;
  clientSubmissionId: string | null;
  vehicle: { id: string; registrationNumber: string };
}

export interface DocumentRecord {
  id: string;
  type: string;
  customName: string | null;
  ownerType: string;
  vehicleId: string | null;
  employeeId: string | null;
  documentNumber: string | null;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  fileId: string | null;
  verificationStatus: string;
  verifiedAt: string | null;
}

export interface Page<T> {
  data: T[];
  page: { limit: number; nextCursor: string | null };
}

/**
 * How far a service receipt has got, in the five words a driver is shown.
 *
 * Deliberately coarse. A driver photographed a bill at a garage and wants to know whether the
 * office has it and whether anything is expected of them — not how it was read, by what, or how
 * sure it was. The server collapses its own vocabulary into these five before sending anything.
 */
export type DriverReceiptState = 'uploaded' | 'processing' | 'needsReview' | 'verified' | 'failed';

export interface DriverServiceReceipt {
  id: string;
  amount: string;
  serviceDate: string | null;
  vendorName: string | null;
  vehicleRegistration: string;
  hasReceipt: boolean;
  state: DriverReceiptState;
  submittedAt: string;
}
