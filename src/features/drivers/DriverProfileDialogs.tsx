import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { driversApi, employeesApi, vehiclesApi } from '@/features/api/resources';
import type { ApiDriver, ApiEmployee, ApiVehicle } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { InlineBusy } from '../admin/components/states';

/**
 * Creates a driver profile on top of an existing employee. There is deliberately no way to
 * create a "driver" from scratch here: the person must already exist as an employee, which
 * is what stops the same person being recorded twice.
 */
export function CreateDriverProfileDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (driver: ApiDriver) => void;
}) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceExpiryDate, setLicenceExpiryDate] = useState('');
  const [homeTown, setHomeTown] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Employees who do not have a driver profile yet are the only valid choices.
  const candidates = useApiResource(() => employeesApi.list({ status: 'ACTIVE', limit: 100 }), [open], open);
  const available = useMemo(
    () => (candidates.data?.data ?? []).filter((employee: ApiEmployee) => !employee.driver),
    [candidates.data],
  );

  useEffect(() => {
    if (open) {
      setEmployeeId('');
      setLicenceNumber('');
      setLicenceExpiryDate('');
      setHomeTown('');
      setError(null);
    }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!employeeId) return setError(t('admin.driversApi.errEmployee'));
    setBusy(true);
    setError(null);
    try {
      const driver = await driversApi.create({
        employeeId,
        licenceNumber: licenceNumber || undefined,
        licenceExpiryDate: licenceExpiryDate || undefined,
        homeTown: homeTown || undefined,
      });
      toast.success(t('admin.driversApi.created', { name: driver.employee.fullName }));
      onCreated(driver);
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
          <DialogTitle>{t('admin.driversApi.add')}</DialogTitle>
          <DialogDescription>{t('admin.driversApi.addHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dp-employee">{t('admin.driversApi.employee')}</Label>
            {candidates.loading ? (
              <InlineBusy label={t('common.loading')} />
            ) : (
              <NativeSelect id="dp-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{t('admin.driversApi.chooseEmployee')}</option>
                {available.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName} · {employee.employeeCode}
                  </option>
                ))}
              </NativeSelect>
            )}
            {!candidates.loading && available.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('admin.driversApi.noCandidates')}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dp-licence">{t('admin.driversApi.licence')}</Label>
              <Input id="dp-licence" value={licenceNumber} onChange={(e) => setLicenceNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dp-expiry">{t('admin.driversApi.licenceExpiry')}</Label>
              <Input id="dp-expiry" type="date" value={licenceExpiryDate} onChange={(e) => setLicenceExpiryDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="dp-home">{t('admin.driversApi.homeTown')}</Label>
              <Input id="dp-home" value={homeTown} onChange={(e) => setHomeTown(e.target.value)} />
            </div>
          </div>
          <FieldError>{error ?? undefined}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || available.length === 0}>
              {busy ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edits the driving-specific fields. Personal details live on the employee record. */
export function EditDriverDialog({
  driver,
  open,
  onOpenChange,
  onSaved,
}: {
  driver: ApiDriver;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [licenceNumber, setLicenceNumber] = useState(driver.licenceNumber ?? '');
  const [licenceExpiryDate, setLicenceExpiryDate] = useState(driver.licenceExpiryDate ?? '');
  const [homeTown, setHomeTown] = useState(driver.homeTown ?? '');
  const [contactName, setContactName] = useState(driver.emergencyContact.name ?? '');
  const [contactPhone, setContactPhone] = useState(driver.emergencyContact.phone ?? '');
  const [sharing, setSharing] = useState(driver.locationSharingEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLicenceNumber(driver.licenceNumber ?? '');
    setLicenceExpiryDate(driver.licenceExpiryDate ?? '');
    setHomeTown(driver.homeTown ?? '');
    setContactName(driver.emergencyContact.name ?? '');
    setContactPhone(driver.emergencyContact.phone ?? '');
    setSharing(driver.locationSharingEnabled);
    setError(null);
  }, [open, driver]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await driversApi.update(driver.id, {
        licenceNumber,
        licenceExpiryDate: licenceExpiryDate || undefined,
        homeTown,
        emergencyContactName: contactName,
        emergencyContactPhone: contactPhone,
        locationSharingEnabled: sharing,
      });
      toast.success(t('admin.driversApi.updated', { name: driver.employee.fullName }));
      onSaved();
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
          <DialogTitle>{t('admin.driversApi.editTitle')}</DialogTitle>
          <DialogDescription>{t('admin.driversApi.editHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ed-licence">{t('admin.driversApi.licence')}</Label>
              <Input id="ed-licence" value={licenceNumber} onChange={(e) => setLicenceNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-expiry">{t('admin.driversApi.licenceExpiry')}</Label>
              <Input id="ed-expiry" type="date" value={licenceExpiryDate} onChange={(e) => setLicenceExpiryDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-home">{t('admin.driversApi.homeTown')}</Label>
              <Input id="ed-home" value={homeTown} onChange={(e) => setHomeTown(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-contact">{t('admin.driversApi.emergencyName')}</Label>
              <Input id="ed-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-contact-phone">{t('admin.driversApi.emergencyPhone')}</Label>
              <Input id="ed-contact-phone" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('admin.driversApi.locationSharing')}</p>
              <p className="text-xs text-muted-foreground">{t('admin.driversApi.locationSharingHint')}</p>
            </div>
            <Switch checked={sharing} onCheckedChange={setSharing} aria-label={t('admin.driversApi.locationSharing')} />
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

/**
 * Assigns this driver to a vehicle, or releases the one they hold. Reassignment closes the
 * open assignment on the server and opens a new one, so history is preserved automatically.
 */
export function AssignVehicleToDriverDialog({
  driver,
  open,
  onOpenChange,
  onDone,
}: {
  driver: ApiDriver;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [vehicleId, setVehicleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicles = useApiResource(() => vehiclesApi.list({ limit: 100 }), [open], open);
  const selectable = useMemo(
    () =>
      (vehicles.data?.data ?? []).filter(
        (vehicle: ApiVehicle) =>
          vehicle.status !== 'RETIRED' && (!vehicle.currentAssignment || vehicle.currentAssignment.driver.id === driver.id),
      ),
    [vehicles.data, driver.id],
  );

  useEffect(() => {
    if (open) {
      setVehicleId(driver.currentAssignment?.vehicle.id ?? '');
      setError(null);
    }
  }, [open, driver]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vehicleId) return setError(t('admin.driversApi.errVehicle'));
    setBusy(true);
    setError(null);
    try {
      await vehiclesApi.assignDriver(vehicleId, driver.id);
      toast.success(t('admin.driversApi.assigned', { name: driver.employee.fullName }));
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('admin.api.errorTitle'));
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    if (!driver.currentAssignment) return;
    setBusy(true);
    try {
      await vehiclesApi.unassignDriver(driver.currentAssignment.vehicle.id);
      toast.success(t('admin.driversApi.released', { name: driver.employee.fullName }));
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
          <DialogTitle>{t('admin.drivers.assignVehicle')}</DialogTitle>
          <DialogDescription>{t('admin.driversApi.assignHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="av-vehicle">{t('admin.common.vehicle')}</Label>
            {vehicles.loading ? (
              <InlineBusy label={t('common.loading')} />
            ) : (
              <NativeSelect id="av-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">{t('admin.driversApi.chooseVehicle')}</option>
                {selectable.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registrationNumber}
                    {vehicle.model ? ` · ${vehicle.model}` : ''}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
          <FieldError>{error ?? undefined}</FieldError>
          <DialogFooter>
            {driver.currentAssignment && (
              <Button type="button" variant="destructive" onClick={() => void release()} disabled={busy}>
                {t('admin.driversApi.release')}
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
