import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, Check, FileWarning, ImageIcon, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { serviceReceiptsApi } from '@/features/api/resources';
import { canManageFinance, canManageFleet, useSession } from '@/features/api/session';
import type {
  ApiLineItemKind, ApiReceiptAIStatus, ApiReceiptReview, ApiReceiptSuggestions, ApiSuggestedValue, ApiVerifiedLineItem,
} from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { fmtDate, fmtDateTime, inr } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ErrorState, InlineBusy } from './states';
import { ReceiptViewer } from './ReceiptViewer';

/**
 * Reviewing what was read off a service receipt, and deciding whether to stand behind it.
 *
 * The screen is built around one idea: the extraction is a suggestion and the record is the
 * record. So the form starts from what is on the record, an extracted value has to be taken
 * across by a deliberate click, and the button that saves is labelled for what it does — verify
 * the record — not "accept the AI". A field the receipt did not give stays blank; nothing is
 * filled in with a zero or with today's date to make the form look complete. Which values matched
 * the reading and which were corrected is worked out by the server, not claimed by this screen.
 *
 * Whichever way the office decides, the original stays: it is one click away throughout, and it
 * is the thing they are actually checking against.
 */

export const RECEIPT_STATUS_TONE: Record<ApiReceiptAIStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  NOT_PROCESSED: 'neutral',
  QUEUED: 'info',
  PROCESSING: 'info',
  RETRYING: 'warning',
  SUCCEEDED: 'info',
  NEEDS_REVIEW: 'warning',
  FAILED: 'danger',
  VERIFIED: 'success',
  REJECTED: 'neutral',
};

const LINE_KINDS: ApiLineItemKind[] = ['PART', 'LABOUR', 'OTHER'];

interface FormState {
  amount: string;
  expenseDate: string;
  vendorName: string;
  description: string;
  invoiceNumber: string;
  serviceType: string;
  odometerKm: string;
  nextServiceDate: string;
  nextServiceKm: string;
  labourAmount: string;
  partsAmount: string;
  taxAmount: string;
  lineItems: ApiVerifiedLineItem[];
}

/** Which suggestion fills which form field. */
const FIELD_FOR: Record<keyof ApiReceiptSuggestions, keyof Omit<FormState, 'description' | 'lineItems'>> = {
  totalAmount: 'amount',
  invoiceDate: 'expenseDate',
  vendorName: 'vendorName',
  invoiceNumber: 'invoiceNumber',
  serviceType: 'serviceType',
  odometerKm: 'odometerKm',
  nextServiceDate: 'nextServiceDate',
  nextServiceKm: 'nextServiceKm',
  labourAmount: 'labourAmount',
  partsAmount: 'partsAmount',
  taxAmount: 'taxAmount',
};
const MONEY_FIELDS = new Set<keyof ApiReceiptSuggestions>(['totalAmount', 'labourAmount', 'partsAmount', 'taxAmount']);

const fromRecord = (data: ApiReceiptReview): FormState => ({
  amount: data.record.amount,
  expenseDate: data.record.expenseDate ?? '',
  vendorName: data.record.vendorName ?? '',
  description: data.record.description ?? '',
  invoiceNumber: data.record.service.invoiceNumber ?? '',
  serviceType: data.record.service.serviceType ?? '',
  odometerKm: data.record.service.odometerKm?.toString() ?? '',
  nextServiceDate: data.record.service.nextServiceDate ?? '',
  nextServiceKm: data.record.service.nextServiceKm?.toString() ?? '',
  labourAmount: data.record.service.labourAmount ?? '',
  partsAmount: data.record.service.partsAmount ?? '',
  taxAmount: data.record.service.taxAmount ?? '',
  lineItems: data.record.service.lineItems,
});

const orNull = (value: string) => (value.trim() ? value.trim() : null);
const intOrNull = (value: string) => (value.trim() ? Number(value.trim().replace(/[,\s]/g, '')) : null);

export function ReceiptReviewDrawer({
  expenseId,
  onClose,
  onChanged,
}: {
  expenseId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const role = useSession((s) => s.user?.role);
  const mayDecide = canManageFleet(role) || canManageFinance(role);
  /** Re-opening a settled record is a fleet-management act, not an accounting one. */
  const mayReopen = canManageFleet(role);

  const review = useApiResource(() => serviceReceiptsApi.review(expenseId as string), [expenseId], Boolean(expenseId));
  const data = review.data;

  const [form, setForm] = useState<FormState | null>(null);
  /** Values taken across from the reading, shown as "taken" until the office types over them. */
  const [taken, setTaken] = useState<(keyof ApiReceiptSuggestions)[]>([]);
  const [busy, setBusy] = useState<'verify' | 'reject' | 'retry' | 'reopen' | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [mode, setMode] = useState<'review' | 'reject' | 'reopen'>('review');

  // The form starts from the record, never from the extraction. Taking a suggested value across
  // is something the office does on purpose, one field at a time.
  useEffect(() => {
    if (!data) return;
    setForm(fromRecord(data));
    setTaken([]);
    setMode('review');
    setRejectReason('');
    setReopenReason('');
  }, [data]);

  const latest = data?.results[0] ?? null;
  const issues = latest?.validationIssues ?? [];
  const warnings = latest?.warnings ?? [];
  const editable = mayDecide && Boolean(data?.ai.canVerify);

  const suggestionFor = (key: keyof ApiReceiptSuggestions): ApiSuggestedValue<string | number> | null =>
    data?.suggestions ? (data.suggestions[key] ?? null) : null;

  const take = (key: keyof ApiReceiptSuggestions) => {
    const suggestion = suggestionFor(key);
    if (!suggestion || suggestion.state === 'missing' || suggestion.value === null) return;
    const value = MONEY_FIELDS.has(key) ? Number(suggestion.value).toFixed(2) : String(suggestion.value);
    setForm((current) => (current ? { ...current, [FIELD_FOR[key]]: value } : current));
    setTaken((all) => (all.includes(key) ? all : [...all, key]));
  };

  /** Typing over a value taken from the extraction means it is the office's own again. */
  const edit = (patch: Partial<FormState>, key?: keyof ApiReceiptSuggestions) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
    if (key) setTaken((all) => all.filter((entry) => entry !== key));
  };

  const takeLines = () => {
    if (!data?.extraction) return;
    edit({
      lineItems: data.extraction.lineItems.map((line) => ({
        description: line.description ?? '',
        kind: line.kind,
        // The API takes at most three decimals; a reading of 0.3333… is not worth a refused save.
        quantity: line.quantity === null ? null : String(Number(line.quantity.toFixed(3))),
        unitPrice: line.unitPrice === null ? null : line.unitPrice.toFixed(2),
        amount: line.amount === null ? null : line.amount.toFixed(2),
      })),
    });
  };

  const editLine = (index: number, patch: Partial<ApiVerifiedLineItem>) =>
    setForm((current) => (current ? { ...current, lineItems: current.lineItems.map((line, i) => (i === index ? { ...line, ...patch } : line)) } : current));

  const after = (message: string) => {
    toast.success(message);
    review.reload();
    onChanged?.();
  };

  const fail = (error: unknown) => toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));

  const verify = async () => {
    if (!data || !form) return;
    setBusy('verify');
    try {
      const outcome = await serviceReceiptsApi.verify(data.record.id, {
        amount: form.amount,
        expenseDate: form.expenseDate || undefined,
        vendorName: form.vendorName,
        description: form.description,
        invoiceNumber: orNull(form.invoiceNumber),
        serviceType: orNull(form.serviceType),
        odometerKm: intOrNull(form.odometerKm),
        nextServiceDate: orNull(form.nextServiceDate),
        nextServiceKm: intOrNull(form.nextServiceKm),
        labourAmount: orNull(form.labourAmount),
        partsAmount: orNull(form.partsAmount),
        taxAmount: orNull(form.taxAmount),
        lineItems: form.lineItems
          .filter((line) => line.description.trim())
          .map((line) => ({
            description: line.description.trim(),
            kind: line.kind,
            quantity: line.quantity?.trim() || null,
            unitPrice: line.unitPrice?.trim() || null,
            amount: line.amount?.trim() || null,
          })),
        resultId: latest?.id,
      });
      after(
        outcome.correctedFields.length
          ? `${t('admin.receiptAi.confirmed')} ${t('admin.receiptAi.correctedNote', { count: outcome.correctedFields.length })}`
          : t('admin.receiptAi.confirmed'),
      );
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!data) return;
    setBusy('reject');
    try {
      await serviceReceiptsApi.reject(data.record.id, rejectReason.trim() || undefined);
      after(t('admin.receiptAi.rejected'));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    if (!data) return;
    setBusy('retry');
    try {
      await serviceReceiptsApi.retry(data.record.id);
      after(t('admin.receiptAi.retryQueued'));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const reopen = async () => {
    if (!data || reopenReason.trim().length === 0) return;
    setBusy('reopen');
    try {
      await serviceReceiptsApi.reopen(data.record.id, reopenReason.trim());
      after(t('admin.receiptAi.reopened'));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  /** One record field with what the receipt said beside it. */
  const field = (key: keyof ApiReceiptSuggestions, label: string, input: React.ReactNode, format: (value: string | number) => string) => (
    <Field label={label} suggestion={suggestionFor(key)} taken={taken.includes(key)} onTake={() => take(key)} disabled={!editable} format={format}>
      {input}
    </Field>
  );
  const money = (value: string | number) => inr(Number(value));
  const plain = (value: string | number) => String(value);
  const km = (value: string | number) => `${Number(value).toLocaleString('en-IN')} km`;
  const date = (value: string | number) => fmtDate(String(value), i18n.language);

  return (
    <Sheet open={Boolean(expenseId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full max-w-xl p-0 sm:max-w-xl">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3.5 pr-12">
          <div className="min-w-0">
            <SheetTitle>{t('admin.receiptAi.drawerTitle')}</SheetTitle>
            {data && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Plate reg={data.record.vehicle.registrationNumber} size="xs" />
                <span className="text-xs text-muted-foreground">
                  {data.record.expenseDate ? fmtDate(data.record.expenseDate, i18n.language) : '—'}
                  {data.record.driver ? ` · ${data.record.driver.fullName}` : ''}
                </span>
                <Badge tone={RECEIPT_STATUS_TONE[data.ai.status]}>{t(`admin.receiptAi.status.${data.ai.status}`)}</Badge>
              </div>
            )}
          </div>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto">
          {review.loading ? (
            <div className="flex h-40 items-center justify-center">
              <InlineBusy label={t('common.loading')} />
            </div>
          ) : review.error ? (
            <ErrorState error={review.error} onRetry={review.reload} />
          ) : !data || !form ? null : (
            <div className="space-y-5 p-4">
              {/* The original. First, because it is what everything else is checked against. */}
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.receiptAi.original')}</p>
                {data.receipt ? (
                  <button
                    type="button"
                    onClick={() => setShowReceipt(true)}
                    className="mt-2 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                      <ImageIcon className="size-5 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{data.receipt.filename}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('admin.receiptAi.uploadedAt', { when: fmtDateTime(data.receipt.uploadedAt, i18n.language) })}
                      </span>
                    </span>
                    <span className="text-xs font-medium text-primary">{t('admin.receiptAi.openOriginal')}</span>
                  </button>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t('admin.receiptAi.noOriginal')}</p>
                )}
              </section>

              {/* What was read, how, and how much of it can be relied on. */}
              <section>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.receiptAi.reading')}</p>
                  {latest && (
                    <span className="text-[11px] text-muted-foreground">
                      {t('admin.receiptAi.readingMeta', {
                        version: latest.version,
                        model: latest.model,
                        confidence: latest.confidence === null ? '—' : `${Math.round(latest.confidence * 100)}%`,
                      })}
                    </span>
                  )}
                </div>

                {!latest ? (
                  <p className="mt-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    {data.ai.status === 'QUEUED' || data.ai.status === 'PROCESSING' || data.ai.status === 'RETRYING'
                      ? t('admin.receiptAi.stillReading')
                      : t('admin.receiptAi.noReading')}
                  </p>
                ) : (
                  <>
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
                      <Sparkles className="mt-px size-3.5 shrink-0" />
                      {/* Said once, plainly, on the screen where it matters. */}
                      {t('admin.receiptAi.suggestionOnly')}
                    </p>
                    {latest.preparation && (
                      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
                        {t('admin.receiptAi.readFrom', { how: preparationLabel(latest.preparation, t) })}
                      </p>
                    )}

                    {issues.length > 0 && (
                      <ul className="mt-2 space-y-1.5 rounded-lg border border-warning/40 bg-warning-soft/60 p-2.5">
                        {issues.map((issue) => (
                          <li key={issue} className="flex items-start gap-1.5 text-xs text-warning">
                            <AlertTriangle className="mt-px size-3.5 shrink-0" />
                            <span className="text-foreground/80">{issue}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {warnings.length > 0 && (
                      <ul className="mt-2 space-y-1 px-1">
                        {warnings.map((warning) => (
                          <li key={warning} className="text-xs text-muted-foreground">
                            · {warning}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>

              {data.ai.status === 'FAILED' && (
                <section className="rounded-lg border border-danger/40 bg-danger-soft/50 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
                    <FileWarning className="size-4" />
                    {t('admin.receiptAi.failedTitle')}
                  </p>
                  <p className="mt-1 text-xs text-foreground/80">
                    {data.jobs[0]?.failureMessage ?? t('admin.receiptAi.failedGeneric')}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">{t('admin.receiptAi.failedStillUsable')}</p>
                </section>
              )}

              {/* The record itself. This is what gets saved. */}
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.receiptAi.theRecord')}</p>
                <div className="mt-2 space-y-3">
                  {field(
                    'totalAmount',
                    t('admin.common.amount'),
                    <Input value={form.amount} inputMode="decimal" onChange={(e) => edit({ amount: e.target.value }, 'totalAmount')} disabled={!editable} />,
                    money,
                  )}
                  {field(
                    'invoiceDate',
                    t('admin.receiptAi.serviceDate'),
                    <Input type="date" value={form.expenseDate} onChange={(e) => edit({ expenseDate: e.target.value }, 'invoiceDate')} disabled={!editable} />,
                    date,
                  )}
                  {field(
                    'vendorName',
                    t('admin.receiptAi.workshop'),
                    <Input value={form.vendorName} onChange={(e) => edit({ vendorName: e.target.value }, 'vendorName')} disabled={!editable} />,
                    plain,
                  )}
                  <div>
                    <Label htmlFor="receipt-note">{t('common.note')}</Label>
                    <Textarea id="receipt-note" rows={2} value={form.description} onChange={(e) => edit({ description: e.target.value })} disabled={!editable} />
                  </div>
                </div>
              </section>

              {/* Structured service details: what maintenance intelligence reads once verified. */}
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.receiptAi.serviceDetails')}</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {field('invoiceNumber', t('admin.receiptAi.invoiceNumber'),
                    <Input value={form.invoiceNumber} onChange={(e) => edit({ invoiceNumber: e.target.value }, 'invoiceNumber')} disabled={!editable} />, plain)}
                  {field('serviceType', t('admin.receiptAi.serviceType'),
                    <Input value={form.serviceType} onChange={(e) => edit({ serviceType: e.target.value }, 'serviceType')} disabled={!editable} />, plain)}
                  {field('odometerKm', t('admin.receiptAi.odometer'),
                    <Input value={form.odometerKm} inputMode="numeric" onChange={(e) => edit({ odometerKm: e.target.value }, 'odometerKm')} disabled={!editable} />, km)}
                  {field('nextServiceKm', t('admin.receiptAi.nextServiceKm'),
                    <Input value={form.nextServiceKm} inputMode="numeric" onChange={(e) => edit({ nextServiceKm: e.target.value }, 'nextServiceKm')} disabled={!editable} />, km)}
                  {field('nextServiceDate', t('admin.receiptAi.nextServiceDate'),
                    <Input type="date" value={form.nextServiceDate} onChange={(e) => edit({ nextServiceDate: e.target.value }, 'nextServiceDate')} disabled={!editable} />, date)}
                  {field('partsAmount', t('admin.receiptAi.partsAmount'),
                    <Input value={form.partsAmount} inputMode="decimal" onChange={(e) => edit({ partsAmount: e.target.value }, 'partsAmount')} disabled={!editable} />, money)}
                  {field('labourAmount', t('admin.receiptAi.labour'),
                    <Input value={form.labourAmount} inputMode="decimal" onChange={(e) => edit({ labourAmount: e.target.value }, 'labourAmount')} disabled={!editable} />, money)}
                  {field('taxAmount', t('admin.receiptAi.gst'),
                    <Input value={form.taxAmount} inputMode="decimal" onChange={(e) => edit({ taxAmount: e.target.value }, 'taxAmount')} disabled={!editable} />, money)}
                </div>
              </section>

              {/* Line items: taken across as a whole, then corrected line by line if needed. */}
              <section>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.receiptAi.lineItems')}</p>
                  {editable && data.extraction && data.extraction.lineItems.length > 0 && (
                    <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={takeLines}>
                      {t('admin.receiptAi.useExtractedLines', { count: data.extraction.lineItems.length })}
                    </button>
                  )}
                </div>
                {form.lineItems.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{t('admin.receiptAi.noLines')}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {form.lineItems.map((line, index) => (
                      <li key={index} className="grid grid-cols-[1fr_96px_92px_auto] items-center gap-1.5">
                        <Input
                          value={line.description}
                          aria-label={t('admin.receiptAi.lineDescription')}
                          onChange={(e) => editLine(index, { description: e.target.value })}
                          disabled={!editable}
                        />
                        <NativeSelect
                          value={line.kind ?? ''}
                          aria-label={t('admin.receiptAi.lineKind')}
                          onChange={(e) => editLine(index, { kind: (e.target.value || null) as ApiLineItemKind | null })}
                          disabled={!editable}
                        >
                          <option value="">—</option>
                          {LINE_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {t(`admin.receiptAi.kind.${kind}`)}
                            </option>
                          ))}
                        </NativeSelect>
                        <Input
                          value={line.amount ?? ''}
                          inputMode="decimal"
                          aria-label={t('admin.common.amount')}
                          onChange={(e) => editLine(index, { amount: e.target.value })}
                          disabled={!editable}
                        />
                        {editable && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('admin.receiptAi.removeLine')}
                            onClick={() => setForm((current) => (current ? { ...current, lineItems: current.lineItems.filter((_, i) => i !== index) } : current))}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {editable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1.5"
                    onClick={() =>
                      setForm((current) =>
                        current ? { ...current, lineItems: [...current.lineItems, { description: '', kind: null, quantity: null, unitPrice: null, amount: null }] } : current,
                      )
                    }
                  >
                    <Plus className="size-3.5" />
                    {t('admin.receiptAi.addLine')}
                  </Button>
                )}
              </section>

              {/* Every reading kept, so a later run never quietly replaces an earlier one. */}
              {data.results.length > 1 && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.receiptAi.history')}</p>
                  <ul className="mt-2 space-y-1">
                    {data.results.map((result) => (
                      <li key={result.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {t('admin.receiptAi.versionLabel', { version: result.version })} · {result.model}
                          {result.id === data.ai.acceptedResultId ? ` · ${t('admin.receiptAi.acceptedVersion')}` : ''}
                        </span>
                        <span>{fmtDateTime(result.createdAt, i18n.language)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.ai.status === 'VERIFIED' && (
                <p className="rounded-lg bg-success-soft/60 p-3 text-xs text-foreground/80">
                  {t('admin.receiptAi.confirmedNote', { when: data.ai.verifiedAt ? fmtDateTime(data.ai.verifiedAt, i18n.language) : '—' })}
                  {data.ai.acceptedFields.length > 0
                    ? ` ${t('admin.receiptAi.acceptedFieldsNote', { count: data.ai.acceptedFields.length })}`
                    : ` ${t('admin.receiptAi.allTypedNote')}`}
                </p>
              )}
            </div>
          )}
        </div>

        {data && mayDecide && (
          <div className="border-t bg-card p-3">
            {mode === 'reject' ? (
              <div className="space-y-2">
                <Label htmlFor="reject-reason">{t('admin.receiptAi.rejectReason')}</Label>
                <Textarea id="reject-reason" rows={2} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setMode('review')}>
                    {t('common.cancel')}
                  </Button>
                  <Button variant="destructive" disabled={busy !== null} onClick={() => void reject()}>
                    {t('admin.receiptAi.reject')}
                  </Button>
                </div>
              </div>
            ) : mode === 'reopen' ? (
              <div className="space-y-2">
                <Label htmlFor="reopen-reason">{t('admin.receiptAi.reopenReason')}</Label>
                <Textarea id="reopen-reason" rows={2} value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setMode('review')}>
                    {t('common.cancel')}
                  </Button>
                  <Button disabled={busy !== null || reopenReason.trim().length === 0} onClick={() => void reopen()}>
                    {t('admin.receiptAi.reopen')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {data.ai.canRetry && (
                  <Button variant="outline" disabled={busy !== null} onClick={() => void retry()}>
                    <RefreshCw className={cn(busy === 'retry' && 'animate-spin')} />
                    {t('admin.receiptAi.readAgain')}
                  </Button>
                )}
                {data.ai.status === 'VERIFIED' || data.ai.status === 'REJECTED' ? (
                  mayReopen && (
                    <Button variant="outline" onClick={() => setMode('reopen')}>
                      <Undo2 />
                      {t('admin.receiptAi.reopen')}
                    </Button>
                  )
                ) : (
                  <>
                    {latest && (
                      <Button variant="outline" onClick={() => setMode('reject')}>
                        <X />
                        {t('admin.receiptAi.reject')}
                      </Button>
                    )}
                    <Button disabled={busy !== null || !data.ai.canVerify} onClick={() => void verify()}>
                      <Check />
                      {t('admin.receiptAi.confirmRecord')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>

      <ReceiptViewer
        fileId={showReceipt ? (data?.receipt?.fileId ?? null) : null}
        title={data ? `${data.record.vehicle.registrationNumber} · ${data.receipt?.filename ?? ''}` : ''}
        onClose={() => setShowReceipt(false)}
      />
    </Sheet>
  );
}

/** "image+ocr" → "photo, with OCR"; "pdf:text" → "the PDF's own text". */
function preparationLabel(preparation: string, t: TFunction): string {
  const ocr = preparation.endsWith('+ocr');
  const base = preparation.replace(/\+ocr$/, '').replace(/[:+]/g, '_');
  const label = t(`admin.receiptAi.prep.${base}`);
  return ocr ? `${label} ${t('admin.receiptAi.prep.withOcr')}` : label;
}

/**
 * One editable record field, with what the receipt said beside it.
 *
 * A found value can be taken across with a click; a value the receipt did not give says so and
 * offers nothing, which is the difference between "the bill says nothing" and "the bill says zero".
 */
function Field({
  label,
  suggestion,
  taken,
  onTake,
  disabled,
  format,
  children,
}: {
  label: string;
  suggestion: ApiSuggestedValue<string | number> | null;
  taken: boolean;
  onTake: () => void;
  disabled?: boolean;
  format: (value: string | number) => string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const found = suggestion?.state === 'found' && suggestion.value !== null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        {suggestion &&
          (found ? (
            <button
              type="button"
              disabled={disabled || taken}
              onClick={onTake}
              className={cn(
                'text-xs font-medium transition-colors',
                taken ? 'text-success' : 'text-primary hover:underline disabled:text-muted-foreground',
              )}
            >
              {taken ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-3" />
                  {t('admin.receiptAi.taken')}
                </span>
              ) : (
                t('admin.receiptAi.useValue', { value: format(suggestion.value as string | number) })
              )}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">{t('admin.receiptAi.notOnReceipt')}</span>
          ))}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Shown on the review queue when nothing needs a person. */
export function ReceiptQueueEmpty() {
  const { t } = useTranslation();
  return (
    <p className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
      <RotateCcw className="size-7 opacity-40" />
      {t('admin.receiptAi.queueEmpty')}
    </p>
  );
}
