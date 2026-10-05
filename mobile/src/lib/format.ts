/**
 * Money and quantities as the driver and the office read them — the same rules as the office web
 * console (src/lib/format.ts there), so a figure looks identical on the phone and on the desktop:
 * Indian digit grouping, Latin digits in every language, whole rupees when there are no paise and
 * exactly two digits when there are.
 */

/** "₹23,999.75", or "₹18,000" when there are no paise. Exact: an API string is never rounded. */
export function rupees(amount: string | number): string {
  const text = typeof amount === 'number' ? amount.toFixed(2) : amount.trim();
  const [whole = '0', fraction = ''] = text.replace(/^-/, '').split('.');
  const grouped = Number(whole).toLocaleString('en-IN');
  const paise = fraction.padEnd(2, '0').slice(0, 2);
  return `${text.startsWith('-') ? '−' : ''}₹${grouped}${paise === '00' ? '' : `.${paise}`}`;
}

/** A quantity such as litres: grouped, at most `digits` decimals, no trailing zeros ("25.3"). */
export function quantity(value: string | number, digits = 2): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('en-IN', { maximumFractionDigits: digits });
}
