import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createSeed, type DemoData } from '@/data/seed';
import { expiryNotifications } from '@/features/documents/expiry';
import { todayISO } from '@/lib/dates';
import { clearFiles } from '@/lib/fileStore';
import { uid } from '@/lib/utils';
import type {
  AdminLang, AppNotification, CompanySettings, DocRecord, DocType, DocVerification, Driver, Expense, ExpenseCategory,
  FileRef, FuelEntry, FuelType, Lang, NotificationKind, Payment, PaymentMethod, PaymentStatus, PaymentType, ReminderTarget, Role, Trip, Vehicle,
} from '@/types';

const STORE_VERSION = 4;

interface UiState {
  version: number;
  seededAt: string;
  role: Role;
  currentDriverId: string;
  adminLanguage: AdminLang;
  theme: 'light' | 'dark';
  offline: boolean;
  session: { driver: boolean; admin: boolean };
  lastRoute: Record<Role, string>;
}

export interface FuelInput {
  fuelType: FuelType;
  amount: number;
  litres: number;
  station: string;
  date: string;
  receipt: FileRef | null;
}
export interface ExpenseInput {
  category: ExpenseCategory;
  amount: number;
  note: string;
  date: string;
  receipt: FileRef | null;
}
export interface DocUploadInput {
  docId?: string;
  ownerType: DocRecord['ownerType'];
  ownerId: string;
  type: DocType;
  customName?: string;
  number: string;
  issuer: string;
  expiresOn: string | null;
  file: FileRef;
}

interface Actions {
  setRole: (role: Role) => void;
  setCurrentDriver: (id: string) => void;
  setAdminLanguage: (lang: AdminLang) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setLastRoute: (role: Role, path: string) => void;
  login: (role: Role) => void;
  logout: (role: Role) => void;
  setOffline: (offline: boolean) => void;
  pendingSyncCount: () => number;
  syncPending: () => number;
  resetDemo: () => Promise<void>;

  addFuel: (input: FuelInput) => FuelEntry;
  updateFuel: (id: string, patch: Partial<Pick<FuelEntry, 'fuelType' | 'amount' | 'litres' | 'station' | 'date'>>) => void;
  deleteFuel: (id: string) => void;
  addExpense: (input: ExpenseInput) => Expense;
  setExpenseStatus: (id: string, status: Expense['status']) => void;
  /** Office-entered expense (e.g. a workshop bill) — approved on entry. */
  recordExpense: (input: ExpenseInput & { vehicleId: string; driverId: string }) => Expense;
  reportAdvance: (input: { amount: number; note: string; date: string }) => Payment;

  createPayment: (input: { driverId: string; type: PaymentType; amount: number; method: PaymentMethod; note: string }) => Payment;
  approvePayment: (id: string) => void;
  setPaymentStatus: (id: string, status: PaymentStatus) => void;

  uploadDocument: (input: DocUploadInput) => DocRecord;
  setDocVerification: (id: string, v: DocVerification) => void;
  sendDocReminder: (id: string, to: ReminderTarget) => void;
  runExpiryCheck: () => void;

  updateDriver: (id: string, patch: Partial<Pick<Driver, 'name' | 'status' | 'language' | 'locationSharing' | 'notificationPrefs' | 'baseSalary'>>) => void;
  addDriver: (input: { name: string; phone: string; language: Lang; baseSalary: number; homeTown: string; vehicleId: string | null }) => Driver;
  assignVehicle: (driverId: string, vehicleId: string | null) => void;
  addVehicle: (input: Pick<Vehicle, 'reg' | 'model' | 'kind' | 'fuelType' | 'capacityT' | 'year' | 'mileageKmpl'>) => Vehicle;
  updateVehicle: (id: string, patch: Partial<Pick<Vehicle, 'status' | 'model' | 'mileageKmpl'>>) => void;
  assignTrip: (input: { driverId: string; from: string; to: string; goods: string; distanceKm: number }) => void;

  markRead: (id: string) => void;
  markAllRead: (audience: string) => void;
  updateCompany: (patch: Partial<CompanySettings>) => void;
}

export type AppState = DemoData & UiState & Actions;

const PAYMENT_KINDS: NotificationKind[] = ['payment_created', 'payment_processing', 'payment_paid', 'payment_failed'];
const DOC_KINDS: NotificationKind[] = ['doc_expiring', 'doc_expired', 'doc_verified', 'doc_rejected', 'doc_reminder'];

function freshState(): DemoData & UiState {
  const seed = createSeed(new Date());
  return {
    ...seed,
    version: STORE_VERSION,
    seededAt: new Date().toISOString(),
    role: 'driver',
    currentDriverId: seed.drivers[0].id,
    adminLanguage: 'en',
    theme: 'light',
    offline: false,
    session: { driver: true, admin: true },
    lastRoute: { driver: '/driver', admin: '/admin' },
  };
}

const nowIso = () => new Date().toISOString();

export const useApp = create<AppState>()(
  persist(
    (set, get) => {
      /** Adds notifications, honouring each driver's notification preferences. */
      const withNotes = (existing: AppNotification[], ...notes: Omit<AppNotification, 'id' | 'createdAt' | 'read'>[]) => {
        const drivers = get().drivers;
        const accepted = notes.filter((n) => {
          if (n.audience === 'admin') return true;
          const prefs = drivers.find((d) => d.id === n.audience)?.notificationPrefs;
          if (!prefs) return true;
          if (PAYMENT_KINDS.includes(n.kind)) return prefs.payments;
          if (DOC_KINDS.includes(n.kind)) return prefs.documents;
          if (n.kind === 'trip_assigned') return prefs.trips;
          return true;
        });
        return [...accepted.map((n) => ({ ...n, id: uid('ntf'), createdAt: nowIso(), read: false })), ...existing];
      };
      const driverName = (id: string) => get().drivers.find((d) => d.id === id)?.name ?? '';
      const regOf = (id: string | null) => get().vehicles.find((v) => v.id === id)?.reg ?? '';
      const me = () => get().drivers.find((d) => d.id === get().currentDriverId)!;

      return {
        ...freshState(),

        setRole: (role) => set({ role }),
        setCurrentDriver: (currentDriverId) => set({ currentDriverId }),
        setAdminLanguage: (adminLanguage) => set({ adminLanguage }),
        setTheme: (theme) => set({ theme }),
        setLastRoute: (role, path) => set((s) => ({ lastRoute: { ...s.lastRoute, [role]: path } })),
        login: (role) => set((s) => ({ session: { ...s.session, [role]: true } })),
        logout: (role) => set((s) => ({ session: { ...s.session, [role]: false } })),
        setOffline: (offline) => set({ offline }),

        pendingSyncCount: () => {
          const s = get();
          return s.fuel.filter((f) => f.sync === 'pending').length + s.expenses.filter((e) => e.sync === 'pending').length + s.payments.filter((p) => p.sync === 'pending').length;
        },

        syncPending: () => {
          const s = get();
          const pendingFuel = s.fuel.filter((f) => f.sync === 'pending');
          const count = s.pendingSyncCount();
          if (!count) return 0;
          const upload = (r: FileRef | null) => (r ? { ...r, uploaded: true } : r);
          let notifications = s.notifications;
          for (const f of pendingFuel) {
            notifications = withNotes(notifications, { audience: 'admin', kind: 'fuel_added', params: { driver: driverName(f.driverId), vehicle: regOf(f.vehicleId), amount: f.amount, fuelType: f.fuelType }, link: `/admin/fuel?entry=${f.id}` });
          }
          set({
            fuel: s.fuel.map((f) => (f.sync === 'pending' ? { ...f, sync: 'synced', receipt: upload(f.receipt) } : f)),
            expenses: s.expenses.map((e) => (e.sync === 'pending' ? { ...e, sync: 'synced', receipt: upload(e.receipt) } : e)),
            payments: s.payments.map((p) => (p.sync === 'pending' ? { ...p, sync: 'synced' } : p)),
            notifications,
          });
          return count;
        },

        resetDemo: async () => {
          await clearFiles();
          const keep = { role: get().role };
          set({ ...freshState(), ...keep });
        },

        addFuel: (input) => {
          const s = get();
          const driver = me();
          const offline = s.offline;
          const entry: FuelEntry = {
            id: uid('fuel'),
            driverId: driver.id,
            vehicleId: driver.vehicleId!,
            ...input,
            receipt: input.receipt ? { ...input.receipt, uploaded: !offline } : null,
            createdAt: nowIso(),
            sync: offline ? 'pending' : 'synced',
          };
          set({
            fuel: [entry, ...s.fuel],
            notifications: offline
              ? s.notifications
              : withNotes(s.notifications, { audience: 'admin', kind: 'fuel_added', params: { driver: driver.name, vehicle: regOf(entry.vehicleId), amount: entry.amount, fuelType: entry.fuelType }, link: `/admin/fuel?entry=${entry.id}` }),
          });
          return entry;
        },
        updateFuel: (id, patch) => set((s) => ({ fuel: s.fuel.map((f) => (f.id === id ? { ...f, ...patch, editedAt: nowIso() } : f)) })),
        deleteFuel: (id) => set((s) => ({ fuel: s.fuel.filter((f) => f.id !== id) })),

        addExpense: (input) => {
          const s = get();
          const driver = me();
          const exp: Expense = {
            id: uid('exp'),
            driverId: driver.id,
            vehicleId: driver.vehicleId!,
            ...input,
            receipt: input.receipt ? { ...input.receipt, uploaded: !s.offline } : null,
            createdAt: nowIso(),
            status: 'submitted',
            sync: s.offline ? 'pending' : 'synced',
            enteredBy: 'driver',
          };
          set({ expenses: [exp, ...s.expenses] });
          return exp;
        },
        recordExpense: (input) => {
          const exp: Expense = { id: uid('exp'), ...input, createdAt: nowIso(), status: 'approved', sync: 'synced', enteredBy: 'admin' };
          set((s) => ({ expenses: [exp, ...s.expenses] }));
          return exp;
        },
        setExpenseStatus: (id, status) => {
          const s = get();
          const exp = s.expenses.find((e) => e.id === id);
          if (!exp) return;
          set({
            expenses: s.expenses.map((e) => (e.id === id ? { ...e, status } : e)),
            notifications:
              status === 'submitted' || exp.enteredBy === 'admin'
                ? s.notifications
                : withNotes(s.notifications, { audience: exp.driverId, kind: status === 'approved' ? 'expense_approved' : 'expense_rejected', params: { category: exp.category, amount: exp.amount }, link: '/driver/updates' }),
          });
        },
        reportAdvance: ({ amount, note, date }) => {
          const s = get();
          const driver = me();
          const at = date === todayISO() ? nowIso() : new Date(`${date}T12:00:00`).toISOString();
          const p: Payment = {
            id: uid('pay'), driverId: driver.id, type: 'other_advance', amount, status: 'paid', method: 'cash', reference: null, note,
            createdAt: at, updatedAt: at, paidAt: at, approved: true, reportedByDriver: true,
            history: [{ status: 'created', at }, { status: 'paid', at }], sync: s.offline ? 'pending' : 'synced',
          };
          set({
            payments: [p, ...s.payments],
            notifications: withNotes(s.notifications, { audience: 'admin', kind: 'advance_reported', params: { driver: driver.name, amount }, link: `/admin/payments?payment=${p.id}` }),
          });
          return p;
        },

        createPayment: ({ driverId, type, amount, method, note }) => {
          const s = get();
          const at = nowIso();
          const p: Payment = {
            id: uid('pay'), driverId, type, amount, status: 'pending', method, reference: null, note, createdAt: at, updatedAt: at, paidAt: null,
            approved: false, reportedByDriver: false, history: [{ status: 'created', at }], sync: 'synced',
          };
          set({
            payments: [p, ...s.payments],
            notifications: withNotes(s.notifications, { audience: driverId, kind: 'payment_created', params: { amount, type }, link: `/driver/payments/${p.id}` }),
          });
          return p;
        },
        approvePayment: (id) =>
          set((s) => ({
            payments: s.payments.map((p) => (p.id === id ? { ...p, approved: true, updatedAt: nowIso(), history: [...p.history, { status: 'approved', at: nowIso() }] } : p)),
          })),
        setPaymentStatus: (id, status) => {
          const s = get();
          const p = s.payments.find((x) => x.id === id);
          if (!p || p.status === status) return;
          const at = nowIso();
          const reference =
            status === 'paid' || status === 'failed' || status === 'processing'
              ? p.reference ?? (p.method === 'upi' ? `RZP-${Math.floor(100000 + Math.random() * 900000)}` : p.method === 'bank' ? `UTR${Math.floor(1e11 + Math.random() * 9e11)}` : null)
              : p.reference;
          const updated: Payment = {
            ...p, status, reference, updatedAt: at, approved: p.approved || status !== 'cancelled',
            paidAt: status === 'paid' ? at : p.paidAt,
            history: [...p.history, { status, at }],
          };
          const driverKind: Partial<Record<PaymentStatus, NotificationKind>> = { processing: 'payment_processing', paid: 'payment_paid', failed: 'payment_failed' };
          let notifications = s.notifications;
          const dk = driverKind[status];
          if (dk) notifications = withNotes(notifications, { audience: p.driverId, kind: dk, params: { amount: p.amount, type: p.type }, link: `/driver/payments/${p.id}` });
          if (status === 'failed') notifications = withNotes(notifications, { audience: 'admin', kind: 'payment_failed', params: { driver: driverName(p.driverId), amount: p.amount, type: p.type }, link: `/admin/payments?payment=${p.id}` });
          set({ payments: s.payments.map((x) => (x.id === id ? updated : x)), notifications });
        },

        uploadDocument: (input) => {
          const s = get();
          const at = nowIso();
          const existing = input.docId ? s.documents.find((d) => d.id === input.docId) : undefined;
          const doc: DocRecord = existing
            ? { ...existing, number: input.number || existing.number, issuer: input.issuer || existing.issuer, expiresOn: input.expiresOn, file: input.file, uploadedAt: at, verification: 'pending', customName: input.customName ?? existing.customName }
            : { id: uid('doc'), ownerType: input.ownerType, ownerId: input.ownerId, type: input.type, customName: input.customName, number: input.number, issuer: input.issuer, issuedOn: null, expiresOn: input.expiresOn, uploadedAt: at, file: input.file, verification: 'pending', reminders: [] };
          const owner = doc.ownerType === 'vehicle' ? regOf(doc.ownerId) : driverName(doc.ownerId);
          const uploader = s.role === 'driver' ? me().name : 'Admin';
          set({
            documents: existing ? s.documents.map((d) => (d.id === doc.id ? doc : d)) : [...s.documents, doc],
            notifications: s.role === 'driver' ? withNotes(s.notifications, { audience: 'admin', kind: 'doc_uploaded', params: { doc: doc.type, owner, driver: uploader, docId: doc.id }, link: `/admin/documents?doc=${doc.id}` }) : s.notifications,
          });
          get().runExpiryCheck();
          return doc;
        },
        setDocVerification: (id, verification) => {
          const s = get();
          const doc = s.documents.find((d) => d.id === id);
          if (!doc) return;
          const driverId = doc.ownerType === 'driver' ? doc.ownerId : s.vehicles.find((v) => v.id === doc.ownerId)?.driverId;
          let notifications = s.notifications;
          if (driverId && (verification === 'verified' || verification === 'rejected' || verification === 'approved'))
            notifications = withNotes(notifications, { audience: driverId, kind: verification === 'rejected' ? 'doc_rejected' : 'doc_verified', params: { doc: doc.type, docId: doc.id }, link: `/driver/documents/${doc.id}` });
          set({ documents: s.documents.map((d) => (d.id === id ? { ...d, verification } : d)), notifications });
        },
        sendDocReminder: (id, to) => {
          const s = get();
          const doc = s.documents.find((d) => d.id === id);
          if (!doc) return;
          const driverId = doc.ownerType === 'driver' ? doc.ownerId : s.vehicles.find((v) => v.id === doc.ownerId)?.driverId ?? null;
          const owner = doc.ownerType === 'vehicle' ? regOf(doc.ownerId) : driverName(doc.ownerId);
          let notifications = s.notifications;
          if (to === 'driver' && driverId) notifications = withNotes(notifications, { audience: driverId, kind: 'doc_reminder', params: { doc: doc.type, owner, docId: doc.id }, link: `/driver/documents/${doc.id}` });
          if (to === 'admin') notifications = withNotes(notifications, { audience: 'admin', kind: 'doc_reminder', params: { doc: doc.type, owner, docId: doc.id }, link: `/admin/documents?doc=${doc.id}` });
          if (to === 'insurer') notifications = withNotes(notifications, { audience: 'admin', kind: 'insurer_notified', params: { doc: doc.type, owner, insurer: doc.issuer, docId: doc.id }, link: `/admin/documents?doc=${doc.id}` });
          set({ documents: s.documents.map((d) => (d.id === id ? { ...d, reminders: [...d.reminders, { to, at: nowIso() }] } : d)), notifications });
        },
        runExpiryCheck: () => {
          const s = get();
          const fresh = expiryNotifications(s.documents, s.vehicles, s.drivers, s.notifications, s.company);
          if (fresh.length) set({ notifications: [...fresh, ...s.notifications] });
        },

        updateDriver: (id, patch) => set((s) => ({ drivers: s.drivers.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
        addDriver: (input) => {
          const s = get();
          const n = s.drivers.length + 1;
          const driver: Driver = {
            id: uid('drv'), code: `GR-D-${100 + n}`, name: input.name, phone: `+91 ${input.phone.slice(0, 3)}•• •••${input.phone.slice(-2)}`, language: input.language, status: 'active',
            vehicleId: null, joinedOn: todayISO(), baseSalary: input.baseSalary, homeTown: input.homeTown, locationSharing: true,
            notificationPrefs: { payments: true, documents: true, trips: true },
            sim: { route: ['belagavi', 'dharwad'], offset: 0, speedKmh: 0, mode: 'stopped' },
          };
          set({ drivers: [...s.drivers, driver] });
          if (input.vehicleId) get().assignVehicle(driver.id, input.vehicleId);
          return driver;
        },
        assignVehicle: (driverId, vehicleId) =>
          set((s) => {
            const prevVehicle = s.drivers.find((d) => d.id === driverId)?.vehicleId ?? null;
            const displacedDriver = vehicleId ? s.vehicles.find((v) => v.id === vehicleId)?.driverId ?? null : null;
            return {
              drivers: s.drivers.map((d) => (d.id === driverId ? { ...d, vehicleId } : d.id === displacedDriver && d.id !== driverId ? { ...d, vehicleId: null } : d)),
              vehicles: s.vehicles.map((v) =>
                v.id === vehicleId ? { ...v, driverId, status: v.status === 'maintenance' ? v.status : 'active' } : v.id === prevVehicle && v.id !== vehicleId ? { ...v, driverId: null, status: v.status === 'maintenance' ? v.status : 'idle' } : v,
              ),
            };
          }),
        addVehicle: (input) => {
          const v: Vehicle = { id: uid('veh'), ...input, reg: input.reg.toUpperCase(), driverId: null, status: 'idle' };
          set((s) => ({ vehicles: [...s.vehicles, v] }));
          return v;
        },
        updateVehicle: (id, patch) => set((s) => ({ vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) })),
        assignTrip: ({ driverId, from, to, goods, distanceKm }) => {
          const s = get();
          const d = s.drivers.find((x) => x.id === driverId);
          if (!d?.vehicleId) return;
          const trip: Trip = { id: uid('trip'), driverId, vehicleId: d.vehicleId, from, to, goods, weightT: 0, distanceKm, startedOn: todayISO(), status: 'assigned' };
          set({ trips: [...s.trips, trip], notifications: withNotes(s.notifications, { audience: driverId, kind: 'trip_assigned', params: { from, to } }) });
        },

        markRead: (id) => set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
        markAllRead: (audience) => set((s) => ({ notifications: s.notifications.map((n) => (n.audience === audience ? { ...n, read: true } : n)) })),
        updateCompany: (patch) => set((s) => ({ company: { ...s.company, ...patch } })),
      };
    },
    {
      name: 'gangamata-roadlines-demo',
      version: STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: () => freshState() as unknown as AppState,
      partialize: (s) => {
        const out: Partial<AppState> = {};
        for (const [k, v] of Object.entries(s)) if (typeof v !== 'function') (out as Record<string, unknown>)[k] = v;
        return out as AppState;
      },
    },
  ),
);

/** The driver currently using the driver app (demo). */
export const useCurrentDriver = () => {
  const id = useApp((s) => s.currentDriverId);
  const drivers = useApp((s) => s.drivers);
  return drivers.find((d) => d.id === id) ?? drivers[0];
};
