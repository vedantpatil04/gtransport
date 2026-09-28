import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OperationCategory, Prisma, RecordStatus, ServiceReceiptAIStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { ServiceReceiptExtractionSchema, type ServiceReceiptExtraction } from '../schema';
import { parseIsoDate, toSuggestedValues, validateExtraction } from './extraction-review';
import { canTransition, isHumanSettled } from './receipt-state';
import { ReceiptJobService } from './receipt-job.service';

/**
 * Human verification — the boundary where a suggestion becomes the record.
 *
 * Everything the AI produced up to this point lives in `service_receipt_ai_results` and has
 * changed nothing. This service is the only code in the system that writes an extracted value
 * onto a `VehicleExpense`, and it only does so because a named person asked it to. That is what
 * "AI is not authoritative" means in practice (§4, §14).
 *
 * Three things follow from it, and each is enforced here rather than trusted to a caller:
 *
 *  - **Verification names its author.** `aiVerifiedById` and `aiVerifiedAt` are written together,
 *    and the database refuses half of one.
 *  - **Corrections are distinguishable from acceptances.** `aiAcceptedFields` records which
 *    values were taken from the extraction; anything else on the record was typed by a person.
 *  - **A verified record is closed to automation.** Re-opening it is a separate, audited act.
 */
@Injectable()
export class ReceiptReviewService {
  private readonly logger = new Logger(ReceiptReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: ReceiptJobService,
  ) {}

  /**
   * Everything the review screen needs about one maintenance record: the record as it stands, the
   * original receipt reference, every extraction version, and what the latest one suggests.
   */
  async review(companyId: string, vehicleExpenseId: string) {
    const expense = await this.prisma.vehicleExpense.findFirst({
      where: { id: vehicleExpenseId, companyId },
      select: {
        id: true,
        category: true,
        amount: true,
        expenseDate: true,
        vendorName: true,
        description: true,
        receiptFileId: true,
        status: true,
        aiStatus: true,
        acceptedResultId: true,
        aiVerifiedAt: true,
        aiVerifiedById: true,
        aiRejectedAt: true,
        aiAcceptedFields: true,
        driver: { select: { id: true, driverCode: true, employee: { select: { fullName: true } } } },
        vehicle: { select: { id: true, registrationNumber: true } },
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
                in: [ServiceReceiptAIStatus.COMPLETED, ServiceReceiptAIStatus.REVIEW_REQUIRED, ServiceReceiptAIStatus.FAILED],
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
   * Confirms a service record.
   *
   * The values written are the ones the administrator submitted — which may be the extraction's
   * suggestions, their own corrections, or a mixture. The extraction is never read directly into
   * the record here: what the person had in front of them is what gets saved.
   */
  async verify(
    user: AuthenticatedUser,
    vehicleExpenseId: string,
    input: {
      amount?: string;
      expenseDate?: string;
      vendorName?: string | null;
      description?: string | null;
      /** Which of the submitted values came from the extraction rather than being typed. */
      acceptedFields?: string[];
      /** The extraction version the administrator worked from, when there was one. */
      resultId?: string | null;
    },
  ) {
    const expense = await this.prisma.vehicleExpense.findFirst({
      where: { id: vehicleExpenseId, companyId: user.companyId },
      select: { id: true, aiStatus: true, amount: true, expenseDate: true, vendorName: true, description: true, status: true },
    });
    if (!expense) throw new NotFoundException('Service record not found.');
    if (expense.status !== RecordStatus.ACTIVE) throw new BadRequestException('This record is archived.');
    if (!canTransition(expense.aiStatus, ServiceReceiptAIStatus.CONFIRMED, 'admin')) {
      throw new BadRequestException(`A record that is ${expense.aiStatus.toLowerCase().replace(/_/g, ' ')} cannot be confirmed.`);
    }

    if (input.resultId) await this.assertResultBelongs(user.companyId, vehicleExpenseId, input.resultId);

    const expenseDate = input.expenseDate ? parseIsoDate(input.expenseDate) : null;
    if (input.expenseDate && !expenseDate) throw new BadRequestException('The service date must be a valid date (YYYY-MM-DD).');
    if (input.amount !== undefined && !/^\d+(\.\d{1,2})?$/.test(input.amount)) {
      throw new BadRequestException('The amount must be a number with at most two decimal places.');
    }

    const now = new Date();
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const record = (key: string, from: unknown, to: unknown) => {
      if (String(from ?? '') !== String(to ?? '')) changes[key] = { from, to };
    };
    record('amount', expense.amount.toFixed(2), input.amount);
    record('expenseDate', expense.expenseDate.toISOString().slice(0, 10), input.expenseDate);
    record('vendorName', expense.vendorName, input.vendorName);
    record('description', expense.description, input.description);

    const updated = await this.prisma.vehicleExpense.update({
      where: { id: vehicleExpenseId },
      data: {
        ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
        ...(expenseDate ? { expenseDate } : {}),
        ...(input.vendorName !== undefined ? { vendorName: input.vendorName?.trim() || null } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        aiStatus: ServiceReceiptAIStatus.CONFIRMED,
        aiVerifiedAt: now,
        aiVerifiedById: user.id,
        aiRejectedAt: null,
        acceptedResultId: input.resultId ?? null,
        aiAcceptedFields: input.acceptedFields ?? [],
        updatedById: user.id,
      },
      select: { id: true, aiStatus: true, aiVerifiedAt: true },
    });

    // The audit line says who confirmed what and which fields they took from the extraction —
    // enough to reconstruct the decision later, without the receipt's contents (§25).
    await this.audit.record({
      action: 'service_receipt.verified',
      entityType: 'VehicleExpense',
      entityId: vehicleExpenseId,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: {
        from: expense.aiStatus,
        to: ServiceReceiptAIStatus.CONFIRMED,
        acceptedFields: input.acceptedFields ?? [],
        correctedFields: Object.keys(changes),
        resultId: input.resultId ?? null,
      },
    });
    this.logger.log(`Service record ${vehicleExpenseId} confirmed by user ${user.id}`);

    return updated;
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
   * This is the controlled reprocessing workflow §14 requires: the only way out of CONFIRMED, and
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
    if (!reason?.trim()) throw new BadRequestException('A reason is required to re-open a confirmed record.');

    const updated = await this.prisma.vehicleExpense.update({
      where: { id: vehicleExpenseId },
      data: {
        aiStatus: ServiceReceiptAIStatus.REVIEW_REQUIRED,
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
      changes: { from: expense.aiStatus, to: ServiceReceiptAIStatus.REVIEW_REQUIRED, previouslyVerifiedBy: expense.aiVerifiedById },
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

    return { jobId: outcome.jobId, status: ServiceReceiptAIStatus.PENDING };
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

  private async assertResultBelongs(companyId: string, vehicleExpenseId: string, resultId: string): Promise<void> {
    const result = await this.prisma.serviceReceiptAIResult.findFirst({
      where: { id: resultId, companyId, vehicleExpenseId },
      select: { id: true },
    });
    if (!result) throw new ForbiddenException('That extraction does not belong to this record.');
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
