import { localeFor } from './format';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "2 min ago" / "2 ನಿಮಿಷಗಳ ಹಿಂದೆ" — localised by the browser, no strings to translate. */
export function relTime(iso: string | null | undefined, lang: string, now = Date.now()) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto', style: 'short' });
  if (Math.abs(diff) < 45_000) return rtf.format(0, 'second');
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === 'minute') return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, 'second');
}
