export type Lang = 'en' | 'hi' | 'kn' | 'mr' | 'ta' | 'te';
export type AdminLang = 'en' | 'hi';
export type Role = 'driver' | 'admin';
export type FuelType = 'petrol' | 'diesel';
export type SyncStatus = 'synced' | 'pending';

export type ExpenseCategory = 'toll' | 'parking' | 'repair' | 'food' | 'maintenance' | 'trip' | 'other';
/** Driver-side update types. `advance` records cash received and becomes a payment record. */
export type UpdateType = ExpenseCategory | 'advance';

export type PaymentType = 'salary' | 'fuel_advance' | 'trip_allowance' | 'other_advance' | 'reimbursement';
export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled';
export type PaymentMethod = 'upi' | 'bank' | 'cash';

export type DocType = 'rc' | 'insurance' | 'puc' | 'licence' | 'fitness' | 'permit' | 'other';
export type DocVerification = 'pending' | 'approved' | 'verified' | 'rejected';
export type ReminderTarget = 'driver' | 'admin' | 'insurer';

export type DriverStatus = 'active' | 'inactive';
export type VehicleStatus = 'active' | 'maintenance' | 'idle';
export type MotionState = 'moving' | 'stopped' | 'offline' | 'none';
export type VehicleKind = 'lcv' | 'pickup' | 'truck';

/** Reference to an uploaded file. `generated` files are rendered on the fly (seeded demo records). */
export interface FileRef {
  id: string;
  kind: 'image' | 'pdf' | 'generated';
  name?: string;
  size?: number;
  /** false while the upload is queued (offline) */
  uploaded: boolean;
}

export interface DriverSim {
  route: string[];
  /** starting distance along the route, 0..1 */
  offset: number;
  speedKmh: number;
  mode: 'moving' | 'stopped' | 'offline';
  /** ISO timestamp of the last ping when offline */
  lastSeen?: string;
}

export interface Driver {
  id: string;
  code: string;
  name: string;
  phone: string;
  language: Lang;
  status: DriverStatus;
  vehicleId: string | null;
  joinedOn: string;
  baseSalary: number;
  homeTown: string;
  locationSharing: boolean;
  notificationPrefs: { payments: boolean; documents: boolean; trips: boolean };
  sim: DriverSim;
}

export interface Vehicle {
  id: string;
  reg: string;
  model: string;
  kind: VehicleKind;
  fuelType: FuelType;
  capacityT: number;
  year: number;
  mileageKmpl: number;
  driverId: string | null;
  status: VehicleStatus;
}

export interface FuelEntry {
  id: string;
  driverId: string;
  vehicleId: string;
  fuelType: FuelType;
  amount: number;
  litres: number;
  station: string;
  date: string;
  createdAt: string;
  receipt: FileRef | null;
  sync: SyncStatus;
  editedAt?: string;
}

export interface Expense {
  id: string;
  driverId: string;
  vehicleId: string;
  category: ExpenseCategory;
  amount: number;
  note: string;
  date: string;
  createdAt: string;
  receipt: FileRef | null;
  status: 'submitted' | 'approved' | 'rejected';
  sync: SyncStatus;
  enteredBy: 'driver' | 'admin';
}

export interface PaymentEvent {
  status: PaymentStatus | 'created' | 'approved';
  at: string;
}

export interface Payment {
  id: string;
  driverId: string;
  type: PaymentType;
  amount: number;
  status: PaymentStatus;
  method: PaymentMethod;
  reference: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  approved: boolean;
  reportedByDriver: boolean;
  history: PaymentEvent[];
  sync: SyncStatus;
}

export interface DocReminder {
  to: ReminderTarget;
  at: string;
}

export interface DocRecord {
  id: string;
  ownerType: 'vehicle' | 'driver';
  ownerId: string;
  type: DocType;
  customName?: string;
  number: string;
  issuer: string;
  issuedOn: string | null;
  expiresOn: string | null;
  uploadedAt: string;
  file: FileRef | null;
  verification: DocVerification;
  reminders: DocReminder[];
}

export interface Trip {
  id: string;
  driverId: string;
  vehicleId: string;
  from: string;
  to: string;
  goods: string;
  weightT: number;
  distanceKm: number;
  startedOn: string;
  status: 'assigned' | 'in_transit' | 'delivered';
}

export type NotificationKind =
  | 'doc_expiring'
  | 'doc_expired'
  | 'doc_uploaded'
  | 'doc_verified'
  | 'doc_rejected'
  | 'doc_reminder'
  | 'insurer_notified'
  | 'payment_created'
  | 'payment_processing'
  | 'payment_paid'
  | 'payment_failed'
  | 'payment_pending'
  | 'fuel_added'
  | 'expense_approved'
  | 'expense_rejected'
  | 'driver_offline'
  | 'trip_assigned'
  | 'advance_reported';

export interface AppNotification {
  id: string;
  /** 'admin' or a driver id */
  audience: string;
  kind: NotificationKind;
  params: Record<string, string | number>;
  createdAt: string;
  read: boolean;
  link?: string;
  dedupeKey?: string;
}

export interface MonthSummary {
  month: string; // YYYY-MM
  fuel: number;
  salaries: number;
  maintenance: number;
  tolls: number;
  other: number;
}

export interface CompanySettings {
  name: string;
  office: string;
  phone: string;
  gstin: string;
  reminderDays: Record<'30' | '15' | '7' | '3', boolean>;
  autoNotify: Record<ReminderTarget, boolean>;
}
