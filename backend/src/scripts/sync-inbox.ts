import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { InboxSyncScheduler } from '../modules/inbox/inbox-sync.scheduler';

/**
 * Synchronises the company mailbox once, for a deployment that prefers a system cron to the
 * in-process timer (set EMAIL_SYNC_ENABLED=false there), e.g.
 *   every fifteen minutes:  cd /srv/gangamata/backend && npm run inbox:sync
 *
 * Safe to run repeatedly: ingestion is keyed on the provider's message id, so an overlapping
 * window files nothing twice.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const result = await app.get(InboxSyncScheduler).runForAllCompanies();
    new Logger('InboxSync').log(`Synchronised ${result.companies} company mailbox(es); ${result.created} new message(s) filed.`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('InboxSync').error(error);
  process.exitCode = 1;
});
