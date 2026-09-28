/**
 * Indian financial year: 1 April → 31 March.
 *
 * The single source of truth for FY maths on the backend. Fuel statements, dashboards and any
 * later reporting call these helpers rather than re-deriving April boundaries in place.
 *
 * All calculations use calendar dates in UTC. Stored business dates are Postgres `date`
 * columns (no time, no zone), so treating them as UTC midnight is exact — an entry dated
 * 31 March is always in the old year and 1 April always in the new one, whatever the
 * server's local timezone.
 */

export interface FinancialYear {
  /** Calendar year the FY starts in: 2026 for FY 2026–27. */
  startYear: number;
  /** "FY 2026–27". */
  label: string;
  /** "2026-27", stable for URLs and query strings. */
  code: string;
  /** 1 April of startYear, inclusive. */
  start: Date;
  /** 31 March of startYear + 1, inclusive. */
  end: Date;
}

const APRIL = 3; // zero-based month index

const utcDate = (year: number, monthIndex: number, day: number): Date => new Date(Date.UTC(year, monthIndex, day));

/** The financial year starting in `startYear`. */
export function financialYear(startYear: number): FinancialYear {
  if (!Number.isInteger(startYear) || startYear < 1900 || startYear > 9998) {
    throw new RangeError(`Invalid financial year start: ${startYear}`);
  }
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return {
    startYear,
    label: `FY ${startYear}–${endShort}`,
    code: `${startYear}-${endShort}`,
    start: utcDate(startYear, APRIL, 1),
    end: utcDate(startYear + 1, APRIL - 1, 31),
  };
}

/** The financial year a given date falls in. January–March belong to the previous start year. */
export function financialYearOf(date: Date): FinancialYear {
  const year = date.getUTCFullYear();
  return financialYear(date.getUTCMonth() >= APRIL ? year : year - 1);
}

/** Parses "2026-27" (or "2026") into a financial year; rejects mismatched pairs like "2026-29". */
export function parseFinancialYear(code: string): FinancialYear {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(code.trim());
  if (!match) throw new RangeError(`Invalid financial year: "${code}". Use the form 2026-27.`);
  const startYear = Number(match[1]);
  const fy = financialYear(startYear);
  if (match[2] !== undefined && match[2] !== fy.code.slice(5)) {
    throw new RangeError(`Invalid financial year: "${code}". Did you mean ${fy.code}?`);
  }
  return fy;
}

/** Today's calendar date as a UTC-midnight Date, in India's timezone. */
export function todayInIndia(now: Date = new Date()): Date {
  // IST is a fixed UTC+05:30 with no daylight saving, so a fixed offset is exact.
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  return utcDate(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
}

/** First day of the calendar month containing `date`. */
export function monthStart(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/** Parses a "YYYY-MM-DD" business date strictly, rejecting impossible dates such as 31 February. */
export function parseBusinessDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Invalid date: "${value}". Use YYYY-MM-DD.`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = utcDate(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError(`Invalid date: "${value}".`);
  }
  return date;
}

export const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);
