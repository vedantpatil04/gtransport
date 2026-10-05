import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  AIFailureCode, InboxAIStatus, InboxClassification, InboxMessageStatus, InboxSuggestionStatus, InboxSuggestionType,
  OperationCategory, Prisma, UserRole,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { AI_PROVIDER } from '../ai/ai.tokens';
import { AIProviderError, type AIProvider } from '../ai/provider';
import { parseJsonObject } from '../ai/json';
import { backoffMs } from '../ai/receipts/receipt-state';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { FINANCE_MANAGE_ROLES, FLEET_MANAGE_ROLES } from '../auth/roles';
import { OperationsService } from '../expenses/operations.service';
import { RECEIPT_MIME_TYPES } from '../files/files.service';
import {
  buildClassificationInput, EmailClassificationSchema, EMAIL_CLASSIFICATION_PROMPT, mayApplyClassification, suggestionsToKeep,
} from './email-ai';
import type { AcceptSuggestionDto } from './dto/inbox.dto';

/** Categories the office should look at soon when they arrive unread. */
const ATTENTION_CLASSES: InboxClassification[] = [
  InboxClassification.VEHICLE_DOCUMENT,
  InboxClassification.MAINTENANCE,
  InboxClassification.FINANCE,
  InboxClassification.SALARY_PAYMENT,
  InboxClassification.COMPLIANCE,
];

/**
 * Who may decide a suggestion of each kind — the same roles that may act in that area anywhere
 * else in the system. A suggestion is never a way round a permission.
 */
const DECIDERS: Record<InboxSuggestionType, UserRole[]> = {
  CREATE_SERVICE_RECORD: [...FLEET_MANAGE_ROLES, UserRole.ACCOUNTING],
  RECORD_FUEL_EXPENSE: [...FLEET_MANAGE_ROLES, UserRole.ACCOUNTING],
  REVIEW_VEHICLE_DOCUMENT: FLEET_MANAGE_ROLES,
  REVIEW_COMPLIANCE: FLEET_MANAGE_ROLES,
  REVIEW_FINANCE: FINANCE_MANAGE_ROLES,
  REVIEW_PAYMENT: FINANCE_MANAGE_ROLES,
};

const SUGGESTION_VIEW = {
  id: true, messageId: true, aiResultId: true, type: true, status: true, reason: true, details: true,
  attachmentId: true, decidedAt: true, decidedById: true, decisionNote: true, resultEntityType: true,
  resultEntityId: true, createdAt: true,
  attachment: { select: { id: true, filename: true, mimeType: true, fileId: true } },
} as const;

/**
 * Reading, triaging and classifying what arrived — and the office's decisions about it.
 *
 * Three rules run through all of it. A person's classification is never overwritten by a model.
 * A reading the model is unsure of is recorded but not applied. And nothing here acts on a message
 * by itself: no reply, no payment, no finance or compliance record. The most a model does is
 * suggest; a suggestion does nothing until a person with the right role accepts it, and even then
 * the only record it can create is a service record that goes through Service AI verification
 * like any other (§21).
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly operations: OperationsService,
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
        _count: { select: { attachments: true, suggestions: { where: { status: InboxSuggestionStatus.PENDING } } } },
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
    const [unread, total, needingAttention, pendingSuggestions, byClassification] = await Promise.all([
      this.prisma.inboxMessage.count({ where: { companyId, status: InboxMessageStatus.UNREAD } }),
      this.prisma.inboxMessage.count({ where: { companyId } }),
      this.prisma.inboxMessage.count({
        where: { companyId, status: InboxMessageStatus.UNREAD, classification: { in: ATTENTION_CLASSES } },
      }),
      this.prisma.inboxSuggestion.count({ where: { companyId, status: InboxSuggestionStatus.PENDING } }),
      this.prisma.inboxMessage.groupBy({ by: ['classification'], where: { companyId }, _count: { _all: true } }),
    ]);

    return {
      unread,
      total,
      needingAttention,
      pendingSuggestions,
      byClassification: Object.fromEntries(byClassification.map((row) => [row.classification, row._count._all])),
    };
  }

  /** One message in full, with its attachments, every AI reading and the suggestions made. */
  async findOne(companyId: string, id: string) {
    const message = await this.prisma.inboxMessage.findFirst({
      where: { id, companyId },
      select: {
        id: true, provider: true, mailbox: true, providerMessageId: true, providerThreadId: true,
        fromAddress: true, fromName: true, toAddresses: true, ccAddresses: true, subject: true,
        receivedAt: true, bodyText: true, bodyTruncated: true, hasHtml: true, labels: true,
        status: true, classification: true, classifiedById: true, classifiedAt: true,
        aiStatus: true, aiAttempts: true, aiFailureCode: true, aiFailureMessage: true, aiNextAttemptAt: true,
        authenticationResults: true, sizeBytes: true, createdAt: true,
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, filename: true, mimeType: true, sizeBytes: true, fileId: true, skipReason: true, downloadAttempts: true },
        },
        aiResults: {
          orderBy: { version: 'desc' },
          select: {
            id: true, version: true, provider: true, model: true, classification: true,
            confidence: true, summary: true, extraction: true, warnings: true, durationMs: true, createdAt: true,
          },
        },
        suggestions: { orderBy: { createdAt: 'desc' }, select: SUGGESTION_VIEW },
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
   * message. A valid reading is always recorded; whether it is *applied* depends on whether a
   * person has already decided, and on the model being confident enough. A retryable failure is
   * scheduled again with backoff, up to EMAIL_AI_MAX_ATTEMPTS.
   */
  async runClassification(companyId: string, messageId: string): Promise<ClassificationOutcome> {
    if (!this.config.email.aiEnabled) return { ok: false, applied: false, reason: 'Email AI is switched off on this server.' };
    if (!this.ai) return { ok: false, applied: false, reason: 'No AI provider is configured.' };
    const ai = this.ai;

    const message = await this.prisma.inboxMessage.findFirst({
      where: { id: messageId, companyId },
      select: {
        id: true, fromAddress: true, fromName: true, subject: true, bodyText: true, classification: true,
        classifiedById: true, aiAttempts: true,
        attachments: { select: { id: true, filename: true, mimeType: true, fileId: true } },
      },
    });
    if (!message) return { ok: false, applied: false, reason: 'Message not found.' };

    await this.prisma.inboxMessage.update({
      where: { id: messageId },
      data: { aiStatus: InboxAIStatus.PROCESSING, aiAttempts: { increment: 1 }, aiNextAttemptAt: null },
    });
    const attempt = message.aiAttempts + 1;

    const startedAt = Date.now();
    try {
      const raw = await ai.processText({
        instructions: EMAIL_CLASSIFICATION_PROMPT,
        content: buildClassificationInput(message),
      });
      const parsed = EmailClassificationSchema.safeParse(parseJsonObject(raw));

      if (!parsed.success) {
        const outcome = await this.recordAIFailure(companyId, messageId, attempt, AIFailureCode.INVALID_AI_OUTPUT,
          'The model returned a classification that did not match the expected shape.', true);
        return { ok: false, applied: false, reason: 'The model returned an unusable classification.', willRetry: outcome.willRetry };
      }

      const reading = parsed.data;
      const durationMs = Date.now() - startedAt;
      const minConfidence = this.config.email.aiMinConfidence;
      // A person's decision stands, and a guess below the floor is not filed as a category.
      const applied = mayApplyClassification(message, reading.confidence, minConfidence);
      const suggestions = suggestionsToKeep(reading, minConfidence);
      const lowConfidence = reading.confidence < minConfidence;

      const created = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.inboxAIResult.findFirst({ where: { messageId }, orderBy: { version: 'desc' }, select: { version: true } });
        const result = await tx.inboxAIResult.create({
          data: {
            companyId,
            messageId,
            version: (latest?.version ?? 0) + 1,
            provider: ai.name,
            model: ai.model,
            classification: reading.classification,
            confidence: new Prisma.Decimal(reading.confidence.toFixed(3)),
            summary: reading.summary.slice(0, 2_000) || null,
            extraction: { references: reading.references, suggestedActions: reading.suggestedActions } as unknown as Prisma.InputJsonValue,
            warnings: [...(lowConfidence ? ['Low confidence: the category was not applied.'] : []), ...reading.warnings].slice(0, 10),
            durationMs,
          },
          select: { id: true },
        });

        // Earlier undecided suggestions give way to this reading's; decided ones are history.
        await tx.inboxSuggestion.updateMany({
          where: { messageId, status: InboxSuggestionStatus.PENDING },
          data: { status: InboxSuggestionStatus.SUPERSEDED },
        });
        for (const action of suggestions) {
          const attachment = action.attachment
            ? message.attachments.find((candidate) => candidate.filename.toLowerCase() === action.attachment!.toLowerCase())
            : undefined;
          await tx.inboxSuggestion.create({
            data: {
              companyId,
              messageId,
              aiResultId: result.id,
              type: action.type,
              reason: action.reason,
              details: {
                vehicleRegistration: action.vehicleRegistration,
                amount: action.amount,
                date: action.date,
                reference: action.reference,
              } as Prisma.InputJsonValue,
              attachmentId: attachment?.id ?? null,
            },
          });
        }

        await tx.inboxMessage.update({
          where: { id: messageId },
          data: {
            aiStatus: InboxAIStatus.COMPLETED,
            aiFailureCode: null,
            aiFailureMessage: null,
            aiNextAttemptAt: null,
            ...(applied ? { classification: reading.classification } : {}),
          },
        });
        return result;
      });

      if (applied && reading.classification !== message.classification) {
        await this.audit.record({
          action: 'inbox.ai_classified',
          entityType: 'InboxMessage',
          entityId: messageId,
          companyId,
          changes: {
            from: message.classification,
            to: reading.classification,
            confidence: reading.confidence,
            resultId: created.id,
            provider: ai.name,
            model: ai.model,
            suggestions: suggestions.map((s) => s.type),
          },
        });
      }

      // Counts and codes; the mail's contents are not logged (§37).
      this.logger.log(
        `Inbox message ${messageId} read as ${reading.classification} (confidence ${reading.confidence.toFixed(2)}, ${durationMs}ms, ` +
          `${applied ? 'applied' : message.classifiedById ? 'recorded only — a person had already classified it' : 'recorded only — below the confidence floor'}, ` +
          `${suggestions.length} suggestion(s))`,
      );
      return { ok: true, applied, suggestions: suggestions.length };
    } catch (error) {
      const failure =
        error instanceof AIProviderError
          ? { code: error.code as AIFailureCode, message: error.message, retryable: error.retryable }
          : { code: AIFailureCode.UNKNOWN, message: 'Classification failed unexpectedly.', retryable: true };
      const outcome = await this.recordAIFailure(companyId, messageId, attempt, failure.code, failure.message, failure.retryable);
      this.logger.warn(`Inbox classification failed for message ${messageId}: ${failure.code}${outcome.willRetry ? ' (will retry)' : ''}`);
      return { ok: false, applied: false, reason: failure.message, willRetry: outcome.willRetry };
    }
  }

  /** Classifies everything waiting — new mail, and retries that have come due. */
  async classifyPending(companyId: string, limit = 10): Promise<{ processed: number; failed: number }> {
    if (!this.config.email.aiEnabled || !this.ai) return { processed: 0, failed: 0 };

    const pending = await this.prisma.inboxMessage.findMany({
      where: {
        companyId,
        OR: [
          { aiStatus: InboxAIStatus.PENDING },
          { aiStatus: InboxAIStatus.RETRYING, OR: [{ aiNextAttemptAt: null }, { aiNextAttemptAt: { lte: new Date() } }] },
        ],
      },
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

    await this.audit.record({
      action: 'inbox.ai_retried',
      entityType: 'InboxMessage',
      entityId: id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { ok: outcome.ok, applied: outcome.applied },
    });
    if (!outcome.ok) throw new BadRequestException(outcome.reason ?? 'Classification could not be run.');
    return { ok: true, applied: outcome.applied, suggestions: outcome.suggestions ?? 0 };
  }

  // ───────────────────────────── Suggestions ─────────────────────────────

  /** Suggestions across the inbox, newest first — the reviewer's queue. */
  async listSuggestions(companyId: string, query: { status?: InboxSuggestionStatus; limit: number; cursor?: string }) {
    const rows = await this.prisma.inboxSuggestion.findMany({
      where: { companyId, status: query.status ?? InboxSuggestionStatus.PENDING },
      select: { ...SUGGESTION_VIEW, message: { select: { id: true, subject: true, fromAddress: true, fromName: true, receivedAt: true } } },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, page: { limit: query.limit, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null } };
  }

  /**
   * A person accepting a suggestion.
   *
   * For a workshop invoice, acceptance creates a service record from the values the person
   * submitted and the stored attachment as its receipt — which then goes through Service AI
   * reading and needs verifying like any driver upload. For everything else, acceptance records
   * that the office will act on it in the relevant module; no finance, payment or compliance
   * record is created from here, by anyone.
   */
  async acceptSuggestion(user: AuthenticatedUser, id: string, dto: AcceptSuggestionDto) {
    const suggestion = await this.prisma.inboxSuggestion.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true, type: true, status: true, messageId: true, attachmentId: true },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found.');
    this.assertMayDecide(user, suggestion.type);
    if (suggestion.status !== InboxSuggestionStatus.PENDING) {
      throw new ConflictException(`This suggestion has already been ${suggestion.status.toLowerCase()}.`);
    }

    let result: { entityType: string; entityId: string } | null = null;
    if (suggestion.type === InboxSuggestionType.CREATE_SERVICE_RECORD) {
      if (!dto.serviceRecord) {
        throw new BadRequestException('A service record needs the vehicle, amount and service date, checked against the invoice.');
      }
      const attachmentId = dto.serviceRecord.attachmentId ?? suggestion.attachmentId;
      if (!attachmentId) throw new BadRequestException('Choose the invoice attachment the service record is for.');
      const attachment = await this.prisma.inboxAttachment.findFirst({
        where: { id: attachmentId, messageId: suggestion.messageId, companyId: user.companyId },
        select: { fileId: true, mimeType: true },
      });
      if (!attachment?.fileId) throw new BadRequestException('That attachment was not stored, so it cannot become a receipt.');
      if (!RECEIPT_MIME_TYPES.has(attachment.mimeType)) {
        throw new BadRequestException('Only a photo or PDF attachment can be used as a service receipt.');
      }

      const { record } = await this.operations.createForOffice(user, {
        category: OperationCategory.MAINTENANCE,
        vehicleId: dto.serviceRecord.vehicleId,
        driverId: dto.serviceRecord.driverId,
        amount: dto.serviceRecord.amount,
        expenseDate: dto.serviceRecord.expenseDate,
        vendorName: dto.serviceRecord.vendorName,
        description: dto.serviceRecord.description,
        receiptFileId: attachment.fileId,
        // Idempotent: accepting twice, or two people at once, yields one record.
        clientSubmissionId: `inbox-suggestion:${suggestion.id}`,
      });
      result = { entityType: 'VehicleExpense', entityId: record.id };
    }

    // Claimed only from PENDING, so a concurrent decision cannot be overwritten.
    const claimed = await this.prisma.inboxSuggestion.updateMany({
      where: { id: suggestion.id, status: InboxSuggestionStatus.PENDING },
      data: {
        status: InboxSuggestionStatus.ACCEPTED,
        decidedAt: new Date(),
        decidedById: user.id,
        decisionNote: dto.note?.trim() || null,
        resultEntityType: result?.entityType ?? null,
        resultEntityId: result?.entityId ?? null,
      },
    });
    if (claimed.count === 0) throw new ConflictException('Someone else decided this suggestion first.');

    await this.audit.record({
      action: 'inbox.suggestion_accepted',
      entityType: 'InboxSuggestion',
      entityId: suggestion.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { type: suggestion.type, messageId: suggestion.messageId, result },
    });
    return this.prisma.inboxSuggestion.findUniqueOrThrow({ where: { id: suggestion.id }, select: SUGGESTION_VIEW });
  }

  async rejectSuggestion(user: AuthenticatedUser, id: string, note?: string) {
    const suggestion = await this.prisma.inboxSuggestion.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true, type: true, status: true, messageId: true },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found.');
    this.assertMayDecide(user, suggestion.type);

    const claimed = await this.prisma.inboxSuggestion.updateMany({
      where: { id: suggestion.id, status: InboxSuggestionStatus.PENDING },
      data: { status: InboxSuggestionStatus.REJECTED, decidedAt: new Date(), decidedById: user.id, decisionNote: note?.trim() || null },
    });
    if (claimed.count === 0) throw new ConflictException(`This suggestion has already been ${suggestion.status.toLowerCase()}.`);

    await this.audit.record({
      action: 'inbox.suggestion_rejected',
      entityType: 'InboxSuggestion',
      entityId: suggestion.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { type: suggestion.type, messageId: suggestion.messageId },
      metadata: note?.trim() ? { note: note.trim().slice(0, 500) } : undefined,
    });
    return this.prisma.inboxSuggestion.findUniqueOrThrow({ where: { id: suggestion.id }, select: SUGGESTION_VIEW });
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

  private assertMayDecide(user: AuthenticatedUser, type: InboxSuggestionType): void {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (!DECIDERS[type].includes(user.role)) {
      throw new ForbiddenException('Your role cannot decide this kind of suggestion.');
    }
  }

  private async recordAIFailure(
    companyId: string,
    messageId: string,
    attempt: number,
    code: AIFailureCode,
    message: string,
    retryable: boolean,
  ): Promise<{ willRetry: boolean }> {
    const willRetry = retryable && attempt < this.config.email.aiMaxAttempts;
    await this.prisma.inboxMessage.update({
      where: { id: messageId },
      data: {
        aiStatus: willRetry ? InboxAIStatus.RETRYING : InboxAIStatus.FAILED,
        aiFailureCode: code,
        aiFailureMessage: message.slice(0, 500),
        aiNextAttemptAt: willRetry ? new Date(Date.now() + backoffMs(attempt)) : null,
      },
    });
    await this.audit.record({
      action: 'inbox.ai_failed',
      entityType: 'InboxMessage',
      entityId: messageId,
      companyId,
      changes: { code, attempt, willRetry },
    });
    return { willRetry };
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

export interface ClassificationOutcome {
  ok: boolean;
  applied: boolean;
  reason?: string;
  willRetry?: boolean;
  suggestions?: number;
}
