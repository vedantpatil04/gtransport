import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ComplianceService } from '../modules/compliance/compliance.service';

/**
 * Daily compliance scan for a server cron, e.g.
 *   15 0 * * *  cd /srv/gangamata/backend && npm run compliance:scan
 * Safe to run repeatedly: each warning is recorded once. Sends nothing.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const result = await app.get(ComplianceService).scanExpiryEvents();
    new Logger('ComplianceScan').log(`Scanned ${result.scanned} documents; recorded ${result.recorded} new expiry events.`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('ComplianceScan').error(error);
  process.exitCode = 1;
});
