const pad = (n: number) => String(n).padStart(2, '0');

export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISODate(new Date());

export function parseISODate(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, n: number) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export const daysBetween = (from: string, to: string) =>
  Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);

export const monthKey = (iso: string) => iso.slice(0, 7);
/** Local calendar date of an ISO timestamp. */
export const localDateOf = (timestamp: string) => toISODate(new Date(timestamp));

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** ISO timestamp for a local date at a given hour/minute. */
export function atTime(isoDate: string, hours: number, minutes = 0) {
  const d = parseISODate(isoDate);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

export function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
