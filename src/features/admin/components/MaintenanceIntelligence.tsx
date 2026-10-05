import { useTranslation } from 'react-i18next';
import { CalendarClock, Info, Repeat, Wrench } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { serviceReceiptsApi } from '@/features/api/resources';
import type { ApiNextService, ApiRepeatedIssue } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { fmtDate, inr } from '@/lib/format';
import { Panel } from './ui';
import { ErrorState, TableLoading } from './states';

/**
 * What the verified service history says — due and overdue services, things that keep coming back,
 * and recent work.
 *
 * Every figure rests on records a person verified, and the panel says so in the server's own
 * words. A due date printed by a workshop is shown as the workshop's; one derived from past
 * intervals is marked as an estimate. Nothing here is an instruction or a safety judgement.
 */

const STATUS_TONE: Record<ApiNextService['status'], 'danger' | 'warning' | 'neutral'> = {
  overdue: 'danger',
  upcoming: 'warning',
  scheduled: 'neutral',
};

function DueLine({ next }: { next: ApiNextService }) {
  const { t, i18n } = useTranslation();
  const when =
    next.dueDate === null
      ? t('admin.maintenance.dueAtKm', { km: (next.dueKm ?? 0).toLocaleString('en-IN') })
      : next.status === 'overdue'
        ? t('admin.maintenance.overdueBy', { count: Math.abs(next.daysRemaining ?? 0), date: fmtDate(next.dueDate, i18n.language) })
        : t('admin.maintenance.dueIn', { count: next.daysRemaining ?? 0, date: fmtDate(next.dueDate, i18n.language) });
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={STATUS_TONE[next.status]}>{t(`admin.maintenance.status.${next.status}`)}</Badge>
      <span className="text-xs text-foreground/80">{when}</span>
      {next.dueDate !== null && next.dueKm !== null && (
        <span className="text-xs text-muted-foreground">{t('admin.maintenance.orAtKm', { km: next.dueKm.toLocaleString('en-IN') })}</span>
      )}
      <span className="text-[11px] text-muted-foreground">· {t(`admin.maintenance.source.${next.source}`)}</span>
    </span>
  );
}

function IssueLine({ issue }: { issue: ApiRepeatedIssue }) {
  const { t, i18n } = useTranslation();
  return (
    <span className="text-xs text-foreground/80">
      {issue.label} · {t('admin.maintenance.times', { count: issue.occurrences })}
      <span className="text-muted-foreground"> · {t('admin.maintenance.since', { date: fmtDate(issue.firstSeen, i18n.language) })}</span>
    </span>
  );
}

/** Fleet-wide: what is due, what keeps recurring. For the maintenance side of Operations. */
export function FleetMaintenancePanel() {
  const { t } = useTranslation();
  const summary = useApiResource(() => serviceReceiptsApi.maintenanceSummary(), []);
  const data = summary.data;

  return (
    <Panel title={t('admin.maintenance.fleetTitle')}>
      {summary.loading ? (
        <TableLoading rows={3} columns={2} />
      ) : summary.error ? (
        <ErrorState error={summary.error} onRetry={summary.reload} />
      ) : !data ? null : (
        <div className="divide-y">
          <div className="grid grid-cols-3 gap-2 px-4 py-3 text-center">
            <div>
              <p className="figure text-base font-semibold">{data.verifiedServices}</p>
              <p className="text-[11px] text-muted-foreground">{t('admin.maintenance.verifiedServices', { days: data.windowDays })}</p>
            </div>
            <div>
              <p className="figure text-base font-semibold">{inr(Number(data.verifiedSpend), true)}</p>
              <p className="text-[11px] text-muted-foreground">{t('admin.maintenance.verifiedSpend')}</p>
            </div>
            <div>
              <p className="figure text-base font-semibold">{data.awaitingReview}</p>
              <p className="text-[11px] text-muted-foreground">{t('admin.maintenance.awaitingReview')}</p>
            </div>
          </div>

          <div className="px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="size-3.5" />
              {t('admin.maintenance.dueTitle')}
            </p>
            {data.dueServices.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{t('admin.maintenance.nothingDue')}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.dueServices.map((due) => (
                  <li key={due.vehicle.id} className="flex flex-col gap-1">
                    <Plate reg={due.vehicle.registrationNumber} size="xs" />
                    <DueLine next={due} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.repeatedIssues.length > 0 && (
            <div className="px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Repeat className="size-3.5" />
                {t('admin.maintenance.repeatedTitle')}
              </p>
              <ul className="mt-2 space-y-1.5">
                {data.repeatedIssues.slice(0, 6).map((issue) => (
                  <li key={`${issue.vehicle.id}-${issue.kind}-${issue.label}`} className="flex flex-wrap items-center gap-2">
                    <Plate reg={issue.vehicle.registrationNumber} size="xs" />
                    <IssueLine issue={issue} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="flex items-start gap-1.5 px-4 py-2.5 text-[11px] text-muted-foreground">
            <Info className="mt-px size-3 shrink-0" />
            {data.basis}
          </p>
        </div>
      )}
    </Panel>
  );
}

/** One vehicle's verified service history and what it suggests. */
export function VehicleMaintenancePanel({ vehicleId }: { vehicleId: string }) {
  const { t, i18n } = useTranslation();
  const intel = useApiResource(() => serviceReceiptsApi.vehicleMaintenance(vehicleId), [vehicleId]);
  const data = intel.data;

  return (
    <Panel title={t('admin.maintenance.vehicleTitle')}>
      {intel.loading ? (
        <TableLoading rows={3} columns={2} />
      ) : intel.error ? (
        <ErrorState error={intel.error} onRetry={intel.reload} />
      ) : !data ? null : data.verifiedServices === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">{data.basis}</p>
      ) : (
        <div className="divide-y">
          <div className="space-y-1.5 px-4 py-3">
            {data.nextService ? <DueLine next={data.nextService} /> : <p className="text-xs text-muted-foreground">{t('admin.maintenance.noNextService')}</p>}
            <p className="text-xs text-muted-foreground">
              {t('admin.maintenance.lastService', { date: data.lastServiceDate ? fmtDate(data.lastServiceDate, i18n.language) : '—' })}
              {data.lastOdometerKm !== null ? ` · ${data.lastOdometerKm.toLocaleString('en-IN')} km` : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('admin.maintenance.frequency', { n90: data.servicesLast90Days, n365: data.servicesLast365Days })}
              {data.averageIntervalDays !== null ? ` · ${t('admin.maintenance.averageInterval', { days: data.averageIntervalDays })}` : ''}
            </p>
          </div>

          {data.observations.length > 0 && (
            <ul className="space-y-1.5 px-4 py-3">
              {data.observations.map((observation) => (
                <li key={`${observation.kind}-${observation.message}`} className="flex items-start gap-1.5 text-xs">
                  <Wrench className={observation.severity === 'attention' ? 'mt-px size-3.5 shrink-0 text-warning' : 'mt-px size-3.5 shrink-0 text-muted-foreground'} />
                  <span className="text-foreground/80">{observation.message}</span>
                </li>
              ))}
            </ul>
          )}

          {data.repeatedIssues.length > 0 && (
            <ul className="space-y-1 px-4 py-3">
              {data.repeatedIssues.map((issue) => (
                <li key={`${issue.kind}-${issue.label}`}>
                  <IssueLine issue={issue} />
                </li>
              ))}
            </ul>
          )}

          <p className="flex items-start gap-1.5 px-4 py-2.5 text-[11px] text-muted-foreground">
            <Info className="mt-px size-3 shrink-0" />
            {data.basis}
          </p>
        </div>
      )}
    </Panel>
  );
}
