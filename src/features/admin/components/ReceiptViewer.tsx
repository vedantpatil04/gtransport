import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchReceiptUrl } from '@/features/api/resources';
import { InlineBusy } from './states';

/**
 * Shows a stored receipt. The file is fetched with the session token (receipts are never
 * public) and displayed as an image, or embedded when it is a PDF.
 */
export function ReceiptViewer({ fileId, title, onClose }: { fileId: string | null; title: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ url: string; mimeType: string } | 'loading' | 'error'>('loading');

  useEffect(() => {
    if (!fileId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setState('loading');

    fetchReceiptUrl(fileId)
      .then((result) => {
        objectUrl = result.url;
        if (cancelled) URL.revokeObjectURL(result.url);
        else setState(result);
      })
      .catch(() => !cancelled && setState('error'));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  return (
    <Dialog open={Boolean(fileId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-[240px] items-center justify-center rounded-lg bg-muted/40">
          {state === 'loading' ? (
            <InlineBusy label={t('common.loading')} />
          ) : state === 'error' ? (
            <p className="text-sm text-muted-foreground">{t('admin.fuelApi.receiptError')}</p>
          ) : state.mimeType === 'application/pdf' ? (
            <iframe title={title} src={state.url} className="h-[70vh] w-full rounded-lg" />
          ) : (
            <img src={state.url} alt={title} className="max-h-[70vh] w-auto rounded-lg object-contain" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
