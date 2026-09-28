import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { employeesApi } from '@/features/api/resources';
import type { ApiEmployee, ApiPaymentStatus } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { inr } from '@/lib/format';

/** API money is a two-decimal string; shown with paise only when there are any. */
export const money = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return inr(n, !Number.isInteger(n));
};

/**
 * Whole paise from what someone typed, or null if it is not a valid rupee amount (at most two
 * decimals). Previews add paise as integers so they agree exactly with the server's Decimal.
 */
export function toPaise(input: string): number | null {
  const value = input.trim();
  if (value === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export const paiseToRupees = (paise: number): string => (paise / 100).toFixed(2);

const TONE: Record<ApiPaymentStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'solidWarning'> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  PROCESSING: 'info',
  STATUS_REVIEW_REQUIRED: 'solidWarning',
  PAID: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  REVERSED: 'danger',
};

export function PaymentStatusBadge({ status }: { status: ApiPaymentStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONE[status]}>{t(`admin.enum.paymentStatus.${status}`)}</Badge>;
}

/** Financial years for filters: the current one (April–March) and the five before it. */
export function financialYearOptions(): { code: string; label: string }[] {
  const now = new Date();
  const current = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 6 }, (_, i) => {
    const start = current - i;
    return { code: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, label: `FY ${start}–${String((start + 1) % 100).padStart(2, '0')}` };
  });
}

/** "2026-09" for this month, local time. */
export const currentPeriod = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/** Forward/back through cursor pages; any change to `resetKey` returns to the first page. */
export function useCursorPages(resetKey: string) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setCursors([undefined]);
    setIndex(0);
  }, [resetKey]);
  return {
    cursor: cursors[index],
    index,
    prev: () => setIndex((i) => Math.max(0, i - 1)),
    next: (nextCursor: string | null) => {
      if (!nextCursor) return;
      setCursors((all) => (all[index + 1] ? all : [...all.slice(0, index + 1), nextCursor]));
      setIndex((i) => i + 1);
    },
  };
}

export function CursorPager({ index, nextCursor, onPrev, onNext }: { index: number; nextCursor: string | null; onPrev: () => void; onNext: () => void }) {
  const { t } = useTranslation();
  if (index === 0 && !nextCursor) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
      <Button variant="outline" disabled={index === 0} onClick={onPrev}>
        {t('admin.common.prev')}
      </Button>
      <Button variant="outline" disabled={!nextCursor} onClick={onNext}>
        {t('admin.common.next')}
      </Button>
    </div>
  );
}

/** Active employees for pickers (salaries, advances, payments). */
export function useActiveEmployees(enabled = true) {
  return useApiResource<ApiEmployee[]>(async () => (await employeesApi.list({ status: 'ACTIVE', limit: 100 })).data, [], enabled);
}
