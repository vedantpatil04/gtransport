import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { CITY_IDS, routeLengthKm } from '@/data/geo';
import { GOODS } from '@/data/constants';
import { LANGUAGES } from '@/i18n';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import type { Driver, Lang } from '@/types';

const driverSchema = z.object({
  name: z.string().trim().min(3, 'admin.drivers.errName'),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'admin.drivers.errPhone'),
  language: z.enum(['en', 'hi', 'kn', 'mr', 'ta', 'te']),
  baseSalary: z.coerce.number().min(5000, 'admin.drivers.errSalary').max(100000, 'admin.drivers.errSalary'),
  homeTown: z.string().trim().min(2, 'admin.drivers.errTown'),
  vehicleId: z.string(),
});
type DriverValues = z.infer<typeof driverSchema>;

export function AddDriverDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (d: Driver) => void }) {
  const { t } = useTranslation();
  const vehicles = useApp((s) => s.vehicles);
  const free = vehicles.filter((v) => !v.driverId && v.status !== 'maintenance');
  const { register, handleSubmit, formState, reset } = useForm<DriverValues>({
    resolver: zodResolver(driverSchema),
    defaultValues: { name: '', phone: '', language: 'kn', baseSalary: 18000, homeTown: '', vehicleId: '' },
  });
  const err = (k: keyof DriverValues) => (formState.errors[k]?.message ? t(String(formState.errors[k]?.message)) : undefined);
  const submit = (v: DriverValues) => {
    const d = useApp.getState().addDriver({ name: v.name.trim(), phone: v.phone, language: v.language as Lang, baseSalary: v.baseSalary, homeTown: v.homeTown.trim(), vehicleId: v.vehicleId || null });
    toast.success(t('admin.drivers.added', { name: d.name }));
    reset();
    onOpenChange(false);
    onCreated?.(d);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.drivers.add')}</DialogTitle>
          <DialogDescription>{t('admin.drivers.addHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ad-name">{t('admin.drivers.name')}</Label>
              <Input id="ad-name" aria-invalid={!!formState.errors.name} {...register('name')} />
              <FieldError>{err('name')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-phone">{t('admin.drivers.phone')}</Label>
              <Input id="ad-phone" inputMode="numeric" maxLength={10} placeholder="98XXXXXXXX" aria-invalid={!!formState.errors.phone} {...register('phone')} />
              <FieldError>{err('phone')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-lang">{t('admin.drivers.language')}</Label>
              <NativeSelect id="ad-lang" {...register('language')}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.native} · {l.english}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-salary">{t('admin.drivers.salary')} (₹)</Label>
              <Input id="ad-salary" inputMode="numeric" aria-invalid={!!formState.errors.baseSalary} {...register('baseSalary')} />
              <FieldError>{err('baseSalary')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-town">{t('admin.drivers.homeTown')}</Label>
              <Input id="ad-town" aria-invalid={!!formState.errors.homeTown} {...register('homeTown')} />
              <FieldError>{err('homeTown')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-vehicle">{t('admin.common.vehicle')}</Label>
              <NativeSelect id="ad-vehicle" {...register('vehicleId')}>
                <option value="">{t('admin.drivers.assignLater')}</option>
                {free.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.reg} · {v.model}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('admin.drivers.add')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AssignVehicleDialog({ driver, onOpenChange }: { driver: Driver | null; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const vehicles = useApp((s) => s.vehicles);
  const drivers = useApp((s) => s.drivers);
  const [choice, setChoice] = useState<string | null>(null);
  if (!driver) return null;
  const current = choice ?? driver.vehicleId ?? '';
  const save = () => {
    useApp.getState().assignVehicle(driver.id, current || null);
    const reg = vehicles.find((v) => v.id === current)?.reg;
    toast.success(reg ? t('admin.drivers.assigned', { name: driver.name, reg }) : t('admin.drivers.unassigned', { name: driver.name }));
    setChoice(null);
    onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={(v) => { setChoice(null); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.drivers.assignVehicle')}</DialogTitle>
          <DialogDescription>{t('admin.drivers.assignHint', { name: driver.name })}</DialogDescription>
        </DialogHeader>
        <div className="scroll-thin max-h-[50vh] space-y-1.5 overflow-y-auto pr-1" role="radiogroup">
          <button role="radio" aria-checked={current === ''} onClick={() => setChoice('')} className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm', current === '' ? 'border-primary bg-primary/5' : 'hover:bg-accent')}>
            {t('admin.drivers.noVehicle')}
          </button>
          {vehicles.map((v) => {
            const holder = drivers.find((d) => d.id === v.driverId && d.id !== driver.id);
            return (
              <button key={v.id} role="radio" aria-checked={current === v.id} onClick={() => setChoice(v.id)} className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm', current === v.id ? 'border-primary bg-primary/5' : 'hover:bg-accent')}>
                <Plate reg={v.reg} size="xs" />
                <span className="min-w-0 flex-1 truncate">{v.model}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{holder ? t('admin.drivers.withDriver', { name: holder.name }) : v.status === 'maintenance' ? t('enum.vehicleStatus.maintenance') : t('admin.vehicles.unassigned')}</span>
              </button>
            );
          })}
        </div>
        {(() => {
          const holder = drivers.find((d) => d.id === vehicles.find((v) => v.id === current)?.driverId && d.id !== driver.id);
          return holder ? <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">{t('admin.drivers.reassignWarn', { name: holder.name })}</p> : null;
        })()}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} data-testid="assign-save">
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignTripDialog({ driver, onOpenChange }: { driver: Driver | null; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ from: 'belagavi', to: 'pune', goods: GOODS[0] as string });
  const [error, setError] = useState<string | null>(null);
  if (!driver) return null;
  const km = Math.round(routeLengthKm([v.from, v.to]));
  const save = () => {
    if (v.from === v.to) return setError(t('admin.drivers.errTrip'));
    if (!driver.vehicleId) return setError(t('admin.drivers.errTripVehicle'));
    useApp.getState().assignTrip({ driverId: driver.id, from: v.from, to: v.to, goods: v.goods, distanceKm: km });
    toast.success(t('admin.drivers.tripAssigned', { name: driver.name }));
    onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.drivers.assignTrip')}</DialogTitle>
          <DialogDescription>{driver.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tr-from">{t('admin.drivers.from')}</Label>
            <NativeSelect id="tr-from" value={v.from} onChange={(e) => { setV({ ...v, from: e.target.value }); setError(null); }}>
              {CITY_IDS.map((c) => (
                <option key={c} value={c}>
                  {t(`city.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-to">{t('admin.drivers.to')}</Label>
            <NativeSelect id="tr-to" value={v.to} onChange={(e) => { setV({ ...v, to: e.target.value }); setError(null); }}>
              {CITY_IDS.map((c) => (
                <option key={c} value={c}>
                  {t(`city.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tr-goods">{t('admin.drivers.goods')}</Label>
            <NativeSelect id="tr-goods" value={v.goods} onChange={(e) => setV({ ...v, goods: e.target.value })}>
              {GOODS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t('admin.drivers.approxDistance', { km })}</p>
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save}>{t('admin.drivers.assignTrip')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
