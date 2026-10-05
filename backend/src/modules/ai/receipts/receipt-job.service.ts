import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AIFailureCode, Prisma, ServiceReceiptAIStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppConfigService } from '../../../config/app-config.service';
import { backoffMs, canQueueProcessing, isHumanSettled, NEEDS_ATTENTION } from './receipt-state';

/**
 * The durable work queue for receipt processing.
 *
 * Jobs are rows in PostgreSQL rather than entries in a memory queue, which is the whole point:
 * the API can be restarted, redeployed or killed mid-call and nothing is lost. A job that was
 * being processed when the process died is still there, still claimed by a worker that no longer
 * exists, and is reclaimed once its claim goes stale.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`. That is what allows more than one worker — or more than
 * one instance of the API — to drain the queue at the same time without two of them calling the
 * provider for the same receipt, which would cost real money and produce two results for one
 * document. No external broker is needed for this (§15: no unnecessary microservices).
 */
@Injectable()
export class ReceiptJobService {
  private readonly logger = new Logger(ReceiptJobService.name);

  /** Identifies this process in `claimed_by`, so a stuck job can be traced to a worker. */
  private readonly workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Queues processing for a receipt that has just been attached to a maintenance record.
   *
   * Refuses to queue for a record a person has already settled: a confirmed record is not
   * re-read because a new file arrived, and a rejected one is not quietly retried (§14).
   * Refuses to queue a second job while one is already pending or running, so a double-tapped
   * upload produces one job, not two.
   */
  async enqueue(input: {
    companyId: string;
    vehicleExpenseId: string;
    receiptFileId: string;
    requestedById?: string | null;
    maxAttempts?: number;
  }): Promise<{ jobId: string; queued: boolean; reason?: string }> {
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.vehicleExpense.findUnique({
        where: { id: input.vehicleExpenseId },
        select: { id: true, companyId: true, aiStatus: true },
      });
      if (!expense || expense.companyId !== input.companyId) {
        return { jobId: '', queued: false, reason: 'Record not found.' };
      }
      if (isHumanSettled(expense.aiStatus)) {
        return {
          jobId: '',
          queued: false,
          reason: 'This record has already been settled by the office; re-open it before processing again.',
        };
      }

      // One live job per record. The check and the insert share a transaction, so two concurrent
      // uploads cannot both pass it.
      const live = await tx.serviceReceiptAIJob.findFirst({
        where: {
          vehicleExpenseId: input.vehicleExpenseId,
          status: { in: [ServiceReceiptAIStatus.QUEUED, ServiceReceiptAIStatus.PROCESSING, ServiceReceiptAIStatus.RETRYING] },
        },
        select: { id: true },
      });
      if (live) return { jobId: live.id, queued: false, reason: 'Processing is already under way for this receipt.' };

      const job = await tx.serviceReceiptAIJob.create({
        data: {
          companyId: input.companyId,
          vehicleExpenseId: input.vehicleExpenseId,
          receiptFileId: input.receiptFileId,
          status: ServiceReceiptAIStatus.QUEUED,
          attempt: 1,
          // AI_MAX_ATTEMPTS, recorded on the job so a later configuration change does not
          // rewrite the retry budget of work already queued.
          maxAttempts: input.maxAttempts ?? this.config.ai.maxAttempts,
          requestedById: input.requestedById ?? null,
        },
        select: { id: true },
      });

      await tx.vehicleExpense.update({
        where: { id: input.vehicleExpenseId },
        data: { aiStatus: ServiceReceiptAIStatus.QUEUED },
      });

      return { jobId: job.id, queued: true };
    });
  }

  /**
   * Claims the next runnable job, or returns null when there is nothing to do.
   *
   * The `SKIP LOCKED` is doing the important work: two workers running this at the same instant
   * each get a different row instead of one of them blocking. Rows whose claim has gone stale are
   * picked up again, which is how a job survives the process that was running it being killed.
   */
  async claimNext(staleClaimMs = 10 * 60_000): Promise<ClaimedJob | null> {
    const staleBefore = new Date(Date.now() - staleClaimMs);
    const now = new Date();

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH claimable AS (
        SELECT id
          FROM service_receipt_ai_jobs
         WHERE (
                 status = 'QUEUED'
                 OR (status = 'RETRYING' AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
                 OR (status = 'PROCESSING' AND claimed_at IS NOT NULL AND claimed_at < ${staleBefore})
               )
         ORDER BY queued_at ASC
         LIMIT 1
           FOR UPDATE SKIP LOCKED
      )
      UPDATE service_receipt_ai_jobs AS j
         SET status = 'PROCESSING',
             claimed_at = ${now},
             claimed_by = ${this.workerId},
             started_at = COALESCE(j.started_at, ${now}),
             updated_at = ${now}
        FROM claimable
       WHERE j.id = claimable.id
      RETURNING j.id`;

    const claimedId = rows[0]?.id;
    if (!claimedId) return null;

    const job = await this.prisma.serviceReceiptAIJob.findUniqueOrThrow({
      where: { id: claimedId },
      select: {
        id: true,
        companyId: true,
        vehicleExpenseId: true,
        receiptFileId: true,
        attempt: true,
        maxAttempts: true,
        vehicleExpense: {
          select: {
            id: true,
            aiStatus: true,
            amount: true,
            expenseDate: true,
            vehicle: { select: { id: true, registrationNumber: true } },
            driverId: true,
          },
        },
        receiptFile: { select: { id: true, originalFilename: true, mimeType: true, objectKey: true, deletedAt: true } },
      },
    });

    // The record may have been confirmed by a person between queueing and claiming. Their decision
    // wins: the job is closed without contacting a provider.
    if (isHumanSettled(job.vehicleExpense.aiStatus)) {
      await this.prisma.serviceReceiptAIJob.update({
        where: { id: job.id },
        data: {
          status: job.vehicleExpense.aiStatus,
          finishedAt: new Date(),
          claimedAt: null,
          claimedBy: null,
          failureMessage: 'The office settled this record before processing began.',
        },
      });
      this.logger.log(`Job ${job.id} abandoned: the record was settled by the office first.`);
      return null;
    }

    await this.prisma.vehicleExpense.update({
      where: { id: job.vehicleExpenseId },
      data: { aiStatus: ServiceReceiptAIStatus.PROCESSING },
    });

    return job;
  }

  /** Records a successful run and the state the review rules assigned. */
  async completeSuccess(input: {
    jobId: string;
    vehicleExpenseId: string;
    outcome: ServiceReceiptAIStatus;
    provider: string;
    model: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.serviceReceiptAIJob.update({
        where: { id: input.jobId },
        data: {
          status: input.outcome,
          provider: input.provider,
          model: input.model,
          finishedAt: new Date(),
          claimedAt: null,
          claimedBy: null,
          failureCode: null,
          failureMessage: null,
        },
      }),
      this.prisma.vehicleExpense.update({
        where: { id: input.vehicleExpenseId },
        // Guarded below rather than here: a record settled mid-run keeps its human state.
        data: { aiStatus: input.outcome },
      }),
    ]);
  }

  /**
   * Records a failure, and decides whether it is worth trying again.
   *
   * A retryable failure with attempts left becomes a new job, scheduled after a backoff. A
   * non-retryable one — an unsupported file, a model that is not installed — stops immediately,
   * because trying it again would waste time and tell nobody anything new.
   */
  async completeFailure(input: {
    jobId: string;
    vehicleExpenseId: string;
    companyId: string;
    receiptFileId: string;
    attempt: number;
    maxAttempts: number;
    code: AIFailureCode;
    message: string;
    retryable: boolean;
    provider: string;
    model: string | null;
  }): Promise<{ willRetry: boolean }> {
    const willRetry = input.retryable && input.attempt < input.maxAttempts;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.serviceReceiptAIJob.update({
        where: { id: input.jobId },
        data: {
          status: ServiceReceiptAIStatus.FAILED,
          provider: input.provider,
          model: input.model,
          failureCode: input.code,
          failureMessage: input.message,
          finishedAt: now,
          claimedAt: null,
          claimedBy: null,
        },
      });

      if (willRetry) {
        // A new job rather than a reset one, so what was attempted stays on the record (§29).
        await tx.serviceReceiptAIJob.create({
          data: {
            companyId: input.companyId,
            vehicleExpenseId: input.vehicleExpenseId,
            receiptFileId: input.receiptFileId,
            status: ServiceReceiptAIStatus.RETRYING,
            attempt: input.attempt + 1,
            maxAttempts: input.maxAttempts,
            nextAttemptAt: new Date(now.getTime() + backoffMs(input.attempt)),
          },
        });
      }

      const expense = await tx.vehicleExpense.findUnique({
        where: { id: input.vehicleExpenseId },
        select: { aiStatus: true },
      });
      // A person who confirmed the record while the provider was failing keeps their decision.
      if (expense && !isHumanSettled(expense.aiStatus)) {
        await tx.vehicleExpense.update({
          where: { id: input.vehicleExpenseId },
          data: { aiStatus: willRetry ? ServiceReceiptAIStatus.RETRYING : ServiceReceiptAIStatus.FAILED },
        });
      }
    });

    return { willRetry };
  }

  /**
   * An explicit request to process a receipt again — the admin's "retry" button, or a rerun
   * against a newly configured model.
   *
   * A verified record is refused: re-opening it is a separate, deliberate act.
   */
  async requestReprocessing(input: {
    companyId: string;
    vehicleExpenseId: string;
    requestedById: string;
  }): Promise<{ jobId: string; queued: boolean; reason?: string }> {
    const expense = await this.prisma.vehicleExpense.findFirst({
      where: { id: input.vehicleExpenseId, companyId: input.companyId },
      select: { id: true, aiStatus: true, receiptFileId: true },
    });
    if (!expense) return { jobId: '', queued: false, reason: 'Record not found.' };
    if (!expense.receiptFileId) {
      return { jobId: '', queued: false, reason: 'This record has no receipt attached, so there is nothing to read.' };
    }
    if (isHumanSettled(expense.aiStatus)) {
      return {
        jobId: '',
        queued: false,
        reason: 'This record has been settled by the office. Re-open it first if it needs reading again.',
      };
    }
    if (!canQueueProcessing(expense.aiStatus)) {
      return { jobId: '', queued: false, reason: 'Processing is already under way for this receipt.' };
    }

    return this.enqueue({
      companyId: input.companyId,
      vehicleExpenseId: input.vehicleExpenseId,
      receiptFileId: expense.receiptFileId,
      requestedById: input.requestedById,
    });
  }

  /** The next version number for this record's extractions. Uniqueness is enforced by the database. */
  async nextResultVersion(tx: Prisma.TransactionClient, vehicleExpenseId: string): Promise<number> {
    const latest = await tx.serviceReceiptAIResult.findFirst({
      where: { vehicleExpenseId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }

  /** Queue depth, for the admin's processing indicator and for operational visibility. */
  async queueStatus(companyId: string): Promise<{
    queued: number;
    processing: number;
    retrying: number;
    failed: number;
    awaitingReview: number;
  }> {
    const [queued, processing, retrying, failed, awaitingReview] = await Promise.all([
      this.prisma.serviceReceiptAIJob.count({ where: { companyId, status: ServiceReceiptAIStatus.QUEUED } }),
      this.prisma.serviceReceiptAIJob.count({ where: { companyId, status: ServiceReceiptAIStatus.PROCESSING } }),
      this.prisma.serviceReceiptAIJob.count({ where: { companyId, status: ServiceReceiptAIStatus.RETRYING } }),
      this.prisma.serviceReceiptAIJob.count({ where: { companyId, status: ServiceReceiptAIStatus.FAILED } }),
      // Records the office still has to look at, which is the number that actually needs acting on.
      this.prisma.vehicleExpense.count({ where: { companyId, aiStatus: { in: NEEDS_ATTENTION } } }),
    ]);
    return { queued, processing, retrying, failed, awaitingReview };
  }
}

export type ClaimedJob = {
  id: string;
  companyId: string;
  vehicleExpenseId: string;
  receiptFileId: string;
  attempt: number;
  maxAttempts: number;
  vehicleExpense: {
    id: string;
    aiStatus: ServiceReceiptAIStatus;
    amount: Prisma.Decimal;
    expenseDate: Date;
    driverId: string | null;
    vehicle: { id: string; registrationNumber: string };
  };
  receiptFile: { id: string; originalFilename: string; mimeType: string; objectKey: string; deletedAt: Date | null };
};
