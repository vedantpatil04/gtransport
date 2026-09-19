import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { PaymentStatusChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { DetailList, DriverCell } from '@/features/admin/components/ui';
import { fmtDateTime, inr } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import { ACTION_ICON, availableActions, useRunPaymentAction } from './PaymentActions';

export function PaymentSheet({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const payment = useApp((s) => s.payments.find((p) => p.id === paymentId));
  const driver = useApp((s) => s.drivers.find((d) => d.id === payment?.driverId));
  const vehicle = useApp((s) => s.vehicles.find((v) => v.id === driver?.vehicleId));
  const run = useRunPaymentAction();

  return (
    <Sheet open={!!payment} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-[460px] overflow-y-auto">
        {payment && (
          <div className="space-y-5 p-5" data-testid="payment-sheet">
            <div className="pr-8">
              <SheetTitle>{t('admin.payments.detail')}</SheetTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">{t(`enum.paymentType.${payment.type}`)}</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <p className="figure text-3xl font-bold">{inr(payment.amount)}</p>
              <PaymentStatusChip status={payment.status} size="lg" />
            </div>
            {availableActions(payment).length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {availableActions(payment).map((a) => {
                  const Icon = ACTION_ICON[a];
                  return (
                    <Button
                      key={a}
                      variant={a === 'paid' ? 'success' : a === 'failed' || a === 'cancel' ? 'outline' : a === 'processing' || a === 'retry' ? 'default' : 'outline'}
                      className={cn((a === 'failed' || a === 'cancel') && 'text-danger hover:text-danger')}
                      onClick={() => run(payment, a)}
                      data-testid={`sheet-action-${a}`}
                    >
                      <Icon />
                      {t(`admin.payments.action.${a}`)}
                    </Button>
                  );
                })}
              </div>
            )}
            <DetailList
              rows={[
                [t('admin.common.driver'), <DriverCell driver={driver} />],
                [t('admin.common.vehicle'), <Plate reg={vehicle?.reg} size="xs" />],
                [t('admin.payments.method'), t(`enum.method.${payment.method}`)],
                [t('admin.payments.reference'), payment.reference ? <span className="font-mono">{payment.reference}</span> : '—'],
                [t('admin.payments.approved'), payment.approved ? t('common.yes') : t('common.no')],
                [t('admin.payments.createdOn'), fmtDateTime(payment.createdAt, i18n.language)],
                ...(payment.note ? ([[t('common.note'), payment.note]] as [string, string][]) : []),
                ...(payment.reportedByDriver ? ([[t('admin.payments.source'), t('admin.payments.reportedByDriver')]] as [string, string][]) : []),
              ]}
            />
            <div>
              <h3 className="mb-3 text-sm font-semibold">{t('admin.payments.history')}</h3>
              <ol className="space-y-3">
                {[...payment.history].reverse().map((h, i) => (
                  <li key={i} className="flex gap-3">
                    <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', h.status === 'failed' || h.status === 'cancelled' ? 'bg-danger text-white' : h.status === 'paid' ? 'bg-success text-white' : 'bg-secondary text-foreground')}>
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <div className="text-sm">
                      <p className="font-medium">
                        {t(`enum.paymentEvent.${h.status}`)}
                      </p>
                      <p className="text-xs text-muted-foreground">{fmtDateTime(h.at, i18n.language)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
