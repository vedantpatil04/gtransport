import { toIsoDate } from '../../common/dates/financial-year';
import type { OperationRow, TyreInsuranceRow } from './operations.service';

export function presentOperation(record: OperationRow) {
  return {
    id: record.id,
    category: record.category,
    amount: record.amount.toFixed(2),
    expenseDate: toIsoDate(record.expenseDate),
    vendorName: record.vendorName,
    description: record.description,
    receiptFileId: record.receiptFileId,
    status: record.status,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    archiveReason: record.archiveReason,
    clientSubmissionId: record.clientSubmissionId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    vehicle: record.vehicle,
    driver: record.driver ? { id: record.driver.id, driverCode: record.driver.driverCode, fullName: record.driver.employee.fullName } : null,
  };
}

export function presentTyreInsurance(record: TyreInsuranceRow) {
  return {
    id: record.id,
    insurer: record.issuer,
    policyNumber: record.documentNumber,
    premium: record.amount?.toFixed(2) ?? null,
    startDate: record.issueDate ? toIsoDate(record.issueDate) : null,
    expiryDate: record.expiryDate ? toIsoDate(record.expiryDate) : null,
    fileId: record.fileId,
    verificationStatus: record.verificationStatus,
    clientSubmissionId: record.clientSubmissionId,
    createdAt: record.createdAt.toISOString(),
    vehicle: record.vehicle,
  };
}
