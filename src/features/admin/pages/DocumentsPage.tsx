import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BellRing, CircleCheckBig, MoreHorizontal, ShieldAlert, ShieldCheck, TriangleAlert, Upload, Eye, BadgeCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { ExpiryChip, VerificationChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/ui/input';
import { DOC_TYPES } from '@/data/constants';
import type { DocTarget } from '@/features/documents/DocUploadForm';
import { DocumentSheet, REMIND_ICON, useDocReminder } from '@/features/documents/DocumentSheet';
import { docStatus, responsibleDriverId } from '@/features/documents/expiry';
import { fmtDate, fmtDayMonth } from '@/lib/format';
import { cn, normalize } from '@/lib/utils';
import { useApp } from '@/store';
import { useConnected } from '@/features/api/mode';
import { DocumentsConnected } from './DocumentsConnected';
import type { DocRecord, ReminderTarget } from '@/types';
import { ConfirmDialog, PageHeader, Panel, SearchInput, Table, TD, TH, TR } from '../components/ui';
import { useComplianceCounts } from '../useAdminData';
import { UploadDocDialog } from './VehiclesPage';

type Bucket = 'all' | 'valid' | 'expiring' | 'expired';
type Band = 'expired' | 'within7' | 'within30' | 'valid';

const bandOf = (d: DocRecord): Band => {
  const s = docStatus(d);
  if (s.state === 'expired') return 'expired';
  if (s.state === 'expiring') return (s.days ?? 99) <= 7 ? 'within7' : 'within30';
  return 'valid';
};

function DocumentsDemo() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const documents = useApp((s) => s.documents);
  const vehicles = useApp((s) => s.vehicles);
  const drivers = useApp((s) => s.drivers);
  const counts = useComplianceCounts();
  const remind = useDocReminder();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [type, setType] = useState('');
  const [owner, setOwner] = useState('');
  const [band, setBand] = useState<Band | ''>('');
  const [upload, setUpload] = useState<DocTarget | null>(null);
  const [bulk, setBulk] = useState(false);
  const bucket = (params.get('tab') as Bucket) ?? 'all';
  const vehicleId = params.get('vehicle') ?? '';
  const driverId = params.get('driver') ?? '';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'all') next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const ownerLabel = (d: DocRecord) => (d.ownerType === 'vehicle' ? vehicles.find((v) => v.id === d.ownerId)?.reg ?? '' : drivers.find((x) => x.id === d.ownerId)?.name ?? '');
  const bucketCounts = useMemo(() => {
    const c = { all: documents.length, valid: 0, expiring: 0, expired: 0 };
    documents.forEach((d) => {
      const s = docStatus(d).state;
      if (s === 'expired') c.expired += 1;
      else if (s === 'expiring') c.expiring += 1;
      else c.valid += 1;
    });
    return c;
  }, [documents]);

  const rows = useMemo(() => {
    const nq = normalize(q);
    return documents
      .filter((d) => {
        const s = docStatus(d).state;
        if (bucket === 'valid') return s === 'valid' || s === 'none';
        if (bucket === 'expiring') return s === 'expiring';
        if (bucket === 'expired') return s === 'expired';
        return true;
      })
      .filter((d) => !band || bandOf(d) === band)
      .filter((d) => !type || d.type === type)
      .filter((d) => !owner || d.ownerType === owner)
      .filter((d) => !vehicleId || (d.ownerType === 'vehicle' && d.ownerId === vehicleId))
      .filter((d) => !driverId || (d.ownerType === 'driver' ? d.ownerId === driverId : vehicles.find((v) => v.id === d.ownerId)?.driverId === driverId))
      .filter((d) => !nq || normalize(`${ownerLabel(d)} ${d.number} ${d.issuer} ${t(`enum.docTypeLong.${d.type}`)}`).includes(nq))
      .sort((a, b) => docStatus(b).level - docStatus(a).level || (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, vehicles, drivers, bucket, band, type, owner, q, vehicleId, driverId, t]);

  const urgent = documents.filter((d) => docStatus(d).level >= 3);

  const sendAll = () => {
    let n = 0;
    urgent.forEach((d) => {
      if (responsibleDriverId(d, vehicles)) {
        useApp.getState().sendDocReminder(d.id, 'driver');
        n += 1;
      }
      if (d.type === 'insurance') {
        useApp.getState().sendDocReminder(d.id, 'insurer');
        n += 1;
      }
    });
    toast.success(t('admin.documents.bulkSent', { count: n }));
  };

  const band_ = (b: Band, label: string, value: number, icon: typeof ShieldAlert, cls: string) => {
    const Icon = icon;
    const active = band === b;
    return (
      <button onClick={() => { setBand(active ? '' : b); setParam('tab', 'all'); }} aria-pressed={active} className={cn('rounded-lg border p-4 text-left transition-colors', active ? 'ring-2 ring-primary' : 'hover:bg-accent/40', cls)} data-testid={`compliance-${b}`}>
        <span className="flex items-center justify-between text-sm font-medium">
          {label}
          <Icon className="size-4" />
        </span>
        <span className="figure mt-1 block text-3xl font-bold">{value}</span>
      </button>
    );
  };

  return (
    <div>
      <PageHeader
        title={t('admin.documents.title')}
        description={t('admin.documents.subtitle')}
        actions={
          urgent.length > 0 && (
            <Button onClick={() => setBulk(true)} data-testid="doc-bulk-remind">
              <BellRing />
              {t('admin.documents.remindUrgent', { count: urgent.length })}
            </Button>
          )
        }
      />
      <section aria-label={t('admin.documents.compliance')}>
        <h2 className="mb-3 text-base font-semibold">{t('admin.documents.compliance')}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {band_('expired', t('admin.documents.band.expired'), counts.expired, ShieldAlert, 'border-danger/30 bg-danger-soft text-danger')}
          {band_('within7', t('admin.documents.band.within7'), counts.within7, TriangleAlert, 'border-danger/20 bg-[hsl(var(--danger-soft)/0.55)] text-danger')}
          {band_('within30', t('admin.documents.band.within30'), counts.within30, TriangleAlert, 'border-warning/30 bg-warning-soft text-warning')}
          {band_('valid', t('admin.documents.band.valid'), counts.valid, ShieldCheck, 'bg-card text-success')}
        </div>
      </section>

      <Panel className="mt-6">
        <div className="scroll-thin flex gap-1 overflow-x-auto border-b px-2 pt-2" role="tablist">
          {(['all', 'valid', 'expiring', 'expired'] as Bucket[]).map((b) => (
            <button
              key={b}
              role="tab"
              aria-selected={bucket === b}
              onClick={() => { setBand(''); setParam('tab', b); }}
              className={cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1.5 text-sm font-medium', bucket === b ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
              data-testid={`docs-tab-${b}`}
            >
              {t(`admin.documents.tab.${b}`)}
              <span className={cn('figure rounded-full px-1.5 text-xs', b === 'expired' && bucketCounts.expired ? 'bg-danger text-white' : b === 'expiring' && bucketCounts.expiring ? 'bg-warning text-white' : 'bg-muted')}>{bucketCounts[b]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
          <SearchInput value={q} onChange={setQ} placeholder={t('admin.documents.search')} className="w-full sm:w-72" />
          <NativeSelect value={type} onChange={(e) => setType(e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.type')}>
            <option value="">{t('admin.documents.allTypes')}</option>
            {DOC_TYPES.map((d) => (
              <option key={d.type} value={d.type}>
                {t(`enum.docTypeLong.${d.type}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={owner} onChange={(e) => setOwner(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.documents.owner')}>
            <option value="">{t('admin.documents.allOwners')}</option>
            <option value="vehicle">{t('admin.documents.vehicleDocs')}</option>
            <option value="driver">{t('admin.documents.driverDocs')}</option>
          </NativeSelect>
          {(band || vehicleId || driverId) && (
            <Button variant="ghost" size="sm" onClick={() => { setBand(''); setParams({}, { replace: true }); }}>
              <X />
              {t('admin.common.clearFilters')}
            </Button>
          )}
        </div>
        <Table>
          <thead>
            <tr>
              <TH>{t('admin.documents.document')}</TH>
              <TH>{t('admin.documents.owner')}</TH>
              <TH>{t('admin.documents.expiresOn')}</TH>
              <TH>{t('admin.common.status')}</TH>
              <TH>{t('admin.documents.check')}</TH>
              <TH>{t('admin.documents.lastReminder')}</TH>
              <TH className="w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const last = d.reminders[d.reminders.length - 1];
              return (
                <TR key={d.id} onClick={() => setParam('doc', d.id)} data-testid="doc-row">
                  <TD className="min-w-[200px]">
                    <span className="block font-medium">{d.customName || t(`enum.docTypeLong.${d.type}`)}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{d.number}</span>
                  </TD>
                  <TD>{d.ownerType === 'vehicle' ? <Plate reg={ownerLabel(d)} size="xs" /> : <span className="whitespace-nowrap">{ownerLabel(d)}</span>}</TD>
                  <TD className="whitespace-nowrap">{d.expiresOn ? fmtDate(d.expiresOn, i18n.language) : '—'}</TD>
                  <TD>
                    <ExpiryChip doc={d} long />
                  </TD>
                  <TD>
                    <VerificationChip value={d.verification} />
                  </TD>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">{last ? `${t(`admin.documents.sentTo.${last.to}`)} · ${fmtDayMonth(last.at, i18n.language)}` : '—'}</TD>
                  <TD>
                    <DocMenu doc={d} onView={() => setParam('doc', d.id)} onReplace={() => setUpload({ ownerType: d.ownerType, ownerId: d.ownerId, type: d.type, existing: d })} onRemind={(to) => remind(d, to)} />
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-sm text-muted-foreground">
            <CircleCheckBig className="size-6 text-success" />
            {t('admin.documents.none')}
          </div>
        )}
      </Panel>
      <DocumentSheet docId={params.get('doc')} onClose={() => setParam('doc', '')} onReplace={(d) => setUpload({ ownerType: d.ownerType, ownerId: d.ownerId, type: d.type, existing: d })} />
      <UploadDocDialog target={upload} onClose={() => setUpload(null)} />
      <ConfirmDialog open={bulk} onOpenChange={setBulk} title={t('admin.documents.bulkTitle')} description={t('admin.documents.bulkBody', { count: urgent.length })} confirmLabel={t('admin.documents.sendNow')} onConfirm={sendAll} />
    </div>
  );
}

function DocMenu({ doc, onView, onReplace, onRemind }: { doc: DocRecord; onView: () => void; onReplace: () => void; onRemind: (to: ReminderTarget) => void }) {
  const { t } = useTranslation();
  const targets: ReminderTarget[] = doc.type === 'insurance' ? ['driver', 'admin', 'insurer'] : ['driver', 'admin'];
  const verify = (v: DocRecord['verification']) => {
    useApp.getState().setDocVerification(doc.id, v);
    toast.success(t(`admin.documents.verificationSet.${v}`));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()} aria-label={t('admin.common.actions')}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} className="w-52">
        <DropdownMenuItem onSelect={onView}>
          <Eye />
          {t('common.view')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => verify('verified')}>
          <BadgeCheck />
          {t('admin.documents.verify')}
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={() => verify('rejected')}>
          <X />
          {t('admin.documents.reject')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReplace}>
          <Upload />
          {t('admin.documents.replace')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('admin.documents.sendReminder')}</DropdownMenuLabel>
        {targets.map((to) => {
          const Icon = REMIND_ICON[to];
          return (
            <DropdownMenuItem key={to} onSelect={() => onRemind(to)}>
              <Icon />
              {t(`admin.documents.notify.${to}`)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


/**
 * Demo mode keeps the approved prototype exactly as it was; connected mode reads the real
 * Phase 4 documents. Same "Documents & Compliance" entry — no second tab.
 */
export function DocumentsPage() {
  return useConnected() ? <DocumentsConnected /> : <DocumentsDemo />;
}
