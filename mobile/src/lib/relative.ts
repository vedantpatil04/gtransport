import type { TFunction } from 'i18next';

/**
 * "5 min ago", "2 hours ago", "3 days ago" in the reader's language. Built from translations rather
 * than Intl.RelativeTimeFormat, which the phone's JavaScript engine does not reliably provide.
 */
export function relativeTime(iso: string | null | undefined, t: TFunction, now: number = Date.now()): string {
  if (!iso) return '—';
  const elapsed = now - new Date(iso).getTime();
  if (!Number.isFinite(elapsed)) return '—';
  const minutes = Math.floor(Math.max(0, elapsed) / 60_000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  return t('time.daysAgo', { count: Math.floor(hours / 24) });
}
