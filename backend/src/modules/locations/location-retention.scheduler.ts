import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { LocationConfigService } from './location.config';
import { CleanupOptions, CleanupResult, LocationRetentionService } from './location-retention.service';

/**
 * Scheduled background worker that periodically triggers raw GPS retention cleanup.
 *
 * Keeps `driver_location_pings` bounded to the configured retention window (default 7 days).
 * Never touches `driver_location_states` (the current location read model) or any other tables.
 *
 * Follows the same in-process timer pattern as `InboxSyncScheduler` and `ReceiptDispatcherService`,
 * with `unref()` so it does not block application shutdown. Can be disabled via
 * `GPS_RAW_CLEANUP_ENABLED=false` when running from an external system cron (`npm run gps:cleanup`).
 */
@Injectable()
export class LocationRetentionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LocationRetentionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly retention: LocationRetentionService,
    private readonly config: LocationConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.cleanupEnabled) {
      this.logger.log('Raw GPS retention cleanup is disabled in this process (GPS_RAW_CLEANUP_ENABLED=false).');
      return;
    }

    const days = this.config.rawRetentionDays;
    const intervalHours = this.config.cleanupIntervalMs / 3600_000;
    this.logger.log(`Raw GPS retention scheduler active: ${days} days retention, running every ${intervalHours}h.`);

    // Delay the initial tick by 60 seconds to allow the application to complete startup
    this.schedule(60_000);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
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
      const outcome = await this.retention.cleanupOldPings();
      if (outcome.deletedCount > 0) {
        this.logger.log(
          `Raw GPS cleanup run finished: removed ${outcome.deletedCount} pings older than ${outcome.cutoff.toISOString()} in ${outcome.batches} batch(es).`,
        );
      }
    } catch (error) {
      this.logger.error('Raw GPS retention cleanup tick failed', error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
      this.schedule(this.config.cleanupIntervalMs);
    }
  }

  /**
   * Runs cleanup once immediately. Used by cron CLI scripts and isolated tests.
   */
  async runOnce(options?: CleanupOptions): Promise<CleanupResult> {
    return this.retention.cleanupOldPings(options);
  }
}
