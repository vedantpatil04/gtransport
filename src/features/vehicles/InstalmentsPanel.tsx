import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label } from '@/components/ui/input';
import { financeApi } from '@/features/api/resources';
import type { ApiInstalment } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { money } from '@/features/finance/shared';
import { ApiError } from '@/lib/api/client';
import { todayISO } from '@/lib/dates';
import { fmtDate } from '@/lib/format';
import { Panel, Table, TD, TH, TR } from '../admin/components/ui';
import { ErrorState, InlineBusy, TableLoading } from '../admin/components/states';

/**
 * EMI instalments for a vehicle's loan. Editable only while the vehicle is financed and the
 * user may manage finance; a closed loan on an owned vehicle shows the same list read-only.
 */
export function InstalmentsPanel({ vehicleId, editable, onChanged }: { vehicleId: string; editable: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [paying, setPaying] = useState<ApiInstalment | null>(null);
  const instalments = useApiResource(() => financeApi.instalments(vehicleId), [vehicleId]);
  const today = todayISO();

  const generate = async () => {
    setGenerating(true);
    try {
      const rows = await financeApi.generateInstalments(vehicleId);
      toast.success(t('admin.vehiclesApi.scheduleCreated', { count: rows.length }));
      instalments.reload();
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t('common.somethingWrong'));
    } finally {
      setGenerating(false);
    }
  };

  const rows = instalments.data ?? [];
  return (
    <Panel title={t('admin.vehiclesApi.instalments')} className="mt-4">
      {instalments.loading ? (
        <TableLoading rows={3} columns={4} />
      ) : instalments.error ? (
        <ErrorState error={instalments.error} onRetry={instalments.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t('admin.vehiclesApi.instalments')}
          hint={t('admin.vehiclesApi.scheduleHint')}
          action={
            editable ? (
              <Button onClick={generate} disabled={generating}>
                {generating ? <InlineBusy label={t('common.loading')} /> : t('admin.vehiclesApi.generateSchedule')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          <Table>
            <thead>
              <tr>
                <TH className="w-16">{t('admin.vehiclesApi.instalmentNo')}</TH>
                <TH>{t('admin.vehiclesApi.due')}</TH>
                <TH className="text-right">{t('admin.common.amount')}</TH>
                <TH>{t('admin.common.status')}</TH>
                {editable && <TH className="w-32" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overdue = row.status === 'PENDING' && row.dueDate < today;
                return (
                  <TR key={row.id}>
                    <TD className="figure text-muted-foreground">{row.installmentNumber}</TD>
                    <TD className="whitespace-nowrap">{fmtDate(row.dueDate)}</TD>
                    <TD className="figure text-right font-semibold">{money(row.amount)}</TD>
                    <TD>
                      {row.status === 'PAID' ? (
                        <span className="text-sm">
                          <Badge tone="success">{t('admin.enum.instalmentStatus.PAID')}</Badge>
                          {row.paidAt && <span className="ml-2 text-xs text-muted-foreground">{fmtDate(row.paidAt)}{row.paymentReference ? ` · ${row.paymentReference}` : ''}</span>}
                        </span>
                      ) : (
                        <Badge tone={overdue ? 'danger' : 'warning'}>{overdue ? t('admin.vehiclesApi.overdue') : t('admin.enum.instalmentStatus.PENDING')}</Badge>
                      )}
                    </TD>
                    {editable && (
                      <TD className="text-right">
                        {row.status === 'PENDING' && (
                          <Button size="sm" variant="outline" onClick={() => setPaying(row)}>
                            {t('admin.vehiclesApi.markPaid')}
                          </Button>
                        )}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
      <PayInstalmentDialog
        vehicleId={vehicleId}
        instalment={paying}
        onClose={() => setPaying(null)}
        onPaid={() => {
          setPaying(null);
          instalments.reload();
          onChanged();
        }}
      />
    </Panel>
  );
}

function PayInstalmentDialog({ vehicleId, instalment, onClose, onPaid }: { vehicleId: string; instalment: ApiInstalment | null; onClose: () => void; onPaid: () => void }) {
  const { t } = useTranslation();
  const [paidOn, setPaidOn] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!instalment) return;
    setPaidOn(todayISO());
    setReference('');
    setError(null);
    setFieldErrors({});
  }, [instalment]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!instalment) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await financeApi.payInstalment(vehicleId, instalment.installmentNumber, { paidOn, reference: reference.trim() || undefined });
      toast.success(result.loanCompleted ? t('admin.vehiclesApi.loanCompleted') : t('admin.vehiclesApi.instalmentPaid', { number: instalment.installmentNumber }));
      onPaid();
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

  return (
    <Dialog open={Boolean(instalment)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.vehiclesApi.payInstalmentTitle', { number: instalment?.installmentNumber ?? '' })}</DialogTitle>
          <DialogDescription>
            {instalment ? `${fmtDate(instalment.dueDate)} · ${money(instalment.amount)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="emi-paid-on">{t('admin.vehiclesApi.paidOn')}</Label>
            <Input id="emi-paid-on" type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} />
            <FieldError>{fieldErrors.paidOn}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emi-ref">{t('admin.vehiclesApi.reference')}</Label>
            <Input id="emi-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
          </div>
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={busy}>{t('admin.vehiclesApi.markPaid')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
