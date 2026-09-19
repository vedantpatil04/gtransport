import { useTranslation } from 'react-i18next';
import { BadgeCheck, Building2, Check, Send, Upload, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { ExpiryChip, VerificationChip, useExpiryLabel } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FileView } from '@/components/media/FileView';
import { DetailList, DriverCell } from '@/features/admin/components/ui';
import { docTypeConfig } from '@/data/constants';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import type { DocRecord, ReminderTarget } from '@/types';
import { docStatus, LEVEL_STYLES, responsibleDriverId } from './expiry';

export const REMIND_ICON: Record<ReminderTarget, typeof Send> = { driver: UserRound, admin: BadgeCheck, insurer: Building2 };

export function useDocReminder() {
  const { t } = useTranslation();
  const vehicles = useApp((s) => s.vehicles);
  const drivers = useApp((s) => s.drivers);
  return (doc: DocRecord, to: ReminderTarget) => {
    useApp.getState().sendDocReminder(doc.id, to);
    const who =
      to === 'driver'
        ? (drivers.find((d) => d.id === responsibleDriverId(doc, vehicles))?.name ?? '')
        : to === 'insurer'
          ? doc.issuer
          : t('admin.documents.officeTeam');
    toast.success(t(`admin.documents.notified.${to}`, { who }), { description: t(`enum.docTypeLong.${doc.type}`) });
  };
}

export function DocumentSheet({ docId, onClose, onReplace }: { docId: string | null; onClose: () => void; onReplace: (doc: DocRecord) => void }) {
  const { t, i18n } = useTranslation();
  const doc = useApp((s) => s.documents.find((d) => d.id === docId));
  const vehicles = useApp((s) => s.vehicles);
  const drivers = useApp((s) => s.drivers);
  const remind = useDocReminder();
  const label = useExpiryLabel();

  const setVerification = (v: DocRecord['verification']) => {
    if (!doc) return;
    useApp.getState().setDocVerification(doc.id, v);
    toast.success(t(`admin.documents.verificationSet.${v}`));
  };

  return (
    <Sheet open={!!doc} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-[520px] overflow-y-auto">
        {doc && (() => {
          const s = docStatus(doc);
          const vehicle = doc.ownerType === 'vehicle' ? vehicles.find((v) => v.id === doc.ownerId) : undefined;
          const driverId = responsibleDriverId(doc, vehicles);
          const driver = drivers.find((d) => d.id === driverId);
          const cfg = docTypeConfig(doc.type);
          const targets: ReminderTarget[] = doc.type === 'insurance' ? ['driver', 'admin', 'insurer'] : ['driver', 'admin'];
          return (
            <div className="space-y-5 p-5" data-testid="doc-sheet">
              <div className="pr-8">
                <SheetTitle>{doc.customName || t(`enum.docTypeLong.${doc.type}`)}</SheetTitle>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {vehicle ? <Plate reg={vehicle.reg} size="xs" /> : <span className="text-sm text-muted-foreground">{driver?.name}</span>}
                  <VerificationChip value={doc.verification} />
                </div>
              </div>
              {s.level > 0 && (
                <div className={cn('rounded-lg border p-3.5', LEVEL_STYLES[s.level].banner)}>
                  <p className="font-bold">{label(doc)}</p>
                  {doc.expiresOn && <p className="text-sm opacity-85">{t('admin.documents.validTill', { date: fmtDate(doc.expiresOn, i18n.language) })}</p>}
                </div>
              )}
              {doc.file && <FileView file={doc.file} alt={t(`enum.docTypeLong.${doc.type}`)} />}
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={() => setVerification('approved')} disabled={doc.verification === 'approved'}>
                  <Check />
                  {t('admin.documents.approve')}
                </Button>
                <Button variant="success" size="sm" onClick={() => setVerification('verified')} disabled={doc.verification === 'verified'} data-testid="doc-verify">
                  <BadgeCheck />
                  {t('admin.documents.verify')}
                </Button>
                <Button variant="outline" size="sm" className="text-danger hover:text-danger" onClick={() => setVerification('rejected')} disabled={doc.verification === 'rejected'}>
                  <X />
                  {t('admin.documents.reject')}
                </Button>
              </div>
              <DetailList
                rows={[
                  [doc.type === 'insurance' ? t('driver.docs.policyNumber') : t('driver.docs.number'), <span className="font-mono">{doc.number || '—'}</span>],
                  [doc.type === 'insurance' ? t('admin.documents.insurer') : t('driver.docs.issuer'), doc.issuer || '—'],
                  ...(doc.issuedOn ? ([[t('admin.documents.issuedOn'), fmtDate(doc.issuedOn, i18n.language)]] as [string, string][]) : []),
                  [t('driver.docs.expiry'), cfg.hasExpiry && doc.expiresOn ? <span className="inline-flex items-center gap-2">{fmtDate(doc.expiresOn, i18n.language)} <ExpiryChip doc={doc} /></span> : t('expiry.noExpiry')],
                  [t('driver.docs.uploadedOn'), fmtDate(doc.uploadedAt, i18n.language)],
                  [t('admin.documents.responsible'), <DriverCell driver={driver} />],
                ]}
              />
              <Button variant="outline" className="w-full" onClick={() => onReplace(doc)} data-testid="doc-admin-replace">
                <Upload />
                {t('admin.documents.replace')}
              </Button>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('admin.documents.sendReminder')}</h3>
                <div className={cn('grid gap-2', targets.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
                  {targets.map((to) => {
                    const Icon = REMIND_ICON[to];
                    return (
                      <Button key={to} variant="outline" size="sm" onClick={() => remind(doc, to)} disabled={to === 'driver' && !driver} data-testid={`doc-remind-${to}`}>
                        <Icon />
                        {t(`admin.documents.notify.${to}`)}
                      </Button>
                    );
                  })}
                </div>
                {doc.reminders.length > 0 && (
                  <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                    {[...doc.reminders].reverse().slice(0, 5).map((r, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <Send className="size-3" />
                        {t(`admin.documents.sentTo.${r.to}`)} · {fmtDateTime(r.at, i18n.language)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })()}
      </SheetContent>
    </Sheet>
  );
}
