import { useTranslation } from 'react-i18next';
import { Ban, CheckCircle2, CircleCheckBig, CircleX, Eye, Hourglass, MoreHorizontal, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { inr } from '@/lib/format';
import { useApp } from '@/store';
import type { Payment, PaymentStatus } from '@/types';

export type PaymentAction = 'approve' | 'processing' | 'paid' | 'failed' | 'retry' | 'cancel';

export function availableActions(p: Payment): PaymentAction[] {
  switch (p.status) {
    case 'pending':
      return [...(p.approved ? [] : (['approve'] as PaymentAction[])), 'processing', 'paid', 'cancel'];
    case 'processing':
      return ['paid', 'failed'];
    case 'failed':
      return ['retry', 'cancel'];
    default:
      return [];
  }
}

const TARGET: Record<Exclude<PaymentAction, 'approve'>, PaymentStatus> = { processing: 'processing', paid: 'paid', failed: 'failed', retry: 'processing', cancel: 'cancelled' };
export const ACTION_ICON = { approve: CheckCircle2, processing: Hourglass, paid: CircleCheckBig, failed: CircleX, retry: RotateCw, cancel: Ban };

export function useRunPaymentAction() {
  const { t } = useTranslation();
  const drivers = useApp((s) => s.drivers);
  return (p: Payment, action: PaymentAction) => {
    const s = useApp.getState();
    if (action === 'approve') s.approvePayment(p.id);
    else s.setPaymentStatus(p.id, TARGET[action]);
    const name = drivers.find((d) => d.id === p.driverId)?.name ?? '';
    toast.success(t(`admin.payments.done.${action}`), { description: `${inr(p.amount)} · ${name}` });
  };
}

/** Row-level action menu. */
export function PaymentActionsMenu({ payment, onView }: { payment: Payment; onView: () => void }) {
  const { t } = useTranslation();
  const run = useRunPaymentAction();
  const actions = availableActions(payment);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()} aria-label={t('admin.common.actions')} data-testid="payment-actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onView}>
          <Eye />
          {t('admin.payments.viewDetails')}
        </DropdownMenuItem>
        {actions.length > 0 && <DropdownMenuSeparator />}
        {actions.map((a) => {
          const Icon = ACTION_ICON[a];
          return (
            <DropdownMenuItem key={a} destructive={a === 'failed' || a === 'cancel'} onSelect={() => run(payment, a)} data-testid={`payment-action-${a}`}>
              <Icon />
              {t(`admin.payments.action.${a}`)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
