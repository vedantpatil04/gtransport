import { Injectable, Logger } from '@nestjs/common';
import { AIFailureCode, OperationCategory, Prisma, RecordStatus, ServiceReceiptAIStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AppConfigService } from '../../../config/app-config.service';
import { FileStorage } from '../../files/file-storage';
import { ReceiptAIService } from '../receipt-ai.service';
import { classifyDocumentKind } from '../preprocessing/document-preparation';
import { decideReviewOutcome, validateExtraction } from './extraction-review';
import { ReceiptJobService, type ClaimedJob } from './receipt-job.service';

/**
 * Runs one receipt job from claim to recorded outcome.
 *
 * The invariants this protects, in order of how expensive they would be to get wrong:
 *
 *  1. **The original is never touched.** The worker reads the stored file and works on bytes in
 *     memory. Whatever happens — a provider outage, a malformed response, a crash — the upload is
 *     exactly where the driver left it, which is what makes manual entry always possible (§5).
 *  2. **A failure is a failure.** There is no path here that records a successful extraction
 *     without a provider having returned one. A missing file, an unreadable document and an
 *     unreachable model each produce a stored failure code and a visible state (§31, §39).
 *  3. **Nothing is promoted automatically.** A successful run writes a result row and a status.
 *     It does not write the amount, the date or the vendor onto the maintenance record — only a
 *     person confirming the extraction does that (§11, §14).
 */
@Injectable()
export class ReceiptWorkerService {
  private readonly logger = new Logger(ReceiptWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: ReceiptJobService,
    private readonly ai: ReceiptAIService,
    private readonly storage: FileStorage,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Drains up to `max` jobs. Returns how many ran, so a caller can decide whether to come back
   * immediately or wait for the next tick.
   */
  async drain(max = 5): Promise<number> {
    let processed = 0;
    for (let i = 0; i < max; i += 1) {
      const job = await this.jobs.claimNext();
      if (!job) break;
      await this.runClaimed(job);
      processed += 1;
    }
    return processed;
  }

  /** Runs one already-claimed job. Never throws: a worker loop must not die on one bad receipt. */
  async runClaimed(job: ClaimedJob): Promise<void> {
    const { provider, model } = this.ai.describeProvider();
    this.logger.log(`Receipt AI job ${job.id} started (attempt ${job.attempt}/${job.maxAttempts}, provider ${provider})`);
    await this.audit.record({
      action: 'service_receipt.ai_processing',
      entityType: 'VehicleExpense',
      entityId: job.vehicleExpenseId,
      companyId: job.companyId,
      changes: { jobId: job.id, attempt: job.attempt, maxAttempts: job.maxAttempts, provider, model },
    });

    try {
      // ── The original must still be there. If it is not, that is the finding. ──
      if (job.receiptFile.deletedAt) {
        await this.fail(job, AIFailureCode.FILE_UNAVAILABLE, 'The receipt file has been removed, so it cannot be read.', false, provider, model);
        return;
      }

      let bytes: Uint8Array;
      try {
        bytes = await this.storage.get(job.receiptFile.objectKey);
      } catch (error) {
        // Storage being unreachable is transient; the file itself is untouched either way.
        this.logger.warn(`Receipt AI job ${job.id}: stored receipt could not be read from storage`);
        await this.fail(
          job,
          AIFailureCode.FILE_UNAVAILABLE,
          'The stored receipt could not be read right now. The file is intact and processing can be retried.',
          true,
          provider,
          model,
          error,
        );
        return;
      }

      const result = await this.ai.processServiceReceipt({
        receipt: {
          filename: job.receiptFile.originalFilename,
          mimeType: job.receiptFile.mimeType,
          kind: classifyDocumentKind(job.receiptFile.mimeType),
          bytes,
        },
        context: {
          vehicleNumber: job.vehicleExpense.vehicle.registrationNumber,
          vehicleId: job.vehicleExpense.vehicle.id,
          driverId: job.vehicleExpense.driverId,
        },
      });

      if (!result.ok) {
        await this.fail(
          job,
          result.failure.code as AIFailureCode,
          result.failure.message,
          result.failure.retryable,
          provider,
          result.model,
        );
        return;
      }

      // ── The application's own checks, independent of what the model claimed ──
      const validationIssues = validateExtraction(result.extraction, {
        vehicleNumber: job.vehicleExpense.vehicle.registrationNumber,
        expenseDate: job.vehicleExpense.expenseDate,
        recordedAmount: job.vehicleExpense.amount.toNumber(),
        lastVerifiedOdometerKm: await this.lastVerifiedOdometer(job),
      });
      // Low confidence routes to NEEDS_REVIEW (AI_LOW_CONFIDENCE_THRESHOLD); it never decides truth.
      const outcome = decideReviewOutcome(result.extraction, validationIssues, this.config.ai.lowConfidenceThreshold);

      await this.prisma.$transaction(async (tx) => {
        const version = await this.jobs.nextResultVersion(tx, job.vehicleExpenseId);
        await tx.serviceReceiptAIResult.create({
          data: {
            companyId: job.companyId,
            vehicleExpenseId: job.vehicleExpenseId,
            jobId: job.id,
            version,
            provider: result.provider,
            model: result.model,
            extraction: result.extraction as unknown as Prisma.InputJsonValue,
            confidence: new Prisma.Decimal(result.extraction.confidence.toFixed(3)),
            warnings: result.extraction.warnings.slice(0, 20),
            validationIssues: validationIssues.slice(0, 20),
            preparation: result.preparation,
            sourceTextChars: result.sourceTextChars,
            durationMs: result.durationMs,
          },
        });
      });

      await this.jobs.completeSuccess({
        jobId: job.id,
        vehicleExpenseId: job.vehicleExpenseId,
        outcome: outcome === 'SUCCEEDED' ? ServiceReceiptAIStatus.SUCCEEDED : ServiceReceiptAIStatus.NEEDS_REVIEW,
        provider: result.provider,
        model: result.model,
      });

      // Counts and codes only. The extraction and the receipt's contents are not logged (§37).
      this.logger.log(
        `Receipt AI job ${job.id} completed: ${outcome}, confidence ${result.extraction.confidence.toFixed(2)}, ` +
          `${validationIssues.length} validation issue(s), ${result.durationMs}ms via ${result.provider}`,
      );

      await this.audit.record({
        action: 'service_receipt.ai_completed',
        entityType: 'VehicleExpense',
        entityId: job.vehicleExpenseId,
        companyId: job.companyId,
        changes: {
          jobId: job.id,
          provider: result.provider,
          model: result.model,
          outcome,
          confidence: result.extraction.confidence,
          validationIssues: validationIssues.length,
        },
      });
    } catch (error) {
      // The catch-all exists so one unexpected failure cannot stop the worker loop. The receipt
      // is untouched and the job records that something went wrong.
      this.logger.error(
        `Receipt AI job ${job.id} failed unexpectedly`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.fail(job, AIFailureCode.UNKNOWN, 'Processing failed unexpectedly. The original receipt is unchanged.', true, provider, model).catch(
        () => undefined,
      );
    }
  }

  /**
   * The highest odometer reading on this vehicle's verified service history, so a reading that went
   * backwards is flagged. Verified records only — an unchecked extraction is not a reference point.
   */
  private async lastVerifiedOdometer(job: ClaimedJob): Promise<number | null> {
    const latest = await this.prisma.vehicleExpense.findFirst({
      where: {
        companyId: job.companyId,
        vehicleId: job.vehicleExpense.vehicle.id,
        category: OperationCategory.MAINTENANCE,
        status: RecordStatus.ACTIVE,
        aiStatus: ServiceReceiptAIStatus.VERIFIED,
        odometerKm: { not: null },
        id: { not: job.vehicleExpenseId },
      },
      orderBy: { odometerKm: 'desc' },
      select: { odometerKm: true },
    });
    return latest?.odometerKm ?? null;
  }

  private async fail(
    job: ClaimedJob,
    code: AIFailureCode,
    message: string,
    retryable: boolean,
    provider: string,
    model: string | null,
    cause?: unknown,
  ): Promise<void> {
    const { willRetry } = await this.jobs.completeFailure({
      jobId: job.id,
      vehicleExpenseId: job.vehicleExpenseId,
      companyId: job.companyId,
      receiptFileId: job.receiptFileId,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      code,
      message,
      retryable,
      provider,
      model,
    });

    this.logger.warn(
      `Receipt AI job ${job.id} failed: ${code} (attempt ${job.attempt}/${job.maxAttempts})` +
        `${willRetry ? ' — a retry has been scheduled' : ' — no further automatic attempts'}` +
        `${cause instanceof Error ? ` [${cause.name}]` : ''}`,
    );

    await this.audit.record({
      action: 'service_receipt.ai_failed',
      entityType: 'VehicleExpense',
      entityId: job.vehicleExpenseId,
      companyId: job.companyId,
      changes: { jobId: job.id, code, attempt: job.attempt, willRetry, provider },
    });
  }
}
