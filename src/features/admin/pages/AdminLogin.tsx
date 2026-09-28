import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { isApiConfigured } from '@/features/api/mode';
import { NotOfficeAccountError, useSession } from '@/features/api/session';
import { ApiError } from '@/lib/api/client';
import { useApp } from '@/store';

/**
 * Admin sign-in. With an API configured this authenticates for real; without one it keeps
 * the prototype's demo sign-in so the standalone demo still works.
 */
export function AdminLogin() {
  const { t } = useTranslation();
  const connected = isApiConfigured();
  const signIn = useSession((s) => s.signIn);
  const ended = useSession((s) => s.endedMessage);

  const [identifier, setIdentifier] = useState(connected ? '' : 'office@gangamatatransport.in');
  const [password, setPassword] = useState(connected ? '' : 'demo-password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    if (!connected) {
      window.setTimeout(() => useApp.getState().login('admin'), 500);
      return;
    }

    try {
      // Drivers use the phone app; signIn refuses them before any session is stored.
      await signIn(identifier, password);
      // The prototype's own view state still drives which shell is shown.
      useApp.getState().login('admin');
    } catch (cause) {
      if (cause instanceof NotOfficeAccountError) setError(t('admin.login.errNotOffice'));
      else setError(cause instanceof ApiError ? cause.message : t('admin.api.errorTitle'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={connected ? 'flex min-h-dvh items-center justify-center px-4 py-10' : 'flex min-h-[calc(100dvh-36px)] items-center justify-center px-4 py-10'}>
      <div className="w-full max-w-sm">
        <Logo size="lg" className="mb-8 flex justify-center" />
        <div className="panel p-6 shadow-sm">
          <h1 className="text-xl font-bold">{t('admin.login.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.login.subtitle')}</p>
          {connected && ended && (
            <p className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" role="status" data-testid="session-ended">
              {t('admin.login.sessionEnded')}
            </p>
          )}
          <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">{connected ? t('admin.login.identifier') : t('admin.login.email')}</Label>
              <Input
                id="email"
                type={connected ? 'text' : 'email'}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                aria-invalid={Boolean(error)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('admin.login.password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                aria-invalid={Boolean(error)}
              />
            </div>
            <FieldError>{error ?? undefined}</FieldError>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t('common.loading') : t('admin.login.signIn')}
            </Button>
          </form>
          {!connected && (
            <p className="mt-4 rounded-md border border-dashed bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
              {t('admin.login.demoNote')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
