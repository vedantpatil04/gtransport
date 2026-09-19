import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FilePicker } from '@/components/media/FilePicker';
import { QUICK_AMOUNTS } from '@/data/constants';
import { inr } from '@/lib/format';
import { todayISO } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import type { FileRef, UpdateType } from '@/types';
import { UPDATE_META } from '../updateMeta';
import { AmountInput, parseAmount } from './AmountInput';
import { DateField } from './DateField';

const MAX: Record<UpdateType, number> = { toll: 5000, parking: 2000, repair: 50000, food: 3000, advance: 50000, trip: 10000, other: 20000, maintenance: 50000 };

const schema = (type: UpdateType) =>
  z.object({
    amount: z
      .string()
      .refine((v) => parseAmount(v) > 0, 'driver.update.errAmount')
      .refine((v) => !(parseAmount(v) > MAX[type]), 'driver.update.errAmountHigh'),
    note: z.string().max(120),
    date: z.string().refine((d) => d <= todayISO(), 'driver.fuel.errDate'),
    receipt: z.custom<FileRef | null>(),
  });
type Values = z.infer<ReturnType<typeof schema>>;

export function AddUpdateSheet({ type, onClose }: { type: UpdateType | null; onClose: () => void }) {
  if (!type) return null;
  return <UpdateForm key={type} type={type} onClose={onClose} />;
}

function UpdateForm({ type, onClose }: { type: UpdateType; onClose: () => void }) {
  const { t } = useTranslation();
  const offline = useApp((s) => s.offline);
  const form = useForm<Values>({
    resolver: zodResolver(schema(type)),
    defaultValues: { amount: '', note: '', date: todayISO(), receipt: null },
  });
  const { register, handleSubmit, control, setValue, watch, formState } = form;

  const meta = UPDATE_META[type];
  const Icon = meta.icon;
  const label = t(`enum.category.${type}`);
  const amount = watch('amount');

  const submit = (v: Values) => {
    const value = parseAmount(v.amount);
    if (type === 'advance') {
      useApp.getState().reportAdvance({ amount: value, note: v.note.trim(), date: v.date });
    } else {
      useApp.getState().addExpense({ category: type, amount: value, note: v.note.trim(), date: v.date, receipt: v.receipt });
    }
    toast.success(t('driver.update.saved', { type: label }), { description: `${inr(value)}${offline ? ` · ${t('driver.fuel.savedOnPhone')}` : ''}` });
    onClose();
  };

  const err = (k: keyof Values) => {
    const m = formState.errors[k]?.message;
    return m ? t(String(m)) : undefined;
  };

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-[440px]">
        <form onSubmit={handleSubmit(submit)} className="flex max-h-[calc(92dvh-20px)] flex-col" noValidate data-testid="update-form">
          <div className="flex items-center gap-3 px-5 pb-3 pt-3">
            <span className={cn('flex size-11 items-center justify-center rounded-xl', meta.tint)}>
              <Icon className="size-6" />
            </span>
            <SheetTitle>{label}</SheetTitle>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-4">
            {type === 'advance' && <p className="-mt-1 text-sm text-muted-foreground">{t('driver.update.advanceHint')}</p>}
            <div className="space-y-2">
              <Label htmlFor="upd-amount">{t('driver.update.amount')}</Label>
              <AmountInput id="upd-amount" placeholder="0" aria-invalid={!!formState.errors.amount} {...register('amount')} autoFocus />
              <FieldError>{err('amount')}</FieldError>
              <div className="flex flex-wrap gap-2 pt-1" aria-label={t('driver.update.quick')}>
                {QUICK_AMOUNTS[type].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setValue('amount', String(q), { shouldValidate: true })}
                    className={cn('figure h-11 rounded-full border px-4 text-[15px] font-semibold transition-colors', parseAmount(amount) === q ? 'border-primary bg-primary text-white' : 'bg-card hover:bg-accent')}
                  >
                    {inr(q)}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="upd-note">
                {t('driver.update.note')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
              </Label>
              <Input id="upd-note" className="h-12 text-base" placeholder={type === 'advance' ? t('driver.update.advanceNotePlaceholder') : t('driver.update.notePlaceholder')} {...register('note')} />
            </div>
            <div className="space-y-2">
              <Label>{t('common.date')}</Label>
              <Controller control={control} name="date" render={({ field }) => <DateField value={field.value} onChange={field.onChange} invalid={!!formState.errors.date} />} />
              <FieldError>{err('date')}</FieldError>
            </div>
            {type !== 'advance' && (
              <div className="space-y-2">
                <Label>
                  {t('driver.update.receipt')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
                </Label>
                <Controller
                  control={control}
                  name="receipt"
                  render={({ field }) => (
                    <FilePicker value={field.value} onChange={field.onChange} purpose="receipt" labels={{ camera: t('driver.receipt.takePhoto'), gallery: t('driver.receipt.gallery'), done: t('driver.receipt.uploaded') }} testId="update-receipt" />
                  )}
                />
              </div>
            )}
          </div>
          <div className="border-t bg-card px-5 py-3">
            <Button type="submit" size="xl" className="h-14 w-full" data-testid="update-save">
              {t('driver.update.save', { type: label })}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
