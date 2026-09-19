import { addDays, monthKey, shiftMonth, todayISO } from '@/lib/dates';

export type DateRange = 'today' | '7d' | 'month' | 'lastMonth' | 'all';
export const DATE_RANGES: DateRange[] = ['today', '7d', 'month', 'lastMonth', 'all'];

export function inRange(date: string, range: DateRange, today = todayISO()) {
  switch (range) {
    case 'today':
      return date === today;
    case '7d':
      return date > addDays(today, -7) && date <= today;
    case 'month':
      return monthKey(date) === monthKey(today);
    case 'lastMonth':
      return monthKey(date) === shiftMonth(monthKey(today), -1);
    default:
      return true;
  }
}
