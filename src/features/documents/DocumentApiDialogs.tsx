import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { documentsApi, driversApi, uploadDocumentFile, vehiclesApi } from '@/features/api/resources';
import { canManageFleet, useSession } from '@/features/api/session';
import type { ApiDocument } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { fmtDate } from '@/lib/format';
import { ArchiveDialog } from '../admin/components/ArchiveDialog';
import { ReceiptViewer } from '../admin/components/ReceiptViewer';
import { DetailList } from '../admin/components/ui';
import { InlineBusy } from '../admin/components/states';
import { ComplianceBadge, docTypeLabelKey, VEHICLE_DOC_TYPES, VerificationBadge, type ApiDocumentType } from './compliance';

const ALL_TYPES: ApiDocumentType[] = ['RC', 'INSURANCE', 'PUC', 'TYRE_INSURANCE', 'FITNESS', 'PERMIT', 'DRIVING_LICENCE', 'OTHER'];

/** Everything about one document: fields, status, verification, the file, and earlier versions. */
export function DocumentDetailDialog({ documentId, onClose, onChanged }: { documentId: string | null; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const mayManage = canManageFleet(useSession((s) => s.user?.role));
  const [nonce, setNonce] = useState(0);
  const detail = useApiResource(() => documentsApi.get(documentId as string), [documentId, nonce], Boolean(documentId));
  const history = useApiResource(() => documentsApi.history(documentId as string), [documentId, nonce], Boolean(documentId));
  const [viewing, setViewing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setNonce((n) => n + 1);
    onChanged();
  };

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const doc = detail.data;
  const owner = doc?.vehicle?.registrationNumber ?? doc?.employee?.fullName ?? '—';

  return (
    <>
      <Dialog open={Boolean(documentId)} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{doc ? `${t(docTypeLabelKey(doc.type))} · ${owner}` : t('common.loading')}</DialogTitle>
            {doc && (
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <ComplianceBadge status={doc.status} daysRemaining={doc.daysRemaining} />
                <VerificationBadge value={doc.verificationStatus} />
              </DialogDescription>
            )}
          </DialogHeader>

          {!doc ? (
            <InlineBusy label={t('common.loading')} />
          ) : (
            <div className="space-y-4">
              <DetailList
                rows={[
                  [t('admin.docsApi.document'), doc.customName ?? t(docTypeLabelKey(doc.type))],
                  [t('admin.docsApi.owner'), owner],
                  [t('admin.docsApi.number'), doc.documentNumber ?? '—'],
                  [t('admin.docsApi.issuer'), doc.issuer ?? '—'],
                  [t('admin.docsApi.issueDate'), doc.issueDate ? fmtDate(doc.issueDate) : '—'],
                  [t('admin.docsApi.expiryDate'), doc.expiryDate ? fmtDate(doc.expiryDate) : t('expiry.noExpiry')],
                  [t('admin.docsApi.uploaded'), fmtDate(doc.uploadedAt.slice(0, 10))],
                  [t('admin.docsApi.uploadedBy'), doc.uploadedBy ?? '—'],
                  ...(doc.rejectionReason ? ([[t('admin.docsApi.rejectionReason'), doc.rejectionReason]] as [string, string][]) : []),
                ]}
              />

              <div className="flex flex-wrap gap-2">
                {doc.file && (
                  <Button variant="outline" onClick={() => setViewing(doc.file?.id ?? null)}>
                    {t('admin.docsApi.view')}
                  </Button>
                )}
                {mayManage && doc.state === 'CURRENT' && (
                  <>
                    {doc.verificationStatus !== 'VERIFIED' && (
                      <Button onClick={() => void act(() => documentsApi.verify(doc.id), t('admin.docsApi.verified'))} disabled={busy}>
                        {t('admin.documents.verify')}
                      </Button>
                    )}
                    {doc.verificationStatus !== 'REJECTED' && (
                      <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
                        {t('admin.documents.reject')}
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => setReplacing(true)} disabled={busy}>
                      {t('admin.documents.replace')}
                    </Button>
                    <Button variant="outline" onClick={() => setArchiving(true)} disabled={busy}>
                      {t('admin.fuelApi.archive')}
                    </Button>
                  </>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">{t('admin.docsApi.history')}</p>
                {(history.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('admin.docsApi.noHistory')}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {history.data?.map((version) => (
                      <li key={version.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span>
                          {fmtDate(version.uploadedAt.slice(0, 10))} · {version.expiryDate ? fmtDate(version.expiryDate) : t('expiry.noExpiry')}
                        </span>
                        {version.file && (
                          <Button size="sm" variant="ghost" onClick={() => setViewing(version.file?.id ?? null)}>
                            {t('admin.docsApi.view')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ReceiptViewer fileId={viewing} title={doc ? t(docTypeLabelKey(doc.type)) : ''} onClose={() => setViewing(null)} />
      <ArchiveDialog
        open={archiving}
        title={t('admin.fuelApi.confirmArchive')}
        onOpenChange={setArchiving}
        onConfirm={async (reason) => {
          await act(() => documentsApi.archive(doc!.id, reason), t('admin.fuelApi.archived'));
          setArchiving(false);
        }}
      />
      <ArchiveDialog
        open={rejecting}
        title={t('admin.docsApi.rejectTitle')}
        onOpenChange={setRejecting}
        onConfirm={async (reason) => {
          await act(() => documentsApi.reject(doc!.id, reason), t('admin.docsApi.rejected'));
          setRejecting(false);
        }}
      />
      {doc && (
        <UploadDocumentDialog
          open={replacing}
          onOpenChange={setReplacing}
          replacing={doc}
          onSaved={() => {
            setReplacing(false);
            onClose();
            onChanged();
          }}
        />
      )}
    </>
  );
}

/** New document for a vehicle or person, or a new version replacing `replacing`. */
export function UploadDocumentDialog({
  open,
  onOpenChange,
  onSaved,
  replacing,
  presetVehicleId,
  presetType,
  presetEmployeeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (document: ApiDocument) => void;
  replacing?: ApiDocument;
  presetVehicleId?: string;
  presetType?: ApiDocumentType;
  presetEmployeeId?: string;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<ApiDocumentType>(replacing?.type ?? presetType ?? 'INSURANCE');
  const [vehicleId, setVehicleId] = useState(presetVehicleId ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [issuer, setIssuer] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [busy, setBusy] = useState<'uploading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const forVehicle = VEHICLE_DOC_TYPES.includes(type);
  const vehicles = useApiResource(() => vehiclesApi.list({ limit: 100 }), [open], open && !replacing && forVehicle);
  const drivers = useApiResource(() => driversApi.list({ limit: 100 }), [open], open && !replacing && !forVehicle);

  useEffect(() => {
    if (!open) return;
    setType(replacing?.type ?? presetType ?? 'INSURANCE');
    setVehicleId(presetVehicleId ?? '');
    setEmployeeId(presetEmployeeId ?? '');
    setFile(null);
    setDocumentNumber(replacing?.documentNumber ?? '');
    setIssuer(replacing?.issuer ?? '');
    setIssueDate('');
    setExpiryDate('');
    setError(null);
  }, [open, replacing, presetVehicleId, presetType, presetEmployeeId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return setError(t('admin.docsApi.errFile'));
    if (!replacing && forVehicle && !vehicleId) return setError(t('admin.docsApi.errVehicle'));
    if (!replacing && !forVehicle && !employeeId) return setError(t('admin.docsApi.errPerson'));
    setError(null);
    try {
      setBusy('uploading');
      const fileId = await uploadDocumentFile(file);
      setBusy('saving');
      const details = {
        fileId,
        documentNumber: documentNumber.trim() || undefined,
        issuer: issuer.trim() || undefined,
        issueDate: issueDate || undefined,
        expiryDate: expiryDate || undefined,
      };
      const saved = replacing
        ? await documentsApi.replace(replacing.id, details)
        : await documentsApi.create({ ...details, type, ...(forVehicle ? { vehicleId } : { employeeId }) });
      toast.success(t('admin.docsApi.saved'));
      onSaved(saved);
    } catch (cause) {
      // The form keeps its values, so a failed upload can simply be retried.
      setError(cause instanceof Error ? cause.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{replacing ? t('admin.documents.replace') : t('admin.docsApi.upload')}</DialogTitle>
          <DialogDescription>{t('admin.docsApi.uploadHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          {!replacing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-type">{t('admin.docsApi.document')}</Label>
                <NativeSelect id="doc-type" value={type} onChange={(e) => setType(e.target.value as ApiDocumentType)}>
                  {ALL_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {t(docTypeLabelKey(value))}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-owner">{forVehicle ? t('admin.common.vehicle') : t('admin.common.driver')}</Label>
                {forVehicle ? (
                  <NativeSelect id="doc-owner" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">{t('admin.driversApi.chooseVehicle')}</option>
                    {(vehicles.data?.data ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.registrationNumber}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <NativeSelect id="doc-owner" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                    <option value="">{t('admin.vehiclesApi.chooseDriver')}</option>
                    {(drivers.data?.data ?? []).map((d) => (
                      <option key={d.id} value={d.employee.id}>
                        {d.employee.fullName}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="doc-file">{t('admin.docsApi.file')}</Label>
            <Input id="doc-file" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="doc-number">{t('admin.docsApi.number')}</Label>
              <Input id="doc-number" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-issuer">{t('admin.docsApi.issuer')}</Label>
              <Input id="doc-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-issue">{t('admin.docsApi.issueDate')}</Label>
              <Input id="doc-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-expiry">{t('admin.docsApi.expiryDate')}</Label>
              <Input id="doc-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
          </div>

          <FieldError>{error ?? undefined}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={Boolean(busy)}>
              {busy === 'uploading' ? t('admin.docsApi.uploading') : busy === 'saving' ? t('common.loading') : error ? t('admin.api.retry') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
