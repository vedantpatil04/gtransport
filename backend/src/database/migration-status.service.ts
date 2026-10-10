import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Whether the database has every migration this build ships.
 *
 * - current: nothing pending.
 * - behind:  the code is newer than the database (a migration was never applied, or failed).
 *            Queries touching the new columns fail until it is — see the P2021/P2022 handling in
 *            the exception filter.
 * - unknown: could not be determined (no migrations folder next to the build, or no history table).
 */
export interface MigrationStatus {
  status: 'current' | 'behind' | 'unknown';
  /** Shipped by this build but not applied to the database. */
  pending: string[];
  /** Started but never finished: Prisma refuses further migrations until it is resolved. */
  failed: string[];
}

const MIGRATION_DIR = /^\d{14}_[\w-]+$/;

/** Folder names of the migrations that ship with this build, oldest first. */
export function readBundledMigrations(directory: string): string[] | null {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && MIGRATION_DIR.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return null;
  }
}

export interface AppliedMigration {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

/** Pure comparison of what ships against what Prisma's history table says was applied. */
export function compareMigrations(bundled: string[], applied: AppliedMigration[]): MigrationStatus {
  const done = new Set(applied.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
  const failed = applied.filter((row) => !row.finished_at && !row.rolled_back_at).map((row) => row.migration_name);
  const pending = bundled.filter((name) => !done.has(name));
  return { status: pending.length || failed.length ? 'behind' : 'current', pending, failed };
}

const CACHE_MS = 60_000;

@Injectable()
export class MigrationStatusService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Migrations');
  private readonly migrationsDirectory = join(process.cwd(), 'prisma', 'migrations');
  private cached: { at: number; value: MigrationStatus } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Logs once at start-up, loudly when behind, so a deploy that skipped its migration is obvious in the logs. */
  async onApplicationBootstrap(): Promise<void> {
    const result = await this.check(true);
    if (result.status === 'behind') {
      this.logger.error(
        `The database is behind this build. Not applied: ${result.pending.join(', ') || 'none'}; failed: ${result.failed.join(', ') || 'none'}. ` +
          'Features that need them will answer 503 until `npm run db:deploy` runs against this database.',
      );
    } else if (result.status === 'current') {
      this.logger.log('Database schema is up to date with this build.');
    }
  }

  async check(force = false): Promise<MigrationStatus> {
    if (!force && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;

    const unknown: MigrationStatus = { status: 'unknown', pending: [], failed: [] };
    const bundled = readBundledMigrations(this.migrationsDirectory);
    let value = unknown;
    if (bundled) {
      try {
        const applied = await this.prisma.$queryRaw<AppliedMigration[]>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
        value = compareMigrations(bundled, applied);
      } catch {
        value = unknown;
      }
    }
    this.cached = { at: Date.now(), value };
    return value;
  }
}
