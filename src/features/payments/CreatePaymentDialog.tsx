import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { PAYMENT_TYPES } from '@/data/constants';
import { inr } from '@/lib/format';
import { useApp } from '@/store';
import type { Payment, PaymentMethod, PaymentType } from '@/types';

const schema = z.object({
  driverId: z.string().min(1, 'admin.payments.errDriver'),
  type: z.enum(['salary', 'fuel_advance', 'trip_allowance', 'other_advance', 'reimbursement']),
  amount: z.coerce.number({ invalid_type_error: 'admin.payments.errAmount' }).positive('admin.payments.errAmount').max(200000, 'admin.payments.errAmountHigh'),
  method: z.enum(['upi', 'bank', 'cash']),
  note: z.string().max(140),
});
type Values = z.infer<typeof schema>;

export function CreatePaymentDialog({ open, onOpenChange, driverId, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; driverId?: string; onCreated?: (p: Payment) => void }) {
  const { t } = useTranslation();
  const drivers = useApp((s) => s.drivers);
  const { register, handleSubmit, formState, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    values: open ? { driverId: driverId ?? '', type: 'fuel_advance', amount: '' as unknown as number, method: 'upi', note: '' } : undefined,
  });
  const err = (k: keyof Values) => (formState.errors[k]?.message ? t(String(formState.errors[k]?.message)) : undefined);

  const submit = (v: Values) => {
    const p = useApp.getState().createPayment({ driverId: v.driverId, type: v.type as PaymentType, amount: v.amount, method: v.method as PaymentMethod, note: v.note.trim() });
    toast.success(t('admin.payments.created'), { description: `${inr(p.amount)} · ${drivers.find((d) => d.id === p.driverId)?.name}` });
    onOpenChange(false);
    reset();
    onCreated?.(p);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.payments.create')}</DialogTitle>
          <DialogDescription>{t('admin.payments.createHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate data-testid="create-payment-form">
          <div className="space-y-1.5">
            <Label htmlFor="cp-driver">{t('admin.common.driver')}</Label>
            <NativeSelect id="cp-driver" aria-invalid={!!formState.errors.driverId} {...register('driverId')} data-testid="cp-driver">
              <option value="">{t('common.select')}</option>
              {drivers
                .filter((d) => d.status === 'active')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.code}
                  </option>
                ))}
            </NativeSelect>
            <FieldError>{err('driverId')}</FieldError>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-type">{t('admin.common.type')}</Label>
              <NativeSelect id="cp-type" {...register('type')} data-testid="cp-type">
                {PAYMENT_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {t(`enum.paymentType.${pt}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-amount">{t('admin.common.amount')} (₹)</Label>
              <Input id="cp-amount" inputMode="numeric" placeholder="3000" aria-invalid={!!formState.errors.amount} {...register('amount')} data-testid="cp-amount" />
              <FieldError>{err('amount')}</FieldError>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-method">{t('admin.payments.method')}</Label>
            <NativeSelect id="cp-method" {...register('method')}>
              {(['upi', 'bank', 'cash'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`enum.method.${m}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-note">
              {t('common.note')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
            </Label>
            <Textarea id="cp-note" rows={2} {...register('note')} />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" data-testid="cp-submit">
              {t('admin.payments.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
