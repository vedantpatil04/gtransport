import { spawnSync } from 'node:child_process';
import { Logger } from '@nestjs/common';

const logger = new Logger('Start');

/**
 * Production entry point: applies any pending database migrations, then starts the API.
 *
 * Render's `preDeployCommand` (render.yaml) does the same, but it is not available on every Render
 * plan, and a deploy that silently skips it leaves the code ahead of the database — every query
 * touching a new column then fails (Prisma P2022). Running `prisma migrate deploy` here makes that
 * impossible to miss: migrations are additive and applied in order under Prisma's advisory lock,
 * so a second instance starting at the same time just waits and finds nothing to do.
 *
 * It never blocks the API from starting: if the migration cannot run (a pooler that does not
 * support the lock, a timeout) the failure is logged and the app still boots, and /health reports
 * the database as behind. Set SKIP_MIGRATE_ON_START=true to turn this step off entirely.
 */
const MIGRATE_TIMEOUT_MS = 120_000;

function applyMigrations(): void {
  if (process.env.SKIP_MIGRATE_ON_START === 'true') {
    logger.log('SKIP_MIGRATE_ON_START=true — not running prisma migrate deploy.');
    return;
  }
  try {
    const cli = require.resolve('prisma/build/index.js');
    logger.log('Applying pending database migrations (prisma migrate deploy)…');
    const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
      stdio: 'inherit',
      env: process.env,
      timeout: MIGRATE_TIMEOUT_MS,
    });
    if (result.status === 0) logger.log('Database migrations are up to date.');
    else
      logger.error(
        `prisma migrate deploy did not finish (exit ${result.status ?? 'none'}${result.error ? `, ${result.error.message}` : ''}). ` +
          'Starting the API anyway; /health shows schema "behind" until the migration is applied.',
      );
  } catch (error) {
    logger.error(`Could not run prisma migrate deploy: ${error instanceof Error ? error.message : String(error)}. Starting the API anyway.`);
  }
}

applyMigrations();
// A plain require, not import(): under module "nodenext" a dynamic import() of this CommonJS entry would be left
// as a native ESM import, which cannot resolve the extensionless path.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../main');
