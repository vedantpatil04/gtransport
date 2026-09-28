import { BadRequestException } from '@nestjs/common';
import { parseBusinessDate, parseFinancialYear, todayInIndia, type FinancialYear } from './financial-year';

/**
 * Request-facing date handling shared by every module that records business dates, so fuel,
 * operations and documents all accept, reject and filter dates the same way.
 */

export function businessDate(value: string): Date {
  try {
    return parseBusinessDate(value);
  } catch (error) {
    throw new BadRequestException((error as Error).message);
  }
}

/** A date that may be back-dated but never in the future (India time). */
export function pastOrTodayDate(value: string): Date {
  const date = businessDate(value);
  if (date > todayInIndia()) throw new BadRequestException('The date cannot be in the future.');
  return date;
}

export function financialYearParam(code: string): FinancialYear {
  try {
    return parseFinancialYear(code);
  } catch (error) {
    throw new BadRequestException((error as Error).message);
  }
}

/**
 * A { gte, lte } range from optional from/to dates, or else a financial year, or else nothing.
 * Explicit dates win over a financial year when both are given.
 */
export function dateRangeFilter(query: { from?: string; to?: string; fy?: string }): { gte?: Date; lte?: Date } | undefined {
  if (query.from || query.to) {
    const start = query.from ? businessDate(query.from) : undefined;
    const end = query.to ? businessDate(query.to) : undefined;
    if (start && end && start > end) throw new BadRequestException('"from" must be on or before "to".');
    return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
  }
  if (query.fy) {
    const fy = financialYearParam(query.fy);
    return { gte: fy.start, lte: fy.end };
  }
  return undefined;
}
