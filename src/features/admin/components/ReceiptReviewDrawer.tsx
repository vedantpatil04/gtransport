import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, FileWarning, ImageIcon, RefreshCw, RotateCcw, Sparkles, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { serviceReceiptsApi } from '@/features/api/resources';
import { canManageFinance, canManageFleet, useSession } from '@/features/api/session';
import type { ApiReceiptAIStatus, ApiSuggestedValue } from '@/features/api/types';
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
 * across by a deliberate click, and the button that saves is labelled for what it does — confirm
 * the record — not "accept the AI". A field the receipt did not give stays blank; nothing is
 * filled in with a zero or with today's date to make the form look complete.
 *
 * Whichever way the office decides, the original stays: it is one click away throughout, and it
 * is the thing they are actually checking against.
 */

const STATUS_TONE: Record<ApiReceiptAIStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  NOT_PROCESSED: 'neutral',
  PENDING: 'info',
  PROCESSING: 'info',
  RETRYING: 'warning',
  COMPLETED: 'info',
  REVIEW_REQUIRED: 'warning',
  FAILED: 'danger',
  CONFIRMED: 'success',
  REJECTED: 'neutral',
};

/** The fields an extraction may offer, in the order the office reads a bill. */
const FIELDS = ['totalAmount', 'invoiceDate', 'vendorName'] as const;
type FieldKey = (typeof FIELDS)[number];

interface FormState {
  amount: string;
  expenseDate: string;
  vendorName: string;
  description: string;
}

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
  /** Which values the office took from the extraction rather than typing. Recorded on confirm. */
  const [accepted, setAccepted] = useState<FieldKey[]>([]);
  const [busy, setBusy] = useState<'verify' | 'reject' | 'retry' | 'reopen' | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [mode, setMode] = useState<'review' | 'reject' | 'reopen'>('review');

  // The form starts from the record, never from the extraction. Taking a suggested value across
  // is something the office does on purpose, one field at a time.
  useEffect(() => {
    if (!data) return;
    setForm({
      amount: data.record.amount,
      expenseDate: data.record.expenseDate ?? '',
      vendorName: data.record.vendorName ?? '',
      description: data.record.description ?? '',
    });
    setAccepted([]);
    setMode('review');
    setRejectReason('');
    setReopenReason('');
  }, [data]);

  const latest = data?.results[0] ?? null;
  const issues = latest?.validationIssues ?? [];
  const warnings = latest?.warnings ?? [];

  const suggestionFor = (field: FieldKey): ApiSuggestedValue<string | number> | null => {
    if (!data?.suggestions) return null;
    return data.suggestions[field] ?? null;
  };

  const take = (field: FieldKey) => {
    const suggestion = suggestionFor(field);
    if (!suggestion || suggestion.state === 'missing' || suggestion.value === null) return;
    setForm((current) => {
      if (!current) return current;
      if (field === 'totalAmount') return { ...current, amount: Number(suggestion.value).toFixed(2) };
      if (field === 'invoiceDate') return { ...current, expenseDate: String(suggestion.value) };
      return { ...current, vendorName: String(suggestion.value) };
    });
    setAccepted((all) => (all.includes(field) ? all : [...all, field]));
  };

  /** Typing over a value the office took from the extraction means it is theirs again. */
  const edit = (patch: Partial<FormState>, field?: FieldKey) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
    if (field) setAccepted((all) => all.filter((entry) => entry !== field));
  };

  const after = (message: string) => {
    toast.success(message);
    review.reload();
    onChanged?.();
  };

  const fail = (error: unknown) => toast.error(error instanceof ApiError ? error.message : t('common.somethingWrong'));

  const confirm = async () => {
    if (!data || !form) return;
    setBusy('verify');
    try {
      await serviceReceiptsApi.verify(data.record.id, {
        amount: form.amount,
        expenseDate: form.expenseDate || undefined,
        vendorName: form.vendorName,
        description: form.description,
        acceptedFields: accepted,
        resultId: latest?.id,
      });
      after(t('admin.receiptAi.confirmed'));
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
                <Badge tone={STATUS_TONE[data.ai.status]}>{t(`admin.receiptAi.status.${data.ai.status}`)}</Badge>
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

              {/* What was read, and how much of it can be relied on. */}
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
                    {data.ai.status === 'PENDING' || data.ai.status === 'PROCESSING' || data.ai.status === 'RETRYING'
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
                  <Field
                    label={t('admin.common.amount')}
                    suggestion={suggestionFor('totalAmount')}
                    taken={accepted.includes('totalAmount')}
                    onTake={() => take('totalAmount')}
                    disabled={!mayDecide || !data.ai.canVerify}
                    format={(value) => inr(Number(value))}
                  >
                    <Input
                      value={form.amount}
                      inputMode="decimal"
                      onChange={(event) => edit({ amount: event.target.value }, 'totalAmount')}
                      disabled={!mayDecide || !data.ai.canVerify}
                    />
                  </Field>

                  <Field
                    label={t('admin.receiptAi.serviceDate')}
                    suggestion={suggestionFor('invoiceDate')}
                    taken={accepted.includes('invoiceDate')}
                    onTake={() => take('invoiceDate')}
                    disabled={!mayDecide || !data.ai.canVerify}
                    format={(value) => fmtDate(String(value), i18n.language)}
                  >
                    <Input
                      type="date"
                      value={form.expenseDate}
                      onChange={(event) => edit({ expenseDate: event.target.value }, 'invoiceDate')}
                      disabled={!mayDecide || !data.ai.canVerify}
                    />
                  </Field>

                  <Field
                    label={t('admin.opsApi.vendor')}
                    suggestion={suggestionFor('vendorName')}
                    taken={accepted.includes('vendorName')}
                    onTake={() => take('vendorName')}
                    disabled={!mayDecide || !data.ai.canVerify}
                    format={(value) => String(value)}
                  >
                    <Input
                      value={form.vendorName}
                      onChange={(event) => edit({ vendorName: event.target.value }, 'vendorName')}
                      disabled={!mayDecide || !data.ai.canVerify}
                    />
                  </Field>

                  <div>
                    <Label htmlFor="receipt-note">{t('common.note')}</Label>
                    <Textarea
                      id="receipt-note"
                      rows={2}
                      value={form.description}
                      onChange={(event) => edit({ description: event.target.value })}
                      disabled={!mayDecide || !data.ai.canVerify}
                    />
                  </div>
                </div>
              </section>

              {/* Parts and labour, read-only: interesting to check against, never written anywhere. */}
              {data.extraction && (data.extraction.parts.length > 0 || data.extraction.labourAmount !== null) && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('admin.receiptAi.breakdown')}</p>
                  <ul className="mt-2 divide-y rounded-lg border text-sm">
                    {data.extraction.parts.map((part, index) => (
                      <li key={`${part.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="min-w-0 truncate">
                          {part.name}
                          {part.quantity ? <span className="text-muted-foreground"> × {part.quantity}</span> : null}
                        </span>
                        <span className="figure shrink-0 text-muted-foreground">{part.amount === null ? '—' : inr(part.amount)}</span>
                      </li>
                    ))}
                    {data.extraction.labourAmount !== null && (
                      <li className="flex items-center justify-between gap-3 px-3 py-2">
                        <span>{t('admin.receiptAi.labour')}</span>
                        <span className="figure text-muted-foreground">{inr(data.extraction.labourAmount)}</span>
                      </li>
                    )}
                    {data.extraction.gstAmount !== null && (
                      <li className="flex items-center justify-between gap-3 px-3 py-2">
                        <span>{t('admin.receiptAi.gst')}</span>
                        <span className="figure text-muted-foreground">{inr(data.extraction.gstAmount)}</span>
                      </li>
                    )}
                  </ul>
                </section>
              )}

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

              {data.ai.status === 'CONFIRMED' && (
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
                {data.ai.status === 'CONFIRMED' || data.ai.status === 'REJECTED' ? (
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
                    <Button disabled={busy !== null || !data.ai.canVerify} onClick={() => void confirm()}>
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
