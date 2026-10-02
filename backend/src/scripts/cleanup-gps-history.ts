import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LocationRetentionService } from '../modules/locations/location-retention.service';

/**
 * Standalone raw GPS retention cleanup for a server cron or manual maintenance run, e.g.:
 *   0 2 * * *  cd /srv/gangamata/backend && npm run gps:cleanup
 *
 * Removes historical `driver_location_pings` older than GPS_RAW_RETENTION_DAYS (default: 7) in
 * bounded batches. Current locations (`driver_location_states`), alerts, and all business records
 * are preserved. Safe to run repeatedly.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const result = await app.get(LocationRetentionService).cleanupOldPings();
    new Logger('GpsRetentionCleanup').log(
      `Cleaned up ${result.deletedCount} raw GPS ping(s) older than ${result.cutoff.toISOString()} in ${result.batches} batch(es).`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('GpsRetentionCleanup').error(error);
  process.exitCode = 1;
});
