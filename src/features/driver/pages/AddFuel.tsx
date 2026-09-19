import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, CircleCheckBig, CloudOff, Fuel, ImageOff, MapPin, Pencil, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { Plate } from '@/components/Plate';
import { FilePicker } from '@/components/media/FilePicker';
import { FUEL_STATIONS } from '@/data/constants';
import { inr, num } from '@/lib/format';
import { todayISO } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useApp, useCurrentDriver } from '@/store';
import type { FileRef, FuelEntry, FuelType } from '@/types';
import { AmountInput, parseAmount } from '../components/AmountInput';
import { DateField } from '../components/DateField';
import { DriverHeader } from '../components/DriverHeader';
import { useMyVehicle } from '../useDriverData';

const OTHER = '__other__';

const schema = z
  .object({
    fuelType: z.enum(['petrol', 'diesel']),
    amount: z
      .string()
      .refine((v) => parseAmount(v) > 0, 'driver.fuel.errAmount')
      .refine((v) => !(parseAmount(v) > 30000), 'driver.fuel.errAmountHigh'),
    litres: z
      .string()
      .refine((v) => parseAmount(v) > 0, 'driver.fuel.errLitres')
      .refine((v) => !(parseAmount(v) > 400), 'driver.fuel.errLitresHigh'),
    station: z.string().min(1, 'driver.fuel.errStation'),
    otherStation: z.string(),
    date: z.string().refine((d) => d <= todayISO(), 'driver.fuel.errDate'),
    receipt: z.custom<FileRef | null>(),
  })
  .superRefine((v, ctx) => {
    if (v.station === OTHER && v.otherStation.trim().length < 3) ctx.addIssue({ code: 'custom', path: ['otherStation'], message: 'driver.fuel.errStation' });
  });
type Values = z.infer<typeof schema>;

export function AddFuel() {
  const [saved, setSaved] = useState<FuelEntry | null>(null);
  const [formKey, setFormKey] = useState(0);
  if (saved) return <FuelSaved entry={saved} onAnother={() => { setSaved(null); setFormKey((k) => k + 1); }} />;
  return <FuelForm key={formKey} onSaved={setSaved} />;
}

function FuelForm({ onSaved }: { onSaved: (e: FuelEntry) => void }) {
  const { t } = useTranslation();
  const driver = useCurrentDriver();
  const vehicle = useMyVehicle();
  const fuel = useApp((s) => s.fuel);

  // Pumps on the driver's usual route first, the last one used at the top.
  const stations = useMemo(() => {
    const last = fuel.find((f) => f.driverId === driver.id)?.station;
    const onRoute = FUEL_STATIONS.filter((s) => driver.sim.route.includes(s.city)).map((s) => s.name);
    const list = [...new Set([...(last ? [last] : []), ...onRoute])];
    return list.slice(0, 4);
  }, [fuel, driver.id, driver.sim.route]);

  const { register, handleSubmit, control, watch, setValue, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fuelType: vehicle?.fuelType ?? 'diesel', amount: '', litres: '', station: '', otherStation: '', date: todayISO(), receipt: null },
  });
  const [amount, litres, station] = watch(['amount', 'litres', 'station']);
  const rate = parseAmount(amount) / parseAmount(litres);
  const rateOff = Number.isFinite(rate) && rate > 0 && (rate < 60 || rate > 140);
  const err = (k: keyof Values) => (formState.errors[k]?.message ? t(String(formState.errors[k]?.message)) : undefined);

  const submit = (v: Values) => {
    const entry = useApp.getState().addFuel({
      fuelType: v.fuelType as FuelType,
      amount: Math.round(parseAmount(v.amount) * 100) / 100,
      litres: Math.round(parseAmount(v.litres) * 100) / 100,
      station: v.station === OTHER ? v.otherStation.trim() : v.station,
      date: v.date,
      receipt: v.receipt,
    });
    onSaved(entry);
  };

  if (!vehicle) return null;

  return (
    <div className="flex min-h-[calc(100dvh-36px)] flex-col">
      <DriverHeader title={t('driver.fuel.title')} back="/driver" />
      <form onSubmit={handleSubmit(submit)} noValidate className="flex flex-1 flex-col" data-testid="fuel-form">
        <div className="flex-1 space-y-6 px-4 py-5">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/70 px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground">{t('driver.fuel.vehicle')}</span>
            <Plate reg={vehicle.reg} size="md" />
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t('driver.fuel.type')}</legend>
            <Controller
              control={control}
              name="fuelType"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2.5" role="radiogroup">
                  {(['petrol', 'diesel'] as const).map((ft) => (
                    <button
                      key={ft}
                      type="button"
                      role="radio"
                      aria-checked={field.value === ft}
                      onClick={() => field.onChange(ft)}
                      data-testid={`fuel-type-${ft}`}
                      className={cn(
                        'flex h-16 items-center justify-center gap-2 rounded-xl border-2 text-lg font-bold uppercase tracking-wide transition-colors',
                        field.value === ft ? (ft === 'petrol' ? 'border-success bg-success text-white' : 'border-primary bg-primary text-white') : 'border-input bg-card text-foreground hover:bg-accent',
                      )}
                    >
                      {field.value === ft && <Check className="size-5" strokeWidth={3} />}
                      {t(`enum.fuelType.${ft}`)}
                    </button>
                  ))}
                </div>
              )}
            />
          </fieldset>

          <div className="grid grid-cols-1 gap-5 min-[380px]:grid-cols-[1.25fr_1fr]">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="fuel-amount">{t('driver.fuel.amount')}</Label>
              <AmountInput id="fuel-amount" placeholder={t('driver.fuel.amountPlaceholder')} aria-invalid={!!formState.errors.amount} {...register('amount')} data-testid="fuel-amount" />
              <FieldError>{err('amount')}</FieldError>
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="fuel-litres">{t('driver.fuel.litres')}</Label>
              <AmountInput id="fuel-litres" prefix="" suffix="L" placeholder={t('driver.fuel.litresPlaceholder')} aria-invalid={!!formState.errors.litres} {...register('litres')} data-testid="fuel-litres" />
              <FieldError>{err('litres')}</FieldError>
            </div>
          </div>
          {rateOff && !formState.errors.amount && !formState.errors.litres && (
            <p className="-mt-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm font-medium text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {t('driver.fuel.rateCheck')}
            </p>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('driver.fuel.station')}</legend>
            <div className="space-y-2" role="radiogroup">
              {[...stations, OTHER].map((s) => {
                const active = station === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setValue('station', s, { shouldValidate: formState.isSubmitted })}
                    data-testid={s === OTHER ? 'station-other' : 'station-option'}
                    className={cn(
                      'flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 py-2 text-left transition-colors',
                      active ? 'border-primary bg-primary/5' : 'border-input bg-card hover:bg-accent',
                      formState.errors.station && !station && 'border-danger/60',
                    )}
                  >
                    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border-2', active ? 'border-primary bg-primary text-white' : 'border-input')}>
                      {active && <Check className="size-3.5" strokeWidth={3.5} />}
                    </span>
                    {s === OTHER ? <Pencil className="size-4 shrink-0 text-muted-foreground" /> : <MapPin className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">{s === OTHER ? t('driver.fuel.stationOther') : s}</span>
                  </button>
                );
              })}
            </div>
            {station === OTHER && (
              <div className="mt-2">
                <Input className="h-14 text-base" placeholder={t('driver.fuel.stationPlaceholder')} aria-label={t('driver.fuel.stationOther')} autoFocus aria-invalid={!!formState.errors.otherStation} {...register('otherStation')} data-testid="station-other-input" />
                <FieldError>{err('otherStation')}</FieldError>
              </div>
            )}
            <FieldError>{err('station')}</FieldError>
          </fieldset>

          <div className="space-y-2">
            <Label>{t('driver.fuel.date')}</Label>
            <Controller control={control} name="date" render={({ field }) => <DateField value={field.value} onChange={field.onChange} invalid={!!formState.errors.date} testId="fuel-date" />} />
            <FieldError>{err('date')}</FieldError>
          </div>

          <div className="space-y-2">
            <Label>{t('driver.fuel.receipt')}</Label>
            <Controller
              control={control}
              name="receipt"
              render={({ field }) => (
                <FilePicker
                  value={field.value}
                  onChange={field.onChange}
                  purpose="receipt"
                  labels={{ camera: t('driver.receipt.takePhoto'), gallery: t('driver.receipt.gallery'), done: t('driver.receipt.uploaded') }}
                  testId="fuel-receipt"
                />
              )}
            />
          </div>
        </div>
        <div className="sticky bottom-0 z-10 border-t bg-card/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <Button type="submit" size="xl" variant="success" className="h-16 w-full text-xl font-extrabold uppercase tracking-wide" data-testid="fuel-save">
            <Fuel className="!size-6" />
            {t('driver.fuel.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FuelSaved({ entry, onAnother }: { entry: FuelEntry; onAnother: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pending = entry.sync === 'pending';
  return (
    <div className="flex min-h-[calc(100dvh-36px)] flex-col" data-testid="fuel-success">
      <div className="flex flex-1 flex-col items-center px-6 pt-14 text-center animate-in fade-in zoom-in-95 duration-300">
        <div className={cn('flex size-24 items-center justify-center rounded-full', pending ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success')}>
          {pending ? <CloudOff className="size-12" /> : <CircleCheckBig className="size-14" strokeWidth={2.2} />}
        </div>
        <h1 className="mt-6 text-2xl font-bold">{t('driver.fuel.successTitle')}</h1>
        <p className="figure mt-5 text-5xl font-extrabold tracking-tight">{inr(entry.amount)}</p>
        <p className="figure mt-2 text-xl font-semibold text-foreground/80">{t('units.litres', { value: num(entry.litres, 2) })}</p>
        <p className="mt-1 text-base text-muted-foreground">{entry.station}</p>
        <div className="mt-8 w-full space-y-2">
          {entry.receipt ? (
            entry.receipt.uploaded ? (
              <p className="flex items-center justify-center gap-2 rounded-lg bg-success-soft px-4 py-3 font-semibold text-success">
                <CircleCheckBig className="size-5" />
                {t('driver.fuel.receiptUploaded')}
              </p>
            ) : null
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-lg bg-muted px-4 py-3 font-medium text-muted-foreground">
              <ImageOff className="size-5" />
              {t('driver.fuel.noReceipt')}
            </p>
          )}
          {pending && (
            <div className="rounded-lg bg-warning-soft px-4 py-3 text-warning">
              <p className="font-semibold">{t('driver.fuel.savedOnPhone')}</p>
              <p className="text-sm">{t('driver.fuel.willUpload')}</p>
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2 px-4 pb-6 pt-4">
        <Button size="xl" className="h-16 w-full text-lg" onClick={() => navigate('/driver')} data-testid="fuel-go-home">
          {t('driver.fuel.goHome')}
        </Button>
        <Button size="xl" variant="outline" className="w-full" onClick={onAnother}>
          {t('driver.fuel.addAnother')}
        </Button>
      </div>
    </div>
  );
}
