import * as React from 'react';
import { cn } from '@/lib/utils';

/** Big rupee input for drivers: numeric keypad, ₹ prefix, large figures. */
export const AmountInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { suffix?: string; prefix?: string }>(
  ({ className, suffix, prefix = '₹', ...props }, ref) => (
    <div
      className={cn(
        'flex h-16 items-center gap-2 rounded-xl border-2 border-input bg-card px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/30',
        props['aria-invalid'] && 'border-danger focus-within:border-danger',
        className,
      )}
    >
      {prefix && <span className="text-2xl font-bold text-muted-foreground">{prefix}</span>}
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        size={1}
        className="figure h-full w-full min-w-0 flex-1 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-[28px] font-bold outline-none placeholder:text-muted-foreground/40"
        {...props}
      />
      {suffix && <span className="shrink-0 text-lg font-semibold text-muted-foreground">{suffix}</span>}
    </div>
  ),
);
AmountInput.displayName = 'AmountInput';

/** Parses "2,450" / "2450.5" style input into a number (NaN when empty). */
export const parseAmount = (v: unknown) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[,\s₹]/g, '');
  return s === '' ? NaN : Number(s);
};
