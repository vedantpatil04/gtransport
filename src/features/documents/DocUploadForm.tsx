import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { FilePicker } from '@/components/media/FilePicker';
import { docTypeConfig } from '@/data/constants';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import type { DocRecord, DocType, FileRef } from '@/types';

export interface DocTarget {
  ownerType: DocRecord['ownerType'];
  ownerId: string;
  type: DocType;
  existing?: DocRecord;
}

const schema = z
  .object({
    customName: z.string(),
    number: z.string().max(40),
    issuer: z.string().max(80),
    expiresOn: z.string(),
    file: z.custom<FileRef | null>().refine((f) => Boolean(f), 'driver.docs.errFile'),
    needsExpiry: z.boolean(),
    needsName: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.needsExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(v.expiresOn)) ctx.addIssue({ code: 'custom', path: ['expiresOn'], message: 'driver.docs.errExpiry' });
    if (v.needsName && v.customName.trim().length < 2) ctx.addIssue({ code: 'custom', path: ['customName'], message: 'driver.docs.errName' });
  });
type Values = z.infer<typeof schema>;

/**
 * Upload / replace an official document. Used by the driver app (large controls)
 * and by the admin documents module (compact). Originals keep full quality.
 */
export function DocUploadForm({ target, variant, onDone }: { target: DocTarget; variant: 'driver' | 'admin'; onDone: (doc: DocRecord) => void }) {
  const { t } = useTranslation();
  const cfg = docTypeConfig(target.type);
  const big = variant === 'driver';
  const { register, handleSubmit, control, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      customName: target.existing?.customName ?? '',
      number: target.existing?.number ?? '',
      issuer: target.existing?.issuer ?? '',
      expiresOn: '',
      file: null,
      needsExpiry: cfg.hasExpiry,
      needsName: target.type === 'other',
    },
  });
  const err = (k: keyof Values) => (formState.errors[k]?.message ? t(String(formState.errors[k]?.message)) : undefined);
  const inputCls = cn(big && 'h-12 text-base');

  const submit = (v: Values) => {
    const doc = useApp.getState().uploadDocument({
      docId: target.existing?.id,
      ownerType: target.ownerType,
      ownerId: target.ownerId,
      type: target.type,
      customName: target.type === 'other' ? v.customName.trim() : undefined,
      number: v.number.trim(),
      issuer: v.issuer.trim(),
      expiresOn: cfg.hasExpiry ? v.expiresOn : null,
      file: v.file!,
    });
    onDone(doc);
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="space-y-4" data-testid="doc-upload-form">
      {target.type === 'other' && (
        <div className="space-y-1.5">
          <Label htmlFor="doc-name">{t('driver.docs.name')}</Label>
          <Input id="doc-name" className={inputCls} placeholder={t('driver.docs.namePlaceholder')} aria-invalid={!!formState.errors.customName} {...register('customName')} />
          <FieldError>{err('customName')}</FieldError>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>{t('driver.docs.photo')}</Label>
        <Controller
          control={control}
          name="file"
          render={({ field }) => (
            <FilePicker
              value={field.value}
              onChange={field.onChange}
              purpose="document"
              variant={variant}
              invalid={!!formState.errors.file}
              labels={{ camera: t('driver.docs.photo'), gallery: t('driver.docs.file'), done: t('driver.docs.saved') }}
              testId="doc-file"
            />
          )}
        />
        <FieldError>{err('file')}</FieldError>
        <p className="text-xs text-muted-foreground">{t('driver.docs.keepsQuality')}</p>
      </div>
      {cfg.hasExpiry && (
        <div className="space-y-1.5">
          <Label htmlFor="doc-expiry">{t('driver.docs.expiry')}</Label>
          <Input id="doc-expiry" type="date" className={inputCls} aria-invalid={!!formState.errors.expiresOn} {...register('expiresOn')} data-testid="doc-expiry" />
          <FieldError>{err('expiresOn')}</FieldError>
        </div>
      )}
      <div className={cn('grid gap-4', !big && 'sm:grid-cols-2')}>
        <div className="space-y-1.5">
          <Label htmlFor="doc-number">
            {target.type === 'insurance' ? t('driver.docs.policyNumber') : t('driver.docs.number')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
          </Label>
          <Input id="doc-number" className={inputCls} {...register('number')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="doc-issuer">
            {t('driver.docs.issuer')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
          </Label>
          <Input id="doc-issuer" className={inputCls} {...register('issuer')} />
        </div>
      </div>
      <Button type="submit" size={big ? 'xl' : 'default'} className={cn(big && 'h-14 w-full')} data-testid="doc-save">
        {t('common.upload')}
      </Button>
    </form>
  );
}
