import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, RefreshCw, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { paymentsApi } from '@/features/api/resources';
import type { ApiPayment, ApiPaymentHistory, ApiPaymentOutcome } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { ApiError } from '@/lib/api/client';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DetailList } from '../admin/components/ui';
import { ErrorState, InlineBusy, TableLoading } from '../admin/components/states';
import { ReasonDialog, RecordManualDialog } from './FinanceDialogs';
import { money, PaymentStatusBadge } from './shared';

type Busy = 'approve' | 'send' | 'check' | null;

/**
 * One payment: what it is, where the money goes, what happened to it, and the next step the
 * state machine allows. Send asks for confirmation; an unknown outcome locks Send until the
 * status has been checked, so a payout can never be sent twice by accident.
 */
export function PaymentDrawer({
  paymentId, payoutsEnabled, onClose, onChanged,
}: { paymentId: string | null; payoutsEnabled: boolean; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [recording, setRecording] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const payment = useApiResource<ApiPayment>(() => paymentsApi.get(paymentId!), [paymentId], Boolean(paymentId));
  const history = useApiResource<ApiPaymentHistory>(() => paymentsApi.history(paymentId!), [paymentId], Boolean(paymentId));
  // The hook keeps the previous result while refreshing; never act on a different payment's data.
  const p = payment.data && payment.data.id === paymentId ? payment.data : null;
  const loadingThis = payment.loading || (Boolean(paymentId) && !p && !payment.error);

  const refresh = () => {
    payment.reload();
    history.reload();
    onChanged();
  };

  const act = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    try {
      await action();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const reportOutcome = (result: ApiPaymentOutcome, fromCheck: boolean) => {
    if (result.outcome === 'unknown') toast.warning(fromCheck ? t('admin.paymentsApi.stillUnknown') : t('admin.paymentsApi.sentUnknown'));
    else if (result.outcome === 'rejected') toast.error(t('admin.paymentsApi.sentRejected', { reason: result.payment.failureReason ?? '—' }));
    else if (fromCheck) toast.success(t('admin.paymentsApi.checkedToast', { status: t(`admin.enum.paymentStatus.${result.payment.status}`) }));
    else toast.success(t('admin.paymentsApi.sentAccepted'));
  };

  const online = p?.provider === 'RAZORPAYX';
  const canApprove = p?.status === 'PENDING_APPROVAL';
  const canSend = online && payoutsEnabled && (p?.status === 'APPROVED' || p?.status === 'FAILED');
  const canCheck = online && (p?.status === 'STATUS_REVIEW_REQUIRED' || p?.status === 'PROCESSING');
  const canRecord = !online && p?.status === 'APPROVED';
  const canCancel = p ? ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FAILED'].includes(p.status) : false;

  return (
    <Sheet open={Boolean(paymentId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-[480px] overflow-y-auto">
        {loadingThis ? (
          <TableLoading rows={4} columns={2} />
        ) : payment.error ? (
          <ErrorState error={payment.error} onRetry={payment.reload} />
        ) : p ? (
          <div className="space-y-5 p-5" data-testid="payment-drawer">
            <div className="pr-8">
              <SheetTitle>{p.employee.fullName}</SheetTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t(`admin.enum.paymentType.${p.type}`)}
                {p.salary ? ` · ${p.salary.payPeriod}` : ''}
                {p.advance ? ` · ${t(`admin.enum.advanceType.${p.advance.type}`)}` : ''}
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <p className="figure text-3xl font-bold">{money(p.amount)}</p>
              <PaymentStatusBadge status={p.status} />
            </div>

            {p.status === 'STATUS_REVIEW_REQUIRED' && (
              <div className="flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning" role="status">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>{t('admin.paymentsApi.reviewBanner')}</p>
              </div>
            )}
            {(p.status === 'FAILED' || p.status === 'REVERSED') && p.failureReason && (
              <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger" role="status">
                {t('admin.paymentsApi.failedBanner', { reason: p.failureReason })}
              </p>
            )}

            {(canApprove || canSend || canCheck || canRecord || canCancel) && (
              <div className="grid grid-cols-2 gap-2">
                {canApprove && (
                  <Button onClick={() => act('approve', async () => { await paymentsApi.approve(p.id); toast.success(t('admin.paymentsApi.approvedToast')); })} disabled={busy !== null}>
                    <Check />
                    {t('admin.paymentsApi.approve')}
                  </Button>
                )}
                {canSend && (
                  <Button onClick={() => setConfirmSend(true)} disabled={busy !== null}>
                    <Send />
                    {p.status === 'FAILED' ? t('admin.paymentsApi.retry') : t('admin.paymentsApi.send')}
                  </Button>
                )}
                {canCheck && (
                  <Button variant="outline" onClick={() => act('check', async () => reportOutcome(await paymentsApi.checkStatus(p.id), true))} disabled={busy !== null}>
                    <RefreshCw className={cn(busy === 'check' && 'animate-spin')} />
                    {t('admin.paymentsApi.checkStatus')}
                  </Button>
                )}
                {canRecord && (
                  <Button onClick={() => setRecording(true)} disabled={busy !== null}>
                    <Check />
                    {t('admin.paymentsApi.recordPaid')}
                  </Button>
                )}
                {canCancel && (
                  <Button variant="outline" className="text-danger hover:text-danger" onClick={() => setCancelling(true)} disabled={busy !== null}>
                    <X />
                    {t('admin.paymentsApi.cancelPayment')}
                  </Button>
                )}
              </div>
            )}
            {busy && <InlineBusy label={t('common.loading')} />}

            <DetailList
              rows={[
                [t('admin.payments.method'), `${t(`admin.enum.paymentMethod.${p.method}`)} · ${t(`admin.enum.paymentProvider.${p.provider}`)}`],
                [t('admin.paymentsApi.recipient'), p.recipientSummary ?? '—'],
                [t('admin.paymentsApi.utr'), p.paymentReference ? <span className="font-mono">{p.paymentReference}</span> : '—'],
                ...(online
                  ? ([
                      [t('admin.paymentsApi.providerRef'), p.providerReference ? <span className="font-mono text-xs">{p.providerReference}</span> : '—'],
                      [t('admin.paymentsApi.attempt'), String(p.attempt)],
                    ] as [string, React.ReactNode][])
                  : []),
                [t('admin.paymentsApi.description'), p.description ?? '—'],
                [t('admin.payments.createdOn'), fmtDate(p.createdAt.slice(0, 10))],
              ]}
            />

            <div>
              <h3 className="mb-3 text-sm font-semibold">{t('admin.paymentsApi.timeline')}</h3>
              {history.loading || history.refreshing ? (
                <InlineBusy label={t('common.loading')} />
              ) : (
                <ol className="space-y-3">
                  {timeline(history.data).map((entry, i) => (
                    <li key={i} className="flex gap-3">
                      <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', entry.tone === 'bad' ? 'bg-danger text-white' : entry.tone === 'good' ? 'bg-success text-white' : 'bg-secondary text-foreground')}>
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                      <div className="text-sm">
                        <p className="font-medium">{t(`admin.paymentsApi.event.${entry.key}`)}</p>
                        <p className="text-xs text-muted-foreground">{fmtDateTime(entry.at, i18n.language)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>

      {p && (
        <>
          <Dialog open={confirmSend} onOpenChange={setConfirmSend}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('admin.paymentsApi.sendTitle', { amount: money(p.amount), name: p.employee.fullName })}</DialogTitle>
                <DialogDescription>{t('admin.paymentsApi.sendBody', { recipient: p.recipientSummary ?? t('admin.paymentsApi.payoutAccount') })}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmSend(false)}>{t('common.cancel')}</Button>
                <Button
                  disabled={busy !== null}
                  onClick={() => {
                    setConfirmSend(false);
                    void act('send', async () => reportOutcome(await paymentsApi.send(p.id), false));
                  }}
                >
                  <Send />
                  {t('admin.paymentsApi.confirmSend')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <RecordManualDialog payment={p} open={recording} onOpenChange={setRecording} onDone={() => { setRecording(false); refresh(); }} />
          <ReasonDialog
            open={cancelling}
            onOpenChange={setCancelling}
            title={t('admin.paymentsApi.cancelTitle')}
            description={t('admin.paymentsApi.cancelHint')}
            confirmLabel={t('admin.paymentsApi.cancelPayment')}
            onConfirm={async (reason) => {
              await paymentsApi.cancel(p.id, reason);
              toast.success(t('admin.paymentsApi.cancelledToast'));
              setCancelling(false);
              refresh();
            }}
          />
        </>
      )}
    </Sheet>
  );
}

const EVENT_KEYS = new Set([
  'created', 'approved', 'cancelled', 'payout_requested', 'outcome_unknown', 'paid_manually', 'processing', 'paid', 'failed', 'reversed', 'status_review_required',
]);

/** Audit actions and provider webhooks, merged into one oldest-first timeline. */
function timeline(history: ApiPaymentHistory | null): { key: string; at: string; tone: 'good' | 'bad' | 'neutral' }[] {
  if (!history) return [];
  const toneOf = (key: string) => (key === 'paid' || key === 'paid_manually' ? 'good' : key === 'failed' || key === 'reversed' || key === 'cancelled' ? 'bad' : 'neutral');
  const audit = history.audit
    .map((a) => a.action.replace(/^payment\./, ''))
    .map((key, i) => ({ key: EVENT_KEYS.has(key) ? key : 'webhook', at: history.audit[i]!.occurredAt }));
  // Webhooks that changed the payment already appear as audit entries; list only the ones that did not.
  const webhooks = history.providerEvents.filter((e) => !e.outcome?.startsWith('applied')).map((e) => ({ key: 'webhook', at: e.receivedAt }));
  return [...audit, ...webhooks].sort((a, b) => a.at.localeCompare(b.at)).map((e) => ({ ...e, tone: toneOf(e.key) }));
}
