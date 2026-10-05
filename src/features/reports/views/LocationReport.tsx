import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Navigation, PauseCircle, Radio, WifiOff } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/features/admin/components/ui';
import { useApiResource } from '@/features/api/useApiResource';
import { fmtDateTime, num } from '@/lib/format';
import { reportsApi, type DriverTrackingRow, type StopRecord } from '../api';
import { C, ChartPanel, StackedTrend } from '../charts';
import { BreakdownTable, EmptyNote, Kpi, KpiGrid, RecordsTable, SummaryState, useBucketLabel, type RecordColumn } from '../components';
import type { ReportViewProps } from '../ReportsConnected';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { ACTIVE: 'success', STALE: 'warning', OFFLINE: 'danger' };

export function useDuration() {
  const { t } = useTranslation();
  return (minutes: number | null) => {
    if (minutes === null) return '—';
    if (minutes < 60) return t('admin.fleet.minutes', { count: minutes });
    return t('admin.reportsApi.location.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  };
}

export function LocationReportView({ params, paramsKey, setFilter }: ReportViewProps) {
  const { t, i18n } = useTranslation();
  const report = useApiResource(() => reportsApi.summary('location', params), [paramsKey]);
  const dayLabel = useBucketLabel('day');
  const duration = useDuration();
  const [section, setSection] = useState<'drivers' | 'alerts'>('drivers');
  const when = (iso: string | null) => (iso ? fmtDateTime(iso, i18n.language) : '—');

  const driverColumns: RecordColumn<DriverTrackingRow>[] = [
    { key: 'name', header: t('admin.common.driver'), sort: 'name', render: (r) => <Link to={`/admin/drivers/${r.driverId}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.name}</Link> },
    { key: 'vehicle', header: t('admin.common.vehicle'), render: (r) => (r.vehicle ? <Plate reg={r.vehicle.registrationNumber} size="xs" /> : '—') },
    { key: 'status', header: t('admin.reportsApi.location.statusNow'), sort: 'status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{t(`admin.fleet.status.${r.status}`)}</Badge> },
    { key: 'update', header: t('admin.reportsApi.location.lastUpdate'), className: 'whitespace-nowrap', render: (r) => when(r.lastUpdate) },
    { key: 'seen', header: t('admin.reportsApi.location.lastSeen'), sort: 'lastSeen', className: 'whitespace-nowrap', render: (r) => when(r.lastSeenAt) },
    { key: 'stationary', header: t('admin.reportsApi.location.stationaryFor'), numeric: true, render: (r) => duration(r.stationaryMinutes) },
    { key: 'alerts', header: t('admin.reportsApi.location.alertsInPeriod'), sort: 'alerts', numeric: true, render: (r) => num(r.alertsInPeriod, 0) },
    { key: 'fixes', header: t('admin.reportsApi.location.fixes'), sort: 'fixes', numeric: true, render: (r) => num(r.fixesInWindow, 0) },
  ];
  const alertColumns: RecordColumn<StopRecord>[] = [
    { key: 'driver', header: t('admin.common.driver'), render: (r) => r.driver.name },
    { key: 'vehicle', header: t('admin.common.vehicle'), render: (r) => (r.vehicle ? <Plate reg={r.vehicle.registrationNumber} size="xs" /> : '—') },
    { key: 'since', header: t('admin.reportsApi.location.stoppedSince'), className: 'whitespace-nowrap', render: (r) => when(r.stationarySince) },
    { key: 'triggered', header: t('admin.reportsApi.location.alertRaised'), sort: 'triggered', className: 'whitespace-nowrap', render: (r) => when(r.triggeredAt) },
    { key: 'ended', header: t('admin.reportsApi.location.movedOrClosed'), className: 'whitespace-nowrap', render: (r) => (r.endedAt ? when(r.endedAt) : <Badge tone="warning">{t('admin.reportsApi.location.ongoing')}</Badge>) },
    { key: 'duration', header: t('admin.reportsApi.location.duration'), sort: 'duration', numeric: true, render: (r) => duration(r.durationMinutes) },
    { key: 'status', header: t('admin.common.status'), render: (r) => t(`admin.reportsApi.alertStatus.${r.status}`) },
  ];

  return (
    <>
      <SummaryState resource={report}>
        {(r) => (
          <>
            <KpiGrid>
              <Kpi hero label={t('admin.reportsApi.location.activeNow')} value={`${num(r.tracking.active, 0)} / ${num(r.tracking.drivers, 0)}`} sub={t('admin.reportsApi.location.asOf', { time: when(r.asOf) })} icon={Navigation} testId="kpi-tracking-active" />
              <Kpi label={t('admin.reportsApi.location.staleOffline')} value={num(r.tracking.stale + r.tracking.offline, 0)} sub={t('admin.reportsApi.location.unavailable', { count: r.tracking.unavailable })} icon={WifiOff} tone={r.tracking.stale + r.tracking.offline ? 'warning' : 'neutral'} />
              <Kpi label={t('admin.reportsApi.location.stops')} value={num(r.alerts.total, 0)} sub={t('admin.reportsApi.location.stopsSub', { active: r.alerts.active, duration: duration(r.alerts.totalMinutes) })} icon={PauseCircle} definition={t('admin.reportsApi.definitions.stops')} />
              <Kpi label={t('admin.reportsApi.location.neverReported')} value={num(r.tracking.neverReported, 0)} icon={Radio} definition={t('admin.reportsApi.definitions.neverReported')} />
            </KpiGrid>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <ChartPanel title={t('admin.reportsApi.location.activity', { days: r.activity.retentionDays })} height="h-72">
                {r.activity.coveredFrom && r.activity.days.some((d) => d.fixes > 0) ? (
                  <StackedTrend data={r.activity.days.map((d) => ({ bucket: d.date, fixes: d.fixes }))} labelFor={dayLabel} format={(n) => num(n, 0)} series={[{ key: 'fixes', label: t('admin.reportsApi.location.fixesShort'), color: C(4) }]} />
                ) : (
                  <EmptyNote>{r.activity.coveredFrom ? t('admin.reportsApi.location.noFixes') : t('admin.reportsApi.location.outsideRetention', { days: r.activity.retentionDays })}</EmptyNote>
                )}
              </ChartPanel>
              <Panel title={t('admin.reportsApi.location.staleDrivers')}>
                <BreakdownTable
                  rows={r.staleDrivers}
                  rowKey={(row) => row.driverId}
                  onRowClick={(row) => setFilter('driverId', row.driverId)}
                  emptyText={t('admin.reportsApi.location.noneStale')}
                  columns={[
                    { key: 'name', header: t('admin.common.driver'), render: (row) => row.name },
                    { key: 'vehicle', header: t('admin.common.vehicle'), render: (row) => (row.vehicle ? <Plate reg={row.vehicle} size="xs" /> : '—') },
                    { key: 'status', header: t('admin.common.status'), render: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{t(`admin.fleet.status.${row.status}`)}</Badge> },
                    { key: 'seen', header: t('admin.reportsApi.location.lastSeen'), render: (row) => when(row.lastSeenAt) },
                  ]}
                />
              </Panel>
            </div>
          </>
        )}
      </SummaryState>

      <div className="mt-4 flex gap-2" role="tablist" aria-label={t('admin.reportsApi.location.sections')}>
        {(['drivers', 'alerts'] as const).map((s) => (
          <Button key={s} size="sm" variant={section === s ? 'default' : 'outline'} onClick={() => setSection(s)} role="tab" aria-selected={section === s}>
            {t(`admin.reportsApi.location.section.${s}`)}
          </Button>
        ))}
      </div>
      {section === 'drivers' ? (
        <RecordsTable key="drivers" title={t('admin.reportsApi.location.section.drivers')} type="location" section="drivers" params={params} columns={driverColumns} rowKey={(row) => row.driverId} defaultSort={{ field: 'status', dir: 'asc' }} searchPlaceholder={t('admin.driversApi.search')} emptyText={t('admin.reportsApi.location.empty')} testId="location-drivers" />
      ) : (
        <RecordsTable key="alerts" title={t('admin.reportsApi.location.section.alerts')} type="location" section="alerts" params={params} columns={alertColumns} rowKey={(row) => row.id} defaultSort={{ field: 'triggered', dir: 'desc' }} emptyText={t('admin.reportsApi.location.noStops')} testId="location-alerts" />
      )}
    </>
  );
}
