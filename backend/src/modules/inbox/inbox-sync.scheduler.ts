import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { InboxService } from './inbox.service';
import { InboxSyncService } from './inbox-sync.service';

/**
 * Periodic mailbox synchronisation.
 *
 * Off unless `EMAIL_SYNC_ENABLED=true`, and the environment schema refuses that combination
 * without a provider behind it — so this can never be running against nothing while reporting
 * that mail is up to date (§39).
 *
 * Like the receipt dispatcher, it is a timer inside the monolith rather than a broker: the state
 * that matters (the cursor, the messages) is in PostgreSQL, so a restart mid-sync loses nothing
 * and the next run resumes from the stored cursor. A deployment that would rather drive this from
 * a system cron turns the flag off and runs `npm run inbox:sync`.
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
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const { syncEnabled, syncIntervalMinutes } = this.config.email;
    if (!syncEnabled) {
      this.logger.log('Mailbox synchronisation is switched off (EMAIL_SYNC_ENABLED=false).');
      return;
    }
    if (!this.sync.isConfigured()) {
      this.logger.warn('Mailbox synchronisation is switched on, but no mailbox is configured. Nothing will be fetched.');
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
   * Synchronises every active company.
   *
   * One mailbox is configured per deployment today, so in practice this is one company — but
   * iterating keeps the shape right for a deployment serving several, and costs one small query.
   */
  async runForAllCompanies(): Promise<{ companies: number; created: number }> {
    const companies = await this.prisma.company.findMany({ where: { deletedAt: null }, select: { id: true } });
    let created = 0;

    for (const company of companies) {
      const outcome = await this.sync.sync(company.id);
      if (!outcome.ok) continue;
      created += outcome.created;
      if (outcome.created > 0) {
        // Classification is bounded per run so a large backlog is worked through over several
        // passes rather than occupying the process for an unbounded time.
        await this.inbox.classifyPending(company.id, this.config.email.syncBatchSize);
      }
    }

    return { companies: companies.length, created };
  }
}
