import { BadRequestException } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { todayInIndia, toIsoDate } from '../../common/dates/financial-year';
import { ApiErrorCode } from '../../common/http/api-error';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { reportVisibility, type ReportType } from './report-access';
import { resolveReportRange, ReportRangeError, type RangeInput, type ReportRange } from './report-range';

/** Everything a report query needs about who is asking and for which days. */
export interface ReportContext {
  companyId: string;
  userId: string;
  role: UserRole;
  range: ReportRange;
  today: Date;
  now: Date;
  visibility: ReturnType<typeof reportVisibility>;
}

export function reportContext(user: AuthenticatedUser, input: RangeInput, now: Date = new Date()): ReportContext {
  let range: ReportRange;
  try {
    range = resolveReportRange(input, now);
  } catch (error) {
    if (error instanceof ReportRangeError) throw new BadRequestException(error.message);
    throw error;
  }
  return {
    companyId: user.companyId,
    userId: user.id,
    role: user.role,
    range,
    today: todayInIndia(now),
    now,
    visibility: reportVisibility(user.role),
  };
}

export function presentRange(range: ReportRange) {
  return {
    preset: range.preset,
    from: toIsoDate(range.from),
    to: toIsoDate(range.to),
    days: range.days,
    granularity: range.granularity,
    label: range.label,
    financialYears: range.financialYears.map((fy) => ({ code: fy.code, label: fy.label })),
  };
}

/** The common head of every report response: what was asked, for which days, and when. */
export function reportHead(type: ReportType, ctx: ReportContext, filters: object, options: { pointInTime?: boolean } = {}) {
  const applied = Object.fromEntries(
    Object.entries(filters as Record<string, unknown>).filter(([key, value]) => value !== undefined && value !== null && value !== '' && !['preset', 'fy', 'from', 'to', 'page', 'pageSize', 'sort', 'dir', 'format'].includes(key)),
  );
  return {
    report: type,
    range: options.pointInTime ? null : presentRange(ctx.range),
    asOf: toIsoDate(ctx.today),
    filters: applied,
    generatedAt: ctx.now.toISOString(),
  };
}

// ───────────────────────────── Paging & sorting ─────────────────────────────

export interface PageRequest {
  page: number;
  pageSize: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  q?: string;
}

export interface ReportPage<T> {
  data: T[];
  page: { page: number; pageSize: number; total: number; pageCount: number };
  sort: { field: string; dir: 'asc' | 'desc' };
}

export const skipTake = (request: Pick<PageRequest, 'page' | 'pageSize'>) => ({ skip: (request.page - 1) * request.pageSize, take: request.pageSize });

export function toReportPage<T>(data: T[], total: number, request: Pick<PageRequest, 'page' | 'pageSize'>, sort: { field: string; dir: 'asc' | 'desc' }): ReportPage<T> {
  return { data, page: { page: request.page, pageSize: request.pageSize, total, pageCount: Math.max(1, Math.ceil(total / request.pageSize)) }, sort };
}

/**
 * Resolves a requested sort against a report's whitelist. Unknown keys are refused, so a column
 * name from the client never reaches the database; the default applies only when none was asked.
 */
export function resolveSort<T extends string>(requested: string | undefined, dir: 'asc' | 'desc' | undefined, allowed: readonly T[], fallback: { field: T; dir: 'asc' | 'desc' }): { field: T; dir: 'asc' | 'desc' } {
  if (requested === undefined) return { field: fallback.field, dir: dir ?? fallback.dir };
  if (!(allowed as readonly string[]).includes(requested)) {
    throw new BadRequestException(`Cannot sort by "${requested}". Sortable columns: ${allowed.join(', ')}.`);
  }
  return { field: requested as T, dir: dir ?? 'desc' };
}

/** Trimmed search text, or undefined when blank. */
export const searchText = (q: string | undefined): string | undefined => {
  const text = q?.trim();
  return text ? text : undefined;
};

/**
 * Limits for an export's record-level rows. Spreadsheets get every record or a clear refusal —
 * never a silently shortened file an accountant might trust. PDFs are for reading, so they carry
 * a stated excerpt and point to Excel for the rest.
 */
export interface DetailLimits {
  maxRows: number;
  strict: boolean;
}

export class ExportTooLargeError extends BadRequestException {
  constructor(total: number, max: number) {
    super({
      code: ApiErrorCode.EXPORT_TOO_LARGE,
      message: `This export has ${total.toLocaleString('en-IN')} records, more than the ${max.toLocaleString('en-IN')} one file can hold. Narrow the date range or filters and try again.`,
    });
  }
}

export function detailTake(total: number, limits: DetailLimits): number {
  if (limits.strict && total > limits.maxRows) throw new ExportTooLargeError(total, limits.maxRows);
  return Math.min(total, limits.maxRows);
}
