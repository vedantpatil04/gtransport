import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarClock, FileWarning, FileX2, Files, Hourglass } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/features/admin/components/ui';
import { useApiResource } from '@/features/api/useApiResource';
import { docTypeLabelKey, type ApiDocumentType } from '@/features/documents/compliance';
import { num } from '@/lib/format';
import { reportsApi, type ComplianceItem, type DocumentHealth } from '../api';
import { C, ChartPanel, Donut } from '../charts';
import { BreakdownTable, EmptyNote, Kpi, RecordsTable, SummaryState, useDay, type RecordColumn } from '../components';
import type { ReportViewProps } from '../ReportsConnected';

const HEALTH_TONE: Record<DocumentHealth, 'success' | 'warning' | 'danger' | 'neutral'> = { VALID: 'success', EXPIRING: 'warning', EXPIRED: 'danger', MISSING: 'neutral' };
const HEALTH_COLOR: Record<DocumentHealth, string> = { VALID: C(2), EXPIRING: C(3), EXPIRED: C(5), MISSING: 'hsl(var(--muted-foreground))' };

export function ComplianceReportView({ params, paramsKey, setFilter }: ReportViewProps) {
  const { t } = useTranslation();
  const report = useApiResource(() => reportsApi.summary('compliance', params), [paramsKey]);
  const day = useDay();
  const docType = (type: string) => t(docTypeLabelKey(type as ApiDocumentType));

  const columns: RecordColumn<ComplianceItem>[] = [
    { key: 'type', header: t('admin.reportsApi.filters.documentType'), sort: 'type', render: (r) => docType(r.type) },
    {
      key: 'owner', header: t('admin.reportsApi.filters.owner'), sort: 'owner',
      render: (r) =>
        r.owner.kind === 'VEHICLE' && r.owner.id ? (
          <Link to={`/admin/vehicles/${r.owner.id}`} onClick={(e) => e.stopPropagation()}><Plate reg={r.owner.label} size="xs" /></Link>
        ) : r.owner.kind === 'EMPLOYEE' && r.owner.driverId ? (
          <Link to={`/admin/drivers/${r.owner.driverId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{r.owner.label}</Link>
        ) : (
          r.owner.kind === 'COMPANY' ? t('admin.reportsApi.owner.COMPANY') : r.owner.label
        ),
    },
    { key: 'number', header: t('admin.reportsApi.compliance.number'), className: 'text-muted-foreground', render: (r) => r.documentNumber ?? '—' },
    { key: 'expiry', header: t('admin.reportsApi.compliance.expiry'), sort: 'expiry', className: 'whitespace-nowrap', render: (r) => (r.health === 'MISSING' ? '—' : r.expiryDate ? day(r.expiryDate) : t('admin.reportsApi.compliance.noExpiry')) },
    {
      key: 'days', header: t('admin.reportsApi.compliance.daysLeft'), numeric: true,
      render: (r) => (r.daysRemaining === null ? '—' : r.daysRemaining < 0 ? t('admin.reportsApi.compliance.daysAgo', { count: Math.abs(r.daysRemaining) }) : t('admin.reportsApi.days', { count: r.daysRemaining })),
    },
    { key: 'status', header: t('admin.common.status'), sort: 'status', render: (r) => <Badge tone={HEALTH_TONE[r.health]}>{t(`admin.reportsApi.health.${r.health}`)}</Badge> },
    { key: 'verification', header: t('admin.reportsApi.compliance.verification'), render: (r) => (r.verification ? t(`admin.reportsApi.verificationStatus.${r.verification}`) : '—') },
  ];

  return (
    <>
      <SummaryState resource={report} cards={5}>
        {(r) => (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi hero label={t('admin.reportsApi.compliance.held')} value={num(r.totals.documents, 0)} sub={t('admin.reportsApi.compliance.valid', { count: r.totals.valid })} icon={Files} testId="kpi-documents" />
              <Kpi label={t('admin.reportsApi.compliance.expiring', { days: r.windowDays })} value={num(r.totals.expiring, 0)} icon={CalendarClock} tone={r.totals.expiring ? 'warning' : 'neutral'} />
              <Kpi label={t('admin.reportsApi.health.EXPIRED')} value={num(r.totals.expired, 0)} icon={FileX2} tone={r.totals.expired ? 'danger' : 'neutral'} testId="kpi-expired" />
              <Kpi label={t('admin.reportsApi.health.MISSING')} value={num(r.totals.missing, 0)} icon={FileWarning} definition={t('admin.reportsApi.definitions.missing')} testId="kpi-missing" />
              <Kpi label={t('admin.reportsApi.health.PENDING_VERIFICATION')} value={num(r.totals.pendingVerification, 0)} icon={Hourglass} />
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.5fr]">
              <ChartPanel title={t('admin.reportsApi.compliance.status')} sub={t('admin.reportsApi.drillHint')} height="h-72">
                {r.totals.documents + r.totals.missing ? (
                  <Donut
                    data={(['VALID', 'EXPIRING', 'EXPIRED', 'MISSING'] as DocumentHealth[]).map((h) => ({ key: h, name: t(`admin.reportsApi.health.${h}`), value: h === 'VALID' ? r.totals.valid : h === 'EXPIRING' ? r.totals.expiring : h === 'EXPIRED' ? r.totals.expired : r.totals.missing, color: HEALTH_COLOR[h] })).filter((d) => d.value > 0)}
                    center={num(r.totals.documents + r.totals.missing, 0)}
                    centerLabel={t('admin.reportsApi.compliance.required')}
                    format={(n) => num(n, 0)}
                    onSelect={(key) => setFilter('status', key)}
                  />
                ) : (
                  <EmptyNote>{t('admin.reportsApi.compliance.empty')}</EmptyNote>
                )}
              </ChartPanel>
              <Panel title={t('admin.reportsApi.compliance.byType')}>
                <BreakdownTable
                  rows={r.byType}
                  rowKey={(row) => row.type}
                  onRowClick={(row) => setFilter('documentType', row.type)}
                  emptyText={t('admin.reportsApi.compliance.empty')}
                  columns={[
                    { key: 'type', header: t('admin.reportsApi.filters.documentType'), render: (row) => docType(row.type) },
                    { key: 'valid', header: t('admin.reportsApi.health.VALID'), numeric: true, render: (row) => num(row.valid, 0) },
                    { key: 'expiring', header: t('admin.reportsApi.health.EXPIRING'), numeric: true, render: (row) => (row.expiring ? <span className="text-warning">{row.expiring}</span> : 0) },
                    { key: 'expired', header: t('admin.reportsApi.health.EXPIRED'), numeric: true, render: (row) => (row.expired ? <span className="text-danger">{row.expired}</span> : 0) },
                    { key: 'missing', header: t('admin.reportsApi.health.MISSING'), numeric: true, render: (row) => num(row.missing, 0) },
                  ]}
                />
              </Panel>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {([['expired', r.bands.expired], ['d7', r.bands.d7], ['d30', r.bands.d30], ['d60', r.bands.d60], ['d90', r.bands.d90]] as const).map(([band, count]) => (
                <span key={band} className="rounded-full border bg-card px-3 py-1">
                  {t(`admin.reportsApi.compliance.band.${band}`)} · <span className="figure font-semibold">{count}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </SummaryState>

      <RecordsTable
        title={t('admin.reportsApi.compliance.records')}
        type="compliance"
        params={params}
        columns={columns}
        rowKey={(row) => row.documentId ?? `missing-${row.owner.kind}-${row.owner.id}-${row.type}`}
        defaultSort={{ field: 'expiry', dir: 'asc' }}
        searchPlaceholder={t('admin.reportsApi.compliance.search')}
        emptyText={t('admin.reportsApi.compliance.empty')}
        testId="compliance-records"
      />
    </>
  );
}
