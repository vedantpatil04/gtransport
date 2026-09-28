import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReceiptDispatcherService } from '../modules/ai/receipts/receipt-dispatcher.service';

/**
 * Drains the receipt AI queue once, for a deployment that runs the worker from cron rather than
 * inside the API process (set AI_WORKER_ENABLED=false there), e.g.
 *   every five minutes:  cd /srv/gangamata/backend && npm run ai:worker
 *
 * Safe to run alongside the in-process worker: jobs are claimed with SKIP LOCKED, so two drains
 * never take the same receipt.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const processed = await app.get(ReceiptDispatcherService).runOnce(25);
    new Logger('ReceiptAIWorker').log(`Processed ${processed} receipt job(s).`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('ReceiptAIWorker').error(error);
  process.exitCode = 1;
});
