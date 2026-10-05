import { Injectable, Logger } from '@nestjs/common';
import { InboxAIStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { FilesService } from '../files/files.service';
import { EmailProviderError, type EmailProvider, type InboundAttachmentDescriptor, type InboundEmail } from './email-provider';
import { decideAttachment, normaliseMimeType, sanitiseFilename } from './attachment-policy';
import { MailboxConnectionService } from './mailbox-connection.service';

/** Download attempts for one attachment before it is left in the mailbox with its reason. */
export const MAX_ATTACHMENT_ATTEMPTS = 3;
/** Consecutive runs a page may fail to file before the cursor moves past it anyway. */
const MAX_PAGE_RETRIES = 3;

/** Backoff before the scheduler tries a failing mailbox again: 1, 2, 4 … minutes, capped. */
export function syncBackoffMs(consecutiveFailures: number, capMs = 60 * 60_000): number {
  return Math.min(capMs, 60_000 * 2 ** Math.max(0, consecutiveFailures - 1));
}

/**
 * Bringing a company mailbox into the application.
 *
 * The one property everything else rests on: **running this twice changes nothing the first run
 * already did.** Synchronisation is keyed on the provider's own message id, enforced by a unique
 * constraint rather than by a lookup, so an overlapping window after a failure, a scheduler that
 * fires twice, or two instances syncing at once all converge on the same rows (§19).
 *
 * And a failure is never reported as success. A provider that could not be reached, a mailbox
 * that needs re-authorising, a page that could not be filed — each is recorded on the cursor,
 * returned to the caller, written to the audit trail, and retried with backoff.
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
    private readonly connections: MailboxConnectionService,
  ) {}

  /** Contacts the mailbox and reports what happened. Used by the admin's connection check. */
  async verifyConnection(companyId: string) {
    const resolved = await this.connections.resolve(companyId);
    if (!resolved.provider) return { ok: false as const, reason: resolved.reason };
    return resolved.provider.verifyConnection();
  }

  /**
   * Fetches new mail and files it, page by page, up to EMAIL_SYNC_MAX_PAGES pages.
   *
   * Every message is handled on its own, so one that cannot be filed does not stop the rest. But
   * the cursor only moves past a page once every message on it is filed: a page with a failure is
   * read again next run (the ones already filed are recognised and skipped). A page that keeps
   * failing is moved past after MAX_PAGE_RETRIES runs, with the count recorded, so one malformed
   * mail cannot stall a mailbox for ever.
   */
  async sync(
    companyId: string,
    options: { limit?: number; actorUserId?: string | null; trigger?: 'manual' | 'scheduled' } = {},
  ): Promise<SyncOutcome> {
    const trigger = options.trigger ?? 'manual';
    const empty = { fetched: 0, created: 0, duplicates: 0, failed: 0, pages: 0, hasMore: false, attachmentsRecovered: 0, notices: [] as string[] };

    const resolved = await this.connections.resolve(companyId);
    if (!resolved.provider) {
      // Reporting success here would be the "Email synced when the provider was never contacted"
      // that Phase 7 explicitly forbids (§39).
      return { ok: false, reason: resolved.reason, retryable: false, ...empty };
    }
    const provider = resolved.provider;
    const limit = options.limit ?? this.config.email.syncBatchSize;
    const startedAt = new Date();

    const cursorRow = await this.prisma.emailSyncCursor.upsert({
      where: { companyId_provider_mailbox: { companyId, provider: provider.name, mailbox: provider.mailbox } },
      create: { companyId, provider: provider.name, mailbox: provider.mailbox },
      update: {},
      select: { id: true, cursor: true, messagesSynced: true, consecutiveFailures: true, nextAttemptAt: true },
    });

    // The scheduler respects backoff; a person pressing "check now" does not.
    if (trigger === 'scheduled' && cursorRow.nextAttemptAt && cursorRow.nextAttemptAt > startedAt) {
      return { ok: false, skipped: true, reason: `Waiting until ${cursorRow.nextAttemptAt.toISOString()} after earlier failures.`, retryable: true, ...empty };
    }

    await this.prisma.emailSyncCursor.update({ where: { id: cursorRow.id }, data: { lastSyncStartedAt: startedAt } });
    this.logger.log(`Mailbox sync started for company ${companyId} (${provider.name}, ${trigger}).`);

    const totals = { ...empty };
    let cursor = cursorRow.cursor;
    let pageFailure: string | null = null;

    try {
      for (let page = 0; page < this.config.email.maxPagesPerSync; page += 1) {
        const result = await provider.fetchSince(cursor, limit);
        totals.pages += 1;
        totals.fetched += result.messages.length;
        totals.notices.push(...(result.notices ?? []));

        let pageFailed = 0;
        for (const message of result.messages) {
          try {
            const outcome = await this.ingest(companyId, provider, message);
            if (outcome === 'created') totals.created += 1;
            else totals.duplicates += 1;
          } catch (error) {
            pageFailed += 1;
            // Subject and sender are not logged: a failure line should not carry the office's mail.
            this.logger.warn(`A message could not be filed for company ${companyId}: ${error instanceof Error ? error.name : 'unknown error'}`);
          }
        }
        totals.failed += pageFailed;

        if (pageFailed > 0 && cursorRow.consecutiveFailures + 1 < MAX_PAGE_RETRIES) {
          // Hold the cursor: this page is read again next run.
          pageFailure = `${pageFailed} message(s) could not be filed and will be retried.`;
          break;
        }
        if (pageFailed > 0) {
          totals.notices.push(`${pageFailed} message(s) could not be filed after ${MAX_PAGE_RETRIES} attempts and were skipped.`);
        }
        cursor = result.nextCursor;
        totals.hasMore = Boolean(result.hasMore);
        if (!result.hasMore) break;
      }
    } catch (error) {
      const reason = error instanceof EmailProviderError ? error.message : 'The mailbox could not be read.';
      const retryable = error instanceof EmailProviderError ? error.retryable : true;
      if (!(error instanceof EmailProviderError)) {
        this.logger.error('Mailbox sync failed unexpectedly', error instanceof Error ? error.stack : String(error));
      }
      return this.recordFailure(companyId, cursorRow, cursor, provider, totals, reason, retryable, options.actorUserId ?? null, trigger);
    }

    totals.attachmentsRecovered = await this.retryAttachmentDownloads(companyId, provider, startedAt);

    if (pageFailure) {
      return this.recordFailure(companyId, cursorRow, cursor, provider, totals, pageFailure, true, options.actorUserId ?? null, trigger);
    }

    await this.prisma.emailSyncCursor.update({
      where: { id: cursorRow.id },
      data: {
        cursor,
        lastSyncFinishedAt: new Date(),
        lastError: null,
        consecutiveFailures: 0,
        nextAttemptAt: null,
        messagesSynced: cursorRow.messagesSynced + totals.created,
      },
    });

    // Every manual sync is on the record; a scheduled one when it actually filed or failed something.
    if (trigger === 'manual' || totals.created > 0 || totals.failed > 0 || totals.attachmentsRecovered > 0) {
      await this.audit.record({
        action: 'inbox.synced',
        entityType: 'EmailSyncCursor',
        entityId: cursorRow.id,
        companyId,
        actorUserId: options.actorUserId ?? null,
        changes: {
          provider: provider.name,
          trigger,
          pages: totals.pages,
          fetched: totals.fetched,
          created: totals.created,
          duplicates: totals.duplicates,
          failed: totals.failed,
          attachmentsRecovered: totals.attachmentsRecovered,
        },
      });
    }

    this.logger.log(
      `Mailbox sync finished for company ${companyId}: ${totals.fetched} fetched over ${totals.pages} page(s), ` +
        `${totals.created} new, ${totals.duplicates} already filed, ${totals.failed} failed.`,
    );
    return { ok: true, retryable: false, ...totals };
  }

  private async recordFailure(
    companyId: string,
    cursorRow: { id: string; consecutiveFailures: number; messagesSynced: number },
    cursor: string | null,
    provider: EmailProvider,
    totals: Omit<SyncOutcome, 'ok' | 'reason' | 'retryable' | 'skipped'>,
    reason: string,
    retryable: boolean,
    actorUserId: string | null,
    trigger: 'manual' | 'scheduled',
  ): Promise<SyncOutcome> {
    const failures = cursorRow.consecutiveFailures + 1;
    await this.prisma.emailSyncCursor.update({
      where: { id: cursorRow.id },
      data: {
        // Pages fully filed before the failure are kept; the rest is read again next time.
        cursor,
        lastSyncFinishedAt: new Date(),
        lastError: reason,
        consecutiveFailures: failures,
        // A non-retryable failure (credentials refused) waits for a person, not a timer.
        nextAttemptAt: retryable ? new Date(Date.now() + syncBackoffMs(failures)) : null,
        messagesSynced: cursorRow.messagesSynced + totals.created,
      },
    });
    await this.audit.record({
      action: 'inbox.sync_failed',
      entityType: 'EmailSyncCursor',
      entityId: cursorRow.id,
      companyId,
      actorUserId,
      changes: { provider: provider.name, trigger, reason, retryable, consecutiveFailures: failures, created: totals.created },
    });
    this.logger.warn(`Mailbox sync failed for company ${companyId}: ${reason}`);
    return { ok: false, reason, retryable, ...totals };
  }

  /**
   * Files one message.
   *
   * The insert is attempted directly and a unique-constraint violation is treated as "already
   * filed". That is deliberate: a check-then-insert would still race two concurrent syncs, and
   * the constraint cannot.
   */
  private async ingest(companyId: string, provider: EmailProvider, message: InboundEmail): Promise<'created' | 'duplicate'> {
    const maxBodyChars = this.config.email.maxBodyChars;
    const bodyText = message.bodyText ?? null;

    let created: { id: string };
    try {
      created = await this.prisma.inboxMessage.create({
        data: {
          companyId,
          provider: provider.name,
          mailbox: provider.mailbox,
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

    await this.storeAttachments(companyId, provider, created.id, message);
    return 'created';
  }

  /**
   * Stores the attachments worth keeping, and records why the others were not.
   *
   * A refused attachment still gets a row. The office needs to be able to see that something
   * arrived and was not kept — silently dropping it would leave them wondering where the invoice
   * went (§20).
   */
  private async storeAttachments(companyId: string, provider: EmailProvider, messageId: string, message: InboundEmail): Promise<void> {
    const maxBytes = this.config.email.maxAttachmentBytes;

    for (const [index, attachment] of message.attachments.entries()) {
      const filename = sanitiseFilename(attachment.filename, `attachment-${index + 1}`);
      const mimeType = normaliseMimeType(attachment.mimeType);
      const decision = decideAttachment({ filename, mimeType, sizeBytes: attachment.sizeBytes }, maxBytes);

      if (!decision.keep) {
        await this.recordAttachment(companyId, messageId, attachment, filename, mimeType, null, decision.reason, 0);
        continue;
      }

      try {
        const stored = await this.download(companyId, provider, message.providerMessageId, attachment, filename, mimeType);
        await this.recordAttachment(companyId, messageId, attachment, filename, mimeType, stored.id, null, 1);
      } catch (error) {
        this.logger.warn(`An attachment could not be stored: ${error instanceof Error ? error.name : 'unknown error'}`);
        await this.recordAttachment(companyId, messageId, attachment, filename, mimeType, null, 'download_failed', 1);
      }
    }
  }

  /**
   * Fetches the bytes (unless the provider already handed them over) and stores them through the
   * same abstraction as every other file in the system: object storage holds the bytes, the
   * database the reference (§17).
   */
  private async download(
    companyId: string,
    provider: EmailProvider,
    providerMessageId: string,
    attachment: Pick<InboundAttachmentDescriptor, 'providerAttachmentId' | 'content' | 'fetchHandle'>,
    filename: string,
    mimeType: string,
  ) {
    const bytes = attachment.content ?? (await provider.fetchAttachment(providerMessageId, attachment.providerAttachmentId, attachment.fetchHandle));
    if (bytes.byteLength === 0) throw new EmailProviderError('The attachment was empty.', 'PROTOCOL_ERROR', false);
    if (bytes.byteLength > this.config.email.maxAttachmentBytes) {
      throw new EmailProviderError('The attachment was larger than it was declared to be.', 'PROTOCOL_ERROR', false);
    }
    return this.files.store({ companyId, category: 'inbox', filename, mimeType, bytes });
  }

  /**
   * Tries again for attachments whose download failed on an earlier run — a timeout or a provider
   * hiccup should not lose an invoice. Bounded per run and per attachment, and never in the same
   * run that failed, so a struggling provider is not asked twice in a row.
   */
  private async retryAttachmentDownloads(companyId: string, provider: EmailProvider, runStartedAt: Date): Promise<number> {
    const pending = await this.prisma.inboxAttachment.findMany({
      where: {
        companyId,
        fileId: null,
        skipReason: 'download_failed',
        downloadAttempts: { lt: MAX_ATTACHMENT_ATTEMPTS },
        // Failures from earlier runs only: one that failed a moment ago is not retried straight away.
        createdAt: { lt: runStartedAt },
        message: { provider: provider.name, mailbox: provider.mailbox },
      },
      select: { id: true, providerAttachmentId: true, filename: true, mimeType: true, message: { select: { providerMessageId: true } } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    let recovered = 0;
    for (const attachment of pending) {
      try {
        const stored = await this.download(companyId, provider, attachment.message.providerMessageId, attachment, attachment.filename, attachment.mimeType);
        await this.prisma.inboxAttachment.update({
          where: { id: attachment.id },
          data: { fileId: stored.id, skipReason: null, downloadAttempts: { increment: 1 } },
        });
        recovered += 1;
      } catch {
        await this.prisma.inboxAttachment.update({ where: { id: attachment.id }, data: { downloadAttempts: { increment: 1 } } });
      }
    }
    return recovered;
  }

  private async recordAttachment(
    companyId: string,
    messageId: string,
    attachment: InboundAttachmentDescriptor,
    filename: string,
    mimeType: string,
    fileId: string | null,
    skipReason: string | null,
    downloadAttempts: number,
  ): Promise<void> {
    await this.prisma.inboxAttachment
      .create({
        data: {
          companyId,
          messageId,
          providerAttachmentId: attachment.providerAttachmentId,
          filename,
          mimeType,
          sizeBytes: Math.max(0, Math.round(attachment.sizeBytes)),
          fileId,
          skipReason,
          downloadAttempts,
        },
      })
      // A re-synced message finding its attachment already recorded is not an error.
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
        throw error;
      });
  }

  /** Where synchronisation stands, for the Inbox header: the connection and the last run. */
  async status(companyId: string) {
    const connection = await this.connections.status(companyId);
    const resolved = await this.connections.resolve(companyId);
    const cursor = resolved.provider
      ? await this.prisma.emailSyncCursor.findUnique({
          where: { companyId_provider_mailbox: { companyId, provider: resolved.provider.name, mailbox: resolved.provider.mailbox } },
          select: {
            lastSyncStartedAt: true, lastSyncFinishedAt: true, lastError: true, consecutiveFailures: true,
            messagesSynced: true, nextAttemptAt: true,
          },
        })
      : null;

    return {
      /** True only when a mailbox can actually be read right now. */
      configured: Boolean(resolved.provider),
      provider: resolved.provider?.name ?? connection.provider,
      /** So the screen can say "no mailbox is connected" rather than "no mail". */
      mailbox: resolved.provider?.mailbox ?? null,
      unavailableReason: resolved.provider ? null : resolved.reason,
      connection,
      syncEnabled: this.config.email.syncEnabled,
      aiEnabled: this.config.email.aiEnabled,
      lastSyncStartedAt: cursor?.lastSyncStartedAt?.toISOString() ?? null,
      lastSyncFinishedAt: cursor?.lastSyncFinishedAt?.toISOString() ?? null,
      lastError: cursor?.lastError ?? null,
      consecutiveFailures: cursor?.consecutiveFailures ?? 0,
      nextAttemptAt: cursor?.nextAttemptAt?.toISOString() ?? null,
      messagesSynced: cursor?.messagesSynced ?? 0,
    };
  }
}

export interface SyncOutcome {
  ok: boolean;
  /** True when the scheduler left this mailbox alone because it is backing off. */
  skipped?: boolean;
  reason?: string;
  /** Whether trying again later could succeed (false: needs a person, e.g. re-authorisation). */
  retryable: boolean;
  fetched: number;
  created: number;
  duplicates: number;
  failed: number;
  pages: number;
  hasMore: boolean;
  attachmentsRecovered: number;
  notices: string[];
}
