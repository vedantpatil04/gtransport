import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EmailProviderName, InboxAIStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { FilesService } from '../files/files.service';
import { EMAIL_PROVIDER } from './inbox.tokens';
import { EmailProviderError, type EmailProvider, type InboundAttachmentDescriptor, type InboundEmail } from './email-provider';
import { decideAttachment, normaliseMimeType, sanitiseFilename } from './attachment-policy';

/**
 * Bringing a company mailbox into the application.
 *
 * The one property everything else rests on: **running this twice changes nothing the first run
 * already did.** Synchronisation is keyed on the provider's own message id, enforced by a unique
 * constraint rather than by a lookup, so an overlapping window after a failure, a scheduler that
 * fires twice, or two instances syncing at once all converge on the same rows (§19).
 *
 * What it will not do is equally deliberate. Nothing here replies, forwards, deletes or moves
 * money, and nothing it stores modifies a financial or vehicle record. It files what arrived and
 * hands it to a person (§21).
 */
@Injectable()
export class InboxSyncService {
  private readonly logger = new Logger(InboxSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Optional() @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider | null,
  ) {}

  /** Whether a mailbox is configured at all. The Inbox screen says so plainly when it is not. */
  isConfigured(): boolean {
    return Boolean(this.provider?.isConfigured());
  }

  providerName(): EmailProviderName | null {
    return this.provider?.name ?? null;
  }

  /** Contacts the mailbox and reports what happened. Used by the admin's connection check. */
  async verifyConnection() {
    if (!this.provider?.isConfigured()) {
      return { ok: false as const, reason: 'No mailbox is configured on this server.' };
    }
    return this.provider.verifyConnection();
  }

  /**
   * Fetches new mail and files it.
   *
   * Every message is handled on its own: one that cannot be parsed or whose attachment cannot be
   * downloaded does not stop the rest, because a single malformed mail should not stall a
   * mailbox indefinitely. The cursor still advances past it, and the failure is counted.
   */
  async sync(companyId: string, options: { limit?: number; actorUserId?: string | null } = {}): Promise<SyncOutcome> {
    if (!this.provider?.isConfigured()) {
      // Reporting success here would be the "Email synced when the provider was never contacted"
      // that Phase 7 explicitly forbids (§39).
      return { ok: false, reason: 'No mailbox is configured on this server.', fetched: 0, created: 0, duplicates: 0, failed: 0 };
    }

    const mailbox = this.config.email.imap.mailbox;
    const limit = options.limit ?? this.config.email.syncBatchSize;
    const startedAt = new Date();

    const cursorRow = await this.prisma.emailSyncCursor.upsert({
      where: { companyId_provider_mailbox: { companyId, provider: this.provider.name, mailbox } },
      create: { companyId, provider: this.provider.name, mailbox, lastSyncStartedAt: startedAt },
      update: { lastSyncStartedAt: startedAt },
      select: { id: true, cursor: true, messagesSynced: true },
    });

    this.logger.log(`Mailbox sync started for company ${companyId} (${this.provider.name}/${mailbox}).`);

    let page;
    try {
      page = await this.provider.fetchSince(cursorRow.cursor, limit);
    } catch (error) {
      const reason = error instanceof EmailProviderError ? error.message : 'The mailbox could not be read.';
      await this.prisma.emailSyncCursor.update({
        where: { id: cursorRow.id },
        data: {
          lastSyncFinishedAt: new Date(),
          lastError: reason,
          consecutiveFailures: { increment: 1 },
        },
      });
      this.logger.warn(`Mailbox sync failed for company ${companyId}: ${reason}`);
      return { ok: false, reason, fetched: 0, created: 0, duplicates: 0, failed: 0 };
    }

    let created = 0;
    let duplicates = 0;
    let failed = 0;

    for (const message of page.messages) {
      try {
        const outcome = await this.ingest(companyId, message);
        if (outcome === 'created') created += 1;
        else duplicates += 1;
      } catch (error) {
        failed += 1;
        // Subject and sender are not logged: a failure line should not carry the office's mail.
        this.logger.warn(
          `A message could not be filed during sync for company ${companyId}: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    }

    await this.prisma.emailSyncCursor.update({
      where: { id: cursorRow.id },
      data: {
        cursor: page.nextCursor,
        lastSyncFinishedAt: new Date(),
        lastError: null,
        consecutiveFailures: 0,
        messagesSynced: cursorRow.messagesSynced + created,
      },
    });

    if (created > 0 || failed > 0) {
      await this.audit.record({
        action: 'inbox.synced',
        entityType: 'EmailSyncCursor',
        entityId: cursorRow.id,
        companyId,
        actorUserId: options.actorUserId ?? null,
        changes: { provider: this.provider.name, mailbox, fetched: page.messages.length, created, duplicates, failed },
      });
    }

    this.logger.log(
      `Mailbox sync finished for company ${companyId}: ${page.messages.length} fetched, ${created} new, ${duplicates} already filed, ${failed} failed.`,
    );
    return { ok: true, fetched: page.messages.length, created, duplicates, failed };
  }

  /**
   * Files one message.
   *
   * The insert is attempted directly and a unique-constraint violation is treated as "already
   * filed". That is deliberate: a check-then-insert would still race two concurrent syncs, and
   * the constraint cannot.
   */
  private async ingest(companyId: string, message: InboundEmail): Promise<'created' | 'duplicate'> {
    const provider = this.provider!.name;
    const maxBodyChars = this.config.email.maxBodyChars;
    const bodyText = message.bodyText ?? null;

    let created: { id: string };
    try {
      created = await this.prisma.inboxMessage.create({
        data: {
          companyId,
          provider,
          mailbox: this.config.email.imap.mailbox,
          providerMessageId: message.providerMessageId,
          providerThreadId: message.providerThreadId ?? null,
          rfcMessageId: message.rfcMessageId ?? null,
          fromAddress: message.fromAddress.slice(0, 320),
          fromName: message.fromName?.slice(0, 160) ?? null,
          toAddresses: message.toAddresses.slice(0, 25),
          ccAddresses: message.ccAddresses.slice(0, 25),
          subject: message.subject?.slice(0, 500) ?? null,
          receivedAt: message.receivedAt,
          bodyText: bodyText ? bodyText.slice(0, maxBodyChars) : null,
          bodyTruncated: Boolean(bodyText && bodyText.length > maxBodyChars),
          hasHtml: message.hasHtml,
          labels: message.labels.slice(0, 20),
          sizeBytes: message.sizeBytes ?? null,
          authenticationResults: message.authenticationResults ?? null,
          // Queued for classification only when AI is switched on; otherwise it stays untouched
          // and unclassified rather than pretending to have been considered.
          aiStatus: this.config.email.aiEnabled ? InboxAIStatus.PENDING : InboxAIStatus.NOT_PROCESSED,
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Already filed. This is the normal outcome of re-reading an overlapping window.
        return 'duplicate';
      }
      throw error;
    }

    await this.storeAttachments(companyId, created.id, message);
    return 'created';
  }

  /**
   * Stores the attachments worth keeping, and records why the others were not.
   *
   * A refused attachment still gets a row. The office needs to be able to see that something
   * arrived and was not kept — silently dropping it would leave them wondering where the invoice
   * went (§20).
   */
  private async storeAttachments(companyId: string, messageId: string, message: InboundEmail): Promise<void> {
    const maxBytes = this.config.email.maxAttachmentBytes;

    for (const [index, attachment] of message.attachments.entries()) {
      const filename = sanitiseFilename(attachment.filename, `attachment-${index + 1}`);
      const mimeType = normaliseMimeType(attachment.mimeType);
      const decision = decideAttachment({ filename, mimeType, sizeBytes: attachment.sizeBytes }, maxBytes);

      if (!decision.keep) {
        await this.recordAttachment(companyId, messageId, attachment, filename, mimeType, null, decision.reason);
        continue;
      }

      try {
        const bytes = attachment.content ?? (await this.provider!.fetchAttachment(message.providerMessageId, attachment.providerAttachmentId));
        // Stored through the same abstraction as every other file in the system: bytes go to
        // object storage, the database keeps the reference (§17).
        const stored = await this.files.store({
          companyId,
          category: 'inbox',
          filename,
          mimeType,
          bytes,
        });
        await this.recordAttachment(companyId, messageId, attachment, filename, mimeType, stored.id, null);
      } catch (error) {
        this.logger.warn(`An attachment could not be stored: ${error instanceof Error ? error.name : 'unknown error'}`);
        await this.recordAttachment(companyId, messageId, attachment, filename, mimeType, null, 'download_failed');
      }
    }
  }

  private async recordAttachment(
    companyId: string,
    messageId: string,
    attachment: InboundAttachmentDescriptor,
    filename: string,
    mimeType: string,
    fileId: string | null,
    skipReason: string | null,
  ): Promise<void> {
    await this.prisma.inboxAttachment
      .create({
        data: {
          companyId,
          messageId,
          providerAttachmentId: attachment.providerAttachmentId,
          filename,
          mimeType,
          sizeBytes: Math.max(0, attachment.sizeBytes),
          fileId,
          skipReason,
        },
      })
      // A re-synced message finding its attachment already recorded is not an error.
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
        throw error;
      });
  }

  /** Where synchronisation stands, for the Inbox header. */
  async status(companyId: string) {
    const provider = this.provider?.name ?? null;
    const cursor = provider
      ? await this.prisma.emailSyncCursor.findFirst({
          where: { companyId, provider },
          select: {
            provider: true, mailbox: true, lastSyncStartedAt: true, lastSyncFinishedAt: true,
            lastError: true, consecutiveFailures: true, messagesSynced: true,
          },
        })
      : null;

    return {
      configured: this.isConfigured(),
      provider,
      /** So the screen can say "no mailbox is connected" rather than "no mail". */
      mailbox: this.isConfigured() ? this.config.email.imap.mailbox : null,
      syncEnabled: this.config.email.syncEnabled,
      aiEnabled: this.config.email.aiEnabled,
      lastSyncStartedAt: cursor?.lastSyncStartedAt?.toISOString() ?? null,
      lastSyncFinishedAt: cursor?.lastSyncFinishedAt?.toISOString() ?? null,
      lastError: cursor?.lastError ?? null,
      consecutiveFailures: cursor?.consecutiveFailures ?? 0,
      messagesSynced: cursor?.messagesSynced ?? 0,
    };
  }
}

export interface SyncOutcome {
  ok: boolean;
  reason?: string;
  fetched: number;
  created: number;
  duplicates: number;
  failed: number;
}
