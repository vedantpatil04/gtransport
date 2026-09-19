import { addDays, atTime, daysInMonth, localDateOf, monthKey, shiftMonth, toISODate } from '@/lib/dates';
import { createRng, type Rng } from '@/lib/random';
import { expiryNotifications } from '@/features/documents/expiry';
import type {
  AppNotification, CompanySettings, DocRecord, DocType, Driver, DriverSim, Expense, ExpenseCategory, FuelEntry,
  FuelType, Lang, MonthSummary, Payment, PaymentMethod, PaymentStatus, PaymentType, Trip, Vehicle, VehicleKind,
} from '@/types';
import { FUEL_PRICE, FUEL_STATIONS, GOODS, INSURERS, STATE_OF_CITY } from './constants';
import { routeLengthKm, type CityId } from './geo';

export interface DemoData {
  drivers: Driver[];
  vehicles: Vehicle[];
  fuel: FuelEntry[];
  expenses: Expense[];
  payments: Payment[];
  documents: DocRecord[];
  trips: Trip[];
  notifications: AppNotification[];
  history: MonthSummary[];
  company: CompanySettings;
}

type V = [reg: string, model: string, kind: VehicleKind, fuel: FuelType, capacityT: number, year: number, kmpl: number];
const VEHICLES: V[] = [
  ['KA 22 AB 1234', 'Tata Ace Gold Petrol', 'lcv', 'petrol', 0.9, 2022, 17],
  ['KA 22 CD 5678', 'Tata 407 Gold SFC', 'truck', 'diesel', 2.5, 2021, 9],
  ['KA 22 EF 9012', 'Mahindra Bolero Pik-Up', 'pickup', 'diesel', 1.7, 2020, 13],
  ['KA 22 GH 3456', 'Eicher Pro 2059', 'truck', 'diesel', 3.5, 2023, 8],
  ['KA 22 JK 7788', 'Ashok Leyland Dost+', 'pickup', 'diesel', 1.5, 2022, 14],
  ['KA 22 D 4471', 'Tata Intra V30', 'pickup', 'diesel', 1.3, 2023, 15],
  ['KA 22 C 9063', 'Maruti Suzuki Super Carry', 'lcv', 'petrol', 0.74, 2021, 18],
  ['KA 22 B 2317', 'Tata Ace Gold Petrol', 'lcv', 'petrol', 0.9, 2020, 17],
  ['KA 22 AA 5521', 'Mahindra Bolero Maxx Pik-Up', 'pickup', 'diesel', 1.7, 2024, 13],
  ['KA 22 AC 8834', 'Eicher Pro 2049', 'truck', 'diesel', 2.4, 2022, 9],
  ['KA 22 AD 1190', 'Tata Intra V50', 'pickup', 'diesel', 1.5, 2023, 14],
  ['KA 22 AE 6402', 'Ashok Leyland Bada Dost', 'pickup', 'diesel', 1.8, 2022, 13],
  ['KA 22 AF 3378', 'Tata 709g LPT', 'truck', 'diesel', 4.5, 2021, 7.5],
  ['KA 22 AG 9945', 'Maruti Suzuki Super Carry', 'lcv', 'petrol', 0.74, 2022, 18],
  ['KA 22 AH 2256', 'Mahindra Supro Profit Truck', 'lcv', 'diesel', 0.9, 2021, 19],
  ['KA 22 AJ 7713', 'Tata Ace Gold Petrol', 'lcv', 'petrol', 0.9, 2023, 17],
  ['KA 22 AK 4089', 'Eicher Pro 2059', 'truck', 'diesel', 3.5, 2021, 8],
  ['KA 22 AL 6630', 'Tata Yodha 2.0', 'pickup', 'diesel', 2.0, 2022, 12],
  ['KA 22 AM 1527', 'Ashok Leyland Dost+', 'pickup', 'diesel', 1.5, 2020, 14],
  ['KA 22 AN 8841', 'Tata 407 Gold SFC', 'truck', 'diesel', 2.5, 2022, 9],
  ['KA 22 AP 3962', 'Mahindra Bolero Pik-Up', 'pickup', 'diesel', 1.7, 2021, 13],
  ['KA 22 AQ 5170', 'Tata Ace Gold Petrol', 'lcv', 'petrol', 0.9, 2024, 17],
  ['KA 22 AR 2804', 'Eicher Pro 2049', 'truck', 'diesel', 2.4, 2019, 9],
  ['KA 22 AS 7439', 'Tata Intra V30', 'pickup', 'diesel', 1.3, 2022, 15],
];

type D = [name: string, lang: Lang, home: string, salary: number, route: CityId[], mode: DriverSim['mode'], speed: number, offset: number];
const DRIVERS: D[] = [
  ['Ramesh Kumar', 'en', 'Belagavi', 18000, ['belagavi', 'dharwad', 'hubballi'], 'moving', 42, 0.35],
  ['Suresh Patil', 'kn', 'Nipani', 21000, ['kolhapur', 'nipani', 'belagavi'], 'moving', 48, 0.2],
  ['Mahesh Naik', 'kn', 'Gokak', 17500, ['belagavi', 'gokak'], 'offline', 0, 0.97],
  ['Amit Pawar', 'mr', 'Satara', 22000, ['pune', 'satara', 'karad'], 'moving', 55, 0.4],
  ['Ganesh Jadhav', 'mr', 'Kolhapur', 20000, ['belagavi', 'khanapur', 'panaji'], 'stopped', 0, 0.28],
  ['Prakash Hiremath', 'kn', 'Hubballi', 21500, ['hubballi', 'haveri', 'davanagere'], 'moving', 50, 0.1],
  ['Basavaraj Patil', 'kn', 'Bagalkot', 19000, ['vijayapura', 'bagalkot'], 'moving', 44, 0.5],
  ['Santosh Kulkarni', 'kn', 'Dharwad', 20500, ['dharwad', 'hubballi', 'gadag'], 'moving', 38, 0.6],
  ['Vijay Shinde', 'mr', 'Sangli', 19500, ['kolhapur', 'sangli'], 'moving', 40, 0.2],
  ['Raju Gowda', 'kn', 'Davanagere', 23000, ['davanagere', 'chitradurga', 'tumakuru'], 'moving', 58, 0.3],
  ['Murugan Selvam', 'ta', 'Tumakuru', 22500, ['tumakuru', 'bengaluru'], 'stopped', 0, 0.8],
  ['Shivaji More', 'mr', 'Karad', 21000, ['karad', 'kolhapur'], 'moving', 46, 0.7],
  ['Anil Chavan', 'hi', 'Solapur', 20000, ['solapur', 'vijayapura'], 'moving', 52, 0.45],
  ['Mallikarjun Hosamani', 'te', 'Ballari', 21000, ['hubballi', 'gadag', 'hosapete', 'ballari'], 'moving', 47, 0.25],
  ['Sunil Kamble', 'mr', 'Chikkodi', 18500, ['nipani', 'chikkodi'], 'stopped', 0, 0.6],
  ['Vinod Salunkhe', 'mr', 'Pune', 22000, ['satara', 'pune'], 'moving', 50, 0.55],
  ['Imran Mulla', 'hi', 'Karwar', 19000, ['panaji', 'karwar'], 'moving', 36, 0.4],
  ['Rajesh Naikwadi', 'kn', 'Belagavi', 20000, ['belagavi', 'gokak', 'bagalkot'], 'moving', 45, 0.15],
  ['Kiran Bhosale', 'mr', 'Kolhapur', 19500, ['kolhapur', 'nipani'], 'offline', 0, 0.05],
  ['Dattatray Gavade', 'mr', 'Belagavi', 18000, ['belagavi', 'khanapur'], 'stopped', 0, 0.1],
  ['Siddappa Kadam', 'kn', 'Haveri', 20500, ['haveri', 'hubballi'], 'moving', 43, 0.65],
];

const PHONE_PREFIX = ['984', '988', '701', '903', '961', '807', '636', '799', '970', '814', '948', '974'];

const LITRES: Record<VehicleKind, [number, number]> = { lcv: [14, 28], pickup: [20, 38], truck: [34, 66] };

function stationFor(rng: Rng, route: string[]) {
  const onRoute = FUEL_STATIONS.filter((s) => route.includes(s.city));
  return rng.pick(onRoute.length ? onRoute : FUEL_STATIONS);
}

function priceAt(fuel: FuelType, city: CityId, rng: Rng) {
  const state = STATE_OF_CITY[city] ?? 'KA';
  return FUEL_PRICE[fuel][state] + rng.float(-0.25, 0.25);
}

const upiRef = (rng: Rng) => `RZP-${rng.int(100000, 999999)}`;
const bankRef = (rng: Rng) => `UTR${rng.int(1000, 9999)}${rng.int(10000000, 99999999)}`;

export function createSeed(now = new Date()): DemoData {
  const rng = createRng(20260918);
  const today = toISODate(now);
  const month = monthKey(today);
  const monthStart = `${month}-01`;
  const dayCount = Number(today.slice(8, 10));
  const iso = (d: Date) => d.toISOString();
  const beforeNow = (ts: string) => new Date(ts).getTime() < now.getTime() - 5 * 60_000;
  const minsAgo = (m: number) => iso(new Date(now.getTime() - m * 60_000));
  // Today's activity is spread between early morning and a few minutes ago, so the
  // dashboard looks like a working day whatever time the demo is opened.
  const dayStartMs = new Date(`${today}T00:00:00`).getTime();
  const elapsedMin = (now.getTime() - dayStartMs) / 60_000;
  const todayAt = (frac: number) => {
    const start = dayStartMs + (elapsedMin > 7 * 60 ? 5.5 * 60 : 10) * 60_000;
    const end = now.getTime() - 12 * 60_000;
    return iso(new Date(start + Math.min(1, Math.max(0, frac)) * Math.max(0, end - start)));
  };

  // ---------- Vehicles & drivers ----------
  const vehicles: Vehicle[] = VEHICLES.map(([reg, model, kind, fuelType, capacityT, year, mileageKmpl], i) => ({
    id: `veh_${String(i + 1).padStart(2, '0')}`,
    reg, model, kind, fuelType, capacityT, year, mileageKmpl,
    driverId: i < DRIVERS.length ? `drv_${String(i + 1).padStart(2, '0')}` : null,
    status: i === 22 ? 'maintenance' : i >= DRIVERS.length ? 'idle' : 'active',
  }));

  const drivers: Driver[] = DRIVERS.map(([name, language, homeTown, baseSalary, route, mode, speedKmh, offset], i) => ({
    id: `drv_${String(i + 1).padStart(2, '0')}`,
    code: `GR-D-${String(101 + i)}`,
    name,
    phone: `+91 ${PHONE_PREFIX[i % PHONE_PREFIX.length]}•• •••${String(rng.int(10, 99))}`,
    language,
    status: 'active',
    vehicleId: vehicles[i].id,
    joinedOn: addDays(today, -rng.int(220, 2400)),
    baseSalary,
    homeTown,
    locationSharing: name !== 'Dattatray Gavade',
    notificationPrefs: { payments: true, documents: true, trips: true },
    sim: {
      route, offset, speedKmh, mode,
      lastSeen: mode === 'offline' ? minsAgo(name === 'Mahesh Naik' ? 47 : 190) : undefined,
    },
  }));
  const ramesh = drivers[0];

  // ---------- Fuel ----------
  const fuel: FuelEntry[] = [];
  for (let d = 0; d < dayCount; d++) {
    const date = addDays(monthStart, d);
    const isToday = date === today;
    drivers.forEach((drv, i) => {
      const veh = vehicles[i];
      if (isToday && (drv.id === ramesh.id || drv.sim.mode === 'offline')) return;
      const fills = rng.chance(veh.kind === 'truck' ? 0.72 : 0.58) ? (rng.chance(0.12) ? 2 : 1) : 0;
      for (let f = 0; f < fills; f++) {
        const [h, m] = [rng.int(6, 20), rng.int(0, 59)];
        const createdAt = isToday ? todayAt(((h - 6) * 60 + m) / (15 * 60)) : atTime(date, h, m);
        const st = stationFor(rng, drv.sim.route);
        const price = priceAt(veh.fuelType, st.city, rng);
        let amount: number;
        let litres: number;
        if (rng.chance(0.5)) {
          amount = rng.pick(veh.kind === 'truck' ? [3000, 3500, 4000, 5000] : [1500, 2000, 2500, 3000]);
          litres = Math.round((amount / price) * 100) / 100;
        } else {
          litres = Math.round(rng.float(...LITRES[veh.kind]) * 10) / 10;
          amount = Math.round(litres * price);
        }
        const id = `fuel_${fuel.length + 1}`;
        fuel.push({
          id, driverId: drv.id, vehicleId: veh.id, fuelType: veh.fuelType, amount, litres, station: st.name, date, createdAt,
          receipt: rng.chance(0.88) ? { id: `gen:receipt:${id}`, kind: 'generated', uploaded: true } : null,
          sync: 'synced',
        });
      }
    });
  }

  // ---------- Expenses ----------
  const expenses: Expense[] = [];
  const pushExpense = (e: Omit<Expense, 'id' | 'sync' | 'receipt' | 'status' | 'enteredBy'> & Partial<Pick<Expense, 'status' | 'enteredBy'>>) => {
    const id = `exp_${expenses.length + 1}`;
    const age = (now.getTime() - new Date(e.createdAt).getTime()) / 86_400_000;
    expenses.push({
      id, sync: 'synced', enteredBy: e.enteredBy ?? 'driver',
      receipt: e.category === 'toll' || e.category === 'repair' || e.category === 'maintenance' ? { id: `gen:expense:${id}`, kind: 'generated', uploaded: true } : null,
      status: e.status ?? (age > 2 ? (rng.chance(0.04) ? 'rejected' : 'approved') : 'submitted'),
      ...e,
    });
  };
  const EXP_RULES: [ExpenseCategory, number, number, number, string[]][] = [
    ['toll', 0.55, 95, 645, ['Hattargi toll plaza', 'Kognoli toll plaza', 'Tapewadi toll plaza', 'Bankapur toll plaza', 'Guttal toll plaza', 'Kini toll plaza']],
    ['food', 0.6, 120, 350, ['Lunch at dhaba', 'Breakfast', 'Dinner']],
    ['parking', 0.25, 50, 150, ['APMC yard parking', 'Market parking', 'Night halt parking']],
    ['trip', 0.2, 300, 900, ['Loading hamali', 'Unloading hamali', 'Weighbridge charge']],
    ['repair', 0.04, 650, 4800, ['Puncture repair', 'Clutch plate', 'Battery replacement', 'Brake shoe change']],
    ['other', 0.08, 100, 500, ['Tarpaulin rope', 'Mobile recharge', 'Vehicle wash']],
  ];
  for (let d = 0; d < dayCount; d++) {
    const date = addDays(monthStart, d);
    const isToday = date === today;
    drivers.forEach((drv, i) => {
      if (isToday && (drv.id === ramesh.id || drv.sim.mode === 'offline')) return;
      for (const [category, p, min, max, notes] of EXP_RULES) {
        if (!rng.chance(p)) continue;
        const [h, m] = [rng.int(7, 21), rng.int(0, 59)];
        const createdAt = isToday ? todayAt(((h - 7) * 60 + m) / (15 * 60)) : atTime(date, h, m);
        const amount = category === 'toll' ? rng.pick([95, 150, 205, 245, 310, 430, 645]) : Math.round(rng.int(min, max) / 10) * 10;
        pushExpense({ driverId: drv.id, vehicleId: vehicles[i].id, category, amount, note: rng.pick(notes), date, createdAt });
      }
    });
    if (d % 3 === 1) {
      const vi = rng.int(0, vehicles.length - 1);
      const v = vehicles[vi];
      const createdAt = isToday ? todayAt(0.4) : atTime(date, 11, 30);
      if (!isToday || beforeNow(createdAt))
        pushExpense({
          driverId: v.driverId ?? drivers[vi % drivers.length].id, vehicleId: v.id, category: 'maintenance',
          amount: Math.round(rng.int(2500, 9500) / 50) * 50, note: rng.pick(['Periodic service', 'Oil & filter change', 'Tyre rotation and alignment', 'Leaf spring repair']),
          date, createdAt, status: 'approved', enteredBy: 'admin',
        });
    }
  }
  // Ramesh's day so far (matches the home-screen example: ₹850 other expenses)
  pushExpense({ driverId: ramesh.id, vehicleId: ramesh.vehicleId!, category: 'toll', amount: 450, note: 'Hattargi toll plaza', date: today, createdAt: todayAt(0.35) });
  pushExpense({ driverId: ramesh.id, vehicleId: ramesh.vehicleId!, category: 'food', amount: 400, note: 'Breakfast', date: today, createdAt: todayAt(0.7) });

  // ---------- Payments ----------
  const payments: Payment[] = [];
  const addPayment = (p: { driverId: string; type: PaymentType; amount: number; status: PaymentStatus; method: PaymentMethod; createdAt: string; note?: string; approved?: boolean; reportedByDriver?: boolean; finishAfterMin?: number }) => {
    const created = new Date(p.createdAt).getTime();
    const history: Payment['history'] = [{ status: 'created', at: p.createdAt }];
    let updatedAt = p.createdAt;
    let paidAt: string | null = null;
    const step = (s: Payment['history'][number]['status'], mins: number) => {
      const at = iso(new Date(Math.min(created + mins * 60_000, now.getTime() - 60_000)));
      history.push({ status: s, at });
      updatedAt = at;
      return at;
    };
    const approved = p.approved ?? p.status !== 'pending';
    if (approved && !p.reportedByDriver) step('approved', 20);
    if (['processing', 'paid', 'failed'].includes(p.status) && !p.reportedByDriver) step('processing', 45);
    if (p.status === 'paid') paidAt = step('paid', p.finishAfterMin ?? 120);
    if (p.status === 'failed') step('failed', p.finishAfterMin ?? 110);
    if (p.status === 'cancelled') step('cancelled', 60);
    payments.push({
      id: `pay_${payments.length + 1}`,
      driverId: p.driverId, type: p.type, amount: p.amount, status: p.status, method: p.method,
      reference: p.status === 'paid' || p.status === 'failed' ? (p.method === 'upi' ? upiRef(rng) : p.method === 'bank' ? bankRef(rng) : null) : null,
      note: p.note ?? '', createdAt: p.createdAt, updatedAt, paidAt, approved,
      reportedByDriver: p.reportedByDriver ?? false, history, sync: 'synced',
    });
  };
  const safeDay = (n: number) => addDays(monthStart, Math.max(0, Math.min(dayCount - 1, n)));

  drivers.forEach((drv, i) => {
    if (drv.id === ramesh.id) return;
    addPayment({ driverId: drv.id, type: 'salary', amount: drv.baseSalary, status: 'paid', method: 'bank', createdAt: atTime(safeDay(0), 10, 0), note: `Salary for ${shiftMonth(month, -1)}`, finishAfterMin: 60 * 24 + 30 });
    const adv = rng.int(1, 3);
    for (let a = 0; a < adv; a++) {
      const day = safeDay(rng.int(1, dayCount - 2));
      addPayment({ driverId: drv.id, type: 'fuel_advance', amount: rng.pick([2000, 2500, 3000, 4000, 5000]), status: 'paid', method: 'upi', createdAt: atTime(day, rng.int(8, 17), rng.int(0, 59)), finishAfterMin: rng.int(15, 90) });
    }
    if (rng.chance(0.5)) addPayment({ driverId: drv.id, type: 'trip_allowance', amount: rng.pick([1000, 1500, 2000, 2500]), status: rng.chance(0.8) ? 'paid' : 'processing', method: 'upi', createdAt: atTime(safeDay(rng.int(3, dayCount - 1)), 12, 15) });
    if (i % 5 === 2) addPayment({ driverId: drv.id, type: 'other_advance', amount: rng.pick([1000, 1500, 2000]), status: 'paid', method: 'cash', createdAt: atTime(safeDay(rng.int(2, dayCount - 1)), 16, 0), note: 'Cash from office' });
  });
  // Money moving today
  [1, 3, 5, 9, 12, 15, 17].forEach((i, k) => {
    const createdAt = minsAgo(Math.max(15, Math.min(60 * (7 - k) + 20, ((7 - k) / 7) * (elapsedMin - 40) + 20)));
    addPayment({ driverId: drivers[i].id, type: k % 3 === 0 ? 'trip_allowance' : 'fuel_advance', amount: [5000, 4000, 5000, 3000, 6000, 4000, 8000][k], status: k === 6 ? 'processing' : 'paid', method: 'upi', createdAt, finishAfterMin: 18 });
  });
  // Awaiting approval (₹8,500)
  addPayment({ driverId: drivers[3].id, type: 'trip_allowance', amount: 2500, status: 'pending', method: 'upi', createdAt: minsAgo(95), approved: false, note: 'Pune – Karad trip' });
  addPayment({ driverId: drivers[9].id, type: 'reimbursement', amount: 4000, status: 'pending', method: 'upi', createdAt: minsAgo(210), approved: false, note: 'Clutch repair bill' });
  addPayment({ driverId: drivers[13].id, type: 'other_advance', amount: 2000, status: 'pending', method: 'upi', createdAt: minsAgo(35), approved: true, note: 'Family function advance' });
  addPayment({ driverId: drivers[6].id, type: 'fuel_advance', amount: 3000, status: 'failed', method: 'upi', createdAt: atTime(safeDay(dayCount - 2), 9, 40), note: 'UPI limit reached at bank' });
  // Ramesh — matches the "My Payments" example
  addPayment({ driverId: ramesh.id, type: 'salary', amount: 18000, status: 'paid', method: 'bank', createdAt: atTime(safeDay(0), 10, 0), note: `Salary for ${shiftMonth(month, -1)}`, finishAfterMin: 60 * 24 + 40 });
  addPayment({ driverId: ramesh.id, type: 'fuel_advance', amount: 3000, status: 'paid', method: 'upi', createdAt: atTime(safeDay(dayCount - 7), 9, 15), finishAfterMin: 25 });
  addPayment({ driverId: ramesh.id, type: 'other_advance', amount: 2000, status: 'failed', method: 'upi', createdAt: atTime(safeDay(dayCount - 3), 15, 5), note: 'Bank server timeout' });
  addPayment({ driverId: ramesh.id, type: 'trip_allowance', amount: 1500, status: 'processing', method: 'upi', createdAt: atTime(safeDay(dayCount - 2), 11, 30), note: 'Belagavi – Hubballi trips' });

  // ---------- Documents ----------
  const documents: DocRecord[] = [];
  const addDoc = (ownerType: DocRecord['ownerType'], ownerId: string, type: DocType, expiresIn: number | null, number: string, issuer: string, validityDays: number, verification: DocRecord['verification'] = 'verified') => {
    const id = `doc_${documents.length + 1}`;
    const expiresOn = expiresIn === null ? null : addDays(today, expiresIn);
    const issuedOn = expiresOn ? addDays(expiresOn, -validityDays) : addDays(today, -validityDays);
    const uploaded = verification === 'pending' ? minsAgo(60 * 26) : atTime(addDays(issuedOn, 2) < today ? addDays(issuedOn, 2) : today, 12, 0);
    documents.push({ id, ownerType, ownerId, type, number, issuer, issuedOn, expiresOn, uploadedAt: uploaded, file: { id: `gen:doc:${id}`, kind: 'generated', uploaded: true }, verification, reminders: [] });
  };
  const OVERRIDES: Record<string, Partial<Record<DocType, number>>> = {
    'KA 22 AB 1234': { insurance: 18, puc: 85 },
    'KA 22 CD 5678': { puc: 5, insurance: 140 },
    'KA 22 EF 9012': { puc: -4, insurance: 22 },
    'KA 22 D 4471': { insurance: 3 },
    'KA 22 AR 2804': { insurance: -9 },
    'KA 22 GH 3456': { insurance: 27 },
    'KA 22 AC 8834': { puc: 12 },
    'KA 22 AF 3378': { fitness: 25 },
  };
  vehicles.forEach((v) => {
    const o = OVERRIDES[v.reg] ?? {};
    addDoc('vehicle', v.id, 'rc', null, v.reg, 'RTO Belagavi (KA-22)', 365 * (2026 - v.year));
    addDoc('vehicle', v.id, 'insurance', o.insurance ?? rng.int(40, 330), `${rng.int(3001, 3009)}/${rng.int(21000000, 99999999)}/00/000`, rng.pick(INSURERS), 365, v.reg === 'KA 22 GH 3456' ? 'pending' : 'verified');
    addDoc('vehicle', v.id, 'puc', o.puc ?? rng.int(35, 170), `KA0220${rng.int(10000000, 99999999)}`, rng.pick(['Sri Sai Emission Test Centre, Belagavi', 'Om Sai PUC Centre, Hubballi', 'Maruti Emission Check, Gokak']), 180);
    if (v.kind === 'truck') {
      addDoc('vehicle', v.id, 'fitness', o.fitness ?? rng.int(60, 300), `FC/KA22/${rng.int(1000, 9999)}/${v.year + 2}`, 'RTO Belagavi (KA-22)', 730);
      addDoc('vehicle', v.id, 'permit', rng.int(90, 700), `KA2026NP${rng.int(100000, 999999)}`, 'Transport Department, Karnataka', 1825);
    }
  });
  drivers.forEach((drv, i) => {
    const rto = drv.homeTown === 'Kolhapur' || drv.homeTown === 'Satara' || drv.homeTown === 'Pune' ? ['MH09', 'RTO Kolhapur (MH-09)'] : ['KA22', 'RTO Belagavi (KA-22)'];
    const exp = drv.name === 'Mahesh Naik' ? 6 : rng.int(200, 2600);
    addDoc('driver', drv.id, 'licence', exp, `${rto[0]} ${2008 + (i % 12)}00${rng.int(10000, 99999)}`, rto[1], 365 * 5, drv.name === 'Ganesh Jadhav' ? 'approved' : 'verified');
  });

  // ---------- Trips ----------
  const trips: Trip[] = [];
  drivers.forEach((drv, i) => {
    const [a, b] = [drv.sim.route[0], drv.sim.route[drv.sim.route.length - 1]];
    const dist = Math.round(routeLengthKm(drv.sim.route));
    const n = rng.int(3, 5);
    for (let k = n; k >= 1; k--) {
      const startedOn = addDays(today, -k * rng.int(2, 3));
      if (startedOn < monthStart) continue;
      trips.push({ id: `trip_${trips.length + 1}`, driverId: drv.id, vehicleId: vehicles[i].id, from: k % 2 ? a : b, to: k % 2 ? b : a, goods: rng.pick(GOODS), weightT: Math.round(vehicles[i].capacityT * rng.float(0.6, 1) * 10) / 10, distanceKm: dist, startedOn, status: 'delivered' });
    }
    if (drv.sim.mode !== 'offline') trips.push({ id: `trip_${trips.length + 1}`, driverId: drv.id, vehicleId: vehicles[i].id, from: a, to: b, goods: rng.pick(GOODS), weightT: vehicles[i].capacityT, distanceKm: dist, startedOn: today, status: drv.sim.mode === 'moving' ? 'in_transit' : 'assigned' });
  });
  trips.push({ id: `trip_${trips.length + 1}`, driverId: ramesh.id, vehicleId: ramesh.vehicleId!, from: 'hubballi', to: 'belagavi', goods: 'FMCG cartons', weightT: 0.8, distanceKm: 98, startedOn: addDays(today, 1), status: 'assigned' });

  // ---------- Notifications ----------
  const company: CompanySettings = {
    name: 'Gangamata Roadlines',
    office: 'Head office, Old P.B. Road, Belagavi 590003',
    phone: '0831 24•• •••',
    gstin: '29AB•••••••1Z5',
    reminderDays: { '30': true, '15': true, '7': true, '3': true },
    autoNotify: { driver: true, admin: true, insurer: false },
  };
  const notifications: AppNotification[] = [];
  const note = (audience: string, kind: AppNotification['kind'], params: AppNotification['params'], createdAt: string, read: boolean, link?: string) =>
    notifications.push({ id: `ntf_seed_${notifications.length + 1}`, audience, kind, params, createdAt, read, link });

  const todaysFuel = fuel.filter((f) => f.date === today).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 4);
  todaysFuel.forEach((f, k) => {
    const drv = drivers.find((x) => x.id === f.driverId)!;
    note('admin', 'fuel_added', { driver: drv.name, vehicle: vehicles.find((v) => v.id === f.vehicleId)!.reg, amount: f.amount, fuelType: f.fuelType }, f.createdAt, k > 1, `/admin/fuel?entry=${f.id}`);
  });
  const pendingDoc = documents.find((d) => d.verification === 'pending')!;
  note('admin', 'doc_uploaded', { doc: pendingDoc.type, owner: vehicles.find((v) => v.id === pendingDoc.ownerId)!.reg, driver: drivers[3].name, docId: pendingDoc.id }, pendingDoc.uploadedAt, false, `/admin/documents?doc=${pendingDoc.id}`);
  payments.filter((p) => p.status === 'failed').forEach((p) => note('admin', 'payment_failed', { driver: drivers.find((d) => d.id === p.driverId)!.name, amount: p.amount, type: p.type }, p.updatedAt, true, `/admin/payments?payment=${p.id}`));
  payments.filter((p) => p.status === 'pending').forEach((p) => note('admin', 'payment_pending', { driver: drivers.find((d) => d.id === p.driverId)!.name, amount: p.amount, type: p.type }, p.createdAt, false, `/admin/payments?payment=${p.id}`));
  note('admin', 'driver_offline', { driver: drivers[2].name, vehicle: vehicles[2].reg }, drivers[2].sim.lastSeen!, false, `/admin/fleet?driver=${drivers[2].id}`);
  note('admin', 'driver_offline', { driver: drivers[18].name, vehicle: vehicles[18].reg }, drivers[18].sim.lastSeen!, true, `/admin/fleet?driver=${drivers[18].id}`);

  for (const p of payments.filter((x) => x.driverId === ramesh.id)) {
    if (p.status === 'paid') note(ramesh.id, 'payment_paid', { amount: p.amount, type: p.type }, p.paidAt!, true, `/driver/payments/${p.id}`);
    if (p.status === 'processing') note(ramesh.id, 'payment_processing', { amount: p.amount, type: p.type }, p.updatedAt, false, `/driver/payments/${p.id}`);
    if (p.status === 'failed') note(ramesh.id, 'payment_failed', { amount: p.amount, type: p.type }, p.updatedAt, true, `/driver/payments/${p.id}`);
  }
  const rTrip = trips[trips.length - 1];
  note(ramesh.id, 'trip_assigned', { from: rTrip.from, to: rTrip.to }, minsAgo(60 * 20), true);
  const rExp = expenses.find((e) => e.driverId === ramesh.id && e.status === 'approved');
  if (rExp) note(ramesh.id, 'expense_approved', { category: rExp.category, amount: rExp.amount }, iso(new Date(new Date(rExp.createdAt).getTime() + 86_400_000)), true, '/driver/updates');
  const rLicence = documents.find((d) => d.ownerId === ramesh.id)!;
  note(ramesh.id, 'doc_verified', { doc: 'licence', docId: rLicence.id }, atTime(addDays(today, -40), 11, 0), true, `/driver/documents/${rLicence.id}`);

  notifications.push(...expiryNotifications(documents, vehicles, drivers, notifications, company, now));

  // ---------- Previous months (archived totals) ----------
  // Scaled from this month's daily run-rate so the monthly trend chart stays believable.
  const sumOf = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const liveExp = expenses.filter((e) => e.status !== 'rejected');
  const perDay = {
    fuel: sumOf(fuel, (f) => f.amount) / dayCount,
    maintenance: sumOf(liveExp.filter((e) => e.category === 'maintenance' || e.category === 'repair'), (e) => e.amount) / dayCount,
    tolls: sumOf(liveExp.filter((e) => e.category === 'toll'), (e) => e.amount) / dayCount,
    other: sumOf(liveExp.filter((e) => ['parking', 'food', 'trip', 'other'].includes(e.category)), (e) => e.amount) / dayCount,
  };
  const salaryRun = sumOf(payments.filter((p) => p.type === 'salary'), (p) => p.amount);
  const history: MonthSummary[] = [6, 5, 4, 3, 2, 1].map((back) => {
    const r = createRng(1000 + back);
    const m = shiftMonth(month, -back);
    const days = daysInMonth(m);
    return {
      month: m,
      fuel: Math.round((perDay.fuel * days * r.float(0.9, 1.07)) / 10) * 10,
      salaries: Math.round((salaryRun * r.float(0.95, 1.01)) / 500) * 500,
      maintenance: Math.round((perDay.maintenance * days * r.float(0.75, 1.3)) / 10) * 10,
      tolls: Math.round((perDay.tolls * days * r.float(0.92, 1.06)) / 10) * 10,
      other: Math.round((perDay.other * days * r.float(0.88, 1.08)) / 10) * 10,
    };
  });

  // Consistency: entries use local dates
  for (const f of fuel) f.date = localDateOf(f.createdAt);

  return { drivers, vehicles, fuel, expenses, payments, documents, trips, notifications, history, company };
}
