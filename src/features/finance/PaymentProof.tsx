import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Eye, FileText, Paperclip, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, Textarea } from '@/components/ui/input';
import { paymentsApi, uploadDocumentFile } from '@/features/api/resources';
import type { ApiPayment } from '@/features/api/types';
import { ApiError } from '@/lib/api/client';
import { saveFile } from '@/lib/download';
import { fmtDateTime } from '@/lib/format';
import { Footer, FormError, PROOF_ACCEPT, useSubmit } from './FinanceDialogs';

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Proof of payment: the bank screenshot, receipt or cheque scan. Fetched with the session (it is
 * private, payroll roles only), previewed inline for images, and downloadable — which in the phone
 * app goes through its download bridge. Replacing keeps the original on record (the API never
 * deletes a proof; the audit log names both files).
 */
export function PaymentProof({ payment, onChanged }: { payment: ApiPayment; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'view' | 'download' | null>(null);
  const [preview, setPreview] = useState<{ url: string; mimeType: string } | null>(null);
  const proof = payment.proof ?? null;
  const canAttach = payment.status !== 'CANCELLED';

  // A preview belongs to one file: drop it when the proof changes, and free the memory.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);
  useEffect(() => setPreview(null), [proof?.fileId]);

  const upload = async (file: File) => {
    setBusy('upload');
    try {
      const fileId = await uploadDocumentFile(file);
      await paymentsApi.attachProof(payment.id, fileId);
      toast.success(proof ? t('admin.paymentsApi.proofReplaced') : t('admin.paymentsApi.proofAttached'));
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError || cause instanceof Error ? cause.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const view = async () => {
    setBusy('view');
    try {
      setPreview(await paymentsApi.proofUrl(payment.id));
    } catch {
      toast.error(t('admin.paymentsApi.proofFailed'));
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!proof) return;
    setBusy('download');
    try {
      const { url } = await paymentsApi.proofUrl(payment.id);
      const blob = await (await fetch(url)).blob();
      URL.revokeObjectURL(url);
      const result = await saveFile(proof.filename, blob);
      if (result === 'failed') toast.error(t('admin.paymentsApi.proofFailed'));
    } catch {
      toast.error(t('admin.paymentsApi.proofFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border p-3" data-testid="payment-proof">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip className="size-4" />
          {t('admin.paymentsApi.proof')}
        </h3>
        {canAttach && (
          <>
            <input ref={input} type="file" accept={PROOF_ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} data-testid="proof-input" />
            <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy !== null}>
              <Upload />
              {busy === 'upload' ? t('common.loading') : proof ? t('admin.paymentsApi.replaceProof') : t('admin.paymentsApi.uploadProof')}
            </Button>
          </>
        )}
      </div>
      {proof ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">{proof.filename}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{kb(proof.sizeBytes)}</span>
          </div>
          {proof.uploadedAt && <p className="text-xs text-muted-foreground">{t('admin.paymentsApi.proofUploaded', { when: fmtDateTime(proof.uploadedAt, i18n.language) })}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void view()} disabled={busy !== null}>
              <Eye />
              {t('admin.paymentsApi.viewProof')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void download()} disabled={busy !== null}>
              <Download />
              {t('admin.common.download')}
            </Button>
          </div>
          {preview &&
            (preview.mimeType.startsWith('image/') ? (
              <img src={preview.url} alt={proof.filename} className="max-h-80 w-full rounded-md border object-contain" />
            ) : (
              // PDFs: browsers show them inline; the phone's WebView cannot, so Download is offered too.
              <object data={preview.url} type={preview.mimeType} className="h-80 w-full rounded-md border">
                <p className="p-3 text-sm text-muted-foreground">{t('admin.paymentsApi.proofNoPreview')}</p>
              </object>
            ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t('admin.paymentsApi.noProof')}</p>
      )}
    </div>
  );
}

/** Edits the description and remarks only — the API refuses any financial change here. */
export function PaymentNotesDialog({ payment, open, onOpenChange, onSaved }: { payment: ApiPayment; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [remarks, setRemarks] = useState('');
  const form = useSubmit();
  useEffect(() => {
    if (!open) return;
    setDescription(payment.description ?? '');
    setRemarks(payment.remarks ?? '');
    form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.paymentsApi.editNotes')}</DialogTitle>
          <DialogDescription>{t('admin.paymentsApi.editNotesHint')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.run(async () => {
              await paymentsApi.updateNotes(payment.id, { description, remarks });
              toast.success(t('admin.common.saved'));
              onSaved();
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="pn-desc">{t('admin.paymentsApi.description')}</Label>
            <Input id="pn-desc" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
            <FieldError>{form.fieldErrors.description}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pn-remarks">{t('admin.paymentsApi.remarks')}</Label>
            <Textarea id="pn-remarks" value={remarks} maxLength={1000} rows={3} onChange={(e) => setRemarks(e.target.value)} />
            <FieldError>{form.fieldErrors.remarks}</FieldError>
          </div>
          <FormError message={form.error} />
          <Footer busy={form.busy} onCancel={() => onOpenChange(false)} label={t('common.save')} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

