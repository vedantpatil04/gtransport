import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import { todayISO } from '@/lib/dates';

/** Shows "Today, 18 Sep 2026" with a Change button. The native picker only opens when asked. */
export function DateField({ value, onChange, invalid, testId }: { value: string; onChange: (v: string) => void; invalid?: boolean; testId?: string }) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const isToday = value === todayISO();
  const open = () => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        /* fall through */
      }
    }
    el.focus();
    el.click();
  };
  return (
    <div className={`relative flex h-14 items-center gap-3 rounded-xl border-2 bg-card pl-4 pr-1.5 ${invalid ? 'border-danger' : 'border-input'}`}>
      <CalendarDays className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-base font-semibold">
        {isToday ? `${t('common.today')}, ` : ''}
        {fmtDate(value, i18n.language, { weekday: isToday ? undefined : 'short', day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
      <button type="button" onClick={open} className="h-11 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-accent" data-testid={testId}>
        {t('common.change')}
      </button>
      <input
        ref={ref}
        type="date"
        value={value}
        max={todayISO()}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
        tabIndex={-1}
        aria-label={t('common.date')}
        data-testid={testId ? `${testId}-input` : undefined}
      />
    </div>
  );
}
