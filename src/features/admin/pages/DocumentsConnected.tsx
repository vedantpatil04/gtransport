import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleDashed, Clock, ShieldAlert, ShieldCheck, TriangleAlert, Upload } from 'lucide-react';
import { Plate } from '@/components/Plate';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { documentsApi, driversApi, vehiclesApi, type DocumentFilters } from '@/features/api/resources';
import { canManageFleet, useSession } from '@/features/api/session';
import { useApiResource } from '@/features/api/useApiResource';
import { ComplianceBadge, docTypeLabelKey, VerificationBadge, type ApiDocumentType } from '@/features/documents/compliance';
import { DocumentDetailDialog, UploadDocumentDialog } from '@/features/documents/DocumentApiDialogs';
import { fmtDate } from '@/lib/format';
import { FilterBar, PageHeader, Panel, StatCard, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';

const TYPES: ApiDocumentType[] = ['RC', 'INSURANCE', 'PUC', 'TYRE_INSURANCE', 'FITNESS', 'PERMIT', 'DRIVING_LICENCE', 'OTHER'];
const PAGE_SIZE = 50;

/**
 * Documents & Compliance, on the existing navigation entry. Counts come from the server's
 * shared expiry policy; the list is filtered and paged on the server.
 */
export function DocumentsConnected() {
  const { t } = useTranslation();
  const mayManage = canManageFleet(useSession((s) => s.user?.role));

  const [type, setType] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  // A dashboard card can open this screen already filtered (?status=EXPIRED, ?verification=PENDING).
  const [params] = useSearchParams();
  const [status, setStatus] = useState(() => params.get('status') ?? '');
  const [verificationStatus, setVerificationStatus] = useState(() => params.get('verification') ?? '');
  const [expiryFrom, setExpiryFrom] = useState('');
  const [expiryTo, setExpiryTo] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const filters: DocumentFilters = {
    type: type || undefined,
    vehicleId: vehicleId || undefined,
    driverId: driverId || undefined,
    status: status || undefined,
    verificationStatus: verificationStatus || undefined,
    expiryFrom: expiryFrom || undefined,
    expiryTo: expiryTo || undefined,
  };
  const filterKey = JSON.stringify(filters);

  const summary = useApiResource(() => documentsApi.summary(), []);
  const vehicles = useApiResource(() => vehiclesApi.list({ limit: 100 }), []);
  const drivers = useApiResource(() => driversApi.list({ limit: 100 }), []);
  const list = useApiResource(() => documentsApi.list({ ...filters, limit: PAGE_SIZE, cursor: cursors[pageIndex] }), [filterKey, cursors[pageIndex]]);

  const totals = useMemo(() => {
    const rows = summary.data ?? [];
    const sum = (key: 'expired' | 'within7Days' | 'expiringSoon' | 'pendingVerification') => rows.reduce((acc, row) => acc + row[key], 0);
    return {
      expired: sum('expired'),
      within7: sum('within7Days'),
      within30: sum('expiringSoon'),
      pending: sum('pendingVerification'),
      missing: rows.reduce((acc, row) => acc + (row.notUploaded ?? 0), 0),
    };
  }, [summary.data]);

  const setFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setCursors([undefined]);
    setPageIndex(0);
  };
  const quick = (value: string) => setFilter(setStatus)(status === value ? '' : value);

  const reloadAll = () => {
    summary.reload();
    list.reload();
  };

  const rows = list.data?.data ?? [];
  const nextCursor = list.data?.page.nextCursor ?? null;
  const filtersActive = Boolean(type || vehicleId || driverId || status || verificationStatus || expiryFrom || expiryTo);

  return (
    <div>
      <PageHeader
        title={t('admin.documents.title')}
        description={t('admin.documents.subtitle')}
        actions={
          mayManage && (
            <Button onClick={() => setUploading(true)}>
              <Upload />
              {t('admin.docsApi.upload')}
            </Button>
          )
        }
      />

      {/* Alerts: expired, expiring soon, missing and awaiting verification. Tap to filter. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <button type="button" className="text-left" onClick={() => quick('EXPIRED')} aria-pressed={status === 'EXPIRED'}>
          <StatCard label={t('expiry.expired')} value={String(totals.expired)} icon={ShieldAlert} tone={totals.expired > 0 ? 'danger' : 'neutral'} />
        </button>
        <button type="button" className="text-left" onClick={() => quick('WITHIN_7_DAYS')} aria-pressed={status === 'WITHIN_7_DAYS'}>
          <StatCard label={t('admin.docsApi.within7')} value={String(totals.within7)} icon={TriangleAlert} tone={totals.within7 > 0 ? 'warning' : 'neutral'} />
        </button>
        <button type="button" className="text-left" onClick={() => quick('EXPIRING_SOON')} aria-pressed={status === 'EXPIRING_SOON'}>
          <StatCard label={t('admin.docsApi.within30')} value={String(totals.within30)} icon={Clock} />
        </button>
        <StatCard label={t('expiry.notUploaded')} value={String(totals.missing)} icon={CircleDashed} />
        <button type="button" className="text-left" onClick={() => setFilter(setVerificationStatus)(verificationStatus === 'PENDING' ? '' : 'PENDING')} aria-pressed={verificationStatus === 'PENDING'}>
          <StatCard label={t('admin.docsApi.pending')} value={String(totals.pending)} icon={ShieldCheck} />
        </button>
      </div>

      <Panel className="mt-6" title={t('admin.docsApi.byType')}>
        {summary.loading ? (
          <TableLoading rows={4} columns={6} />
        ) : summary.error ? (
          <ErrorState error={summary.error} onRetry={summary.reload} />
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>{t('admin.docsApi.document')}</TH>
                <TH className="text-right">{t('expiry.expired')}</TH>
                <TH className="text-right">{t('admin.docsApi.within7')}</TH>
                <TH className="text-right">{t('admin.docsApi.within30')}</TH>
                <TH className="text-right">{t('expiry.valid')}</TH>
                <TH className="text-right">{t('expiry.notUploaded')}</TH>
                <TH className="text-right">{t('admin.docsApi.pending')}</TH>
              </tr>
            </thead>
            <tbody>
              {(summary.data ?? []).map((row) => (
                <TR key={row.type} onClick={() => setFilter(setType)(row.type)}>
                  <TD className="font-medium">{t(docTypeLabelKey(row.type))}</TD>
                  <TD className={`figure text-right ${row.expired > 0 ? 'font-semibold text-danger' : 'text-muted-foreground'}`}>{row.expired}</TD>
                  <TD className={`figure text-right ${row.within7Days > 0 ? 'font-semibold text-warning' : 'text-muted-foreground'}`}>{row.within7Days}</TD>
                  <TD className="figure text-right text-muted-foreground">{row.expiringSoon}</TD>
                  <TD className="figure text-right text-muted-foreground">{row.valid}</TD>
                  <TD className="figure text-right text-muted-foreground">{row.notUploaded ?? '—'}</TD>
                  <TD className="figure text-right text-muted-foreground">{row.pendingVerification}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel className="mt-6" title={t('admin.docsApi.documents')}>
        <FilterBar
          active={filtersActive}
          onClear={() => {
            for (const reset of [setType, setVehicleId, setDriverId, setStatus, setVerificationStatus, setExpiryFrom, setExpiryTo]) reset('');
            setCursors([undefined]);
            setPageIndex(0);
          }}
        >
          <NativeSelect value={type} onChange={(e) => setFilter(setType)(e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.docsApi.document')}>
            <option value="">{t('admin.documents.allTypes')}</option>
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {t(docTypeLabelKey(value))}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={vehicleId} onChange={(e) => setFilter(setVehicleId)(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.common.vehicle')}>
            <option value="">{t('admin.common.allVehicles')}</option>
            {(vehicles.data?.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.registrationNumber}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={driverId} onChange={(e) => setFilter(setDriverId)(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.common.driver')}>
            <option value="">{t('admin.common.allDrivers')}</option>
            {(drivers.data?.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.employee.fullName}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={status} onChange={(e) => setFilter(setStatus)(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.common.status')}>
            <option value="">{t('admin.docsApi.anyStatus')}</option>
            <option value="EXPIRED">{t('expiry.expired')}</option>
            <option value="WITHIN_7_DAYS">{t('admin.docsApi.within7')}</option>
            <option value="EXPIRING_SOON">{t('expiry.expiringSoon')}</option>
            <option value="VALID">{t('expiry.valid')}</option>
          </NativeSelect>
          <Input type="date" value={expiryFrom} onChange={(e) => setFilter(setExpiryFrom)(e.target.value)} className="w-auto" aria-label={t('admin.docsApi.expiryFrom')} />
          <Input type="date" value={expiryTo} onChange={(e) => setFilter(setExpiryTo)(e.target.value)} className="w-auto" aria-label={t('admin.docsApi.expiryTo')} />
        </FilterBar>

        {list.loading ? (
          <TableLoading columns={6} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <TH>{t('admin.docsApi.document')}</TH>
                  <TH>{t('admin.docsApi.owner')}</TH>
                  <TH>{t('admin.docsApi.number')}</TH>
                  <TH>{t('admin.docsApi.expiryDate')}</TH>
                  <TH>{t('admin.common.status')}</TH>
                  <TH>{t('admin.docsApi.verification')}</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((doc) => (
                  <TR key={doc.id} onClick={() => setOpenId(doc.id)} data-testid="document-row">
                    <TD className="font-medium">{doc.customName ?? t(docTypeLabelKey(doc.type))}</TD>
                    <TD>{doc.vehicle ? <Plate reg={doc.vehicle.registrationNumber} size="xs" /> : doc.employee?.fullName ?? '—'}</TD>
                    <TD className="figure text-muted-foreground">{doc.documentNumber ?? '—'}</TD>
                    <TD className="whitespace-nowrap">{doc.expiryDate ? fmtDate(doc.expiryDate) : '—'}</TD>
                    <TD>
                      <ComplianceBadge status={doc.status} daysRemaining={doc.daysRemaining} />
                    </TD>
                    <TD>
                      <VerificationBadge value={doc.verificationStatus} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            {rows.length === 0 && (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">{filtersActive ? t('admin.common.noResults') : t('admin.docsApi.empty')}</p>
            )}
            {(pageIndex > 0 || nextCursor) && (
              <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                <Button variant="outline" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))}>
                  {t('admin.common.prev')}
                </Button>
                <Button
                  variant="outline"
                  disabled={!nextCursor}
                  onClick={() => {
                    if (!nextCursor) return;
                    setCursors((all) => (all[pageIndex + 1] ? all : [...all.slice(0, pageIndex + 1), nextCursor]));
                    setPageIndex((p) => p + 1);
                  }}
                >
                  {t('admin.common.next')}
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>

      <DocumentDetailDialog documentId={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} />
      <UploadDocumentDialog
        open={uploading}
        onOpenChange={setUploading}
        onSaved={() => {
          setUploading(false);
          reloadAll();
        }}
      />
    </div>
  );
}
