import { addDays, atTime, daysBetween, todayISO } from '@/lib/dates';
import { uid } from '@/lib/utils';
import type { AppNotification, CompanySettings, DocRecord, Driver, Vehicle } from '@/types';

export type ExpiryState = 'valid' | 'expiring' | 'expired' | 'none';
/** 0 = fine, 1 = within 30 days, 2 = within 15, 3 = within 7, 4 = within 3, 5 = expired */
export type ExpiryLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface DocStatus {
  state: ExpiryState;
  level: ExpiryLevel;
  days: number | null;
}

export function docStatus(doc: Pick<DocRecord, 'expiresOn'>, today = todayISO()): DocStatus {
  if (!doc.expiresOn) return { state: 'none', level: 0, days: null };
  const days = daysBetween(today, doc.expiresOn);
  if (days < 0) return { state: 'expired', level: 5, days };
  if (days <= 3) return { state: 'expiring', level: 4, days };
  if (days <= 7) return { state: 'expiring', level: 3, days };
  if (days <= 15) return { state: 'expiring', level: 2, days };
  if (days <= 30) return { state: 'expiring', level: 1, days };
  return { state: 'valid', level: 0, days };
}

/** Tailwind classes per warning level — the hierarchy gets louder as expiry approaches. */
export const LEVEL_STYLES: Record<ExpiryLevel, { text: string; chip: string; banner: string }> = {
  0: { text: 'text-success', chip: 'bg-success-soft text-success', banner: 'bg-success-soft text-success border-success/20' },
  1: { text: 'text-warning', chip: 'bg-warning-soft text-warning', banner: 'bg-warning-soft text-warning border-warning/25' },
  2: { text: 'text-warning', chip: 'bg-warning-soft text-warning ring-1 ring-warning/40', banner: 'bg-warning-soft text-warning border-warning/50' },
  3: { text: 'text-warning font-semibold', chip: 'bg-warning text-white', banner: 'bg-warning text-white border-warning' },
  4: { text: 'text-danger font-semibold', chip: 'bg-danger text-white', banner: 'bg-danger text-white border-danger' },
  5: { text: 'text-danger font-semibold', chip: 'bg-danger text-white', banner: 'bg-danger text-white border-danger' },
};

const BUCKETS = [3, 7, 15, 30] as const;

/** The reminder bucket a document currently sits in, or null when no reminder is due. */
function bucketFor(days: number, settings: CompanySettings): number | 'expired' | null {
  if (days < 0) return 'expired';
  for (const b of BUCKETS) if (days <= b && settings.reminderDays[String(b) as '3' | '7' | '15' | '30']) return b;
  return null;
}

export function responsibleDriverId(doc: DocRecord, vehicles: Vehicle[]): string | null {
  if (doc.ownerType === 'driver') return doc.ownerId;
  return vehicles.find((v) => v.id === doc.ownerId)?.driverId ?? null;
}

export function docOwnerLabel(doc: DocRecord, vehicles: Vehicle[], drivers: Driver[]) {
  if (doc.ownerType === 'vehicle') return vehicles.find((v) => v.id === doc.ownerId)?.reg ?? '—';
  return drivers.find((d) => d.id === doc.ownerId)?.name ?? '—';
}

/**
 * Creates reminder notifications when a document crosses 30/15/7/3 days or expires.
 * Each crossing notifies once (deduplicated), for both the driver and the admin.
 */
export function expiryNotifications(
  docs: DocRecord[],
  vehicles: Vehicle[],
  drivers: Driver[],
  existing: AppNotification[],
  settings: CompanySettings,
  now = new Date(),
): AppNotification[] {
  const today = todayISO();
  const keys = new Set(existing.map((n) => n.dedupeKey).filter(Boolean));
  const out: AppNotification[] = [];
  for (const doc of docs) {
    if (!doc.expiresOn) continue;
    const days = daysBetween(today, doc.expiresOn);
    const bucket = bucketFor(days, settings);
    if (bucket === null) continue;
    const crossedOn = bucket === 'expired' ? addDays(doc.expiresOn, 1) : addDays(doc.expiresOn, -bucket);
    const createdAt = crossedOn > today ? now.toISOString() : atTime(crossedOn, 9, 0);
    const stale = now.getTime() - new Date(createdAt).getTime() > 14 * 86_400_000;
    const driverId = responsibleDriverId(doc, vehicles);
    const kind = bucket === 'expired' ? 'doc_expired' : 'doc_expiring';
    const params = {
      doc: doc.type,
      docId: doc.id,
      owner: docOwnerLabel(doc, vehicles, drivers),
      driver: drivers.find((d) => d.id === driverId)?.name ?? '',
    };
    const base = `exp:${doc.id}:${doc.expiresOn}:${bucket}`;
    if (!keys.has(`${base}:admin`)) {
      out.push({ id: uid('ntf'), audience: 'admin', kind, params, createdAt, read: stale, link: `/admin/documents?doc=${doc.id}`, dedupeKey: `${base}:admin` });
    }
    if (driverId && !keys.has(`${base}:driver`)) {
      out.push({ id: uid('ntf'), audience: driverId, kind, params, createdAt, read: stale, link: `/driver/documents/${doc.id}`, dedupeKey: `${base}:driver` });
    }
  }
  return out;
}
