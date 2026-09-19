import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, ImageOff, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useFileUrl } from '@/hooks/useFileUrl';
import { useApp } from '@/store';
import { cn } from '@/lib/utils';
import type { FileRef } from '@/types';
import { DocumentArt } from './DocumentArt';
import { ExpenseBillArt, FuelReceiptArt } from './ReceiptArt';

/** Renders seeded (generated) files from the record they belong to. */
function GeneratedFile({ id }: { id: string }) {
  const [, kind, recordId] = id.split(':');
  const fuel = useApp((s) => (kind === 'receipt' ? s.fuel.find((f) => f.id === recordId) : undefined));
  const expense = useApp((s) => (kind === 'expense' ? s.expenses.find((e) => e.id === recordId) : undefined));
  const doc = useApp((s) => (kind === 'doc' ? s.documents.find((d) => d.id === recordId) : undefined));
  const vehicles = useApp((s) => s.vehicles);
  const drivers = useApp((s) => s.drivers);
  const reg = (vid: string) => vehicles.find((v) => v.id === vid)?.reg ?? '';
  if (fuel) return <FuelReceiptArt entry={fuel} reg={reg(fuel.vehicleId)} />;
  if (expense) return <ExpenseBillArt expense={expense} reg={reg(expense.vehicleId)} />;
  if (doc) {
    const vehicle = doc.ownerType === 'vehicle' ? vehicles.find((v) => v.id === doc.ownerId) : undefined;
    const driver = doc.ownerType === 'driver' ? drivers.find((d) => d.id === doc.ownerId) : undefined;
    return <DocumentArt doc={doc} ownerLabel={vehicle?.reg ?? driver?.name.toUpperCase() ?? ''} ownerName={driver?.name ?? ''} model={vehicle?.model} />;
  }
  return <Missing />;
}

function Missing() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
      <ImageOff className="size-8" />
      <span className="text-sm">{t('common.notAvailable')}</span>
    </div>
  );
}

/** Shows an uploaded or generated file inline. Images open in a zoomable viewer. */
export function FileView({ file, className, alt }: { file: FileRef; className?: string; alt?: string }) {
  const { t } = useTranslation();
  const { url, loading } = useFileUrl(file);
  const [zoom, setZoom] = useState(false);

  if (file.kind === 'generated') {
    return (
      <div className={cn('rounded-lg bg-[repeating-linear-gradient(135deg,hsl(var(--muted))_0_10px,hsl(var(--background))_10px_20px)] px-3 py-5', className)}>
        <GeneratedFile id={file.id} />
      </div>
    );
  }
  if (loading)
    return (
      <div className={cn('flex h-48 items-center justify-center rounded-lg bg-muted', className)}>
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (!url) return <Missing />;
  if (file.kind === 'pdf') {
    return (
      <div className={cn('overflow-hidden rounded-lg border bg-muted', className)}>
        <object data={url} type="application/pdf" className="h-[420px] w-full" aria-label={alt}>
          <a href={url} download={file.name ?? 'document.pdf'} className="flex items-center justify-center gap-2 p-8 text-sm font-semibold text-primary underline">
            <FileText className="size-5" />
            {file.name ?? t('driver.docs.pdf')}
          </a>
        </object>
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setZoom(true)} className={cn('group relative block w-full overflow-hidden rounded-lg border bg-muted', className)} aria-label={t('driver.docs.tapToZoom')}>
        <img src={url} alt={alt ?? ''} className="max-h-[420px] w-full object-contain" />
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
          <ZoomIn className="size-3.5" />
          {t('driver.docs.tapToZoom')}
        </span>
      </button>
      <ZoomDialog open={zoom} onOpenChange={setZoom} url={url} alt={alt} />
    </>
  );
}

function ZoomDialog({ open, onOpenChange, url, alt }: { open: boolean; onOpenChange: (v: boolean) => void; url: string; alt?: string }) {
  const [scale, setScale] = useState(1);
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setScale(1); }}>
      <DialogContent className="max-w-[min(96vw,1100px)] gap-0 bg-[#0b1320] p-0 text-white">
        <DialogTitle className="sr-only">{alt ?? 'Image'}</DialogTitle>
        <div className="max-h-[82dvh] overflow-auto">
          <img src={url} alt={alt ?? ''} style={{ width: `${scale * 100}%` }} className="mx-auto max-w-none transition-[width]" />
        </div>
        <div className="flex justify-center gap-2 border-t border-white/10 p-2">
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setScale((s) => Math.max(1, s - 0.5))} aria-label="−">
            <ZoomOut />
          </Button>
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setScale((s) => Math.min(3, s + 0.5))} aria-label="+">
            <ZoomIn />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
