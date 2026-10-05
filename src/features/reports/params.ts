import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Preset, ReportParams, ReportType } from './api';

/**
 * Report filters live in the URL, so a filtered report can be bookmarked, shared with a colleague
 * or reached with the back button — and switching tabs keeps the period.
 */

export type FilterKey =
  | 'vehicleId' | 'driverId' | 'employeeId' | 'fuelType' | 'station' | 'category' | 'status' | 'ownership' | 'kind'
  | 'type' | 'paymentStatus' | 'aiStatus' | 'documentType' | 'owner' | 'window';

/** The filters each report understands. The API refuses any other parameter. */
export const REPORT_FILTERS: Record<ReportType, FilterKey[]> = {
  overview: [],
  fuel: ['vehicleId', 'driverId', 'fuelType', 'station'],
  vehicles: ['vehicleId', 'status', 'ownership', 'kind'],
  drivers: ['driverId', 'status'],
  finance: ['employeeId', 'vehicleId', 'type', 'paymentStatus'],
  expenses: ['category', 'vehicleId', 'driverId'],
  maintenance: ['vehicleId', 'driverId', 'aiStatus'],
  tyres: ['vehicleId', 'driverId'],
  compliance: ['documentType', 'owner', 'status', 'window', 'vehicleId', 'driverId'],
  location: ['driverId', 'status'],
};

/** Compliance is "as of today"; every other report covers a period. */
export const usesPeriod = (type: ReportType) => type !== 'compliance';

const PERIOD_KEYS = ['preset', 'fy', 'from', 'to'] as const;
export const DEFAULT_PRESET: Preset = 'this_fy';

export interface PeriodState {
  preset: Preset;
  fy: string;
  from: string;
  to: string;
  /** A custom range still missing one of its dates: nothing is requested until it is complete. */
  incomplete: boolean;
}

export function useReportParams(type: ReportType) {
  const [search, setSearch] = useSearchParams();

  const period: PeriodState = useMemo(() => {
    const preset = (search.get('preset') as Preset | null) ?? DEFAULT_PRESET;
    const from = search.get('from') ?? '';
    const to = search.get('to') ?? '';
    return { preset, fy: search.get('fy') ?? '', from, to, incomplete: preset === 'custom' && (!from || !to) };
  }, [search]);

  const filters = useMemo(() => {
    const out: Partial<Record<FilterKey, string>> = {};
    for (const key of REPORT_FILTERS[type]) {
      const value = search.get(key);
      if (value) out[key] = value;
    }
    return out;
  }, [search, type]);

  /** Exactly what the API is sent: the period (unless point-in-time) and this report's filters. */
  const params: ReportParams = useMemo(() => {
    const out: ReportParams = { ...filters };
    if (usesPeriod(type)) {
      out.preset = period.preset;
      if (period.preset === 'fy') out.fy = period.fy;
      if (period.preset === 'custom') {
        out.from = period.from;
        out.to = period.to;
      }
    }
    return out;
  }, [filters, period, type]);

  const update = useCallback(
    (changes: Record<string, string | undefined>) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );

  const setPeriod = useCallback(
    (preset: Preset, extra: { fy?: string; from?: string; to?: string } = {}) =>
      update({
        preset: preset === DEFAULT_PRESET ? undefined : preset,
        fy: preset === 'fy' ? extra.fy : undefined,
        from: preset === 'custom' ? extra.from ?? period.from : undefined,
        to: preset === 'custom' ? extra.to ?? period.to : undefined,
      }),
    [update, period.from, period.to],
  );

  const setFilter = useCallback((key: FilterKey, value: string | undefined) => update({ [key]: value }), [update]);
  const clearFilters = useCallback(() => update(Object.fromEntries(REPORT_FILTERS[type].map((k) => [k, undefined]))), [update, type]);

  return { period, filters, params, key: JSON.stringify(params), setPeriod, setFilter, clearFilters, ready: !usesPeriod(type) || !period.incomplete };
}

/** The query string to carry into another report: the period, plus filters the target understands. */
export function carryOver(search: URLSearchParams, target: ReportType): string {
  const next = new URLSearchParams();
  for (const key of PERIOD_KEYS) {
    const value = search.get(key);
    if (value) next.set(key, value);
  }
  for (const key of ['vehicleId', 'driverId'] as const) {
    const value = search.get(key);
    if (value && REPORT_FILTERS[target].includes(key)) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `?${qs}` : '';
}
