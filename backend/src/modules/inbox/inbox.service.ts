import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AIFailureCode, InboxAIStatus, InboxClassification, InboxMessageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { AI_PROVIDER } from '../ai/ai.tokens';
import { AIProviderError, type AIProvider } from '../ai/provider';
import { parseJsonObject } from '../ai/json';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  buildClassificationInput, EmailClassificationSchema, EMAIL_CLASSIFICATION_PROMPT, mayApplyClassification,
} from './email-ai';

/**
 * Reading, triaging and classifying what arrived.
 *
 * Two rules run through all of it. A person's classification is never overwritten by a model —
 * `classifiedById` is what records the difference, and every AI path checks it. And nothing here
 * acts on a message: no reply, no payment, no change to a vehicle or financial record. The most
 * an AI result does is suggest a category and write a summary a person reads (§21).
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Optional() @Inject(AI_PROVIDER) private readonly ai: AIProvider | null,
  ) {
    // Classification switched on with nothing to classify with would otherwise be a silent
    // nothing: every sync would report zero classified and no one would know why.
    if (this.config.email.aiEnabled && !this.ai) {
      this.logger.warn('EMAIL_AI_ENABLED is on but no AI provider is available; inbound mail will be filed without a suggested category.');
    }
  }

  /** The inbox list. Paged, and never loading bodies or attachments it does not need (§30). */
  async list(
    companyId: string,
    query: { status?: InboxMessageStatus; classification?: InboxClassification; q?: string; limit: number; cursor?: string },
  ) {
    const q = query.q?.trim();
    const rows = await this.prisma.inboxMessage.findMany({
      where: {
        companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.classification ? { classification: query.classification } : {}),
        ...(q
          ? {
              OR: [
                { subject: { contains: q, mode: Prisma.QueryMode.insensitive } },
                { fromAddress: { contains: q, mode: Prisma.QueryMode.insensitive } },
                { fromName: { contains: q, mode: Prisma.QueryMode.insensitive } },
              ],
            }
          : {}),
      },
      select: {
        id: true, fromAddress: true, fromName: true, subject: true, receivedAt: true, status: true,
        classification: true, classifiedById: true, aiStatus: true, hasHtml: true, provider: true,
        // One count each rather than the rows themselves: the list shows a paperclip, not files.
        _count: { select: { attachments: true } },
        aiResults: { orderBy: { version: 'desc' }, take: 1, select: { summary: true, confidence: true, classification: true } },
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, page: { limit: query.limit, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null } };
  }

  /** Counts for the filter chips. */
  async summary(companyId: string) {
    const [unread, total, needingAttention, byClassification] = await Promise.all([
      this.prisma.inboxMessage.count({ where: { companyId, status: InboxMessageStatus.UNREAD } }),
      this.prisma.inboxMessage.count({ where: { companyId } }),
      this.prisma.inboxMessage.count({
        where: { companyId, status: InboxMessageStatus.UNREAD, classification: { in: [InboxClassification.DOCUMENT, InboxClassification.SERVICE_INVOICE, InboxClassification.PAYMENT_NOTIFICATION] } },
      }),
      this.prisma.inboxMessage.groupBy({ by: ['classification'], where: { companyId }, _count: { _all: true } }),
    ]);

    return {
      unread,
      total,
      needingAttention,
      byClassification: Object.fromEntries(byClassification.map((row) => [row.classification, row._count._all])),
    };
  }

  /** One message in full, with its attachments and every AI reading of it. */
  async findOne(companyId: string, id: string) {
    const message = await this.prisma.inboxMessage.findFirst({
      where: { id, companyId },
      select: {
        id: true, provider: true, mailbox: true, providerMessageId: true, providerThreadId: true,
        fromAddress: true, fromName: true, toAddresses: true, ccAddresses: true, subject: true,
        receivedAt: true, bodyText: true, bodyTruncated: true, hasHtml: true, labels: true,
        status: true, classification: true, classifiedById: true, classifiedAt: true,
        aiStatus: true, aiAttempts: true, aiFailureCode: true, aiFailureMessage: true,
        authenticationResults: true, sizeBytes: true, createdAt: true,
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, filename: true, mimeType: true, sizeBytes: true, fileId: true, skipReason: true },
        },
        aiResults: {
          orderBy: { version: 'desc' },
          select: {
            id: true, version: true, provider: true, model: true, classification: true,
            confidence: true, summary: true, extraction: true, warnings: true, durationMs: true, createdAt: true,
          },
        },
      },
    });
    if (!message) throw new NotFoundException('Message not found.');
    return message;
  }

  async setStatus(user: AuthenticatedUser, id: string, status: InboxMessageStatus) {
    await this.assertExists(user.companyId, id);
    return this.prisma.inboxMessage.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
  }

  /**
   * A person setting the category.
   *
   * Recording who decided is the whole point: from here on, no AI run will change it, and the
   * Inbox shows the category as confirmed rather than suggested.
   */
  async classify(user: AuthenticatedUser, id: string, classification: InboxClassification) {
    const existing = await this.assertExists(user.companyId, id);

    const updated = await this.prisma.inboxMessage.update({
      where: { id },
      data: { classification, classifiedById: user.id, classifiedAt: new Date() },
      select: { id: true, classification: true, classifiedById: true, classifiedAt: true },
    });

    await this.audit.record({
      action: 'inbox.classified',
      entityType: 'InboxMessage',
      entityId: id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { from: existing.classification, to: classification, wasAiClassified: existing.classifiedById === null },
    });
    return updated;
  }

  /**
   * Classifies a message with AI.
   *
   * Returns a structured outcome instead of throwing, so a batch run is not derailed by one
   * message. A result is always recorded; whether it is *applied* depends on whether a person
   * has already decided.
   */
  async runClassification(companyId: string, messageId: string): Promise<{ ok: boolean; applied: boolean; reason?: string }> {
    if (!this.config.email.aiEnabled) return { ok: false, applied: false, reason: 'Email AI is switched off on this server.' };
    if (!this.ai) return { ok: false, applied: false, reason: 'No AI provider is configured.' };

    const message = await this.prisma.inboxMessage.findFirst({
      where: { id: messageId, companyId },
      select: {
        id: true, fromAddress: true, fromName: true, subject: true, bodyText: true,
        classifiedById: true, aiAttempts: true,
        attachments: { select: { filename: true, mimeType: true } },
      },
    });
    if (!message) return { ok: false, applied: false, reason: 'Message not found.' };

    await this.prisma.inboxMessage.update({
      where: { id: messageId },
      data: { aiStatus: InboxAIStatus.PROCESSING, aiAttempts: { increment: 1 } },
    });

    const startedAt = Date.now();
    try {
      const raw = await this.ai.processText({
        instructions: EMAIL_CLASSIFICATION_PROMPT,
        content: buildClassificationInput(message),
      });
      const parsed = EmailClassificationSchema.safeParse(parseJsonObject(raw));

      if (!parsed.success) {
        await this.recordAIFailure(messageId, AIFailureCode.INVALID_AI_OUTPUT, 'The model returned a classification that did not match the expected shape.');
        return { ok: false, applied: false, reason: 'The model returned an unusable classification.' };
      }

      const durationMs = Date.now() - startedAt;
      // A person's decision stands. The reading is still recorded and visible.
      const applied = mayApplyClassification(message);

      await this.prisma.$transaction(async (tx) => {
        const latest = await tx.inboxAIResult.findFirst({
          where: { messageId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        await tx.inboxAIResult.create({
          data: {
            companyId,
            messageId,
            version: (latest?.version ?? 0) + 1,
            provider: this.ai!.name,
            model: this.ai!.model,
            classification: parsed.data.classification,
            confidence: new Prisma.Decimal(parsed.data.confidence.toFixed(3)),
            summary: parsed.data.summary.slice(0, 2_000) || null,
            extraction: { references: parsed.data.references } as unknown as Prisma.InputJsonValue,
            warnings: parsed.data.warnings.slice(0, 10),
            durationMs,
          },
        });
        await tx.inboxMessage.update({
          where: { id: messageId },
          data: {
            aiStatus: InboxAIStatus.COMPLETED,
            aiFailureCode: null,
            aiFailureMessage: null,
            ...(applied ? { classification: parsed.data.classification } : {}),
          },
        });
      });

      // Counts and codes; the mail's contents are not logged (§37).
      this.logger.log(
        `Inbox message ${messageId} classified as ${parsed.data.classification} ` +
          `(confidence ${parsed.data.confidence.toFixed(2)}, ${durationMs}ms, ${applied ? 'applied' : 'recorded only — a person had already classified it'})`,
      );
      return { ok: true, applied };
    } catch (error) {
      const failure =
        error instanceof AIProviderError
          ? { code: error.code as AIFailureCode, message: error.message }
          : { code: AIFailureCode.UNKNOWN, message: 'Classification failed unexpectedly.' };
      await this.recordAIFailure(messageId, failure.code, failure.message);
      this.logger.warn(`Inbox classification failed for message ${messageId}: ${failure.code}`);
      return { ok: false, applied: false, reason: failure.message };
    }
  }

  /** Classifies everything still waiting. Called by the sync job and by the admin's retry. */
  async classifyPending(companyId: string, limit = 10): Promise<{ processed: number; failed: number }> {
    if (!this.config.email.aiEnabled || !this.ai) return { processed: 0, failed: 0 };

    const pending = await this.prisma.inboxMessage.findMany({
      where: { companyId, aiStatus: InboxAIStatus.PENDING },
      select: { id: true },
      orderBy: { receivedAt: 'asc' },
      take: limit,
    });

    let processed = 0;
    let failed = 0;
    for (const message of pending) {
      const outcome = await this.runClassification(companyId, message.id);
      if (outcome.ok) processed += 1;
      else failed += 1;
    }
    return { processed, failed };
  }

  /** An explicit request to classify a message again. */
  async retryClassification(user: AuthenticatedUser, id: string) {
    await this.assertExists(user.companyId, id);
    const outcome = await this.runClassification(user.companyId, id);
    if (!outcome.ok) throw new BadRequestException(outcome.reason ?? 'Classification could not be run.');

    await this.audit.record({
      action: 'inbox.ai_retried',
      entityType: 'InboxMessage',
      entityId: id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { applied: outcome.applied },
    });
    return { ok: true, applied: outcome.applied };
  }

  /** An attachment's stored file id, checked against the company before anything is opened. */
  async attachmentFileId(companyId: string, messageId: string, attachmentId: string): Promise<string> {
    const attachment = await this.prisma.inboxAttachment.findFirst({
      where: { id: attachmentId, messageId, companyId },
      select: { fileId: true, skipReason: true },
    });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    if (!attachment.fileId) {
      throw new BadRequestException(
        `This attachment was not stored (${attachment.skipReason ?? 'unknown reason'}). It remains in the mailbox.`,
      );
    }
    return attachment.fileId;
  }

  private async recordAIFailure(messageId: string, code: AIFailureCode, message: string): Promise<void> {
    await this.prisma.inboxMessage.update({
      where: { id: messageId },
      data: { aiStatus: InboxAIStatus.FAILED, aiFailureCode: code, aiFailureMessage: message.slice(0, 500) },
    });
  }

  private async assertExists(companyId: string, id: string) {
    const message = await this.prisma.inboxMessage.findFirst({
      where: { id, companyId },
      select: { id: true, classification: true, classifiedById: true },
    });
    if (!message) throw new NotFoundException('Message not found.');
    return message;
  }
}
