import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { fuelApi } from '@/features/api/resources';
import type { ApiFuelEntry } from '@/features/api/types';
import { ApiError } from '@/lib/api/client';
import { todayISO } from '@/lib/dates';

type FuelForm = { fuelType: string; amount: string; litres: string; fuelStation: string; transactionDate: string; notes: string };

/** At most `places` decimals and above zero — the same rules the API applies. */
const positive = (value: string, places: number) => new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(value.trim()) && Number(value) > 0;

/**
 * Office correction of a recorded fill-up (PATCH /fuel/:id). The driver and vehicle stay as
 * recorded; the server re-derives the rate, re-posts the ledger and keeps the audit trail. Only
 * shown to the roles the API lets edit fuel, and only for active entries (archived ones are
 * restored first).
 */
export function FuelEditDialog({ entry, onOpenChange, onSaved }: { entry: ApiFuelEntry | null; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FuelForm>({ fuelType: 'DIESEL', amount: '', litres: '', fuelStation: '', transactionDate: '', notes: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof FuelForm | 'form', string>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setForm({
      fuelType: entry.fuelType,
      amount: String(Number(entry.amount)),
      litres: String(Number(entry.litres)),
      fuelStation: entry.fuelStation,
      transactionDate: entry.transactionDate.slice(0, 10),
      notes: entry.notes ?? '',
    });
    setErrors({});
  }, [entry]);

  const set = (key: keyof FuelForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = (): typeof errors => {
    const found: typeof errors = {};
    if (!positive(form.amount, 2)) found.amount = t('admin.fuelApi.errAmount');
    if (!positive(form.litres, 3)) found.litres = t('admin.fuelApi.errLitres');
    if (!form.fuelStation.trim()) found.fuelStation = t('admin.fuelApi.errStation');
    if (!form.transactionDate) found.transactionDate = t('admin.fuelApi.errDate');
    else if (form.transactionDate > todayISO()) found.transactionDate = t('admin.fuelApi.errFutureDate');
    return found;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!entry || busy) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    try {
      await fuelApi.update(entry.id, {
        fuelType: form.fuelType,
        amount: Number(form.amount),
        litres: Number(form.litres),
        fuelStation: form.fuelStation.trim(),
        transactionDate: form.transactionDate,
        notes: form.notes.trim() || undefined,
      });
      toast.success(t('admin.fuel.updated'));
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fields = cause.fieldErrors;
        setErrors(Object.keys(fields).length ? fields : { form: cause.message });
      } else {
        setErrors({ form: t('common.somethingWrong') });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('admin.fuelApi.editTitle')}</DialogTitle>
          <DialogDescription>{t('admin.fuelApi.editHint')}</DialogDescription>
        </DialogHeader>
        {entry && (
          <form onSubmit={submit} noValidate className="space-y-4" data-testid="fuel-edit-form">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
              <Plate reg={entry.vehicle.registrationNumber} size="xs" />
              <span className="font-medium">{entry.driver.fullName}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fe-type">{t('admin.fuel.type')}</Label>
                <NativeSelect id="fe-type" value={form.fuelType} onChange={set('fuelType')}>
                  <option value="DIESEL">{t('enum.fuelType.diesel')}</option>
                  <option value="PETROL">{t('enum.fuelType.petrol')}</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fe-date">{t('admin.common.date')}</Label>
                <Input id="fe-date" type="date" max={todayISO()} value={form.transactionDate} onChange={set('transactionDate')} aria-invalid={Boolean(errors.transactionDate)} />
                <FieldError>{errors.transactionDate}</FieldError>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fe-amount">{`${t('admin.common.amount')} (₹)`}</Label>
                <Input id="fe-amount" inputMode="decimal" value={form.amount} onChange={set('amount')} aria-invalid={Boolean(errors.amount)} />
                <FieldError>{errors.amount}</FieldError>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fe-litres">{t('admin.fuel.litres')}</Label>
                <Input id="fe-litres" inputMode="decimal" value={form.litres} onChange={set('litres')} aria-invalid={Boolean(errors.litres)} />
                <FieldError>{errors.litres}</FieldError>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fe-station">{t('admin.fuel.station')}</Label>
              <Input id="fe-station" maxLength={120} value={form.fuelStation} onChange={set('fuelStation')} aria-invalid={Boolean(errors.fuelStation)} />
              <FieldError>{errors.fuelStation}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fe-notes">
                {t('common.note')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
              </Label>
              <Textarea id="fe-notes" rows={2} maxLength={1000} value={form.notes} onChange={set('notes')} />
            </div>
            <FieldError>{errors.form}</FieldError>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy} data-testid="fuel-edit-save">
                {busy ? t('common.loading') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
