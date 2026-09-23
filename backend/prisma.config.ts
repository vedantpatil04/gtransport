import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration. A prisma.config.ts disables Prisma's implicit .env loading, so
 * env files are loaded here with the same precedence the API uses (see src/config/env-files.ts):
 * .env.<NODE_ENV>.local → .env.<NODE_ENV> → .env.local → .env. Real environment variables win.
 */
const envName = process.env.NODE_ENV ?? 'development';
loadEnv({ path: [`.env.${envName}.local`, `.env.${envName}`, '.env.local', '.env'], quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
});
