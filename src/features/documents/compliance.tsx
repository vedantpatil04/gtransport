import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/**
 * Presentation helpers for the connected document screens. The status itself always comes from
 * the server's shared expiry policy — nothing here recalculates it.
 */

export type ApiDocumentType = 'RC' | 'INSURANCE' | 'PUC' | 'DRIVING_LICENCE' | 'TYRE_INSURANCE' | 'FITNESS' | 'PERMIT' | 'OTHER';
export type ComplianceStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'NOT_UPLOADED';

/** Backend document type → the prototype's existing enum.docType translation key. */
const TYPE_KEY: Record<ApiDocumentType, string> = {
  RC: 'rc',
  INSURANCE: 'insurance',
  PUC: 'puc',
  DRIVING_LICENCE: 'licence',
  TYRE_INSURANCE: 'tyre_insurance',
  FITNESS: 'fitness',
  PERMIT: 'permit',
  OTHER: 'other',
};

export const docTypeLabelKey = (type: ApiDocumentType) => `enum.docType.${TYPE_KEY[type]}`;

export const VEHICLE_DOC_TYPES: ApiDocumentType[] = ['RC', 'INSURANCE', 'PUC', 'TYRE_INSURANCE', 'FITNESS', 'PERMIT'];

export function ComplianceBadge({ status, daysRemaining }: { status: ComplianceStatus; daysRemaining: number | null }) {
  const { t } = useTranslation();
  if (status === 'NOT_UPLOADED') return <Badge tone="neutral">{t('expiry.notUploaded')}</Badge>;
  if (status === 'EXPIRED') {
    return <Badge tone="danger">{daysRemaining !== null ? t('expiry.agoDays', { count: Math.abs(daysRemaining) }) : t('expiry.expired')}</Badge>;
  }
  if (status === 'EXPIRING_SOON') {
    return <Badge tone="warning">{daysRemaining === 0 ? t('expiry.today') : t('expiry.inDays', { count: daysRemaining ?? 0 })}</Badge>;
  }
  return <Badge tone="success">{daysRemaining === null ? t('expiry.noExpiry') : t('expiry.valid')}</Badge>;
}

export function VerificationBadge({ value }: { value: 'PENDING' | 'VERIFIED' | 'REJECTED' }) {
  const { t } = useTranslation();
  if (value === 'VERIFIED') return <Badge tone="success">{t('enum.verification.verified')}</Badge>;
  if (value === 'REJECTED') return <Badge tone="danger">{t('enum.verification.rejected')}</Badge>;
  return <Badge tone="neutral">{t('enum.verification.pending')}</Badge>;
}
