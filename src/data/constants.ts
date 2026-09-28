import type { DocType, ExpenseCategory, PaymentType, UpdateType } from '@/types';
import type { CityId } from './geo';

export const FUEL_BRANDS = ['IndianOil', 'Bharat Petroleum', 'HP Petrol Pump', 'Nayara Energy'] as const;

/** Stations along the corridors the fleet runs on. Brand names stay as printed on the pump. */
export const FUEL_STATIONS: { name: string; city: CityId }[] = [
  { name: 'IndianOil – NH4, Belagavi', city: 'belagavi' },
  { name: 'Bharat Petroleum – Hubballi Bypass', city: 'hubballi' },
  { name: 'HP Petrol Pump – Dharwad', city: 'dharwad' },
  { name: 'Nayara Energy – Gokak Road', city: 'gokak' },
  { name: 'IndianOil – Kolhapur', city: 'kolhapur' },
  { name: 'Bharat Petroleum – Nipani', city: 'nipani' },
  { name: 'HP Petrol Pump – Satara', city: 'satara' },
  { name: 'IndianOil – Karad', city: 'karad' },
  { name: 'Nayara Energy – Pune Bypass', city: 'pune' },
  { name: 'IndianOil – Panaji', city: 'panaji' },
  { name: 'HP Petrol Pump – Khanapur', city: 'khanapur' },
  { name: 'Bharat Petroleum – Haveri', city: 'haveri' },
  { name: 'IndianOil – Davanagere', city: 'davanagere' },
  { name: 'Nayara Energy – Chitradurga', city: 'chitradurga' },
  { name: 'HP Petrol Pump – Tumakuru', city: 'tumakuru' },
  { name: 'Bharat Petroleum – Nelamangala', city: 'bengaluru' },
  { name: 'IndianOil – Vijayapura', city: 'vijayapura' },
  { name: 'HP Petrol Pump – Bagalkot', city: 'bagalkot' },
  { name: 'Nayara Energy – Solapur', city: 'solapur' },
  { name: 'Bharat Petroleum – Gadag', city: 'gadag' },
  { name: 'IndianOil – Hosapete', city: 'hosapete' },
  { name: 'HP Petrol Pump – Ballari', city: 'ballari' },
  { name: 'Bharat Petroleum – Sangli', city: 'sangli' },
  { name: 'IndianOil – Chikkodi', city: 'chikkodi' },
  { name: 'Nayara Energy – Karwar', city: 'karwar' },
];

/** Indicative pump prices (₹/L). Maharashtra runs slightly higher than Karnataka. */
export const FUEL_PRICE = {
  petrol: { KA: 102.9, MH: 104.2, GA: 96.6 },
  diesel: { KA: 88.9, MH: 90.7, GA: 88.2 },
} as const;

export const STATE_OF_CITY: Partial<Record<CityId, 'KA' | 'MH' | 'GA'>> = {
  pune: 'MH', satara: 'MH', karad: 'MH', kolhapur: 'MH', sangli: 'MH', solapur: 'MH', panaji: 'GA',
};

export const INSURERS = ['ICICI Lombard', 'Bajaj Allianz', 'New India Assurance', 'Tata AIG', 'HDFC ERGO'] as const;

export const DOC_TYPES: { type: DocType; owner: 'vehicle' | 'driver'; hasExpiry: boolean; core: boolean }[] = [
  { type: 'rc', owner: 'vehicle', hasExpiry: false, core: true },
  { type: 'insurance', owner: 'vehicle', hasExpiry: true, core: true },
  { type: 'puc', owner: 'vehicle', hasExpiry: true, core: true },
  { type: 'licence', owner: 'driver', hasExpiry: true, core: true },
  { type: 'fitness', owner: 'vehicle', hasExpiry: true, core: false },
  { type: 'permit', owner: 'vehicle', hasExpiry: true, core: false },
  { type: 'other', owner: 'driver', hasExpiry: true, core: false },
];
export const docTypeConfig = (type: DocType) => DOC_TYPES.find((d) => d.type === type)!;

export const UPDATE_TYPES: UpdateType[] = ['rto', 'tyre', 'tyre_insurance', 'maintenance', 'toll', 'advance', 'trip', 'other'];
/**
 * The secondary daily-update tiles on the driver home screen. Petrol/diesel is the primary
 * action and has its own button above these.
 */
export const HOME_UPDATE_TYPES: UpdateType[] = ['rto', 'tyre', 'tyre_insurance', 'maintenance'];

export const QUICK_AMOUNTS: Record<UpdateType, number[]> = {
  toll: [95, 150, 245, 430],
  rto: [500, 1000, 2500],
  tyre: [8000, 12000, 18500],
  tyre_insurance: [1500, 2500, 3500],
  advance: [1000, 2000, 3000, 5000],
  trip: [300, 500, 800],
  other: [100, 200, 500],
  maintenance: [2500, 5000],
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['rto', 'tyre', 'tyre_insurance', 'maintenance', 'toll', 'trip', 'other'];
export const PAYMENT_TYPES: PaymentType[] = ['salary', 'fuel_advance', 'trip_allowance', 'other_advance', 'reimbursement'];

export const GOODS = ['Sugar bags', 'Cement', 'Onions', 'Cotton bales', 'TMT steel rods', 'FMCG cartons', 'Jaggery', 'Vitrified tiles', 'Soybean', 'Auto parts'];

export const OFFICE_PHONE_MASKED = '0831 24•• •••';
