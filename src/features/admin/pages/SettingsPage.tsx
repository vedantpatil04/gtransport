import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Inbox, Info, KeyRound, Moon, RotateCcw, Save, Sun, Users, WifiOff, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import type { ReminderTarget } from '@/types';
import { ConfirmDialog, DetailList, PageHeader, Panel } from '../components/ui';
import { ChangePasswordDialog } from '../components/ChangePassword';
import { isApiConfigured } from '@/features/api/mode';
import { useSession } from '@/features/api/session';

/** Theme and console language: kept on this browser, so they work the same in every mode. */
function AppearancePanel() {
  const { t } = useTranslation();
  const theme = useApp((s) => s.theme);
  const adminLanguage = useApp((s) => s.adminLanguage);
  return (
    <Panel title={t('admin.settings.appearance')} bodyClass="space-y-4 p-4">
      <div>
        <p className="mb-2 text-sm font-medium">{t('admin.settings.theme')}</p>
        <div className="grid grid-cols-2 gap-2">
          {(['light', 'dark'] as const).map((th) => (
            <button key={th} onClick={() => useApp.getState().setTheme(th)} className={cn('flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium', theme === th ? 'border-primary bg-primary/5' : 'hover:bg-accent')} aria-pressed={theme === th}>
              {th === 'light' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {t(`admin.top.${th}`)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">{t('admin.top.language')}</p>
        <div className="grid grid-cols-2 gap-2">
          {(['en', 'hi'] as const).map((l) => (
            <button key={l} lang={l} onClick={() => useApp.getState().setAdminLanguage(l)} className={cn('flex h-11 items-center justify-center rounded-lg border text-sm font-medium', adminLanguage === l ? 'border-primary bg-primary/5' : 'hover:bg-accent')} aria-pressed={adminLanguage === l}>
              {l === 'en' ? 'English' : 'हिंदी'}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('admin.settings.driverLangHint')}</p>
      </div>
    </Panel>
  );
}

function SettingsLink({ to, icon: Icon, title, hint }: { to: string; icon: LucideIcon; title: string; hint: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/50">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/**
 * Real mode. Everything here works against the live system: the signed-in account and its
 * password, this browser's appearance, and the screens where logins and the company mailbox are
 * actually managed. Company details and reminder rules are not stored on the server yet, and the
 * page says so instead of offering controls that would save nothing.
 */
function SettingsLive() {
  const { t } = useTranslation();
  const account = useSession((s) => s.user);
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <div data-testid="settings-live">
      <PageHeader title={t('admin.settings.title')} description={t('admin.settings.liveSubtitle')} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t('admin.settings.account')} bodyClass="space-y-4 p-4">
          <DetailList
            rows={[
              [t('admin.settings.name'), account?.displayName ?? '—'],
              [t('admin.settings.role'), account ? t(`admin.enum.userRole.${account.role}`) : '—'],
              [t('admin.settings.signInId'), account?.email ?? account?.phone ?? '—'],
            ]}
          />
          <div>
            <Button variant="outline" onClick={() => setChangingPassword(true)} data-testid="settings-change-password">
              <KeyRound />
              {t('admin.password.title')}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">{t('admin.password.hint')}</p>
          </div>
        </Panel>

        <AppearancePanel />

        <Panel title={t('admin.settings.administration')} bodyClass="divide-y">
          <SettingsLink to="/admin/employees" icon={Users} title={t('admin.settings.loginsTitle')} hint={t('admin.settings.loginsHint')} />
          <SettingsLink to="/admin/inbox" icon={Inbox} title={t('admin.settings.mailboxTitle')} hint={t('admin.settings.mailboxHint')} />
        </Panel>

        <Panel title={t('admin.settings.companyLater')} bodyClass="p-4">
          <p className="flex gap-2.5 text-sm text-muted-foreground" data-testid="settings-company-later">
            <Info className="mt-0.5 size-4 shrink-0" />
            {t('admin.settings.companyLaterBody')}
          </p>
        </Panel>
      </div>
      <ChangePasswordDialog open={changingPassword} onOpenChange={setChangingPassword} />
    </div>
  );
}

function SettingsDemo() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const company = useApp((s) => s.company);
  const offline = useApp((s) => s.offline);
  const pending = useApp((s) => s.fuel.filter((f) => f.sync === 'pending').length + s.expenses.filter((e) => e.sync === 'pending').length + s.payments.filter((p) => p.sync === 'pending').length);
  const [form, setForm] = useState({ name: company.name, office: company.office });
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState(false);

  const saveCompany = () => {
    if (form.name.trim().length < 3 || form.office.trim().length < 5) return setError(t('admin.settings.errCompany'));
    setError(null);
    useApp.getState().updateCompany({ name: form.name.trim(), office: form.office.trim() });
    toast.success(t('admin.settings.saved'));
  };

  const setDays = (k: keyof typeof company.reminderDays, v: boolean) => {
    useApp.getState().updateCompany({ reminderDays: { ...company.reminderDays, [k]: v } });
    toast.success(t('admin.settings.saved'));
  };
  const setAuto = (k: ReminderTarget, v: boolean) => {
    useApp.getState().updateCompany({ autoNotify: { ...company.autoNotify, [k]: v } });
    toast.success(t('admin.settings.saved'));
  };

  return (
    <div>
      <PageHeader title={t('admin.settings.title')} description={t('admin.settings.subtitle')} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t('admin.settings.company')} bodyClass="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="st-name">{t('admin.settings.companyName')}</Label>
            <Input id="st-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-office">{t('admin.settings.office')}</Label>
            <Input id="st-office" value={form.office} onChange={(e) => setForm({ ...form, office: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('admin.settings.phone')}</p>
              <p className="figure font-medium">{company.phone}</p>
            </div>
            <div>
              <p className="text-muted-foreground">GSTIN</p>
              <p className="font-mono font-medium">{company.gstin}</p>
            </div>
          </div>
          <FieldError>{error}</FieldError>
          <Button onClick={saveCompany}>
            <Save />
            {t('common.save')}
          </Button>
        </Panel>

        <Panel title={t('admin.settings.reminders')} bodyClass="p-4">
          <p className="text-sm text-muted-foreground">{t('admin.settings.remindersHint')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(['30', '15', '7', '3'] as const).map((k) => (
              <label key={k} className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5', company.reminderDays[k] && 'border-primary/40 bg-primary/5')}>
                <span className="text-sm font-medium">{t('admin.settings.daysBefore', { count: Number(k) })}</span>
                <Switch checked={company.reminderDays[k]} onCheckedChange={(v) => setDays(k, v)} aria-label={t('admin.settings.daysBefore', { count: Number(k) })} />
              </label>
            ))}
          </div>
          <p className="mt-5 text-sm font-medium">{t('admin.settings.autoNotify')}</p>
          <div className="mt-2 divide-y rounded-lg border">
            {(['driver', 'admin', 'insurer'] as ReminderTarget[]).map((k) => (
              <label key={k} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3">
                <span>
                  <span className="block text-sm font-medium">{t(`admin.settings.notify.${k}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`admin.settings.notifyHint.${k}`)}</span>
                </span>
                <Switch checked={company.autoNotify[k]} onCheckedChange={(v) => setAuto(k, v)} aria-label={t(`admin.settings.notify.${k}`)} />
              </label>
            ))}
          </div>
        </Panel>

        <AppearancePanel />

        <Panel title={t('admin.settings.demo')} bodyClass="space-y-4 p-4">
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <span>
              <span className="flex items-center gap-2 text-sm font-medium">
                <WifiOff className="size-4" />
                {t('demo.simulateOffline')}
              </span>
              <span className="block text-xs text-muted-foreground">{t('demo.simulateOfflineHint')}</span>
              {pending > 0 && <span className="mt-1 block text-xs font-medium text-warning">{t('offline.waiting', { count: pending })}</span>}
            </span>
            <Switch checked={offline} onCheckedChange={(v) => useApp.getState().setOffline(v)} aria-label={t('demo.simulateOffline')} />
          </label>
          <div className="rounded-lg border border-dashed p-3">
            <p className="text-sm font-medium">{t('demo.reset')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('demo.resetConfirm')}</p>
            <Button variant="outline" size="sm" className="mt-3 text-danger hover:text-danger" onClick={() => setReset(true)}>
              <RotateCcw />
              {t('demo.reset')}
            </Button>
          </div>
        </Panel>
      </div>
      <ConfirmDialog
        open={reset}
        onOpenChange={setReset}
        destructive
        title={t('demo.reset')}
        description={t('demo.resetConfirm')}
        confirmLabel={t('demo.reset')}
        onConfirm={async () => {
          await useApp.getState().resetDemo();
          toast.success(t('demo.resetDone'));
          navigate('/admin');
        }}
      />
    </div>
  );
}

/** The live settings hub with an API; the approved prototype's settings in the demo. */
export function SettingsPage() {
  return isApiConfigured() ? <SettingsLive /> : <SettingsDemo />;
}
