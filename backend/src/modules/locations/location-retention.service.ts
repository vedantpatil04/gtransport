import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LocationConfigService } from './location.config';

export interface CleanupResult {
  deletedCount: number;
  batches: number;
  cutoff: Date;
}

export interface CleanupOptions {
  retentionDays?: number;
  now?: Date;
  batchSize?: number;
  maxBatches?: number;
}

/**
 * Service responsible for pruning raw historical GPS records from `driver_location_pings`.
 *
 * Requirements & Safety:
 * - Only historical `driver_location_pings` are cleaned up.
 * - Current location records (`driver_location_states`) are hot read models and are NEVER deleted.
 * - Stationary alerts (`fleet_location_alerts`) and other operational/financial data are NEVER deleted.
 * - Cleanup executes in bounded batches to avoid holding long locks, saturating WAL, or blocking ingestion.
 * - Deletes are strictly idempotent and safe to run continuously.
 */
@Injectable()
export class LocationRetentionService {
  private readonly logger = new Logger(LocationRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: LocationConfigService,
  ) {}

  /**
   * Calculates the UTC cutoff date for raw ping retention.
   * Any ping whose `recordedAt` is strictly less than this cutoff is eligible for cleanup.
   */
  getCutoffDate(retentionDays?: number, now = new Date()): Date {
    const days = retentionDays ?? this.config.rawRetentionDays;
    if (days <= 0) {
      throw new BadRequestException(`Retention days must be positive, got ${days}`);
    }
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  /**
   * Production-safe batched deletion of raw historical GPS pings.
   *
   * @param options.retentionDays Override the configured retention days (defaults to GPS_RAW_RETENTION_DAYS).
   * @param options.now Reference timestamp for cutoff calculation (defaults to current time).
   * @param options.batchSize Number of records to remove in a single transaction (defaults to GPS_RAW_CLEANUP_BATCH_SIZE).
   * @param options.maxBatches Maximum batch iterations per cleanup run (defaults to 100).
   */
  async cleanupOldPings(options?: CleanupOptions): Promise<CleanupResult> {
    const now = options?.now ?? new Date();
    const days = options?.retentionDays ?? this.config.rawRetentionDays;
    const cutoff = this.getCutoffDate(days, now);

    const batchSize = options?.batchSize ?? this.config.cleanupBatchSize;
    if (batchSize <= 0) {
      throw new BadRequestException(`Batch size must be positive, got ${batchSize}`);
    }
    const maxBatches = options?.maxBatches ?? 100;

    let totalDeleted = 0;
    let batchesRun = 0;

    while (batchesRun < maxBatches) {
      // Find a batch of candidate ping IDs older than the cutoff timestamp
      const batch = await this.prisma.driverLocationPing.findMany({
        where: {
          recordedAt: {
            lt: cutoff,
          },
        },
        select: { id: true },
        take: batchSize,
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) {
        break;
      }

      const ids = batch.map((r) => r.id);

      // Defense-in-depth: delete specifically targeted batch IDs strictly older than the cutoff
      const deleteResult = await this.prisma.driverLocationPing.deleteMany({
        where: {
          id: { in: ids },
          recordedAt: { lt: cutoff },
        },
      });

      totalDeleted += deleteResult.count;
      batchesRun++;

      // If we fetched fewer items than batchSize, no further eligible records exist
      if (batch.length < batchSize) {
        break;
      }
    }

    if (totalDeleted > 0) {
      this.logger.log(
        `Raw GPS retention cleanup: purged ${totalDeleted} historical pings older than ${cutoff.toISOString()} in ${batchesRun} batch(es).`,
      );
    }

    return {
      deletedCount: totalDeleted,
      batches: batchesRun,
      cutoff,
    };
  }
}
