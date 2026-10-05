import {
  financialYear, financialYearOf, monthStart, parseBusinessDate, parseFinancialYear, todayInIndia, toIsoDate,
  type FinancialYear,
} from '../../common/dates/financial-year';

/**
 * The reporting calendar: which days a report covers, resolved once on the server.
 *
 * Every report, chart and export takes its period from here, so "This month" or "FY 2026–27"
 * means exactly the same days everywhere. Dates are calendar days in India (IST, UTC+05:30),
 * represented as UTC-midnight Dates — the same convention as the `date` columns they filter —
 * so there is no midnight off-by-one however the server's own clock is set.
 *
 * Ranges are inclusive at both ends. "Period to date" presets (this week, month, quarter,
 * financial year) end today rather than at the end of the period: days that have not happened
 * yet have no records, and charting them as zeros would present an absence of data as a fact.
 */

export const REPORT_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'previous_month',
  'this_quarter',
  'this_fy',
  'previous_fy',
  'fy',
  'custom',
] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

/** A report period may span at most about three financial years. */
export const MAX_RANGE_DAYS = 1100;
/** Nothing in the business predates this; older dates are a typing mistake. */
export const EARLIEST_REPORT_DATE = '2000-01-01';
/** Day-level charts up to roughly two months; beyond that, months. */
export const DAILY_GRANULARITY_MAX_DAYS = 62;

export type Granularity = 'day' | 'month';

export interface ReportRange {
  preset: ReportPreset;
  /** First day, inclusive (UTC midnight of an IST calendar day). */
  from: Date;
  /** Last day, inclusive. */
  to: Date;
  /** Number of calendar days covered, counting both ends. */
  days: number;
  granularity: Granularity;
  /** Every financial year the range touches, oldest first. */
  financialYears: FinancialYear[];
  /** English, for exports: "1 Apr 2026 – 5 Oct 2026". Screens format from/to themselves. */
  label: string;
}

export interface RangeInput {
  preset?: string;
  fy?: string;
  from?: string;
  to?: string;
}

/** A request that cannot be turned into a valid period. Mapped to 400 by the controller layer. */
export class ReportRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportRangeError';
  }
}

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const utc = (year: number, monthIndex: number, day: number) => new Date(Date.UTC(year, monthIndex, day));
export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);
const lastDayOfMonth = (date: Date) => utc(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
const dayCount = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "5 Oct 2026" — English, unambiguous, used in exports and error messages. */
export const formatDay = (date: Date): string => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
export const formatMonth = (date: Date): string => `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

function parseDay(value: string, field: string): Date {
  try {
    return parseBusinessDate(value);
  } catch {
    throw new ReportRangeError(`"${field}" is not a valid date. Use YYYY-MM-DD.`);
  }
}

/** Financial quarter containing `date`: Q1 = Apr–Jun … Q4 = Jan–Mar. Boundaries match calendar quarters. */
export function quarterStart(date: Date): Date {
  return utc(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1);
}

/** Monday of the week containing `date` (Indian business weeks start on Monday). */
export function weekStart(date: Date): Date {
  return addDays(date, -((date.getUTCDay() + 6) % 7));
}

/** Every financial year touched by [from, to]. */
export function financialYearsBetween(from: Date, to: Date): FinancialYear[] {
  const first = financialYearOf(from).startYear;
  const last = financialYearOf(to).startYear;
  return Array.from({ length: last - first + 1 }, (_, i) => financialYear(first + i));
}

function build(preset: ReportPreset, from: Date, to: Date): ReportRange {
  const days = dayCount(from, to);
  return {
    preset,
    from,
    to,
    days,
    granularity: days <= DAILY_GRANULARITY_MAX_DAYS ? 'day' : 'month',
    financialYears: financialYearsBetween(from, to),
    label: from.getTime() === to.getTime() ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`,
  };
}

/**
 * Turns a report request into the exact days it covers.
 *
 * - no parameters: the current financial year to date;
 * - `from`/`to` (or preset=custom): exactly those days — both required;
 * - `fy` (or preset=fy): that financial year, ending today if it is the current one;
 * - any other preset: computed from today in India.
 *
 * Mixing a relative preset with explicit dates is refused rather than guessed at.
 */
export function resolveReportRange(input: RangeInput, now: Date = new Date()): ReportRange {
  const today = todayInIndia(now);
  const hasDates = Boolean(input.from || input.to);
  const preset = (input.preset ?? (hasDates ? 'custom' : input.fy ? 'fy' : 'this_fy')) as ReportPreset;
  if (!REPORT_PRESETS.includes(preset)) throw new ReportRangeError(`Unknown period "${input.preset}".`);

  if (preset !== 'custom' && hasDates) throw new ReportRangeError('"from" and "to" apply only to a custom range.');
  if (preset !== 'fy' && input.fy) throw new ReportRangeError('"fy" applies only to a financial-year period.');

  const currentFy = financialYearOf(today);

  switch (preset) {
    case 'today':
      return build(preset, today, today);
    case 'yesterday': {
      const day = addDays(today, -1);
      return build(preset, day, day);
    }
    case 'this_week':
      return build(preset, weekStart(today), today);
    case 'this_month':
      return build(preset, monthStart(today), today);
    case 'previous_month': {
      const start = utc(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
      return build(preset, start, lastDayOfMonth(start));
    }
    case 'this_quarter':
      return build(preset, quarterStart(today), today);
    case 'this_fy':
      return build(preset, currentFy.start, today);
    case 'previous_fy': {
      const previous = financialYear(currentFy.startYear - 1);
      return build(preset, previous.start, previous.end);
    }
    case 'fy': {
      if (!input.fy) throw new ReportRangeError('Choose a financial year, e.g. 2026-27.');
      let fy: FinancialYear;
      try {
        fy = parseFinancialYear(input.fy);
      } catch (error) {
        throw new ReportRangeError((error as Error).message);
      }
      if (fy.startYear > currentFy.startYear) throw new ReportRangeError(`${fy.label} has not started yet.`);
      if (fy.start < parseBusinessDate(EARLIEST_REPORT_DATE)) throw new ReportRangeError(`${fy.label} is earlier than any business record.`);
      return build(preset, fy.start, fy.end < today ? fy.end : today);
    }
    case 'custom': {
      if (!input.from || !input.to) throw new ReportRangeError('A custom range needs both "from" and "to".');
      const from = parseDay(input.from, 'from');
      const to = parseDay(input.to, 'to');
      if (from > to) throw new ReportRangeError('"from" must be on or before "to".');
      if (from < parseBusinessDate(EARLIEST_REPORT_DATE)) throw new ReportRangeError(`Dates before ${formatDay(parseBusinessDate(EARLIEST_REPORT_DATE))} are not supported.`);
      if (to > addDays(today, 366)) throw new ReportRangeError('"to" is more than a year in the future.');
      if (dayCount(from, to) > MAX_RANGE_DAYS) throw new ReportRangeError('Choose a range of three years or less.');
      return build(preset, from, to);
    }
  }
}

// ───────────────────────────── Time-zone conversion ─────────────────────────────

/** The IST calendar day an instant falls on, as a UTC-midnight Date. */
export function istDay(instant: Date): Date {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return utc(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * The instants covered by a range of IST days — for timestamp columns (payment paid-at, alert
 * times). Half-open: 00:00 IST on the first day up to, not including, 00:00 IST after the last.
 */
export function instantWindow(range: Pick<ReportRange, 'from' | 'to'>): { gte: Date; lt: Date } {
  return {
    gte: new Date(range.from.getTime() - IST_OFFSET_MS),
    lt: new Date(addDays(range.to, 1).getTime() - IST_OFFSET_MS),
  };
}

/** The Prisma filter for a `date` column. */
export const dateWindow = (range: Pick<ReportRange, 'from' | 'to'>): { gte: Date; lte: Date } => ({ gte: range.from, lte: range.to });

// ───────────────────────────── Trend buckets ─────────────────────────────

export interface Bucket {
  /** "2026-10-05" for days, "2026-10" for months. */
  key: string;
  from: Date;
  to: Date;
}

export const bucketKey = (date: Date, granularity: Granularity): string =>
  granularity === 'day' ? toIsoDate(date) : toIsoDate(date).slice(0, 7);

/**
 * Every bucket in the range, in order — including ones with no records, which are real zeros
 * because the query covering them succeeded. A partial first or last month is clipped to the
 * range, so its totals never include days outside it.
 */
export function bucketsFor(range: Pick<ReportRange, 'from' | 'to' | 'granularity'>): Bucket[] {
  const buckets: Bucket[] = [];
  if (range.granularity === 'day') {
    for (let day = range.from; day <= range.to; day = addDays(day, 1)) buckets.push({ key: toIsoDate(day), from: day, to: day });
    return buckets;
  }
  for (let start = monthStart(range.from); start <= range.to; start = utc(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) {
    const end = lastDayOfMonth(start);
    buckets.push({ key: toIsoDate(start).slice(0, 7), from: start < range.from ? range.from : start, to: end > range.to ? range.to : end });
  }
  return buckets;
}

// ───────────────────────────── Comparisons ─────────────────────────────

export interface ComparisonPeriods {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date };
}

/** Same calendar day `years` earlier, with 29 February falling back to the 28th. */
function sameDayYearsAgo(date: Date, years: number): Date {
  const target = utc(date.getUTCFullYear() - years, date.getUTCMonth(), date.getUTCDate());
  return target.getUTCMonth() === date.getUTCMonth() ? target : utc(date.getUTCFullYear() - years, date.getUTCMonth() + 1, 0);
}

/** Month to date against the same days of the previous month (1–5 Oct vs 1–5 Sep). */
export function monthOverMonth(now: Date = new Date()): ComparisonPeriods {
  const today = todayInIndia(now);
  const start = monthStart(today);
  const previousStart = utc(start.getUTCFullYear(), start.getUTCMonth() - 1, 1);
  const previousEnd = addDays(previousStart, today.getUTCDate() - 1);
  const previousMonthEnd = lastDayOfMonth(previousStart);
  return {
    current: { from: start, to: today },
    previous: { from: previousStart, to: previousEnd > previousMonthEnd ? previousMonthEnd : previousEnd },
  };
}

/** Financial year to date against the same span of the previous financial year. */
export function financialYearOverYear(now: Date = new Date()): ComparisonPeriods {
  const today = todayInIndia(now);
  const fy = financialYearOf(today);
  const previous = financialYear(fy.startYear - 1);
  return { current: { from: fy.start, to: today }, previous: { from: previous.start, to: sameDayYearsAgo(today, 1) } };
}
