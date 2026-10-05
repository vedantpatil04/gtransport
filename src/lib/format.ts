import { parseISODate } from './dates';

const LOCALES: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN' };
/** Native month/day names, but Latin digits (the norm on Indian consumer apps). */
export const localeFor = (lang: string) => `${LOCALES[lang] ?? 'en-IN'}-u-nu-latn`;

const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrFmt2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/**
 * Rupees with Indian digit grouping. With `decimals`, paise show as exactly two digits and a whole
 * amount shows none — "₹23,999.70", "₹18,000" — the same rule as the driver app's rupees().
 */
export const inr = (n: number, decimals = false) => {
  const value = Math.round(n * 100) / 100;
  return `₹${(decimals && !Number.isInteger(value) ? inrFmt2 : inrFmt).format(value)}`;
};
export const num = (n: number, digits = 1) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(n);

/** Compact rupees for chart axes: ₹8.4L, ₹42K. */
export function inrCompact(n: number) {
  if (Math.abs(n) >= 1e7) return `₹${num(n / 1e7, 2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${num(n / 1e5, 2)}L`;
  if (Math.abs(n) >= 1e3) return `₹${num(n / 1e3, 1)}K`;
  return `₹${num(n, 0)}`;
}

const toDate = (v: string | Date) => (v instanceof Date ? v : v.length === 10 ? parseISODate(v) : new Date(v));

export const fmtDate = (v: string | Date, lang = 'en', opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Intl.DateTimeFormat(localeFor(lang), opts).format(toDate(v));

export const fmtDayMonth = (v: string | Date, lang = 'en') => fmtDate(v, lang, { day: 'numeric', month: 'short' });
export const fmtMonth = (month: string, lang = 'en') => fmtDate(`${month}-01`, lang, { month: 'long', year: 'numeric' });
export const fmtTime = (v: string | Date, lang = 'en') => new Intl.DateTimeFormat(localeFor(lang), { hour: 'numeric', minute: '2-digit' }).format(toDate(v));
export const fmtDateTime = (v: string | Date, lang = 'en') => `${fmtDate(v, lang)}, ${fmtTime(v, lang)}`;
