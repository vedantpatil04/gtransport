import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { financeApi, paymentsApi } from '@/features/api/resources';
import type {
  ApiAdvance, ApiAdvanceType, ApiEmployee, ApiPayment, ApiPaymentMethod, ApiPaymentProvider, ApiPaymentType, ApiPayoutAccount, ApiSalary,
} from '@/features/api/types';
import { useApiResource, type ApiResource } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { todayISO } from '@/lib/dates';
import { InlineBusy } from '../admin/components/states';
import { currentPeriod, money, paiseToRupees, toPaise, useActiveEmployees } from './shared';

const ADVANCE_TYPES: ApiAdvanceType[] = ['SALARY_ADVANCE', 'FUEL_ADVANCE', 'TRIP_ADVANCE', 'OTHER_ADVANCE'];
const METHODS: ApiPaymentMethod[] = ['BANK_TRANSFER', 'UPI', 'CASH', 'OTHER'];
/** A salary or advance is free to pay when it has no payment, or only a cancelled/reversed one. */
const isOpen = (payment: { status: string } | null) => !payment || payment.status === 'CANCELLED' || payment.status === 'REVERSED';

/** Shared submit plumbing: busy flag, a form-level message, and per-field messages from the API. */
function useSubmit() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const reset = () => {
    setError(null);
    setFieldErrors({});
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    reset();
    try {
      await action();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFieldErrors(cause.fieldErrors);
        if (Object.keys(cause.fieldErrors).length === 0) setError(cause.message);
      } else {
        setError(t('common.somethingWrong'));
      }
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, fieldErrors, run, reset, setError };
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{message}</p>;
}

function Footer({ busy, onCancel, label, disabled, destructive }: { busy: boolean; onCancel: () => void; label: string; disabled?: boolean; destructive?: boolean }) {
  const { t } = useTranslation();
  return (
    <DialogFooter className="pt-2">
      {busy && <InlineBusy label={t('common.loading')} />}
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" disabled={busy || disabled} variant={destructive ? 'destructive' : undefined}>
        {label}
      </Button>
    </DialogFooter>
  );
}

function EmployeeSelect({
  id, value, onChange, disabled, error, employees: shared,
}: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean; error?: string; employees?: ApiResource<ApiEmployee[]> }) {
  const { t } = useTranslation();
  const own = useActiveEmployees(!shared);
  const employees = shared ?? own;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t('admin.financeApi.employee')}</Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || employees.loading}>
        <option value="">{t('admin.financeApi.chooseEmployee')}</option>
        {(employees.data ?? []).map((e) => (
          <option key={e.id} value={e.id}>
            {e.fullName} · {e.employeeCode}
          </option>
        ))}
      </NativeSelect>
      <FieldError>{error}</FieldError>
    </div>
  );
}

// ───────────────────────────── Cancel with reason ─────────────────────────────

export function ReasonDialog({
  open, onOpenChange, title, description, confirmLabel, onConfirm, reasonLabel,
}: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description: string; confirmLabel: string; onConfirm: (reason: string) => Promise<void>; reasonLabel?: string }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const form = useSubmit();
  useEffect(() => {
    if (open) {
      setReason('');
      form.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void form.run(() => onConfirm(reason.trim())); }}>
          <div className="space-y-1.5">
            <Label htmlFor="reason-text">{reasonLabel ?? t('admin.financeApi.cancelReason')}</Label>
            <Input id="reason-text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
            <FieldError>{form.fieldErrors.reason}</FieldError>
          </div>
          <FormError message={form.error} />
          <Footer busy={form.busy} onCancel={() => onOpenChange(false)} label={confirmLabel} disabled={!reason.trim()} destructive />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Salary ─────────────────────────────

export function SalaryDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: (s: ApiSalary) => void }) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState('');
  const [payPeriod, setPayPeriod] = useState(currentPeriod());
  const [base, setBase] = useState('');
  const [allowances, setAllowances] = useState('');
  const [deductions, setDeductions] = useState('');
  const [notes, setNotes] = useState('');
  const [recover, setRecover] = useState<Set<string>>(new Set());
  const form = useSubmit();

  useEffect(() => {
    if (!open) return;
    setEmployeeId('');
    setPayPeriod(currentPeriod());
    setBase('');
    setAllowances('');
    setDeductions('');
    setNotes('');
    setRecover(new Set());
    form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setRecover(new Set()), [employeeId]);

  const recoverable = useApiResource<ApiAdvance[]>(
    async () => (employeeId ? (await financeApi.advances({ employeeId, recoverable: true, limit: 100 })).data : []),
    [employeeId],
    open,
  );

  // Exact, in paise — the same arithmetic the server does in Decimal.
  const preview = useMemo(() => {
    const parts = [toPaise(base), toPaise(allowances), toPaise(deductions)];
    if (parts.some((p) => p === null)) return null;
    const [b, a, d] = parts as number[];
    const recovery = (recoverable.data ?? []).filter((x) => recover.has(x.id)).reduce((sum, x) => sum + (toPaise(x.amount) ?? 0), 0);
    return { recovery, net: b + a - recovery - d };
  }, [base, allowances, deductions, recover, recoverable.data]);

  const optional = (value: string) => (value.trim() === '' ? undefined : Number(value));
  const submit = () =>
    form.run(async () => {
      const salary = await financeApi.createSalary({
        employeeId, payPeriod, baseSalary: Number(base), allowances: optional(allowances), deductions: optional(deductions),
        recoverAdvanceIds: [...recover], notes: notes.trim() || undefined,
      });
      toast.success(t('admin.financeApi.salarySaved', { name: salary.employee.fullName }));
      onSaved(salary);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('admin.financeApi.addSalary')}</DialogTitle>
          <DialogDescription>{t('admin.financeApi.salaryHint')}</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <EmployeeSelect id="sal-employee" value={employeeId} onChange={setEmployeeId} error={form.fieldErrors.employeeId} />
            <div className="space-y-1.5">
              <Label htmlFor="sal-period">{t('admin.financeApi.payPeriod')}</Label>
              <Input id="sal-period" type="month" value={payPeriod} max={currentPeriod()} onChange={(e) => setPayPeriod(e.target.value)} />
              <FieldError>{form.fieldErrors.payPeriod}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sal-base">{t('admin.financeApi.base')}</Label>
              <Input id="sal-base" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
              <FieldError>{form.fieldErrors.baseSalary}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sal-allow">{t('admin.financeApi.allowances')}</Label>
              <Input id="sal-allow" inputMode="decimal" value={allowances} onChange={(e) => setAllowances(e.target.value)} />
              <FieldError>{form.fieldErrors.allowances}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sal-deduct">{t('admin.financeApi.deductions')}</Label>
              <Input id="sal-deduct" inputMode="decimal" value={deductions} onChange={(e) => setDeductions(e.target.value)} />
              <FieldError>{form.fieldErrors.deductions}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sal-notes">{t('admin.financeApi.notes')}</Label>
              <Input id="sal-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {employeeId && (
            <fieldset className="rounded-lg border p-3">
              <legend className="px-1 text-sm font-semibold">{t('admin.financeApi.recoverTitle')}</legend>
              <p className="mb-2 text-xs text-muted-foreground">{t('admin.financeApi.recoverHint')}</p>
              {recoverable.loading ? (
                <InlineBusy label={t('common.loading')} />
              ) : (recoverable.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('admin.financeApi.noRecoverable')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {(recoverable.data ?? []).map((a) => (
                    <li key={a.id}>
                      <label className="flex cursor-pointer items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={recover.has(a.id)}
                          onChange={(e) =>
                            setRecover((current) => {
                              const next = new Set(current);
                              if (e.target.checked) next.add(a.id);
                              else next.delete(a.id);
                              return next;
                            })
                          }
                        />
                        <span className="flex-1">
                          {t(`admin.enum.advanceType.${a.type}`)} · {a.advanceDate}
                          {a.reason ? ` · ${a.reason}` : ''}
                        </span>
                        <span className="figure font-semibold">{money(a.amount)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}

          {preview && (
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              {preview.recovery > 0 && (
                <p className="flex justify-between text-muted-foreground">
                  <span>{t('admin.financeApi.recovery')}</span>
                  <span className="figure">− {money(paiseToRupees(preview.recovery))}</span>
                </p>
              )}
              <p className="flex justify-between font-semibold">
                <span>{t('admin.financeApi.net')}</span>
                <span className={preview.net < 0 ? 'figure text-danger' : 'figure'}>{money(paiseToRupees(preview.net))}</span>
              </p>
              {preview.net < 0 && <p className="mt-1 text-xs text-danger">{t('admin.financeApi.netNegative')}</p>}
            </div>
          )}

          <FormError message={form.error} />
          <Footer busy={form.busy} onCancel={() => onOpenChange(false)} label={t('admin.financeApi.addSalary')} disabled={!employeeId || !base || !preview || preview.net < 0} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Advance ─────────────────────────────

export function AdvanceDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: (a: ApiAdvance) => void }) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<ApiAdvanceType>('TRIP_ADVANCE');
  const [amount, setAmount] = useState('');
  const [advanceDate, setAdvanceDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const form = useSubmit();

  useEffect(() => {
    if (!open) return;
    setEmployeeId('');
    setType('TRIP_ADVANCE');
    setAmount('');
    setAdvanceDate(todayISO());
    setReason('');
    form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () =>
    form.run(async () => {
      const advance = await financeApi.createAdvance({ employeeId, type, amount: Number(amount), advanceDate, reason: reason.trim() || undefined });
      toast.success(t('admin.financeApi.advanceSaved', { name: advance.employee.fullName }));
      onSaved(advance);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.salaries.recordAdvance')}</DialogTitle>
          <DialogDescription>{t('admin.financeApi.advanceHint')}</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <EmployeeSelect id="adv-employee" value={employeeId} onChange={setEmployeeId} error={form.fieldErrors.employeeId} />
            <div className="space-y-1.5">
              <Label htmlFor="adv-type">{t('admin.financeApi.advanceType')}</Label>
              <NativeSelect id="adv-type" value={type} onChange={(e) => setType(e.target.value as ApiAdvanceType)}>
                {ADVANCE_TYPES.map((k) => (
                  <option key={k} value={k}>{t(`admin.enum.advanceType.${k}`)}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adv-amount">{t('admin.common.amount')}</Label>
              <Input id="adv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <FieldError>{form.fieldErrors.amount}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adv-date">{t('admin.financeApi.advanceDate')}</Label>
              <Input id="adv-date" type="date" value={advanceDate} max={todayISO()} onChange={(e) => setAdvanceDate(e.target.value)} />
              <FieldError>{form.fieldErrors.advanceDate}</FieldError>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-reason">{t('admin.financeApi.reason')}</Label>
            <Input id="adv-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </div>
          <FormError message={form.error} />
          <Footer busy={form.busy} onCancel={() => onOpenChange(false)} label={t('admin.salaries.recordAdvance')} disabled={!employeeId || toPaise(amount) === null || !amount} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Payout account ─────────────────────────────

export function PayoutAccountDialog({
  employee, open, onOpenChange, onSaved,
}: { employee: { id: string; fullName: string } | null; open: boolean; onOpenChange: (v: boolean) => void; onSaved: (a: ApiPayoutAccount | null) => void }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<'BANK_TRANSFER' | 'UPI'>('BANK_TRANSFER');
  const [holder, setHolder] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [account, setAccount] = useState('');
  const [confirm, setConfirm] = useState('');
  const [upi, setUpi] = useState('');
  const form = useSubmit();

  useEffect(() => {
    if (!open) return;
    setMethod('BANK_TRANSFER');
    setHolder(employee?.fullName ?? '');
    setIfsc('');
    setAccount('');
    setConfirm('');
    setUpi('');
    form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id]);

  const mismatch = method === 'BANK_TRANSFER' && confirm.length > 0 && confirm !== account;
  const ready = holder.trim() && (method === 'UPI' ? upi.trim() : ifsc.trim() && account && confirm === account);

  const submit = () =>
    form.run(async () => {
      if (!employee) return;
      const { account: saved } = await paymentsApi.savePayoutAccount(employee.id, {
        method, accountHolderName: holder.trim(),
        ...(method === 'UPI' ? { upiId: upi.trim() } : { ifsc: ifsc.trim().toUpperCase(), accountNumber: account.replace(/\s/g, '') }),
      });
      toast.success(t('admin.paymentsApi.payoutSaved'));
      onSaved(saved);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.paymentsApi.payoutTitle', { name: employee?.fullName ?? '' })}</DialogTitle>
          <DialogDescription>{t('admin.paymentsApi.payoutHint')}</DialogDescription>
        </DialogHeader>
        <form noValidate autoComplete="off" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="flex gap-2" role="radiogroup">
            {(['BANK_TRANSFER', 'UPI'] as const).map((m) => (
              <Button key={m} type="button" variant={method === m ? 'default' : 'outline'} size="sm" onClick={() => setMethod(m)} aria-pressed={method === m}>
                {t(`admin.enum.paymentMethod.${m}`)}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-holder">{t('admin.paymentsApi.holder')}</Label>
            <Input id="po-holder" value={holder} maxLength={120} onChange={(e) => setHolder(e.target.value)} />
            <FieldError>{form.fieldErrors.accountHolderName}</FieldError>
          </div>
          {method === 'UPI' ? (
            <div className="space-y-1.5">
              <Label htmlFor="po-upi">{t('admin.paymentsApi.upiId')}</Label>
              <Input id="po-upi" value={upi} placeholder="name@okaxis" onChange={(e) => setUpi(e.target.value)} />
              <FieldError>{form.fieldErrors.upiId}</FieldError>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="po-ifsc">{t('admin.paymentsApi.ifsc')}</Label>
                <Input id="po-ifsc" value={ifsc} maxLength={11} placeholder="SBIN0001234" className="uppercase" onChange={(e) => setIfsc(e.target.value)} />
                <FieldError>{form.fieldErrors.ifsc}</FieldError>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-account">{t('admin.paymentsApi.accountNumber')}</Label>
                <Input id="po-account" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value.replace(/[^\d]/g, ''))} />
                <FieldError>{form.fieldErrors.accountNumber}</FieldError>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-confirm">{t('admin.paymentsApi.confirmAccount')}</Label>
                <Input id="po-confirm" inputMode="numeric" value={confirm} onPaste={(e) => e.preventDefault()} onChange={(e) => setConfirm(e.target.value.replace(/[^\d]/g, ''))} />
                <FieldError>{mismatch ? t('admin.paymentsApi.mismatch') : undefined}</FieldError>
              </div>
            </div>
          )}
          <FormError message={form.error} />
          <Footer busy={form.busy} onCancel={() => onOpenChange(false)} label={t('admin.paymentsApi.save')} disabled={!ready} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Create payment ─────────────────────────────

export interface PaymentPreset {
  employeeId: string;
  type: 'SALARY' | 'ADVANCE';
  salaryId?: string;
  advanceId?: string;
}

export function CreatePaymentDialog({
  open, onOpenChange, payoutsEnabled, preset, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; payoutsEnabled: boolean; preset?: PaymentPreset | null; onCreated: (p: ApiPayment) => void }) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<ApiPaymentType>('SALARY');
  const [salaryId, setSalaryId] = useState('');
  const [advanceId, setAdvanceId] = useState('');
  const [method, setMethod] = useState<ApiPaymentMethod>('BANK_TRANSFER');
  const [provider, setProvider] = useState<ApiPaymentProvider>('MANUAL');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [accountDialog, setAccountDialog] = useState(false);
  const form = useSubmit();

  useEffect(() => {
    if (!open) return;
    setEmployeeId(preset?.employeeId ?? '');
    setType(preset?.type ?? 'SALARY');
    setSalaryId(preset?.salaryId ?? '');
    setAdvanceId(preset?.advanceId ?? '');
    setMethod('BANK_TRANSFER');
    setProvider(payoutsEnabled ? 'RAZORPAYX' : 'MANUAL');
    setAmount('');
    setDescription('');
    form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const salaries = useApiResource<ApiSalary[]>(
    async () => (employeeId && type === 'SALARY' ? (await financeApi.salaries({ employeeId, status: 'PENDING', limit: 100 })).data.filter((s) => isOpen(s.payment)) : []),
    [employeeId, type],
    open,
  );
  const advances = useApiResource<ApiAdvance[]>(
    async () => (employeeId && type === 'ADVANCE' ? (await financeApi.advances({ employeeId, status: 'PENDING', limit: 100 })).data.filter((a) => isOpen(a.payment)) : []),
    [employeeId, type],
    open,
  );
  const online = provider === 'RAZORPAYX';
  const payout = useApiResource<ApiPayoutAccount | null>(
    async () => (employeeId && online ? (await paymentsApi.payoutAccount(employeeId)).account : null),
    [employeeId, online],
    open,
  );

  // RazorpayX pays only by UPI or bank transfer; cash and "other" are always manual.
  useEffect(() => {
    if (method === 'CASH' || method === 'OTHER') setProvider('MANUAL');
  }, [method]);

  const recordAmount =
    type === 'SALARY' ? salaries.data?.find((s) => s.id === salaryId)?.netPayable : type === 'ADVANCE' ? advances.data?.find((a) => a.id === advanceId)?.amount : undefined;
  const standalone = type === 'ALLOWANCE' || type === 'OTHER';
  const employees = useActiveEmployees(open);
  const employeeName = employees.data?.find((e) => e.id === employeeId)?.fullName ?? '';

  const ready =
    employeeId &&
    (type !== 'SALARY' || salaryId) &&
    (type !== 'ADVANCE' || advanceId) &&
    (!standalone || (amount && toPaise(amount) !== null)) &&
    (!online || payout.data);

  const submit = () =>
    form.run(async () => {
      const payment = await paymentsApi.create({
        employeeId, type, method, provider,
        ...(type === 'SALARY' ? { salaryRecordId: salaryId } : {}),
        ...(type === 'ADVANCE' ? { advanceId } : {}),
        ...(standalone ? { amount: Number(amount) } : {}),
        description: description.trim() || undefined,
      });
      toast.success(t('admin.paymentsApi.createdToast'));
      onCreated(payment);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('admin.paymentsApi.new')}</DialogTitle>
          <DialogDescription>{t('admin.paymentsApi.createHint')}</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <EmployeeSelect id="pay-employee" employees={employees} value={employeeId} onChange={(v) => { setEmployeeId(v); setSalaryId(''); setAdvanceId(''); }} disabled={Boolean(preset)} error={form.fieldErrors.employeeId} />
            <div className="space-y-1.5">
              <Label htmlFor="pay-type">{t('admin.common.type')}</Label>
              <NativeSelect id="pay-type" value={type} disabled={Boolean(preset)} onChange={(e) => setType(e.target.value as ApiPaymentType)}>
                {(['SALARY', 'ADVANCE', 'ALLOWANCE', 'OTHER'] as const).map((k) => (
                  <option key={k} value={k}>{t(`admin.enum.paymentType.${k}`)}</option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {employeeId && type === 'SALARY' && (
            <div className="space-y-1.5">
              <Label htmlFor="pay-salary">{t('admin.paymentsApi.chooseSalary')}</Label>
              {!salaries.loading && (salaries.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('admin.paymentsApi.noOpenSalary')}</p>
              ) : (
                <NativeSelect id="pay-salary" value={salaryId} disabled={Boolean(preset?.salaryId)} onChange={(e) => setSalaryId(e.target.value)}>
                  <option value="">{t('common.select')}</option>
                  {(salaries.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.payPeriod} · {money(s.netPayable)}</option>
                  ))}
                </NativeSelect>
              )}
            </div>
          )}
          {employeeId && type === 'ADVANCE' && (
            <div className="space-y-1.5">
              <Label htmlFor="pay-advance">{t('admin.paymentsApi.chooseAdvance')}</Label>
              {!advances.loading && (advances.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('admin.paymentsApi.noOpenAdvance')}</p>
              ) : (
                <NativeSelect id="pay-advance" value={advanceId} disabled={Boolean(preset?.advanceId)} onChange={(e) => setAdvanceId(e.target.value)}>
                  <option value="">{t('common.select')}</option>
                  {(advances.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{t(`admin.enum.advanceType.${a.type}`)} · {a.advanceDate} · {money(a.amount)}</option>
                  ))}
                </NativeSelect>
              )}
            </div>
          )}

          {standalone ? (
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">{t('admin.common.amount')}</Label>
              <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <FieldError>{form.fieldErrors.amount}</FieldError>
            </div>
          ) : (
            recordAmount && <p className="text-sm text-muted-foreground">{t('admin.paymentsApi.amountFrom', { amount: money(recordAmount) })}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">{t('admin.payments.method')}</Label>
              <NativeSelect id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as ApiPaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>{t(`admin.enum.paymentMethod.${m}`)}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-provider">{t('admin.paymentsApi.how')}</Label>
              <NativeSelect id="pay-provider" value={provider} onChange={(e) => setProvider(e.target.value as ApiPaymentProvider)} disabled={!payoutsEnabled || method === 'CASH' || method === 'OTHER'}>
                <option value="MANUAL">{t('admin.paymentsApi.viaManual')}</option>
                {payoutsEnabled && <option value="RAZORPAYX">{t('admin.paymentsApi.viaRazorpayX')}</option>}
              </NativeSelect>
            </div>
          </div>
          {!payoutsEnabled && <p className="text-xs text-muted-foreground">{t('admin.paymentsApi.payoutsOff')}</p>}
          {payoutsEnabled && !online && (method === 'CASH' || method === 'OTHER') && <p className="text-xs text-muted-foreground">{t('admin.paymentsApi.onlineNeedsAccount')}</p>}

          {online && employeeId && (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div>
                <p className="font-medium">{t('admin.paymentsApi.payoutAccount')}</p>
                <p className="text-muted-foreground">
                  {payout.loading
                    ? t('common.loading')
                    : payout.data
                      ? payout.data.method === 'UPI'
                        ? payout.data.upiIdMasked
                        : `A/c XXXX${payout.data.accountNumberLast4} · ${payout.data.ifsc}`
                      : t('admin.paymentsApi.payoutNone')}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setAccountDialog(true)}>
                {payout.data ? t('admin.paymentsApi.changePayoutAccount') : t('admin.paymentsApi.addPayoutAccount')}
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pay-desc">{t('admin.paymentsApi.description')}</Label>
            <Input id="pay-desc" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <FormError message={form.error} />
          <Footer busy={form.busy} onCancel={() => onOpenChange(false)} label={t('admin.paymentsApi.new')} disabled={!ready} />
        </form>
      </DialogContent>
      <PayoutAccountDialog
        employee={employeeId ? { id: employeeId, fullName: employeeName } : null}
        open={accountDialog}
        onOpenChange={setAccountDialog}
        onSaved={() => {
          setAccountDialog(false);
          payout.reload();
        }}
      />
    </Dialog>
  );
}

// ───────────────────────────── Record a manual payment ─────────────────────────────

export function RecordManualDialog({ payment, open, onOpenChange, onDone }: { payment: ApiPayment | null; open: boolean; onOpenChange: (v: boolean) => void; onDone: (p: ApiPayment) => void }) {
  const { t } = useTranslation();
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayISO());
  const form = useSubmit();
  useEffect(() => {
    if (!open) return;
    setReference('');
    setPaidOn(todayISO());
    form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () =>
    form.run(async () => {
      if (!payment) return;
      const updated = await paymentsApi.recordManual(payment.id, { reference: reference.trim() || undefined, paidOn });
      toast.success(t('admin.paymentsApi.recordedToast'));
      onDone(updated);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.paymentsApi.recordTitle')}</DialogTitle>
          <DialogDescription>{t('admin.paymentsApi.recordHint')}</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="rm-ref">{t('admin.paymentsApi.reference')}</Label>
            <Input id="rm-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
            <FieldError>{form.fieldErrors.reference}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rm-date">{t('admin.paymentsApi.paidOn')}</Label>
            <Input id="rm-date" type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} />
            <FieldError>{form.fieldErrors.paidOn}</FieldError>
          </div>
          <FormError message={form.error} />
          <Footer busy={form.busy} onCancel={() => onOpenChange(false)} label={t('admin.paymentsApi.recordPaid')} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
