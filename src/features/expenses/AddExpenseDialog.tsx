import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { FilePicker } from '@/components/media/FilePicker';
import { EXPENSE_CATEGORIES } from '@/data/constants';
import { todayISO } from '@/lib/dates';
import { inr } from '@/lib/format';
import { useApp } from '@/store';
import type { ExpenseCategory, FileRef } from '@/types';

export function AddExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const vehicles = useApp((s) => s.vehicles);
  const [v, setV] = useState({ vehicleId: '', category: 'maintenance' as ExpenseCategory, amount: '', note: '', date: todayISO() });
  const [bill, setBill] = useState<FileRef | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () => {
    const e: Record<string, string> = {};
    if (!v.vehicleId) e.vehicleId = t('admin.expenses.errVehicle');
    if (!(Number(v.amount) > 0)) e.amount = t('admin.payments.errAmount');
    if (v.note.trim().length < 3) e.note = t('admin.expenses.errNote');
    if (v.date > todayISO()) e.date = t('driver.fuel.errDate');
    setErrors(e);
    if (Object.keys(e).length) return;
    const vehicle = vehicles.find((x) => x.id === v.vehicleId)!;
    const exp = useApp.getState().recordExpense({ vehicleId: vehicle.id, driverId: vehicle.driverId ?? '', category: v.category, amount: Number(v.amount), note: v.note.trim(), date: v.date, receipt: bill });
    toast.success(t('admin.expenses.recorded'), { description: `${inr(exp.amount)} · ${vehicle.reg}` });
    setV({ vehicleId: '', category: 'maintenance', amount: '', note: '', date: todayISO() });
    setBill(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin.expenses.add')}</DialogTitle>
          <DialogDescription>{t('admin.expenses.addHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ae-vehicle">{t('admin.common.vehicle')}</Label>
            <NativeSelect id="ae-vehicle" value={v.vehicleId} onChange={(e) => setV({ ...v, vehicleId: e.target.value })} aria-invalid={!!errors.vehicleId}>
              <option value="">{t('common.select')}</option>
              {vehicles.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.reg}
                </option>
              ))}
            </NativeSelect>
            <FieldError>{errors.vehicleId}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ae-cat">{t('admin.expenses.category')}</Label>
            <NativeSelect id="ae-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as ExpenseCategory })}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`enum.category.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ae-amount">{t('admin.common.amount')} (₹)</Label>
            <Input id="ae-amount" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value.replace(/[^\d.]/g, '') })} aria-invalid={!!errors.amount} />
            <FieldError>{errors.amount}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ae-date">{t('admin.common.date')}</Label>
            <Input id="ae-date" type="date" max={todayISO()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} aria-invalid={!!errors.date} />
            <FieldError>{errors.date}</FieldError>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ae-note">{t('common.note')}</Label>
            <Input id="ae-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder={t('admin.expenses.notePlaceholder')} aria-invalid={!!errors.note} />
            <FieldError>{errors.note}</FieldError>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>
              {t('admin.expenses.bill')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
            </Label>
            <FilePicker value={bill} onChange={setBill} purpose="receipt" variant="admin" labels={{ camera: t('driver.receipt.takePhoto'), gallery: t('driver.receipt.gallery'), done: t('driver.receipt.uploaded') }} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save}>{t('admin.expenses.add')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
