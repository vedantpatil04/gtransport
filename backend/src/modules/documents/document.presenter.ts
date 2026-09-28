import { toIsoDate } from '../../common/dates/financial-year';
import { assessExpiry } from '../compliance/document-expiry.policy';
import type { ComplianceItem, DocumentRow } from './documents.service';

/**
 * Status is computed on every read from the stored expiry date and today's date — it is never
 * stored, so a document cannot show a status that has gone stale overnight.
 */
export function presentDocument(document: DocumentRow, today: Date) {
  const assessment = assessExpiry(document.expiryDate, today);
  return {
    id: document.id,
    type: document.type,
    customName: document.customName,
    ownerType: document.ownerType,
    vehicle: document.vehicle,
    employee: document.employee
      ? { id: document.employee.id, fullName: document.employee.fullName, driver: document.employee.driver }
      : null,
    documentNumber: document.documentNumber,
    issuer: document.issuer,
    issueDate: document.issueDate ? toIsoDate(document.issueDate) : null,
    expiryDate: document.expiryDate ? toIsoDate(document.expiryDate) : null,
    amount: document.amount?.toFixed(2) ?? null,
    status: assessment.status,
    daysRemaining: assessment.daysRemaining,
    threshold: assessment.threshold,
    state: document.state,
    verificationStatus: document.verificationStatus,
    verifiedAt: document.verifiedAt?.toISOString() ?? null,
    rejectionReason: document.rejectionReason,
    supersededAt: document.supersededAt?.toISOString() ?? null,
    archivedAt: document.archivedAt?.toISOString() ?? null,
    archiveReason: document.archiveReason,
    notes: document.notes,
    uploadedAt: document.createdAt.toISOString(),
    /** Metadata only. The bytes are served through the authorised /files/:id/content route. */
    file: document.file
      ? {
          id: document.file.id,
          fileName: document.file.originalFilename,
          mimeType: document.file.mimeType,
          sizeBytes: Number(document.file.sizeBytes),
          uploadedAt: document.file.createdAt.toISOString(),
        }
      : null,
  };
}

export function presentCompliance(items: ComplianceItem[], today: Date) {
  return items.map((item) => ({
    type: item.type,
    status: item.status,
    daysRemaining: item.daysRemaining,
    document: item.document ? presentDocument(item.document, today) : null,
  }));
}
