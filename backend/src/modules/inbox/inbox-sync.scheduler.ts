import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { MailboxConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { InboxService } from './inbox.service';
import { InboxSyncService } from './inbox-sync.service';
import { MailboxConnectionService } from './mailbox-connection.service';

/**
 * Periodic mailbox synchronisation and classification.
 *
 * Off unless `EMAIL_SYNC_ENABLED=true`, and the environment schema refuses that combination
 * without a provider behind it — so this can never be running against nothing while reporting
 * that mail is up to date (§39).
 *
 * Like the receipt dispatcher, it is a timer inside the monolith rather than a broker: the state
 * that matters (the cursor, the messages, the retry times) is in PostgreSQL, so a restart mid-sync
 * loses nothing and the next run resumes from the stored cursor. A mailbox that is failing is left
 * alone until its backoff expires. A deployment that would rather drive this from a system cron
 * turns the flag off and runs `npm run inbox:sync`.
 */
@Injectable()
export class InboxSyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InboxSyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: InboxSyncService,
    private readonly inbox: InboxService,
    private readonly connections: MailboxConnectionService,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const { syncEnabled, syncIntervalMinutes } = this.config.email;
    if (!syncEnabled) {
      this.logger.log('Mailbox synchronisation is switched off (EMAIL_SYNC_ENABLED=false).');
      return;
    }
    this.logger.log(`Mailbox synchronisation every ${syncIntervalMinutes} minutes.`);
    // A short first delay lets the application finish starting before any network call.
    this.schedule(30_000);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;

    try {
      await this.runForAllCompanies();
    } catch (error) {
      this.logger.error('Mailbox synchronisation failed', error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
      this.schedule(this.config.email.syncIntervalMinutes * 60_000);
    }
  }

  /**
   * Synchronises every company that has a mailbox to read, then classifies what is waiting.
   *
   * With Gmail or Microsoft 365 that is each company with a connected mailbox. With IMAP there is
   * one mailbox for the whole deployment, so it is synced automatically only when the deployment
   * serves exactly one company — filing one mailbox into several companies would hand each of
   * them the others' mail.
   */
  async runForAllCompanies(): Promise<{ companies: number; created: number; failed: number }> {
    const companyIds = await this.companiesToSync();
    let created = 0;
    let failed = 0;

    for (const companyId of companyIds) {
      const outcome = await this.sync.sync(companyId, { trigger: 'scheduled' });
      if (outcome.ok) created += outcome.created;
      else if (!outcome.skipped) failed += 1;
      // New mail and due retries alike. Bounded per run, so a backlog is worked through over passes.
      await this.inbox.classifyPending(companyId, this.config.email.syncBatchSize);
    }

    return { companies: companyIds.length, created, failed };
  }

  private async companiesToSync(): Promise<string[]> {
    const oauthProvider = this.connections.oauthProvider();
    if (oauthProvider) {
      const connected = await this.prisma.mailboxConnection.findMany({
        where: { provider: oauthProvider, status: MailboxConnectionStatus.CONNECTED, company: { deletedAt: null } },
        select: { companyId: true },
      });
      return connected.map((row) => row.companyId);
    }

    const companies = await this.prisma.company.findMany({ where: { deletedAt: null }, select: { id: true }, take: 2 });
    if (companies.length > 1) {
      this.logger.warn('The IMAP mailbox is shared by the whole deployment, which serves several companies; it is not synced automatically.');
      return [];
    }
    return companies.map((company) => company.id);
  }
}
