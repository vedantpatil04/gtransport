import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useApp } from '@/store';

export function AdminLogin() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-[calc(100dvh-36px)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo size="lg" className="mb-8 flex justify-center" />
        <div className="panel p-6 shadow-sm">
          <h1 className="text-xl font-bold">{t('admin.login.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.login.subtitle')}</p>
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              window.setTimeout(() => useApp.getState().login('admin'), 500);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('admin.login.email')}</Label>
              <Input id="email" type="email" defaultValue="office@gangamatatransport.in" autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('admin.login.password')}</Label>
              <Input id="password" type="password" defaultValue="demo-password" autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t('common.loading') : t('admin.login.signIn')}
            </Button>
          </form>
          <p className="mt-4 rounded-md border border-dashed bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">{t('admin.login.demoNote')}</p>
        </div>
      </div>
    </div>
  );
}
