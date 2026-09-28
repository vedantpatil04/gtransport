import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, KeyRound, Power, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { accountsApi } from '@/features/api/resources';
import type { ApiAccountStatus, ApiRole } from '@/features/api/session';
import type { ApiAccountAccess } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { ReasonDialog } from '@/features/finance/FinanceDialogs';
import { ApiError } from '@/lib/api/client';
import { fmtDateTime } from '@/lib/format';
import { ConfirmDialog, DetailList } from '../admin/components/ui';
import { ErrorState, InlineBusy, TableLoading } from '../admin/components/states';

/**
 * Account access for one employee: whether they can sign in, as what, and the actions the API
 * says this viewer may take. Every button maps to one API call; nothing here decides access.
 */

const STATUS_TONE: Record<ApiAccountStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'warning',
  DISABLED: 'danger',
};

export function AccountStatusBadge({ status }: { status: ApiAccountStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`admin.enum.accountStatus.${status}`)}</Badge>;
}

export interface AccountSubject {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
}

/** Shown once, right after a temporary password is made. It cannot be fetched again. */
export function TemporaryPasswordDialog({ password, name, onClose }: { password: string | null; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [password]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password ?? '');
      setCopied(true);
    } catch {
      /* the password stays visible to copy by hand */
    }
  };
  return (
    <Dialog open={Boolean(password)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('admin.accounts.tempTitle')}</DialogTitle>
          <DialogDescription>{t('admin.accounts.tempBody', { name })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
          <code className="flex-1 select-all text-center font-mono text-xl font-semibold tracking-wider" data-testid="temporary-password">
            {password}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? t('admin.accounts.copied') : t('admin.accounts.copy')}
          </Button>
        </div>
        <p className="text-sm text-warning">{t('admin.accounts.tempOnce')}</p>
        <DialogFooter>
          <Button onClick={onClose}>{t('admin.accounts.tempDone')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Role, and a mobile number or email to sign in with. Used when giving someone login access. */
export function LoginAccessFields({
  roles, role, onRole, via, onVia, phone, onPhone, email, onEmail, errors, fixedRole,
}: {
  roles: ApiRole[];
  role: ApiRole | '';
  onRole: (r: ApiRole) => void;
  via: 'PHONE' | 'EMAIL';
  onVia: (v: 'PHONE' | 'EMAIL') => void;
  phone: string;
  onPhone: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
  errors: Record<string, string>;
  fixedRole?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {!fixedRole && (
        <div className="space-y-1.5">
          <Label htmlFor="acc-role">{t('admin.accounts.role')}</Label>
          <NativeSelect id="acc-role" value={role} onChange={(e) => onRole(e.target.value as ApiRole)}>
            <option value="">{t('common.select')}</option>
            {roles.map((r) => (
              <option key={r} value={r}>{t(`admin.enum.userRole.${r}`)}</option>
            ))}
          </NativeSelect>
          <FieldError>{errors.role ?? errors['account.role']}</FieldError>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="acc-via">{t('admin.accounts.signInWith')}</Label>
        <NativeSelect id="acc-via" value={via} onChange={(e) => onVia(e.target.value as 'PHONE' | 'EMAIL')}>
          <option value="PHONE">{t('admin.accounts.viaPhone')}</option>
          <option value="EMAIL">{t('admin.accounts.viaEmail')}</option>
        </NativeSelect>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        {via === 'PHONE' ? (
          <>
            <Label htmlFor="acc-phone">{t('admin.accounts.mobile')}</Label>
            <Input id="acc-phone" inputMode="tel" value={phone} onChange={(e) => onPhone(e.target.value)} placeholder="98450 12345" />
            <FieldError>{errors.phone ?? errors['account.phone']}</FieldError>
          </>
        ) : (
          <>
            <Label htmlFor="acc-email">{t('admin.accounts.email')}</Label>
            <Input id="acc-email" type="email" value={email} onChange={(e) => onEmail(e.target.value)} />
            <FieldError>{errors.email ?? errors['account.email']}</FieldError>
          </>
        )}
      </div>
    </div>
  );
}

type Action = 'suspend' | 'disable' | 'reset' | null;

export function AccountAccessPanel({ employee, onChanged }: { employee: AccountSubject; onChanged?: () => void }) {
  const { t, i18n } = useTranslation();
  const access = useApiResource<ApiAccountAccess>(() => accountsApi.get(employee.id), [employee.id]);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [temporary, setTemporary] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<ApiRole | ''>('');

  // Create form
  const [role, setRole] = useState<ApiRole | ''>('');
  const [via, setVia] = useState<'PHONE' | 'EMAIL'>(employee.phone ? 'PHONE' : 'EMAIL');
  const [phone, setPhone] = useState(employee.phone ?? '');
  const [email, setEmail] = useState(employee.email ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const data = access.data;
  const account = data?.account ?? null;
  useEffect(() => setNewRole(account?.role ?? ''), [account?.role]);

  const done = (message: string) => {
    toast.success(message);
    access.reload();
    onChanged?.();
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!role) return setErrors({ role: t('admin.accounts.chooseRole') });
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const result = await accountsApi.create(employee.id, { role, ...(via === 'PHONE' ? { phone } : { email }) });
      setTemporary(result.temporaryPassword);
      done(t('admin.accounts.created', { name: employee.fullName }));
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErrors(cause.fieldErrors);
        if (Object.keys(cause.fieldErrors).length === 0) setFormError(cause.message);
      } else setFormError(t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  if (access.loading) return <TableLoading rows={3} columns={2} />;
  if (access.error) return <ErrorState error={access.error} onRetry={access.reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4" data-testid="account-access">
      {!account ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-dashed p-4">
            <ShieldOff className="size-5 text-muted-foreground" />
            <div>
              <p className="font-medium">{t('admin.accounts.none')}</p>
              <p className="text-sm text-muted-foreground">{t('admin.accounts.noneHint')}</p>
            </div>
          </div>
          {data.canManage && data.assignableRoles.length > 0 && (
            <form onSubmit={create} noValidate className="space-y-4 rounded-lg border p-4">
              <p className="flex items-center gap-2 font-semibold">
                <UserPlus className="size-4" />
                {t('admin.accounts.create')}
              </p>
              <LoginAccessFields
                roles={data.assignableRoles}
                role={role}
                onRole={setRole}
                via={via}
                onVia={setVia}
                phone={phone}
                onPhone={setPhone}
                email={email}
                onEmail={setEmail}
                errors={errors}
              />
              {!data.assignableRoles.includes('DRIVER') && <p className="text-xs text-muted-foreground">{t('admin.accounts.driverHint')}</p>}
              {formError && <p className="text-sm text-danger" role="alert">{formError}</p>}
              <div className="flex justify-end gap-2">
                {busy && <InlineBusy label={t('common.loading')} />}
                <Button type="submit" disabled={busy}>{t('admin.accounts.createButton')}</Button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <>
          <DetailList
            rows={[
              [t('admin.common.status'), <AccountStatusBadge key="s" status={account.status} />],
              [t('admin.accounts.role'), t(`admin.enum.userRole.${account.role}`)],
              [t('admin.accounts.signInId'), <span key="id" className="font-mono">{account.signInId}</span>],
              [t('admin.accounts.password'), account.mustChangePassword ? t('admin.accounts.passwordTemporary') : account.passwordChangedAt ? t('admin.accounts.passwordSet', { date: fmtDateTime(account.passwordChangedAt, i18n.language) }) : t('admin.accounts.passwordOriginal')],
              [t('admin.accounts.lastSignIn'), account.lastLoginAt ? fmtDateTime(account.lastLoginAt, i18n.language) : t('admin.accounts.never')],
            ]}
          />

          {data.canManage ? (
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="acc-new-role">{t('admin.accounts.changeRole')}</Label>
                  <NativeSelect id="acc-new-role" value={newRole} onChange={(e) => setNewRole(e.target.value as ApiRole)}>
                    {data.assignableRoles.includes(account.role) ? null : <option value={account.role}>{t(`admin.enum.userRole.${account.role}`)}</option>}
                    {data.assignableRoles.map((r) => (
                      <option key={r} value={r}>{t(`admin.enum.userRole.${r}`)}</option>
                    ))}
                  </NativeSelect>
                </div>
                <Button
                  variant="outline"
                  disabled={busy || !newRole || newRole === account.role}
                  onClick={() => run(async () => {
                    await accountsApi.changeRole(employee.id, newRole as ApiRole);
                    done(t('admin.accounts.roleChanged', { role: t(`admin.enum.userRole.${newRole}`) }));
                  })}
                >
                  {t('admin.accounts.saveRole')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('admin.accounts.signOutNote')}</p>
              <div className="grid grid-cols-2 gap-2">
                {(account.status === 'SUSPENDED' || account.status === 'DISABLED') && (
                  <Button disabled={busy} onClick={() => run(async () => {
                    await accountsApi.activate(employee.id);
                    done(t('admin.accounts.activated'));
                  })}>
                    <ShieldCheck />
                    {t('admin.accounts.activate')}
                  </Button>
                )}
                {(account.status === 'ACTIVE' || account.status === 'INVITED') && (
                  <Button variant="outline" disabled={busy} onClick={() => setAction('suspend')}>
                    <Power />
                    {t('admin.accounts.suspend')}
                  </Button>
                )}
                {account.status !== 'DISABLED' && (
                  <Button variant="outline" className="text-danger hover:text-danger" disabled={busy} onClick={() => setAction('disable')}>
                    <ShieldOff />
                    {t('admin.accounts.disable')}
                  </Button>
                )}
                <Button variant="outline" disabled={busy} onClick={() => setAction('reset')}>
                  <KeyRound />
                  {t('admin.accounts.resetPassword')}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('admin.accounts.readOnly')}</p>
          )}
        </>
      )}

      <ReasonDialog
        open={action === 'suspend' || action === 'disable'}
        onOpenChange={(open) => !open && setAction(null)}
        title={action === 'disable' ? t('admin.accounts.disableTitle', { name: employee.fullName }) : t('admin.accounts.suspendTitle', { name: employee.fullName })}
        description={action === 'disable' ? t('admin.accounts.disableBody') : t('admin.accounts.suspendBody')}
        confirmLabel={action === 'disable' ? t('admin.accounts.disable') : t('admin.accounts.suspend')}
        reasonLabel={t('admin.accounts.reason')}
        onConfirm={async (reason) => {
          if (action === 'disable') await accountsApi.disable(employee.id, reason);
          else await accountsApi.suspend(employee.id, reason);
          setAction(null);
          done(action === 'disable' ? t('admin.accounts.disabled') : t('admin.accounts.suspended'));
        }}
      />
      <ConfirmDialog
        open={action === 'reset'}
        onOpenChange={(open) => !open && setAction(null)}
        title={t('admin.accounts.resetTitle', { name: employee.fullName })}
        description={t('admin.accounts.resetBody')}
        confirmLabel={t('admin.accounts.resetPassword')}
        onConfirm={() => run(async () => {
          const result = await accountsApi.resetPassword(employee.id);
          setAction(null);
          setTemporary(result.temporaryPassword);
          done(t('admin.accounts.resetDone'));
        })}
      />
      <TemporaryPasswordDialog password={temporary} name={employee.fullName} onClose={() => setTemporary(null)} />
    </div>
  );
}

/** The same panel in a side sheet, opened from the Employees table. */
export function AccountAccessSheet({ employee, onClose, onChanged }: { employee: AccountSubject | null; onClose: () => void; onChanged?: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={Boolean(employee)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-[480px] overflow-y-auto">
        {employee && (
          <div className="space-y-5 p-5">
            <div className="pr-8">
              <SheetTitle>{t('admin.accounts.title')}</SheetTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">{employee.fullName}</p>
            </div>
            <AccountAccessPanel employee={employee} onChanged={onChanged} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
