import { config as loadEnv } from 'dotenv';

/** e2e runs against NODE_ENV=test, so .env.test wins over .env (see src/config/env-files.ts). */
process.env.NODE_ENV = 'test';
loadEnv({ path: ['.env.test.local', '.env.test', '.env'], quiet: true });
