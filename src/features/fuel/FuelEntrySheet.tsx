import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FileView } from '@/components/media/FileView';
import { ConfirmDialog, DetailList, DriverCell } from '@/features/admin/components/ui';
import { fmtDate, fmtDateTime, inr, num } from '@/lib/format';
import { todayISO } from '@/lib/dates';
import { useApp } from '@/store';
import type { FuelEntry, FuelType } from '@/types';

export function FuelEntrySheet({ entryId, onClose }: { entryId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const entry = useApp((s) => s.fuel.find((f) => f.id === entryId));
  const driver = useApp((s) => s.drivers.find((d) => d.id === entry?.driverId));
  const vehicle = useApp((s) => s.vehicles.find((v) => v.id === entry?.vehicleId));
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <Sheet open={!!entry} onOpenChange={(v) => { if (!v) { setEditing(false); onClose(); } }}>
      <SheetContent side="right" className="w-full max-w-[480px] overflow-y-auto">
        {entry && (
          <div className="space-y-5 p-5" data-testid="fuel-entry-sheet">
            <div className="pr-8">
              <SheetTitle>{t('admin.fuel.entryTitle')}</SheetTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">{fmtDateTime(entry.createdAt, i18n.language)}</p>
            </div>
            <div className="flex items-end justify-between gap-3 rounded-lg bg-primary p-4 text-primary-foreground">
              <div>
                <p className="figure text-3xl font-bold">{inr(entry.amount, true)}</p>
                <p className="figure text-sm opacity-80">
                  {t('units.litres', { value: num(entry.litres, 2) })} · {inr(entry.amount / entry.litres, true)}/L
                </p>
              </div>
              <Badge tone={entry.fuelType === 'petrol' ? 'success' : 'info'} className="text-sm">
                {t(`enum.fuelType.${entry.fuelType}`)}
              </Badge>
            </div>
            {editing ? (
              <FuelEditForm entry={entry} onDone={() => setEditing(false)} />
            ) : (
              <>
                <DetailList
                  rows={[
                    [t('admin.common.driver'), <DriverCell driver={driver} />],
                    [t('admin.common.vehicle'), <Plate reg={vehicle?.reg} size="sm" />],
                    [t('admin.fuel.station'), entry.station],
                    [t('admin.common.date'), fmtDate(entry.date, i18n.language)],
                    [t('admin.fuel.enteredBy'), t('admin.fuel.driverApp')],
                    ...(entry.editedAt ? ([[t('admin.fuel.edited'), fmtDateTime(entry.editedAt, i18n.language)]] as [string, string][]) : []),
                  ]}
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setEditing(true)} data-testid="fuel-edit">
                    <Pencil />
                    {t('common.edit')}
                  </Button>
                  <Button variant="outline" className="flex-1 text-danger hover:text-danger" onClick={() => setConfirm(true)} data-testid="fuel-delete">
                    <Trash2 />
                    {t('common.delete')}
                  </Button>
                </div>
              </>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('admin.fuel.receipt')}</h3>
              {entry.receipt ? <FileView file={entry.receipt} alt={t('admin.fuel.receipt')} /> : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('admin.fuel.noReceipt')}</p>}
            </div>
            <ConfirmDialog
              open={confirm}
              onOpenChange={setConfirm}
              destructive
              title={t('admin.fuel.deleteTitle')}
              description={t('admin.fuel.deleteBody', { amount: inr(entry.amount), driver: driver?.name ?? '' })}
              confirmLabel={t('common.delete')}
              onConfirm={() => {
                useApp.getState().deleteFuel(entry.id);
                toast.success(t('admin.fuel.deleted'));
                onClose();
              }}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FuelEditForm({ entry, onDone }: { entry: FuelEntry; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ fuelType: entry.fuelType, amount: String(entry.amount), litres: String(entry.litres), station: entry.station, date: entry.date });
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const amount = Number(v.amount);
    const litres = Number(v.litres);
    if (!(amount > 0) || !(litres > 0) || v.station.trim().length < 3 || v.date > todayISO()) return setError(t('admin.fuel.editError'));
    useApp.getState().updateFuel(entry.id, { fuelType: v.fuelType as FuelType, amount, litres, station: v.station.trim(), date: v.date });
    toast.success(t('admin.fuel.updated'));
    onDone();
  };
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fe-type">{t('admin.fuel.type')}</Label>
          <NativeSelect id="fe-type" value={v.fuelType} onChange={(e) => setV({ ...v, fuelType: e.target.value as FuelType })}>
            <option value="petrol">{t('enum.fuelType.petrol')}</option>
            <option value="diesel">{t('enum.fuelType.diesel')}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fe-date">{t('admin.common.date')}</Label>
          <Input id="fe-date" type="date" max={todayISO()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fe-amount">{t('admin.common.amount')} (₹)</Label>
          <Input id="fe-amount" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} data-testid="fuel-edit-amount" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fe-litres">{t('admin.fuel.litres')}</Label>
          <Input id="fe-litres" inputMode="decimal" value={v.litres} onChange={(e) => setV({ ...v, litres: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fe-station">{t('admin.fuel.station')}</Label>
        <Input id="fe-station" value={v.station} onChange={(e) => setV({ ...v, station: e.target.value })} />
      </div>
      <FieldError>{error}</FieldError>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button onClick={save} data-testid="fuel-edit-save">
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
