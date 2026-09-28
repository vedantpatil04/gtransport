import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label } from '@/components/ui/input';
import { useSession } from '@/features/api/session';
import { ApiError } from '@/lib/api/client';

/**
 * Sets a new password. The API checks the current one and the strength rules, ends every other
 * session, and hands back a fresh token — so this session simply carries on.
 */
function ChangePasswordForm({ onDone, submitLabel }: { onDone: () => void; submitLabel: string }) {
  const { t } = useTranslation();
  const changePassword = useSession((s) => s.changePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next !== confirm) return setErrors({ confirm: t('admin.password.mismatch') });
    setErrors({});
    setBusy(true);
    try {
      await changePassword(current, next);
      toast.success(t('admin.password.changed'));
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fields = cause.fieldErrors;
        setErrors(Object.keys(fields).length ? fields : { form: cause.message });
      } else setErrors({ form: t('common.somethingWrong') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pw-current">{t('admin.password.current')}</Label>
        <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <FieldError>{errors.currentPassword}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-new">{t('admin.password.new')}</Label>
        <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <FieldError>{errors.newPassword}</FieldError>
        <p className="text-xs text-muted-foreground">{t('admin.password.rules')}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-confirm">{t('admin.password.confirm')}</Label>
        <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <FieldError>{errors.confirm}</FieldError>
      </div>
      <FieldError>{errors.form}</FieldError>
      <Button type="submit" className="w-full" disabled={busy || !current || !next || !confirm}>
        {busy ? t('common.loading') : submitLabel}
      </Button>
    </form>
  );
}

/** First sign-in with a temporary password: nothing else is reachable until this is done. */
export function ForcedPasswordChange() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm" data-testid="forced-password-change">
        <Logo size="lg" className="mb-8 flex justify-center" />
        <div className="panel p-6 shadow-sm">
          <h1 className="text-xl font-bold">{t('admin.password.forcedTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.password.forcedBody', { name: user?.displayName ?? '' })}</p>
          <div className="mt-6">
            <ChangePasswordForm submitLabel={t('admin.password.setAndContinue')} onDone={() => undefined} />
          </div>
          <button type="button" onClick={signOut} className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground">
            {t('admin.top.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.password.title')}</DialogTitle>
          <DialogDescription>{t('admin.password.hint')}</DialogDescription>
        </DialogHeader>
        {open && <ChangePasswordForm submitLabel={t('admin.password.save')} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
