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
    HOST: z.string().trim().default('0.0.0.0'),
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

    // ── Receipt AI processing (Phase 7) ──

    /**
     * Whether this process drains the receipt queue. Turn it off to run the worker elsewhere
     * (`npm run ai:worker`) or on a separate machine; the jobs live in PostgreSQL either way.
     */
    AI_WORKER_ENABLED: booleanFromString.default('true'),
    /** Seconds between polls when the queue is empty. A busy queue is drained without waiting. */
    AI_WORKER_POLL_SECONDS: z.coerce.number().int().min(1).max(3_600).default(15),
    /** Receipts processed per tick, bounding how long one pass can occupy the process. */
    AI_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(3),
    /** Automatic attempts before a receipt is left for a person to retry or enter by hand. */
    AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    /**
     * Below this confidence an extraction is always routed for review rather than offered as
     * ready-to-confirm suggestions. It never decides truth — everything is reviewed either way.
     */
    AI_LOW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),

    // ── Inbound mailbox (Phase 7) ──

    /**
     * `none` (the default) leaves the Inbox empty and contacts nothing. `imap` connects to a
     * dedicated company mailbox. Nothing here touches anyone's personal account.
     */
    EMAIL_PROVIDER: z.enum(['none', 'imap']).default('none'),
    EMAIL_SYNC_ENABLED: booleanFromString.default('false'),
    /** Minutes between mailbox synchronisations. */
    EMAIL_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
    /** Messages fetched per synchronisation, so a long-neglected mailbox catches up gradually. */
    EMAIL_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),

    IMAP_HOST: z.string().trim().default(''),
    IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
    IMAP_SECURE: booleanFromString.default('true'),
    IMAP_USER: z.string().trim().default(''),
    /** An app password for the company mailbox. Server-side only; never sent to any client. */
    IMAP_PASSWORD: z.string().default(''),
    IMAP_MAILBOX: z.string().trim().min(1).default('INBOX'),

    /** Largest attachment fetched from an email. Bigger ones are recorded and left in the mailbox. */
    EMAIL_MAX_ATTACHMENT_MB: z.coerce.number().int().min(1).max(100).default(15),
    /** Characters of body text stored. The full message always remains in the mailbox itself. */
    EMAIL_MAX_BODY_CHARS: z.coerce.number().int().min(500).max(200_000).default(20_000),
    /** Whether AI classifies and summarises inbound mail. Off leaves messages UNCLASSIFIED. */
    EMAIL_AI_ENABLED: booleanFromString.default('true'),

    /**
     * Payouts to employees. `none` (default) allows only manually recorded payments; `razorpayx`
     * sends real payouts and needs every RAZORPAYX_* value below. Credentials stay server-side.
     */
    PAYOUT_PROVIDER: z.enum(['none', 'razorpayx']).default('none'),
    RAZORPAYX_BASE_URL: httpUrl('RAZORPAYX_BASE_URL').default('https://api.razorpay.com'),
    RAZORPAYX_KEY_ID: z.string().trim().default(''),
    RAZORPAYX_KEY_SECRET: z.string().trim().default(''),
    /** Your RazorpayX business account number (not an employee's). */
    RAZORPAYX_ACCOUNT_NUMBER: z.string().trim().default(''),
    RAZORPAYX_WEBHOOK_SECRET: z.string().trim().default(''),

    /** Only `local` is implemented in Phase 0. `r2` is added with the Cloudflare R2 adapter. */
    FILE_STORAGE_PROVIDER: z.enum(['local']).default('local'),
    FILE_STORAGE_LOCAL_ROOT: z.string().trim().min(1).default('./storage'),

    // ── Fleet location tracking (Phase 6) ──
    // Operational thresholds, not code constants: the office will tune these once real routes
    // are running. Defaults are the documented Gangamata policy.

    /**
     * Days of raw GPS history (`driver_location_pings`) kept before scheduled cleanup.
     * Current location (`driver_location_states`) is kept indefinitely.
     */
    GPS_RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(7),
    /** Whether this process periodically cleans up old raw GPS pings. */
    GPS_RAW_CLEANUP_ENABLED: booleanFromString.default('true'),
    /** Hours between cleanup runs. */
    GPS_RAW_CLEANUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(6),
    /** Number of old GPS pings deleted per database batch. */
    GPS_RAW_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(10).max(10_000).default(1000),

    /** A driver whose newest fix is older than this is shown as stale rather than live. */
    LOCATION_STALE_AFTER_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),
    /**
     * No contact of any kind within this window means the device is offline. Deliberately
     * longer than the stale window: one missed fix is not an offline driver.
     */
    LOCATION_OFFLINE_AFTER_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(30),

    /** How far a driver may drift and still count as parked in the same place. */
    STATIONARY_RADIUS_METERS: z.coerce.number().int().min(25).max(5_000).default(150),
    /** How long that has to last before the office is alerted. Four hours is the agreed policy. */
    STATIONARY_DURATION_MINUTES: z.coerce.number().int().min(5).max(72 * 60).default(240),
    /**
     * Fixes less accurate than this take no part in the stationary decision — comparing a fix
     * with a wider error radius than the geofence itself would invent movement, or hide it.
     */
    STATIONARY_MAX_ACCURACY_METERS: z.coerce.number().int().min(10).max(5_000).default(200),

    /** A fix less accurate than this is not stored at all. */
    LOCATION_MAX_ACCURACY_METERS: z.coerce.number().int().min(10).max(50_000).default(2_000),
    /** A device clock further ahead of the server than this is wrong, so its fix is refused. */
    LOCATION_MAX_CLOCK_SKEW_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(10),
    /** How far back a buffered fix may be and still be accepted when connectivity returns. */
    LOCATION_MAX_BACKLOG_HOURS: z.coerce.number().int().min(1).max(30 * 24).default(72),
    /** Per-driver ingestion ceiling. Generous for normal tracking, low enough to stop a loop. */
    LOCATION_MAX_FIXES_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),

    /** Seconds between fixes while moving, as instructed to the driver app. */
    LOCATION_TRACKING_INTERVAL: z.coerce.number().int().min(10).max(3_600).default(60),
    /** Seconds between fixes while stationary. Longer, because a parked truck is not news. */
    LOCATION_TRACKING_STATIONARY_INTERVAL: z.coerce.number().int().min(30).max(7_200).default(900),
    /** Metres of travel that make a new fix worth sending. */
    LOCATION_TRACKING_DISTANCE: z.coerce.number().int().min(10).max(10_000).default(150),
    /** Fixes the phone may hold while offline before the oldest are dropped. */
    LOCATION_DEVICE_BUFFER_LIMIT: z.coerce.number().int().min(50).max(20_000).default(1_000),
    /** Fixes accepted in one upload, so a long offline spell syncs in a few requests. */
    LOCATION_MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),

    /** Seconds between Live Fleet refreshes in the admin console. */
    FLEET_REFRESH_INTERVAL: z.coerce.number().int().min(5).max(3_600).default(30),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === 'dify') {
      if (!env.DIFY_API_KEY) ctx.addIssue({ code: 'custom', path: ['DIFY_API_KEY'], message: 'DIFY_API_KEY is required when AI_PROVIDER=dify' });
      if (!env.DIFY_APP_ID) ctx.addIssue({ code: 'custom', path: ['DIFY_APP_ID'], message: 'DIFY_APP_ID is required when AI_PROVIDER=dify' });
    }
    if (env.EMAIL_PROVIDER === 'imap') {
      for (const key of ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when EMAIL_PROVIDER=imap` });
      }
      // Plaintext IMAP would put the mailbox password on the wire. Allowed only against a local
      // test server, never in production.
      if (!env.IMAP_SECURE && env.NODE_ENV === 'production') {
        ctx.addIssue({ code: 'custom', path: ['IMAP_SECURE'], message: 'IMAP_SECURE cannot be false in production: the mailbox password would be sent unencrypted' });
      }
    }
    // Synchronisation that is switched on with no provider behind it would report success while
    // contacting nothing, which is exactly the false comfort Phase 7 forbids.
    if (env.EMAIL_SYNC_ENABLED && env.EMAIL_PROVIDER === 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_SYNC_ENABLED'],
        message: 'EMAIL_SYNC_ENABLED requires EMAIL_PROVIDER to be set: synchronisation cannot run without a mailbox',
      });
    }
    if (env.PAYOUT_PROVIDER === 'razorpayx') {
      for (const key of ['RAZORPAYX_KEY_ID', 'RAZORPAYX_KEY_SECRET', 'RAZORPAYX_ACCOUNT_NUMBER', 'RAZORPAYX_WEBHOOK_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when PAYOUT_PROVIDER=razorpayx` });
      }
      // Live keys move real money: never allow them outside production.
      if (env.NODE_ENV !== 'production' && env.RAZORPAYX_KEY_ID.startsWith('rzp_live_')) {
        ctx.addIssue({ code: 'custom', path: ['RAZORPAYX_KEY_ID'], message: 'A live RazorpayX key is not allowed outside production; use a rzp_test_ key' });
      }
    }
    if (env.LOCATION_OFFLINE_AFTER_MINUTES < env.LOCATION_STALE_AFTER_MINUTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOCATION_OFFLINE_AFTER_MINUTES'],
        message: 'LOCATION_OFFLINE_AFTER_MINUTES must be at least LOCATION_STALE_AFTER_MINUTES: a driver becomes stale before being considered offline',
      });
    }
    if (env.STATIONARY_MAX_ACCURACY_METERS > env.LOCATION_MAX_ACCURACY_METERS) {
      ctx.addIssue({
        code: 'custom',
        path: ['STATIONARY_MAX_ACCURACY_METERS'],
        message: 'STATIONARY_MAX_ACCURACY_METERS cannot exceed LOCATION_MAX_ACCURACY_METERS: a fix too poor to store cannot be used for stationary detection',
      });
    }
    // A driver reporting only every stationary interval must still be seen inside the stale
    // window, or a correctly-behaving parked truck would be reported as stale.
    if (env.LOCATION_TRACKING_STATIONARY_INTERVAL > env.LOCATION_STALE_AFTER_MINUTES * 60) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOCATION_TRACKING_STATIONARY_INTERVAL'],
        message: 'LOCATION_TRACKING_STATIONARY_INTERVAL must fit inside LOCATION_STALE_AFTER_MINUTES, or a driver reporting exactly as instructed would still be marked stale',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (PLACEHOLDER_SECRETS.has(env.JWT_SECRET.toLowerCase()) || /^(.)\1+$/.test(env.JWT_SECRET)) {
        ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET is a placeholder; generate a random secret for production' });
      }
      if (env.CORS_ORIGINS.some((o) => o === '*')) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Wildcard CORS origin is not allowed in production' });
      }
      if (env.CORS_ORIGINS.some((o) => o.startsWith('http://') && !o.includes('localhost') && !o.includes('127.0.0.1'))) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Production CORS origins must use HTTPS' });
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
