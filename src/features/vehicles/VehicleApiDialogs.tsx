import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { driversApi, vehiclesApi } from '@/features/api/resources';
import type { ApiDriver, ApiVehicle } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { InlineBusy } from '../admin/components/states';

/** Creates a vehicle, or edits one when `vehicle` is supplied. */
export function VehicleFormDialog({
  vehicle,
  open,
  onOpenChange,
  onSaved,
}: {
  vehicle?: ApiVehicle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (vehicle: ApiVehicle) => void;
}) {
  const { t } = useTranslation();
  const editing = Boolean(vehicle);

  const [form, setForm] = useState({
    registrationNumber: '',
    kind: 'TRUCK',
    fuelType: 'DIESEL',
    make: '',
    model: '',
    variant: '',
    manufactureYear: '',
    capacityTonnes: '',
    mileageKmpl: '',
    ownership: 'OWNED',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setForm({
      registrationNumber: vehicle?.registrationNumber ?? '',
      kind: vehicle?.kind ?? 'TRUCK',
      fuelType: vehicle?.fuelType ?? 'DIESEL',
      make: vehicle?.make ?? '',
      model: vehicle?.model ?? '',
      variant: vehicle?.variant ?? '',
      manufactureYear: vehicle?.manufactureYear ? String(vehicle.manufactureYear) : '',
      capacityTonnes: vehicle?.capacityTonnes ?? '',
      mileageKmpl: vehicle?.mileageKmpl ?? '',
      ownership: vehicle?.ownership ?? 'OWNED',
      notes: vehicle?.notes ?? '',
    });
    setError(null);
    setFieldErrors({});
  }, [open, vehicle]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const numeric = (value: string) => (value.trim() === '' ? undefined : Number(value));
    const text = (value: string) => (value.trim() === '' ? undefined : value.trim());

    const payload: Record<string, unknown> = {
      registrationNumber: form.registrationNumber.trim(),
      kind: form.kind,
      fuelType: form.fuelType,
      make: text(form.make),
      model: text(form.model),
      variant: text(form.variant),
      manufactureYear: numeric(form.manufactureYear),
      capacityTonnes: numeric(form.capacityTonnes),
      mileageKmpl: numeric(form.mileageKmpl),
      ownership: form.ownership,
      notes: text(form.notes),
    };

    try {
      const saved = vehicle ? await vehiclesApi.update(vehicle.id, payload) : await vehiclesApi.create(payload);
      toast.success(t(editing ? 'admin.vehiclesApi.updated' : 'admin.vehicles.added', { reg: saved.registrationNumber }));
      onSaved(saved);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFieldErrors(cause.fieldErrors);
        if (Object.keys(cause.fieldErrors).length === 0) setError(cause.message);
      } else {
        setError(t('admin.api.errorTitle'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('admin.vehiclesApi.editTitle') : t('admin.vehicles.add')}</DialogTitle>
          <DialogDescription>{t('admin.vehicles.addHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vf-reg">{t('admin.vehicles.reg')}</Label>
              <Input id="vf-reg" className="uppercase" placeholder="KA 22 MN 4455" value={form.registrationNumber} onChange={set('registrationNumber')} />
              <FieldError>{fieldErrors.registrationNumber}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vf-kind">{t('admin.vehicles.kind')}</Label>
              <NativeSelect id="vf-kind" value={form.kind} onChange={set('kind')}>
                <option value="LCV">{t('enum.vehicleKind.lcv')}</option>
                <option value="PICKUP">{t('enum.vehicleKind.pickup')}</option>
                <option value="TRUCK">{t('enum.vehicleKind.truck')}</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vf-make">{t('admin.vehiclesApi.make')}</Label>
              <Input id="vf-make" placeholder="Tata" value={form.make} onChange={set('make')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vf-model">{t('admin.vehicles.model')}</Label>
              <Input id="vf-model" placeholder="407 Gold SFC" value={form.model} onChange={set('model')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vf-variant">{t('admin.vehiclesApi.variant')}</Label>
              <Input id="vf-variant" value={form.variant} onChange={set('variant')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vf-fuel">{t('admin.fuel.type')}</Label>
              <NativeSelect id="vf-fuel" value={form.fuelType} onChange={set('fuelType')}>
                <option value="DIESEL">{t('enum.fuelType.diesel')}</option>
                <option value="PETROL">{t('enum.fuelType.petrol')}</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vf-year">{t('admin.vehicles.year')}</Label>
              <Input id="vf-year" inputMode="numeric" value={form.manufactureYear} onChange={set('manufactureYear')} />
              <FieldError>{fieldErrors.manufactureYear}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vf-capacity">{t('admin.vehicles.capacity')}</Label>
              <Input id="vf-capacity" inputMode="decimal" value={form.capacityTonnes} onChange={set('capacityTonnes')} />
              <FieldError>{fieldErrors.capacityTonnes}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vf-mileage">{t('admin.vehicles.mileage')}</Label>
              <Input id="vf-mileage" inputMode="decimal" value={form.mileageKmpl} onChange={set('mileageKmpl')} />
              <FieldError>{fieldErrors.mileageKmpl}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vf-ownership">{t('admin.vehiclesApi.ownership')}</Label>
              <NativeSelect id="vf-ownership" value={form.ownership} onChange={set('ownership')}>
                <option value="OWNED">{t('admin.enum.ownership.OWNED')}</option>
                <option value="FINANCED">{t('admin.enum.ownership.FINANCED')}</option>
              </NativeSelect>
            </div>
          </div>
          <FieldError>{error ?? undefined}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Loan terms. Only reachable for financed vehicles; the API refuses them for owned ones. */
export function FinancingDialog({
  vehicle,
  open,
  onOpenChange,
  onSaved,
}: {
  vehicle: ApiVehicle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const financing = vehicle.financing;

  const [form, setForm] = useState({
    lenderName: '',
    loanAccountNumber: '',
    loanAmount: '',
    downPayment: '',
    financeStartDate: '',
    tenureMonths: '',
    interestRatePct: '',
    emiAmount: '',
    totalInstallments: '',
    paidInstallments: '',
    nextDueDate: '',
    financeEndDate: '',
    status: 'ACTIVE',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setForm({
      lenderName: financing?.lenderName ?? '',
      loanAccountNumber: financing?.loanAccountNumber ?? '',
      loanAmount: financing?.loanAmount ?? '',
      downPayment: financing?.downPayment ?? '',
      financeStartDate: financing?.financeStartDate ?? '',
      tenureMonths: financing?.tenureMonths ? String(financing.tenureMonths) : '',
      interestRatePct: financing?.interestRatePct ?? '',
      emiAmount: financing?.emiAmount ?? '',
      totalInstallments: financing?.totalInstallments ? String(financing.totalInstallments) : '',
      paidInstallments: financing?.paidInstallments !== null && financing?.paidInstallments !== undefined ? String(financing.paidInstallments) : '',
      nextDueDate: financing?.nextDueDate ?? '',
      financeEndDate: financing?.financeEndDate ?? '',
      status: financing?.status ?? 'ACTIVE',
    });
    setError(null);
    setFieldErrors({});
  }, [open, financing]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  /** Live preview so the office can sanity-check the EMI before saving. */
  const preview = useMemo(() => {
    const principal = Number(form.loanAmount);
    const rate = Number(form.interestRatePct);
    const tenure = Number(form.tenureMonths);
    if (!principal || !tenure || Number.isNaN(rate)) return null;
    const monthly = rate / 12 / 100;
    const emi = monthly === 0 ? principal / tenure : (principal * monthly * Math.pow(1 + monthly, tenure)) / (Math.pow(1 + monthly, tenure) - 1);
    return Math.round(emi * 100) / 100;
  }, [form.loanAmount, form.interestRatePct, form.tenureMonths]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const numeric = (value: string) => (value.trim() === '' ? undefined : Number(value));
    const text = (value: string) => (value.trim() === '' ? undefined : value.trim());

    try {
      await vehiclesApi.saveFinancing(vehicle.id, {
        lenderName: text(form.lenderName),
        loanAccountNumber: text(form.loanAccountNumber),
        loanAmount: numeric(form.loanAmount),
        downPayment: numeric(form.downPayment),
        financeStartDate: text(form.financeStartDate),
        tenureMonths: numeric(form.tenureMonths),
        interestRatePct: numeric(form.interestRatePct),
        emiAmount: numeric(form.emiAmount),
        totalInstallments: numeric(form.totalInstallments),
        paidInstallments: numeric(form.paidInstallments),
        nextDueDate: text(form.nextDueDate),
        financeEndDate: text(form.financeEndDate),
        status: form.status,
      });
      toast.success(t('admin.vehiclesApi.financeSaved', { reg: vehicle.registrationNumber }));
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFieldErrors(cause.fieldErrors);
        if (Object.keys(cause.fieldErrors).length === 0) setError(cause.message);
      } else {
        setError(t('admin.api.errorTitle'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('admin.vehiclesApi.financeTitle')}</DialogTitle>
          <DialogDescription>{t('admin.vehiclesApi.financeHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fd-lender">{t('admin.vehiclesApi.lender')}</Label>
              <Input id="fd-lender" value={form.lenderName} onChange={set('lenderName')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-account">{t('admin.vehiclesApi.loanAccount')}</Label>
              <Input id="fd-account" value={form.loanAccountNumber} onChange={set('loanAccountNumber')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-amount">{t('admin.vehiclesApi.loanAmount')}</Label>
              <Input id="fd-amount" inputMode="decimal" value={form.loanAmount} onChange={set('loanAmount')} />
              <FieldError>{fieldErrors.loanAmount}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-down">{t('admin.vehiclesApi.downPayment')}</Label>
              <Input id="fd-down" inputMode="decimal" value={form.downPayment} onChange={set('downPayment')} />
              <FieldError>{fieldErrors.downPayment}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-start">{t('admin.vehiclesApi.financeStart')}</Label>
              <Input id="fd-start" type="date" value={form.financeStartDate} onChange={set('financeStartDate')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-tenure">{t('admin.vehiclesApi.tenure')}</Label>
              <Input id="fd-tenure" inputMode="numeric" value={form.tenureMonths} onChange={set('tenureMonths')} />
              <FieldError>{fieldErrors.tenureMonths}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-rate">{t('admin.vehiclesApi.rate')}</Label>
              <Input id="fd-rate" inputMode="decimal" value={form.interestRatePct} onChange={set('interestRatePct')} />
              <FieldError>{fieldErrors.interestRatePct}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-emi">{t('admin.vehiclesApi.emi')}</Label>
              <Input id="fd-emi" inputMode="decimal" placeholder={preview ? String(preview) : undefined} value={form.emiAmount} onChange={set('emiAmount')} />
              {preview !== null && <p className="text-xs text-muted-foreground">{t('admin.vehiclesApi.emiPreview', { amount: preview.toLocaleString('en-IN') })}</p>}
              <FieldError>{fieldErrors.emiAmount}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-total">{t('admin.vehiclesApi.totalInstallments')}</Label>
              <Input id="fd-total" inputMode="numeric" value={form.totalInstallments} onChange={set('totalInstallments')} />
              <FieldError>{fieldErrors.totalInstallments}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-paid">{t('admin.vehiclesApi.paidInstallments')}</Label>
              <Input id="fd-paid" inputMode="numeric" value={form.paidInstallments} onChange={set('paidInstallments')} />
              <FieldError>{fieldErrors.paidInstallments}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-due">{t('admin.vehiclesApi.nextDue')}</Label>
              <Input id="fd-due" type="date" value={form.nextDueDate} onChange={set('nextDueDate')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-end">{t('admin.vehiclesApi.financeEnd')}</Label>
              <Input id="fd-end" type="date" value={form.financeEndDate} onChange={set('financeEndDate')} />
              <FieldError>{fieldErrors.financeEndDate}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-status">{t('admin.vehiclesApi.financeStatus')}</Label>
              <NativeSelect id="fd-status" value={form.status} onChange={set('status')}>
                {(['ACTIVE', 'COMPLETED', 'CLOSED', 'DEFAULTED'] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.enum.financeStatus.${value}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <FieldError>{error ?? undefined}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Assigns a driver to this vehicle, or releases the current one. */
export function AssignDriverToVehicleDialog({
  vehicle,
  open,
  onOpenChange,
  onDone,
}: {
  vehicle: ApiVehicle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only active drivers can take a vehicle, and only if they are free (or already on this one).
  const drivers = useApiResource(() => driversApi.list({ status: 'ACTIVE', limit: 100 }), [open], open);
  const selectable = useMemo(
    () =>
      (drivers.data?.data ?? []).filter(
        (driver: ApiDriver) => !driver.currentAssignment || driver.currentAssignment.vehicle.id === vehicle.id,
      ),
    [drivers.data, vehicle.id],
  );

  useEffect(() => {
    if (open) {
      setDriverId(vehicle.currentAssignment?.driver.id ?? '');
      setError(null);
    }
  }, [open, vehicle]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!driverId) return setError(t('admin.vehiclesApi.errDriver'));
    setBusy(true);
    setError(null);
    try {
      await vehiclesApi.assignDriver(vehicle.id, driverId);
      toast.success(t('admin.vehiclesApi.assigned', { reg: vehicle.registrationNumber }));
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('admin.api.errorTitle'));
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    try {
      await vehiclesApi.unassignDriver(vehicle.id);
      toast.success(t('admin.vehiclesApi.released', { reg: vehicle.registrationNumber }));
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('admin.api.errorTitle'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.vehicles.assignDriver')}</DialogTitle>
          <DialogDescription>{t('admin.vehiclesApi.assignHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ad-driver">{t('admin.common.driver')}</Label>
            {drivers.loading ? (
              <InlineBusy label={t('common.loading')} />
            ) : (
              <NativeSelect id="ad-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">{t('admin.vehiclesApi.chooseDriver')}</option>
                {selectable.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.employee.fullName} · {driver.driverCode}
                  </option>
                ))}
              </NativeSelect>
            )}
            {!drivers.loading && selectable.length === 0 && <p className="text-xs text-muted-foreground">{t('admin.vehiclesApi.noFreeDrivers')}</p>}
          </div>
          <FieldError>{error ?? undefined}</FieldError>
          <DialogFooter>
            {vehicle.currentAssignment && (
              <Button type="button" variant="destructive" onClick={() => void release()} disabled={busy}>
                {t('admin.vehiclesApi.release')}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
