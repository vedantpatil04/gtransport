import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, RotateCcw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { financeApi, vehiclesApi } from '@/features/api/resources';
import { MANUAL_LEDGER_TYPES, type ApiManualLedgerDetail, type ApiManualLedgerType, type ApiPaymentMethod } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { todayISO } from '@/lib/dates';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { DetailList } from '../admin/components/ui';
import { ErrorState, TableLoading } from '../admin/components/states';
import { EmployeeSelect, Footer, FormError, METHODS, ReasonDialog, useSubmit } from './FinanceDialogs';
import { money, toPaise } from './shared';

const INCOME: ApiManualLedgerType[] = ['CUSTOMER_PAYMENT', 'OTHER_INCOME'];

/**
 * Adds or edits a hand-kept ledger entry. Income or expense follows from the type (the API decides
 * it the same way). An edit to money, date, type or party is posted as a reversal plus a new line,
 * so the screen says so — and asks why, for the audit record.
 */
export function ManualEntryDialog({
  entry, open, onOpenChange, onSaved,
}: { entry: ApiManualLedgerDetail | null; open: boolean; onOpenChange: (v: boolean) => void; onSaved: (id: string) => void }) {
  const { t } = useTranslation();
  const editing = Boolean(entry);
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<ApiManualLedgerType>('OTHER_EXPENSE');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [method, setMethod] = useState<ApiPaymentMethod | ''>('');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [reason, setReason] = useState('');
  const form = useSubmit();
  const vehicles = useApiResource(() => vehiclesApi.list({ limit: 100 }), [], open);

  useEffect(() => {
    if (!open) return;
    setDate(entry?.date ?? todayISO());
    setType(entry?.type ?? 'OTHER_EXPENSE');
    setAmount(entry ? String(Number(entry.amount)) : '');
    setDescription(entry?.description ?? '');
    setEmployeeId(entry?.employee?.id ?? '');
    setVehicleId(entry?.vehicle?.id ?? '');
    setMethod(entry?.paymentMethod ?? '');
    setReference(entry?.reference ?? '');
    setRemarks(entry?.remarks ?? '');
    setReason('');
    form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);

  const amountOk = toPaise(amount) !== null && Number(amount) > 0;
  const ready = date && amountOk && description.trim();

  const submit = () =>
    form.run(async () => {
      const body = {
        transactionDate: date,
        type,
        amount: Number(amount),
        description: description.trim(),
        employeeId: employeeId || null,
        vehicleId: vehicleId || null,
        paymentMethod: method || null,
        reference: reference.trim() || null,
        remarks: remarks.trim() || null,
      };
      if (entry) {
        await financeApi.updateEntry(entry.id, { ...body, reason: reason.trim() || undefined });
        toast.success(t('admin.ledgerEdit.savedToast'));
        onSaved(entry.id);
      } else {
        const created = await financeApi.createEntry({ ...body, employeeId: body.employeeId ?? undefined, vehicleId: body.vehicleId ?? undefined });
        toast.success(t('admin.ledgerEdit.createdToast'));
        onSaved(created.id);
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('admin.ledgerEdit.editTitle') : t('admin.ledgerEdit.addTitle')}</DialogTitle>
          <DialogDescription>{editing ? t('admin.ledgerEdit.editHint') : t('admin.ledgerEdit.addHint')}</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="manual-entry-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="me-date">{t('admin.common.date')}</Label>
              <Input id="me-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
              <FieldError>{form.fieldErrors.transactionDate}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="me-type">{t('admin.common.type')}</Label>
              <NativeSelect id="me-type" value={type} onChange={(e) => setType(e.target.value as ApiManualLedgerType)}>
                {MANUAL_LEDGER_TYPES.map((k) => (
                  <option key={k} value={k}>{t(`admin.enum.ledgerType.${k}`)}</option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                {INCOME.includes(type) ? t('admin.ledgerEdit.isIncome') : t('admin.ledgerEdit.isExpense')}
              </p>
              <FieldError>{form.fieldErrors.type}</FieldError>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="me-amount">{t('admin.common.amount')} (₹)</Label>
              <Input id="me-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-invalid={Boolean(amount) && !amountOk} />
              <FieldError>{form.fieldErrors.amount ?? (amount && !amountOk ? t('admin.ledgerEdit.amountInvalid') : undefined)}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="me-method">{t('admin.payments.method')}</Label>
              <NativeSelect id="me-method" value={method} onChange={(e) => setMethod(e.target.value as ApiPaymentMethod | '')}>
                <option value="">{t('admin.ledgerEdit.noMethod')}</option>
                {METHODS.map((m) => (
                  <option key={m} value={m}>{t(`admin.enum.paymentMethod.${m}`)}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="me-desc">{t('admin.paymentsApi.description')}</Label>
            <Input id="me-desc" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
            <FieldError>{form.fieldErrors.description}</FieldError>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <EmployeeSelect id="me-employee" value={employeeId} onChange={setEmployeeId} error={form.fieldErrors.employeeId} />
            <div className="space-y-1.5">
              <Label htmlFor="me-vehicle">{t('admin.common.vehicle')}</Label>
              <NativeSelect id="me-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={vehicles.loading}>
                <option value="">{t('admin.ledgerEdit.noVehicle')}</option>
                {(vehicles.data?.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>{v.registrationNumber}</option>
                ))}
              </NativeSelect>
              <FieldError>{form.fieldErrors.vehicleId}</FieldError>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="me-ref">{t('admin.paymentsApi.reference')}</Label>
            <Input id="me-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} placeholder={t('admin.ledgerEdit.referenceHint')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="me-remarks">{t('admin.paymentsApi.remarks')}</Label>
            <Textarea id="me-remarks" value={remarks} maxLength={1000} rows={2} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          {editing && (
            <div className="space-y-1.5">
              <Label htmlFor="me-reason">{t('admin.ledgerEdit.reason')}</Label>
              <Input id="me-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('admin.ledgerEdit.reasonHint')}</p>
            </div>
          )}
          <FormError message={form.error} />
          <Footer busy={form.busy} onCancel={() => onOpenChange(false)} label={editing ? t('common.save') : t('admin.ledgerEdit.add')} disabled={!ready} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_KEYS: Record<string, string> = {
  transactionDate: 'admin.common.date',
  type: 'admin.common.type',
  amount: 'admin.common.amount',
  description: 'admin.paymentsApi.description',
  employeeId: 'admin.financeApi.employee',
  vehicleId: 'admin.common.vehicle',
  paymentMethod: 'admin.payments.method',
  reference: 'admin.paymentsApi.reference',
  remarks: 'admin.paymentsApi.remarks',
};

/** One hand-kept entry: its details, every ledger line it produced, and who changed what. */
export function ManualEntrySheet({ entryId, onClose, onChanged }: { entryId: string | null; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const detail = useApiResource(() => financeApi.entry(entryId!), [entryId], Boolean(entryId));
  const e = detail.data && detail.data.id === entryId ? detail.data : null;

  const refresh = () => {
    detail.reload();
    onChanged();
  };

  const show = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return '—';
    if (key === 'amount') return money(String(value));
    if (key === 'type') return t(`admin.enum.ledgerType.${value}`);
    if (key === 'paymentMethod') return t(`admin.enum.paymentMethod.${value}`);
    if (key === 'employeeId' || key === 'vehicleId') return t('admin.ledgerEdit.changedLink');
    return String(value);
  };

  return (
    <Sheet open={Boolean(entryId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-[520px] overflow-y-auto">
        {detail.loading && !e ? (
          <TableLoading rows={4} columns={2} />
        ) : detail.error ? (
          <ErrorState error={detail.error} onRetry={detail.reload} />
        ) : e ? (
          <div className="space-y-5 p-5" data-testid="manual-entry-sheet">
            <div className="pr-8">
              <SheetTitle>{e.description}</SheetTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t(`admin.enum.ledgerType.${e.type}`)} · {t(`admin.enum.ledgerDirection.${e.direction}`)}
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <p className={`figure text-3xl font-bold ${e.direction === 'EXPENSE' ? 'text-danger' : 'text-success'}`}>{money(e.amount)}</p>
              {e.status === 'ARCHIVED' ? <Badge tone="neutral">{t('admin.financeApi.reversed')}</Badge> : <Badge tone="success">{t('admin.ledgerEdit.active')}</Badge>}
            </div>
            {e.status === 'ARCHIVED' && e.archiveReason && (
              <p className="rounded-lg bg-muted p-3 text-sm" role="status">{t('admin.ledgerEdit.reversedBecause', { reason: e.archiveReason })}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {e.status === 'ACTIVE' ? (
                <>
                  <Button onClick={() => setEditing(true)}>
                    <Pencil />
                    {t('admin.ledgerEdit.edit')}
                  </Button>
                  <Button variant="outline" className="text-danger hover:text-danger" onClick={() => setReversing(true)}>
                    <Undo2 />
                    {t('admin.ledgerEdit.reverse')}
                  </Button>
                </>
              ) : (
                <Button variant="outline" disabled={restoring} onClick={async () => {
                  setRestoring(true);
                  try {
                    await financeApi.restoreEntry(e.id);
                    toast.success(t('admin.ledgerEdit.restoredToast'));
                    refresh();
                  } catch {
                    toast.error(t('common.somethingWrong'));
                  } finally {
                    setRestoring(false);
                  }
                }}>
                  <RotateCcw />
                  {t('admin.ledgerEdit.restore')}
                </Button>
              )}
            </div>

            <DetailList
              rows={[
                [t('admin.common.date'), fmtDate(e.date)],
                [t('admin.financeApi.employee'), e.employee ? `${e.employee.fullName} · ${e.employee.employeeCode}` : '—'],
                [t('admin.common.vehicle'), e.vehicle ? <Plate reg={e.vehicle.registrationNumber} size="xs" /> : '—'],
                [t('admin.payments.method'), e.paymentMethod ? t(`admin.enum.paymentMethod.${e.paymentMethod}`) : '—'],
                [t('admin.paymentsApi.reference'), e.reference ? <span className="font-mono">{e.reference}</span> : '—'],
                [t('admin.paymentsApi.remarks'), e.remarks ? <span className="whitespace-pre-line">{e.remarks}</span> : '—'],
              ]}
            />

            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('admin.ledgerEdit.lines')}</h3>
              <p className="mb-2 text-xs text-muted-foreground">{t('admin.ledgerEdit.linesHint')}</p>
              <ul className="divide-y rounded-lg border text-sm">
                {e.lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-muted-foreground">{fmtDate(l.date)}</span>
                    <span className="flex items-center gap-1.5">
                      {l.isReversal && <Badge tone="neutral">{t('admin.financeApi.correction')}</Badge>}
                      {l.reversed && <Badge tone="neutral">{t('admin.financeApi.reversed')}</Badge>}
                      <span className="figure font-semibold">{l.amount.startsWith('-') ? `− ${money(l.amount.slice(1))}` : money(l.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">{t('admin.ledgerEdit.history')}</h3>
              <ol className="space-y-3" data-testid="manual-entry-history">
                {e.history.map((h) => {
                  const changes = h.changes as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
                  const reason = (h.metadata as { reason?: string } | null)?.reason;
                  return (
                    <li key={h.id} className="text-sm">
                      <p className="font-medium">{t(`admin.ledgerEdit.event.${h.action.replace('ledger.manual_', '')}`, { defaultValue: h.action })}</p>
                      <p className="text-xs text-muted-foreground">
                        {h.actor ?? t('admin.ledgerEdit.system')} · {fmtDateTime(h.at, i18n.language)}
                      </p>
                      {h.action === 'ledger.manual_updated' && changes?.before && changes.after && (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {Object.keys(changes.after).map((k) => (
                            <li key={k}>
                              <span className="text-muted-foreground">{FIELD_KEYS[k] ? t(FIELD_KEYS[k]) : k}: </span>
                              <span className="line-through opacity-70">{show(k, changes.before?.[k])}</span> → <span className="font-medium">{show(k, changes.after?.[k])}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {reason && <p className="mt-1 text-xs italic text-muted-foreground">“{reason}”</p>}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        ) : null}
      </SheetContent>

      {e && (
        <>
          <ManualEntryDialog entry={e} open={editing} onOpenChange={setEditing} onSaved={() => { setEditing(false); refresh(); }} />
          <ReasonDialog
            open={reversing}
            onOpenChange={setReversing}
            title={t('admin.ledgerEdit.reverseTitle')}
            description={t('admin.ledgerEdit.reverseHint')}
            confirmLabel={t('admin.ledgerEdit.reverse')}
            reasonLabel={t('admin.ledgerEdit.reverseReason')}
            onConfirm={async (reason) => {
              await financeApi.reverseEntry(e.id, reason);
              toast.success(t('admin.ledgerEdit.reversedToast'));
              setReversing(false);
              refresh();
            }}
          />
        </>
      )}
    </Sheet>
  );
}
