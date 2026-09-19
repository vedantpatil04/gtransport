import type { TFunction } from 'i18next';
import { daysBetween, localDateOf } from './dates';
import { fmtDate, inr } from './format';
import type { AppNotification, NotificationKind } from '@/types';

export type NotifTone = 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<NotificationKind, NotifTone> = {
  doc_expiring: 'warning', doc_expired: 'danger', doc_uploaded: 'info', doc_verified: 'success', doc_rejected: 'danger',
  doc_reminder: 'warning', insurer_notified: 'info', payment_created: 'info', payment_processing: 'warning', payment_paid: 'success',
  payment_failed: 'danger', payment_pending: 'warning', fuel_added: 'info', expense_approved: 'success', expense_rejected: 'danger',
  driver_offline: 'danger', trip_assigned: 'info', advance_reported: 'info',
};

/** Parses `exp:<docId>:<expiresOn>:<bucket>:<audience>` so the text reflects the day the reminder fired. */
function expiryInfo(n: AppNotification) {
  const parts = n.dedupeKey?.split(':') ?? [];
  const expiresOn = parts[2] && /^\d{4}-\d{2}-\d{2}$/.test(parts[2]) ? parts[2] : null;
  const days = expiresOn ? Math.max(0, daysBetween(localDateOf(n.createdAt), expiresOn)) : 0;
  return { expiresOn, days };
}

export function notifText(n: AppNotification, t: TFunction, lang: string) {
  const p = n.params;
  const { expiresOn, days } = expiryInfo(n);
  const vars: Record<string, string | number> = {
    ...p,
    amount: typeof p.amount === 'number' ? inr(p.amount) : String(p.amount ?? ''),
    type: p.type ? t(`enum.paymentType.${p.type}`) : '',
    doc: p.doc ? t(`enum.docType.${p.doc}`) : '',
    category: p.category ? t(`enum.category.${p.category}`) : '',
    fuelType: p.fuelType ? t(`enum.fuelType.${p.fuelType}`) : '',
    from: p.from ? t(`city.${p.from}`, { defaultValue: String(p.from) }) : '',
    to: p.to ? t(`city.${p.to}`, { defaultValue: String(p.to) }) : '',
    count: days,
    date: expiresOn ? fmtDate(expiresOn, lang) : '',
  };
  const ns = n.audience === 'admin' ? 'notifAdmin' : 'notif';
  return {
    title: t(`${ns}.${n.kind}.title`, vars),
    body: t(`${ns}.${n.kind}.body`, vars),
    tone: TONE[n.kind],
  };
}
