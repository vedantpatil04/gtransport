import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FilePlus2, FileText, IdCard, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { Plate } from '@/components/Plate';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ExpiryChip, VerificationChip, useExpiryLabel } from '@/components/status';
import { FileView } from '@/components/media/FileView';
import { DOC_TYPES, docTypeConfig } from '@/data/constants';
import { DocUploadForm, type DocTarget } from '@/features/documents/DocUploadForm';
import { docStatus, LEVEL_STYLES } from '@/features/documents/expiry';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApp, useCurrentDriver } from '@/store';
import type { DocRecord, DocType } from '@/types';
import { DriverHeader } from '../components/DriverHeader';
import { useMyDocuments, useMyVehicle } from '../useDriverData';

const docName = (t: (k: string) => string, d: Pick<DocRecord, 'type' | 'customName'>) => d.customName || t(`enum.docType.${d.type}`);

export function DriverDocuments() {
  const { t } = useTranslation();
  const driver = useCurrentDriver();
  const vehicle = useMyVehicle();
  const { vehicleDocs, driverDocs } = useMyDocuments();
  const [target, setTarget] = useState<DocTarget | null>(null);
  const [choose, setChoose] = useState(false);

  const missingCore = (owner: 'vehicle' | 'driver', have: DocRecord[]) => DOC_TYPES.filter((d) => d.owner === owner && d.core && !have.some((h) => h.type === d.type)).map((d) => d.type);
  const addable: { type: DocType; owner: 'vehicle' | 'driver' }[] = [
    ...(vehicle ? DOC_TYPES.filter((d) => d.owner === 'vehicle' && !vehicleDocs.some((h) => h.type === d.type)).map((d) => ({ type: d.type, owner: 'vehicle' as const })) : []),
    ...DOC_TYPES.filter((d) => d.owner === 'driver' && (d.type === 'other' || !driverDocs.some((h) => h.type === d.type))).map((d) => ({ type: d.type, owner: 'driver' as const })),
  ];

  const section = (title: string, docs: DocRecord[], owner: 'vehicle' | 'driver', icon: typeof FileText, header?: React.ReactNode) => (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {header}
      </div>
      <ul className="panel divide-y overflow-hidden">
        {docs.map((d) => (
          <DocRow key={d.id} doc={d} icon={icon} />
        ))}
        {missingCore(owner, docs).map((type) => (
          <li key={type}>
            <button onClick={() => setTarget({ ownerType: owner, ownerId: owner === 'vehicle' ? vehicle!.id : driver.id, type })} className="flex min-h-[68px] w-full items-center gap-3 px-3 py-3 text-left hover:bg-accent/60">
              <span className="flex size-11 items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground">
                <Upload className="size-5" />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{t(`enum.docType.${type}`)}</span>
                <span className="text-sm text-danger">{t('driver.docs.notUploaded')}</span>
              </span>
              <span className="text-sm font-semibold text-primary">{t('driver.docs.upload')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div>
      <DriverHeader title={t('driver.docs.title')} />
      <div className="space-y-6 px-4 py-5">
        {vehicle ? section(t('driver.docs.vehicle'), vehicleDocs, 'vehicle', ShieldCheck, <Plate reg={vehicle.reg} size="xs" />) : <p className="panel p-4 text-sm text-muted-foreground">{t('driver.docs.noVehicle')}</p>}
        {section(t('driver.docs.driver'), driverDocs, 'driver', IdCard)}
        {addable.length > 0 && (
          <Button variant="outline" size="xl" className="w-full border-2 border-dashed" onClick={() => setChoose(true)} data-testid="doc-add-other">
            <FilePlus2 />
            {t('driver.docs.addOther')}
          </Button>
        )}
      </div>

      <Sheet open={choose} onOpenChange={setChoose}>
        <SheetContent side="bottom" className="mx-auto max-w-[440px]">
          <div className="px-5 pb-7 pt-3">
            <SheetTitle>{t('driver.docs.chooseType')}</SheetTitle>
            <div className="mt-4 space-y-2">
              {addable.map((a) => (
                <button
                  key={`${a.owner}-${a.type}`}
                  onClick={() => {
                    setChoose(false);
                    setTarget({ ownerType: a.owner, ownerId: a.owner === 'vehicle' ? vehicle!.id : driver.id, type: a.type });
                  }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 text-left hover:bg-accent"
                >
                  <FileText className="size-5 text-muted-foreground" />
                  <span className="flex-1 font-semibold">{t(`enum.docTypeLong.${a.type}`)}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <DocUploadSheet target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function DocRow({ doc, icon: Icon }: { doc: DocRecord; icon: typeof FileText }) {
  const { t } = useTranslation();
  const label = useExpiryLabel();
  const s = docStatus(doc);
  return (
    <li>
      <Link to={`/driver/documents/${doc.id}`} className="flex min-h-[68px] items-center gap-3 px-3 py-3 hover:bg-accent/60" data-testid={`driver-doc-${doc.type}`}>
        <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg', s.level === 0 ? 'bg-muted text-foreground/70' : LEVEL_STYLES[s.level].chip)}>
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{docName(t, doc)}</span>
          <span className={cn('block truncate text-sm', s.level === 0 ? 'text-muted-foreground' : LEVEL_STYLES[s.level].text)}>{s.state === 'none' ? t('expiry.noExpiry') : label(doc)}</span>
        </span>
        <ExpiryChip doc={doc} />
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

function DocUploadSheet({ target, onClose }: { target: DocTarget | null; onClose: () => void }) {
  const { t } = useTranslation();
  if (!target) return null;
  const title = target.existing ? t('driver.docs.replaceTitle', { doc: docName(t, target.existing) }) : t('driver.docs.uploadTitle', { doc: t(`enum.docType.${target.type}`) });
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-[440px]">
        <div className="overflow-y-auto px-5 pb-7 pt-3">
          <SheetTitle className="mb-4 pr-8">{title}</SheetTitle>
          <DocUploadForm
            target={target}
            variant="driver"
            onDone={() => {
              toast.success(t('driver.docs.saved'), { description: t('driver.docs.savedHint') });
              onClose();
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DriverDocumentDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const doc = useApp((s) => s.documents.find((d) => d.id === id));
  const vehicles = useApp((s) => s.vehicles);
  const [replace, setReplace] = useState(false);
  const label = useExpiryLabel();
  if (!doc)
    return (
      <div>
        <DriverHeader title={t('driver.docs.title')} back="/driver/documents" />
        <EmptyState icon={FileText} title={t('driver.docs.notFound')} />
      </div>
    );
  const s = docStatus(doc);
  const cfg = docTypeConfig(doc.type);
  const owner = doc.ownerType === 'vehicle' ? vehicles.find((v) => v.id === doc.ownerId)?.reg : null;
  const rows: [string, React.ReactNode][] = [
    [t('driver.docs.name'), docName(t, doc)],
    [t('driver.docs.issuer'), doc.issuer || '—'],
    [doc.type === 'insurance' ? t('driver.docs.policyNumber') : t('driver.docs.number'), <span className="font-mono text-[14px]">{doc.number || '—'}</span>],
    [t('driver.docs.expiry'), cfg.hasExpiry && doc.expiresOn ? fmtDate(doc.expiresOn, i18n.language) : t('expiry.noExpiry')],
    [t('driver.docs.uploadedOn'), fmtDate(doc.uploadedAt, i18n.language)],
    [t('driver.docs.office'), <VerificationChip value={doc.verification} />],
  ];
  return (
    <div data-testid="driver-doc-detail">
      <DriverHeader title={docName(t, doc)} back="/driver/documents" />
      <div className="space-y-5 px-4 py-5">
        {s.level > 0 && (
          <div className={cn('rounded-xl border p-4', LEVEL_STYLES[s.level].banner)}>
            <p className="text-lg font-bold">{label(doc)}</p>
            {owner && <p className="text-sm opacity-85">{owner}</p>}
          </div>
        )}
        {doc.file ? <FileView file={doc.file} alt={docName(t, doc)} /> : null}
        <dl className="panel divide-y text-[15px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-between gap-2">
          <ExpiryChip doc={doc} long />
        </div>
        <Button size="xl" className="h-14 w-full" onClick={() => setReplace(true)} data-testid="doc-replace">
          <Upload />
          {t('driver.docs.replace')}
        </Button>
      </div>
      <DocUploadSheet target={replace ? { ownerType: doc.ownerType, ownerId: doc.ownerId, type: doc.type, existing: doc } : null} onClose={() => setReplace(false)} />
    </div>
  );
}
