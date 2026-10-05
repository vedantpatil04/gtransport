import type { TFunction } from 'i18next';
import { fmtDayMonth, inr } from '@/lib/format';
import { normalize } from '@/lib/utils';
import type { AppState } from '@/store';

export type SearchGroupKey = 'employees' | 'drivers' | 'vehicles' | 'fuel' | 'expenses' | 'payments' | 'documents';

export interface SearchItem {
  id: string;
  title: string;
  sub: string;
  to: string;
  plate?: string;
}
export interface SearchGroup {
  key: SearchGroupKey;
  items: SearchItem[];
  total: number;
  viewAll?: string;
}

const LIMIT = 5;

/**
 * Searches every module at once. Matching a driver or vehicle also pulls in that
 * driver's / vehicle's fuel entries, expenses, payments and documents.
 */
export function searchAll(query: string, s: Pick<AppState, 'drivers' | 'vehicles' | 'fuel' | 'expenses' | 'payments' | 'documents'>, t: TFunction, lang: string): SearchGroup[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const has = (...fields: (string | undefined | null)[]) => fields.some((f) => f && normalize(f).includes(q));

  const drivers = s.drivers.filter((d) => has(d.name, d.code, d.homeTown, d.phone.replace(/\D/g, '')));
  const vehicles = s.vehicles.filter((v) => has(v.reg, v.model));
  const driverIds = new Set(drivers.map((d) => d.id));
  const vehicleIds = new Set(vehicles.map((v) => v.id));
  const dName = (id: string) => s.drivers.find((d) => d.id === id)?.name ?? '';
  const reg = (id: string | null) => s.vehicles.find((v) => v.id === id)?.reg ?? '';

  const synced = <T extends { sync: string }>(x: T) => x.sync === 'synced';
  const fuel = s.fuel.filter((f) => synced(f) && (driverIds.has(f.driverId) || vehicleIds.has(f.vehicleId) || has(f.station))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const expenses = s.expenses.filter((e) => synced(e) && (driverIds.has(e.driverId) || vehicleIds.has(e.vehicleId) || has(e.note))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const payments = s.payments.filter((p) => synced(p) && (driverIds.has(p.driverId) || has(p.reference, p.note))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const documents = s.documents.filter((d) => (d.ownerType === 'vehicle' ? vehicleIds.has(d.ownerId) : driverIds.has(d.ownerId)) || has(d.number, d.issuer));

  // A single matched vehicle or driver gives the "view all" links a precise filter.
  const scope = vehicles.length === 1 && drivers.length === 0 ? `vehicle=${vehicles[0].id}` : drivers.length === 1 && vehicles.length === 0 ? `driver=${drivers[0].id}` : `q=${encodeURIComponent(query.trim())}`;

  const groups: SearchGroup[] = [
    {
      key: 'drivers',
      total: drivers.length,
      items: drivers.slice(0, LIMIT).map((d) => ({ id: d.id, title: d.name, sub: `${d.code} · ${d.homeTown}`, plate: reg(d.vehicleId) || undefined, to: `/admin/drivers/${d.id}` })),
      viewAll: `/admin/drivers?q=${encodeURIComponent(query.trim())}`,
    },
    {
      key: 'vehicles',
      total: vehicles.length,
      items: vehicles.slice(0, LIMIT).map((v) => ({ id: v.id, title: v.model, sub: v.driverId ? dName(v.driverId) : t('admin.vehicles.unassigned'), plate: v.reg, to: `/admin/vehicles/${v.id}` })),
      viewAll: `/admin/vehicles?q=${encodeURIComponent(query.trim())}`,
    },
    {
      key: 'fuel',
      total: fuel.length,
      items: fuel.slice(0, LIMIT).map((f) => ({ id: f.id, title: `${inr(f.amount)} · ${t(`enum.fuelType.${f.fuelType}`)}`, sub: `${dName(f.driverId)} · ${f.station} · ${fmtDayMonth(f.date, lang)}`, plate: reg(f.vehicleId), to: `/admin/fuel?entry=${f.id}` })),
      viewAll: `/admin/fuel?${scope}`,
    },
    {
      key: 'expenses',
      total: expenses.length,
      items: expenses.slice(0, LIMIT).map((e) => ({ id: e.id, title: `${inr(e.amount)} · ${t(`enum.category.${e.category}`)}`, sub: `${dName(e.driverId)} · ${e.note} · ${fmtDayMonth(e.date, lang)}`, plate: reg(e.vehicleId), to: `/admin/finance/expenses?expense=${e.id}` })),
      viewAll: `/admin/finance/expenses?${scope}`,
    },
    {
      key: 'payments',
      total: payments.length,
      items: payments.slice(0, LIMIT).map((p) => ({ id: p.id, title: `${inr(p.amount)} · ${t(`enum.paymentType.${p.type}`)}`, sub: `${dName(p.driverId)} · ${t(`enum.paymentStatus.${p.status}`)}${p.reference ? ` · ${p.reference}` : ''}`, to: `/admin/finance/payments?payment=${p.id}` })),
      viewAll: `/admin/finance/payments?${scope}`,
    },
    {
      key: 'documents',
      total: documents.length,
      items: documents.slice(0, LIMIT).map((d) => ({
        id: d.id,
        title: d.customName || t(`enum.docTypeLong.${d.type}`),
        sub: `${d.ownerType === 'vehicle' ? reg(d.ownerId) : dName(d.ownerId)} · ${d.number}`,
        to: `/admin/documents?doc=${d.id}`,
      })),
      viewAll: `/admin/documents?${scope}`,
    },
  ];
  return groups.filter((g) => g.total > 0);
}
