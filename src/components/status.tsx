import { Ban, CircleCheckBig, CircleX, Clock3, Hourglass, TriangleAlert, ShieldCheck, CircleDashed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { docStatus, LEVEL_STYLES } from '@/features/documents/expiry';
import { cn } from '@/lib/utils';
import type { DocRecord, DocVerification, MotionState, PaymentStatus } from '@/types';

export const PAYMENT_TONE = {
  paid: { tone: 'success', icon: CircleCheckBig, text: 'text-success', bg: 'bg-success-soft' },
  processing: { tone: 'warning', icon: Hourglass, text: 'text-warning', bg: 'bg-warning-soft' },
  pending: { tone: 'info', icon: Clock3, text: 'text-muted-foreground', bg: 'bg-muted' },
  failed: { tone: 'danger', icon: CircleX, text: 'text-danger', bg: 'bg-danger-soft' },
  cancelled: { tone: 'neutral', icon: Ban, text: 'text-muted-foreground', bg: 'bg-muted' },
} as const satisfies Record<PaymentStatus, unknown>;

export function PaymentStatusChip({ status, driver = false, size = 'sm', className }: { status: PaymentStatus; driver?: boolean; size?: 'sm' | 'lg'; className?: string }) {
  const { t } = useTranslation();
  const cfg = PAYMENT_TONE[status];
  const Icon = cfg.icon;
  return (
    <Badge tone={cfg.tone} className={cn(size === 'lg' && 'px-2.5 py-1 text-sm [&_svg]:size-4', className)}>
      <Icon />
      {t(`enum.${driver ? 'paymentStatusDriver' : 'paymentStatus'}.${status}`)}
    </Badge>
  );
}

/** Localised expiry sentence for a document ("Expires in 18 days", "Expired 4 days ago"). */
export function useExpiryLabel() {
  const { t } = useTranslation();
  return (doc: Pick<DocRecord, 'expiresOn'>) => {
    const s = docStatus(doc);
    if (s.state === 'none') return t('expiry.noExpiry');
    if (s.state === 'expired') return t('expiry.agoDays', { count: Math.abs(s.days!) });
    if (s.days === 0) return t('expiry.today');
    if (s.state === 'expiring') return t('expiry.inDays', { count: s.days! });
    return t('expiry.valid');
  };
}

export function ExpiryChip({ doc, className, long = false }: { doc: Pick<DocRecord, 'expiresOn'>; className?: string; long?: boolean }) {
  const { t } = useTranslation();
  const label = useExpiryLabel();
  const s = docStatus(doc);
  if (s.state === 'none') {
    return (
      <Badge tone="success" className={className}>
        <ShieldCheck />
        {t('expiry.noExpiry')}
      </Badge>
    );
  }
  const Icon = s.level === 0 ? ShieldCheck : TriangleAlert;
  const text = s.state === 'valid' ? t('expiry.valid') : long || s.level >= 1 ? label(doc) : t('expiry.expiringSoon');
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold [&_svg]:size-3.5', LEVEL_STYLES[s.level].chip, className)}>
      <Icon />
      {text}
    </span>
  );
}

export function VerificationChip({ value, className }: { value: DocVerification; className?: string }) {
  const { t } = useTranslation();
  const tone = value === 'verified' || value === 'approved' ? 'success' : value === 'rejected' ? 'danger' : 'neutral';
  const Icon = value === 'verified' || value === 'approved' ? CircleCheckBig : value === 'rejected' ? CircleX : CircleDashed;
  return (
    <Badge tone={tone} className={className}>
      <Icon />
      {t(`enum.verification.${value}`)}
    </Badge>
  );
}

export const MOTION_COLOR: Record<MotionState, string> = {
  moving: 'bg-success',
  stopped: 'bg-warning',
  offline: 'bg-danger',
  none: 'bg-muted-foreground/50',
};
export const MOTION_HEX: Record<MotionState, string> = { moving: '#16804a', stopped: '#b87400', offline: '#c0392b', none: '#8a94a3' };

export function MotionDot({ motion, pulse = false, className }: { motion: MotionState; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0', className)} aria-hidden>
      {pulse && motion === 'moving' && <span className={cn('absolute inset-0 animate-ring-pulse rounded-full', MOTION_COLOR[motion])} />}
      <span className={cn('relative inline-flex size-full rounded-full', MOTION_COLOR[motion])} />
    </span>
  );
}

export function MotionLabel({ motion, pulse, className }: { motion: MotionState; pulse?: boolean; className?: string }) {
  const { t } = useTranslation();
  const color = { moving: 'text-success', stopped: 'text-warning', offline: 'text-danger', none: 'text-muted-foreground' }[motion];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', color, className)}>
      <MotionDot motion={motion} pulse={pulse} />
      {t(`enum.motion.${motion}`)}
    </span>
  );
}
