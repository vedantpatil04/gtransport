import { z } from 'zod';

/** Duration form accepted by jsonwebtoken, e.g. 15m / 12h / 7d. */
export type JwtDuration = `${number}${'s' | 'm' | 'h' | 'd'}`;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Placeholder secrets that must never reach production. */
const PLACEHOLDER_SECRETS = new Set(['change-me', 'changeme', 'secret', 'replace-with-a-long-random-string']);

const httpUrl = (name: string) =>
  z
    .string()
    .trim()
    .url(`${name} must be a valid URL`)
    .refine((v) => /^https?:\/\//i.test(v), `${name} must use http or https`)
    .transform((v) => v.replace(/\/+$/, ''));

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * Every environment variable the API reads is declared here. The process refuses to start
 * when validation fails, so misconfiguration surfaces at boot rather than at first use.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('log'),
    /** Set when running behind a reverse proxy (Caddy/Nginx) so client IPs are recorded correctly. */
    TRUST_PROXY: booleanFromString.default('false'),
    /** Comma-separated list of browser origins allowed to call the API. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim().replace(/\/+$/, ''))
          .filter(Boolean),
      ),

    DATABASE_URL: z
      .string()
      .trim()
      .min(1, 'DATABASE_URL is required')
      .refine((v) => /^postgres(ql)?:\/\//i.test(v), 'DATABASE_URL must be a PostgreSQL connection string'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z
      .string()
      .trim()
      .regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN must look like 15m, 12h or 7d')
      .default('12h')
      .transform((v) => v as JwtDuration),

    AI_PROVIDER: z.enum(['ollama', 'dify']).default('ollama'),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    OLLAMA_BASE_URL: httpUrl('OLLAMA_BASE_URL').default('http://127.0.0.1:11434'),
    OLLAMA_MODEL: z.string().trim().min(1).default('gemma4'),
    DIFY_BASE_URL: httpUrl('DIFY_BASE_URL').default('https://api.dify.ai/v1'),
    DIFY_API_KEY: z.string().trim().default(''),
    DIFY_APP_ID: z.string().trim().default(''),

    /** Only `local` is implemented in Phase 0. `r2` is added with the Cloudflare R2 adapter. */
    FILE_STORAGE_PROVIDER: z.enum(['local']).default('local'),
    FILE_STORAGE_LOCAL_ROOT: z.string().trim().min(1).default('./storage'),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === 'dify') {
      if (!env.DIFY_API_KEY) ctx.addIssue({ code: 'custom', path: ['DIFY_API_KEY'], message: 'DIFY_API_KEY is required when AI_PROVIDER=dify' });
      if (!env.DIFY_APP_ID) ctx.addIssue({ code: 'custom', path: ['DIFY_APP_ID'], message: 'DIFY_APP_ID is required when AI_PROVIDER=dify' });
    }
    if (env.NODE_ENV === 'production') {
      if (PLACEHOLDER_SECRETS.has(env.JWT_SECRET.toLowerCase()) || /^(.)\1+$/.test(env.JWT_SECRET)) {
        ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET is a placeholder; generate a random secret for production' });
      }
      if (env.CORS_ORIGINS.some((o) => o === '*')) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Wildcard CORS origin is not allowed in production' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Used by ConfigModule.forRoot({ validate }). Never echoes secret values. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  return result.data;
}
