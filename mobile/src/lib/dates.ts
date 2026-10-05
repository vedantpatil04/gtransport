/**
 * Business dates on the phone. Values sent to the API are always "YYYY-MM-DD" strings built
 * from the device's local calendar — never a formatted display string.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** A local calendar date as YYYY-MM-DD. */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const todayIso = (now: Date = new Date()): string => isoDate(now);

/** Parses YYYY-MM-DD into a local Date at midnight, for the date picker. */
export function fromIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
}

/**
 * The Intl locale for a UI language: native month names, but Latin digits (the norm on Indian
 * consumer apps, and what the office web console shows) — Marathi would otherwise default to
 * Devanagari digits.
 */
export function localeFor(language: string): string {
  return `${{ en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN' }[language] ?? 'en-IN'}-u-nu-latn`;
}

/** "19 September 2026" in the driver's language. */
export function displayDate(value: string, language: string): string {
  const locale = localeFor(language);
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(fromIsoDate(value));
  } catch {
    return value;
  }
}

/** The first day of the local calendar month containing `now`. */
export const monthStartIso = (now: Date = new Date()): string => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

export const daysAgoIso = (days: number, now: Date = new Date()): string => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return isoDate(date);
};
