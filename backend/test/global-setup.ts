import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

/**
 * Applies migrations to the test database before the suite runs.
 *
 * Refuses to touch a database whose name does not end in `_test`, so a misconfigured
 * DATABASE_URL can never wipe development data. Set E2E_SKIP_MIGRATE=1 when the schema is
 * already applied (for example in CI, as a separate step).
 */
export default function globalSetup(): void {
  process.env.NODE_ENV = 'test';
  loadEnv({ path: ['.env.test.local', '.env.test', '.env'], quiet: true });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL must be set (create backend/.env.test) before running e2e tests.');

  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '').split('?')[0];
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refusing to run e2e tests against "${databaseName}": the database name must end with _test.`);
  }

  if (process.env.E2E_SKIP_MIGRATE === '1') return;

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}
