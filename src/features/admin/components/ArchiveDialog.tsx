import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label } from '@/components/ui/input';

/**
 * Archiving a financial record requires a reason: it stays on record for audit, and the
 * reason is what a later reader needs to understand why it no longer counts.
 */
export function ArchiveDialog({
  open,
  title,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return setError(t('admin.fuelApi.reasonRequired'));
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('admin.fuelApi.archiveNote')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="archive-reason">{t('admin.fuelApi.archiveReason')}</Label>
            <Input id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus aria-invalid={Boolean(error)} />
            <FieldError>{error ?? undefined}</FieldError>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? t('common.loading') : t('admin.fuelApi.archive')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
