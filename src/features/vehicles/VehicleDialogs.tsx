import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { initials, cn } from '@/lib/utils';
import { useApp } from '@/store';
import type { FuelType, Vehicle, VehicleKind } from '@/types';

/** Indian registration: state, RTO, series, number — e.g. KA 22 AB 1234. */
const REG = /^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}$/;
const formatReg = (s: string) => {
  const m = s.toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{4})$/);
  return m ? `${m[1]} ${m[2].padStart(2, '0')} ${m[3]} ${m[4]}` : s.toUpperCase();
};

const schema = z.object({
  reg: z.string().transform((s) => s.toUpperCase().trim()).refine((s) => REG.test(s), 'admin.vehicles.errReg'),
  model: z.string().trim().min(3, 'admin.vehicles.errModel'),
  kind: z.enum(['lcv', 'pickup', 'truck']),
  fuelType: z.enum(['petrol', 'diesel']),
  capacityT: z.coerce.number().positive('admin.vehicles.errNumber').max(40, 'admin.vehicles.errNumber'),
  year: z.coerce.number().int().min(2005, 'admin.vehicles.errYear').max(new Date().getFullYear(), 'admin.vehicles.errYear'),
  mileageKmpl: z.coerce.number().positive('admin.vehicles.errNumber').max(40, 'admin.vehicles.errNumber'),
});
type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

export function AddVehicleDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (v: Vehicle) => void }) {
  const { t } = useTranslation();
  const vehicles = useApp((s) => s.vehicles);
  const { register, handleSubmit, formState, reset, setError } = useForm<Values, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: { reg: '', model: '', kind: 'truck', fuelType: 'diesel', capacityT: 2.5, year: 2024, mileageKmpl: 9 },
  });
  const err = (k: keyof Values) => (formState.errors[k]?.message ? t(String(formState.errors[k]?.message)) : undefined);
  const submit = (v: Output) => {
    const reg = formatReg(v.reg);
    if (vehicles.some((x) => x.reg === reg)) return setError('reg', { message: 'admin.vehicles.errDuplicate' });
    const created = useApp.getState().addVehicle({ ...v, reg, kind: v.kind as VehicleKind, fuelType: v.fuelType as FuelType });
    toast.success(t('admin.vehicles.added', { reg }));
    reset();
    onOpenChange(false);
    onCreated?.(created);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.vehicles.add')}</DialogTitle>
          <DialogDescription>{t('admin.vehicles.addHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="av-reg">{t('admin.vehicles.reg')}</Label>
              <Input id="av-reg" placeholder="KA 22 MN 4455" className="uppercase" aria-invalid={!!formState.errors.reg} {...register('reg')} />
              <FieldError>{err('reg')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="av-model">{t('admin.vehicles.model')}</Label>
              <Input id="av-model" placeholder="Tata 407 Gold SFC" aria-invalid={!!formState.errors.model} {...register('model')} />
              <FieldError>{err('model')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="av-kind">{t('admin.vehicles.kind')}</Label>
              <NativeSelect id="av-kind" {...register('kind')}>
                {(['lcv', 'pickup', 'truck'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`enum.vehicleKind.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="av-fuel">{t('admin.fuel.type')}</Label>
              <NativeSelect id="av-fuel" {...register('fuelType')}>
                <option value="diesel">{t('enum.fuelType.diesel')}</option>
                <option value="petrol">{t('enum.fuelType.petrol')}</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="av-cap">{t('admin.vehicles.capacity')}</Label>
              <Input id="av-cap" inputMode="decimal" aria-invalid={!!formState.errors.capacityT} {...register('capacityT')} />
              <FieldError>{err('capacityT')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="av-year">{t('admin.vehicles.year')}</Label>
              <Input id="av-year" inputMode="numeric" aria-invalid={!!formState.errors.year} {...register('year')} />
              <FieldError>{err('year')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="av-kmpl">{t('admin.vehicles.mileage')}</Label>
              <Input id="av-kmpl" inputMode="decimal" aria-invalid={!!formState.errors.mileageKmpl} {...register('mileageKmpl')} />
              <FieldError>{err('mileageKmpl')}</FieldError>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('admin.vehicles.add')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AssignDriverDialog({ vehicle, onOpenChange }: { vehicle: Vehicle | null; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const drivers = useApp((s) => s.drivers);
  const vehicles = useApp((s) => s.vehicles);
  const [choice, setChoice] = useState<string | null>(null);
  if (!vehicle) return null;
  const current = choice ?? vehicle.driverId ?? '';
  const save = () => {
    if (current) useApp.getState().assignVehicle(current, vehicle.id);
    else if (vehicle.driverId) useApp.getState().assignVehicle(vehicle.driverId, null);
    const name = drivers.find((d) => d.id === current)?.name;
    toast.success(name ? t('admin.drivers.assigned', { name, reg: vehicle.reg }) : t('admin.vehicles.driverRemoved', { reg: vehicle.reg }));
    onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.vehicles.assignDriver')}</DialogTitle>
          <DialogDescription>{vehicle.reg}</DialogDescription>
        </DialogHeader>
        <div className="scroll-thin max-h-[50vh] space-y-1.5 overflow-y-auto pr-1" role="radiogroup">
          <button role="radio" aria-checked={current === ''} onClick={() => setChoice('')} className={cn('flex w-full items-center rounded-lg border px-3 py-2.5 text-left text-sm', current === '' ? 'border-primary bg-primary/5' : 'hover:bg-accent')}>
            {t('admin.vehicles.noDriver')}
          </button>
          {drivers
            .filter((d) => d.status === 'active')
            .map((d) => {
              const has = vehicles.find((v) => v.id === d.vehicleId && v.id !== vehicle.id);
              return (
                <button key={d.id} role="radio" aria-checked={current === d.id} onClick={() => setChoice(d.id)} className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm', current === d.id ? 'border-primary bg-primary/5' : 'hover:bg-accent')}>
                  <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-[11px] font-bold">{initials(d.name)}</span>
                  <span className="flex-1 font-medium">{d.name}</span>
                  <span className="text-xs text-muted-foreground">{has ? has.reg : t('admin.vehicles.free')}</span>
                </button>
              );
            })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
