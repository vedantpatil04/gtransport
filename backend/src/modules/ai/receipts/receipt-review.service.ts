import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LedgerSourceType, OperationCategory, Prisma, RecordStatus, ServiceReceiptAIStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import { businessDate, pastOrTodayDate } from '../../../common/dates/request-dates';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { LedgerService } from '../../finance/ledger.service';
import { expensePosting } from '../../finance/ledger-postings';
import { ServiceReceiptExtractionSchema, type ServiceReceiptExtraction } from '../schema';
import { compareWithExtraction, toSuggestedValues, validateExtraction, type SubmittedValues } from './extraction-review';
import { canTransition, isHumanSettled } from './receipt-state';
import { ReceiptJobService } from './receipt-job.service';
import type { VerifyServiceReceiptDto } from './dto/receipt-review.dto';

/** The columns a verified service record carries, as read back for review and for the ledger. */
const RECORD_VIEW = {
  id: true,
  category: true,
  amount: true,
  expenseDate: true,
  vendorName: true,
  description: true,
  status: true,
  aiStatus: true,
  invoiceNumber: true,
  serviceType: true,
  odometerKm: true,
  nextServiceDate: true,
  nextServiceKm: true,
  labourAmount: true,
  partsAmount: true,
  taxAmount: true,
  serviceLineItems: true,
  vehicle: { select: { id: true, registrationNumber: true } },
  driver: { select: { id: true } },
} as const;

/**
 * Human verification — the boundary where a suggestion becomes the record.
 *
 * Everything the AI produced up to this point lives in `service_receipt_ai_results` and has
 * changed nothing. This service is the only code in the system that writes an extracted value
 * onto a `VehicleExpense`, and it only does so because a named person asked it to. That is what
 * "AI is not authoritative" means in practice (§4, §14).
 *
 * Four things follow from it, and each is enforced here rather than trusted to a caller:
 *
 *  - **Verification names its author.** `aiVerifiedById` and `aiVerifiedAt` are written together,
 *    and the database refuses half of one.
 *  - **Corrections are distinguishable from acceptances.** The server compares what was submitted
 *    with what was read, records which values were accepted and which corrected, and writes a
 *    separate audit entry when anything was corrected.
 *  - **The ledger follows the record.** A verified amount or date that differs from what the
 *    driver entered moves the expense's ledger line in the same transaction, so finance never
 *    disagrees with a verified service record.
 *  - **A verified record is closed to automation.** Re-opening it is a separate, audited act.
 */
@Injectable()
export class ReceiptReviewService {
  private readonly logger = new Logger(ReceiptReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: ReceiptJobService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Everything the review screen needs about one maintenance record: the record as it stands, the
   * original receipt reference, every extraction version, and what the latest one suggests.
   */
  async review(companyId: string, vehicleExpenseId: string) {
    const expense = await this.prisma.vehicleExpense.findFirst({
      where: { id: vehicleExpenseId, companyId },
      select: {
        ...RECORD_VIEW,
        receiptFileId: true,
        acceptedResultId: true,
        aiVerifiedAt: true,
        aiVerifiedById: true,
        aiRejectedAt: true,
        aiAcceptedFields: true,
        driver: { select: { id: true, driverCode: true, employee: { select: { fullName: true } } } },
        receiptFile: { select: { id: true, originalFilename: true, mimeType: true, sizeBytes: true, createdAt: true } },
        aiResults: {
          orderBy: { version: 'desc' },
          select: {
            id: true, version: true, provider: true, model: true, extraction: true, confidence: true,
            warnings: true, validationIssues: true, preparation: true, sourceTextChars: true,
            durationMs: true, createdAt: true,
          },
        },
        aiJobs: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true, status: true, attempt: true, maxAttempts: true, provider: true, model: true,
            queuedAt: true, startedAt: true, finishedAt: true, nextAttemptAt: true,
            failureCode: true, failureMessage: true,
          },
        },
      },
    });
    if (!expense) throw new NotFoundException('Service record not found.');

    const latest = expense.aiResults[0] ?? null;
    const extraction = latest ? this.readExtraction(latest.extraction) : null;

    return {
      expense,
      latestResult: latest,
      /** Pre-filled values for the form, each marked found or missing. Never invented (§6). */
      suggestions: extraction ? toSuggestedValues(extraction) : null,
      extraction,
      /** True while the record can still be changed by a person. */
      canVerify: !isHumanSettled(expense.aiStatus),
      canRetry: Boolean(expense.receiptFileId) && !isHumanSettled(expense.aiStatus),
    };
  }

  /** Receipts waiting on someone, newest first. The office's work queue. */
  async pending(companyId: string, query: { status?: ServiceReceiptAIStatus; limit: number; cursor?: string }) {
    const rows = await this.prisma.vehicleExpense.findMany({
      where: {
        companyId,
        status: RecordStatus.ACTIVE,
        // Only service records carry receipts worth reading.
        category: OperationCategory.MAINTENANCE,
        ...(query.status
          ? { aiStatus: query.status }
          : {
              aiStatus: {
                in: [ServiceReceiptAIStatus.SUCCEEDED, ServiceReceiptAIStatus.NEEDS_REVIEW, ServiceReceiptAIStatus.FAILED],
              },
            }),
      },
      select: {
        id: true, amount: true, expenseDate: true, vendorName: true, aiStatus: true, createdAt: true,
        vehicle: { select: { id: true, registrationNumber: true } },
        driver: { select: { id: true, employee: { select: { fullName: true } } } },
        receiptFileId: true,
        aiResults: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, confidence: true, validationIssues: true, warnings: true },
        },
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, page: { limit: query.limit, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null } };
  }

  /**
   * Verifies a service record.
   *
   * The values written are the ones the administrator submitted — which may be the extraction's
   * suggestions, their own corrections, or a mixture. The extraction is never read directly into
   * the record here: what the person had in front of them is what gets saved.
   */
  async verify(user: AuthenticatedUser, vehicleExpenseId: string, input: VerifyServiceReceiptDto) {
    const expense = await this.prisma.vehicleExpense.findFirst({
      where: { id: vehicleExpenseId, companyId: user.companyId },
      select: RECORD_VIEW,
    });
    if (!expense) throw new NotFoundException('Service record not found.');
    if (expense.status !== RecordStatus.ACTIVE) throw new BadRequestException('This record is archived.');
    if (expense.category !== OperationCategory.MAINTENANCE) {
      throw new BadRequestException('Only maintenance and service records are verified against a receipt.');
    }
    if (!canTransition(expense.aiStatus, ServiceReceiptAIStatus.VERIFIED, 'admin')) {
      throw new BadRequestException(`A record that is ${expense.aiStatus.toLowerCase().replace(/_/g, ' ')} cannot be verified.`);
    }

    // The reading the administrator compared against: the version they name, or the latest one.
    const result = input.resultId
      ? await this.resultFor(user.companyId, vehicleExpenseId, input.resultId)
      : await this.prisma.serviceReceiptAIResult.findFirst({
          where: { vehicleExpenseId, companyId: user.companyId },
          orderBy: { version: 'desc' },
          select: { id: true, extraction: true },
        });
    const extraction = result ? this.readExtraction(result.extraction) : null;

    // ── What will be saved, checked as a clerk would ──
    const serviceDate = input.expenseDate ? pastOrTodayDate(input.expenseDate) : expense.expenseDate;
    const nextServiceDate =
      input.nextServiceDate === undefined ? undefined : input.nextServiceDate === null ? null : businessDate(input.nextServiceDate);
    if (nextServiceDate && nextServiceDate.getTime() <= serviceDate.getTime()) {
      throw new BadRequestException('The next service date must be after the service date.');
    }
    const odometerKm = input.odometerKm === undefined ? expense.odometerKm : input.odometerKm;
    const nextServiceKm = input.nextServiceKm === undefined ? expense.nextServiceKm : input.nextServiceKm;
    if (odometerKm !== null && nextServiceKm !== null && nextServiceKm <= odometerKm) {
      throw new BadRequestException('The next service reading must be above the odometer reading.');
    }
    if (input.amount !== undefined && new Prisma.Decimal(input.amount).lte(0)) {
      throw new BadRequestException('The amount must be greater than zero.');
    }

    const lineItems =
      input.lineItems === undefined
        ? undefined
        : input.lineItems === null
          ? Prisma.DbNull
          : (input.lineItems.map((line) => ({
              description: line.description.trim(),
              kind: line.kind ?? null,
              quantity: line.quantity ?? null,
              unitPrice: line.unitPrice ?? null,
              amount: line.amount ?? null,
            })) as Prisma.InputJsonValue);

    const submitted: SubmittedValues = {
      ...(input.amount !== undefined ? { totalAmount: input.amount } : {}),
      ...(input.expenseDate !== undefined ? { invoiceDate: input.expenseDate } : {}),
      ...(input.vendorName !== undefined ? { vendorName: input.vendorName } : {}),
      ...(input.invoiceNumber !== undefined ? { invoiceNumber: input.invoiceNumber } : {}),
      ...(input.serviceType !== undefined ? { serviceType: input.serviceType } : {}),
      ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
      ...(input.nextServiceDate !== undefined ? { nextServiceDate: input.nextServiceDate } : {}),
      ...(input.nextServiceKm !== undefined ? { nextServiceKm: input.nextServiceKm } : {}),
      ...(input.labourAmount !== undefined ? { labourAmount: input.labourAmount } : {}),
      ...(input.partsAmount !== undefined ? { partsAmount: input.partsAmount } : {}),
      ...(input.taxAmount !== undefined ? { taxAmount: input.taxAmount } : {}),
      ...(input.lineItems !== undefined ? { lineItems: input.lineItems } : {}),
    };
    const { accepted, corrected } = compareWithExtraction(extraction, submitted);

    // What changed on the record itself, for the audit line.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const note = (key: string, from: unknown, to: unknown) => {
      if (to !== undefined && String(from ?? '') !== String(to ?? '')) changes[key] = { from, to };
    };
    note('amount', expense.amount.toFixed(2), input.amount);
    note('expenseDate', toIsoDate(expense.expenseDate), input.expenseDate);
    note('vendorName', expense.vendorName, input.vendorName);
    note('invoiceNumber', expense.invoiceNumber, input.invoiceNumber);
    note('serviceType', expense.serviceType, input.serviceType);
    note('odometerKm', expense.odometerKm, input.odometerKm);
    note('nextServiceDate', expense.nextServiceDate ? toIsoDate(expense.nextServiceDate) : null, input.nextServiceDate);
    note('nextServiceKm', expense.nextServiceKm, input.nextServiceKm);

    const decimalOrNull = (value: string | null | undefined) =>
      value === undefined ? undefined : value === null ? null : new Prisma.Decimal(value);
    const textOrNull = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.vehicleExpense.update({
        where: { id: vehicleExpenseId },
        data: {
          ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
          ...(input.expenseDate !== undefined ? { expenseDate: serviceDate } : {}),
          ...(input.vendorName !== undefined ? { vendorName: input.vendorName.trim() || null } : {}),
          ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
          invoiceNumber: textOrNull(input.invoiceNumber),
          serviceType: textOrNull(input.serviceType),
          odometerKm: input.odometerKm,
          nextServiceDate,
          nextServiceKm: input.nextServiceKm,
          labourAmount: decimalOrNull(input.labourAmount),
          partsAmount: decimalOrNull(input.partsAmount),
          taxAmount: decimalOrNull(input.taxAmount),
          serviceLineItems: lineItems,
          aiStatus: ServiceReceiptAIStatus.VERIFIED,
          aiVerifiedAt: now,
          aiVerifiedById: user.id,
          aiRejectedAt: null,
          acceptedResultId: result?.id ?? null,
          aiAcceptedFields: accepted,
          updatedById: user.id,
        },
        select: { ...RECORD_VIEW, aiVerifiedAt: true },
      });
      // The expense's ledger line follows the verified amount and date, atomically.
      await this.ledger.syncSource(
        tx,
        { companyId: user.companyId, sourceType: LedgerSourceType.VEHICLE_EXPENSE, sourceId: row.id, actorId: user.id },
        expensePosting(row),
      );
      return row;
    });

    // Who verified what, which fields matched the reading, which were corrected — enough to
    // reconstruct the decision later, without the receipt's contents (§25).
    await this.audit.record({
      action: 'service_receipt.verified',
      entityType: 'VehicleExpense',
      entityId: vehicleExpenseId,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: {
        from: expense.aiStatus,
        to: ServiceReceiptAIStatus.VERIFIED,
        acceptedFields: accepted,
        correctedFields: corrected,
        recordChanges: changes as unknown as Prisma.InputJsonValue,
        resultId: result?.id ?? null,
      },
    });
    if (corrected.length > 0) {
      await this.audit.record({
        action: 'service_receipt.corrected',
        entityType: 'VehicleExpense',
        entityId: vehicleExpenseId,
        companyId: user.companyId,
        actorUserId: user.id,
        actorRole: user.role,
        changes: { correctedFields: corrected, resultId: result?.id ?? null },
      });
    }
    this.logger.log(`Service record ${vehicleExpenseId} verified by user ${user.id} (${accepted.length} accepted, ${corrected.length} corrected)`);

    return { id: updated.id, aiStatus: updated.aiStatus, aiVerifiedAt: updated.aiVerifiedAt, acceptedFields: accepted, correctedFields: corrected };
  }

  /** Marks an extraction unusable. The record keeps whatever a person typed; the receipt stays. */
  async reject(user: AuthenticatedUser, vehicleExpenseId: string, reason?: string) {
    const expense = await this.prisma.vehicleExpense.findFirst({
      where: { id: vehicleExpenseId, companyId: user.companyId },
      select: { id: true, aiStatus: true },
    });
    if (!expense) throw new NotFoundException('Service record not found.');
    if (!canTransition(expense.aiStatus, ServiceReceiptAIStatus.REJECTED, 'admin')) {
      throw new BadRequestException(`A record that is ${expense.aiStatus.toLowerCase().replace(/_/g, ' ')} cannot be rejected.`);
    }

    const updated = await this.prisma.vehicleExpense.update({
      where: { id: vehicleExpenseId },
      data: {
        aiStatus: ServiceReceiptAIStatus.REJECTED,
        aiRejectedAt: new Date(),
        // A rejected record is not verified by anyone, even if it once was.
        aiVerifiedAt: null,
        aiVerifiedById: null,
        acceptedResultId: null,
        aiAcceptedFields: [],
        updatedById: user.id,
      },
      select: { id: true, aiStatus: true, aiRejectedAt: true },
    });

    await this.audit.record({
      action: 'service_receipt.extraction_rejected',
      entityType: 'VehicleExpense',
      entityId: vehicleExpenseId,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { from: expense.aiStatus, to: ServiceReceiptAIStatus.REJECTED },
      metadata: reason ? { reason: reason.slice(0, 500) } : undefined,
    });

    return updated;
  }

  /**
   * Re-opens a settled record so it can be looked at again.
   *
   * This is the controlled reprocessing workflow §14 requires: the only way out of VERIFIED, and
   * it takes a person, a reason and an audit entry. A model running again never does this.
   */
  async reopen(user: AuthenticatedUser, vehicleExpenseId: string, reason: string) {
    const expense = await this.prisma.vehicleExpense.findFirst({
      where: { id: vehicleExpenseId, companyId: user.companyId },
      select: { id: true, aiStatus: true, aiVerifiedById: true },
    });
    if (!expense) throw new NotFoundException('Service record not found.');
    if (!isHumanSettled(expense.aiStatus)) {
      throw new BadRequestException('This record has not been settled, so there is nothing to re-open.');
    }
    if (!reason?.trim()) throw new BadRequestException('A reason is required to re-open a verified record.');

    const updated = await this.prisma.vehicleExpense.update({
      where: { id: vehicleExpenseId },
      data: {
        aiStatus: ServiceReceiptAIStatus.NEEDS_REVIEW,
        // The verification is cleared because it no longer holds — but the audit trail keeps it.
        aiVerifiedAt: null,
        aiVerifiedById: null,
        aiRejectedAt: null,
        updatedById: user.id,
      },
      select: { id: true, aiStatus: true },
    });

    await this.audit.record({
      action: 'service_receipt.reopened',
      entityType: 'VehicleExpense',
      entityId: vehicleExpenseId,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { from: expense.aiStatus, to: ServiceReceiptAIStatus.NEEDS_REVIEW, previouslyVerifiedBy: expense.aiVerifiedById },
      metadata: { reason: reason.trim().slice(0, 500) },
    });
    this.logger.log(`Service record ${vehicleExpenseId} re-opened by user ${user.id}`);

    return updated;
  }

  /** An explicit request to read the receipt again. Refused for a record a person has settled. */
  async retry(user: AuthenticatedUser, vehicleExpenseId: string) {
    const outcome = await this.jobs.requestReprocessing({
      companyId: user.companyId,
      vehicleExpenseId,
      requestedById: user.id,
    });
    if (!outcome.queued) throw new BadRequestException(outcome.reason ?? 'Processing could not be queued.');

    await this.audit.record({
      action: 'service_receipt.ai_retry_requested',
      entityType: 'VehicleExpense',
      entityId: vehicleExpenseId,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { jobId: outcome.jobId },
    });

    return { jobId: outcome.jobId, status: ServiceReceiptAIStatus.QUEUED };
  }

  /** A driver's view of their own uploaded receipts. Scoped to them by the caller. */
  async driverStatus(companyId: string, driverId: string, limit: number) {
    return this.prisma.vehicleExpense.findMany({
      where: { companyId, driverId, category: OperationCategory.MAINTENANCE, status: RecordStatus.ACTIVE },
      select: {
        id: true, amount: true, expenseDate: true, vendorName: true, aiStatus: true, receiptFileId: true, createdAt: true,
        vehicle: { select: { registrationNumber: true } },
      },
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  private async resultFor(companyId: string, vehicleExpenseId: string, resultId: string) {
    const result = await this.prisma.serviceReceiptAIResult.findFirst({
      where: { id: resultId, companyId, vehicleExpenseId },
      select: { id: true, extraction: true },
    });
    if (!result) throw new ForbiddenException('That extraction does not belong to this record.');
    return result;
  }

  /**
   * Reads a stored extraction back through the same schema that accepted it.
   *
   * Re-validating on read is not paranoia about the database: it means a schema change cannot
   * silently hand the review screen a shape it no longer understands. A row that no longer fits
   * is reported as unusable rather than rendered half-empty.
   */
  private readExtraction(value: Prisma.JsonValue): ServiceReceiptExtraction | null {
    const parsed = ServiceReceiptExtractionSchema.safeParse(value);
    if (!parsed.success) {
      this.logger.warn('A stored extraction no longer matches the receipt schema and was not shown.');
      return null;
    }
    return parsed.data;
  }

  /** Re-runs the application's checks against a stored extraction, for display in review. */
  revalidate(extraction: ServiceReceiptExtraction, context: { vehicleNumber?: string | null; recordedAmount?: number | null }) {
    return validateExtraction(extraction, context);
  }
}
