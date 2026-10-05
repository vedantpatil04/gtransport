import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AIConfig } from '../modules/ai/config';
import type { Env, LogLevel } from './env.schema';

/** Typed, read-only access to validated configuration. Inject this instead of ConfigService. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get http() {
    return {
      host: this.get('HOST'),
      port: this.get('PORT'),
      corsOrigins: this.get('CORS_ORIGINS'),
      trustProxy: this.get('TRUST_PROXY'),
    };
  }

  get logLevel(): LogLevel {
    return this.get('LOG_LEVEL');
  }

  get database() {
    return { url: this.get('DATABASE_URL'), poolMax: this.get('DATABASE_POOL_MAX') };
  }

  get jwt() {
    return { secret: this.get('JWT_SECRET'), expiresIn: this.get('JWT_EXPIRES_IN') };
  }

  get ai(): AIConfig {
    return {
      provider: this.get('AI_PROVIDER'),
      requestTimeoutMs: this.get('AI_REQUEST_TIMEOUT_MS'),
      ollama: { baseUrl: this.get('OLLAMA_BASE_URL'), model: this.get('OLLAMA_MODEL') },
      dify: { baseUrl: this.get('DIFY_BASE_URL'), apiKey: this.get('DIFY_API_KEY'), appId: this.get('DIFY_APP_ID') },
      workerEnabled: this.get('AI_WORKER_ENABLED'),
      workerPollSeconds: this.get('AI_WORKER_POLL_SECONDS'),
      workerBatchSize: this.get('AI_WORKER_BATCH_SIZE'),
      maxAttempts: this.get('AI_MAX_ATTEMPTS'),
      lowConfidenceThreshold: this.get('AI_LOW_CONFIDENCE_THRESHOLD'),
      ocr: {
        mode: this.get('OCR_ENGINE'),
        languages: this.get('OCR_LANGUAGES'),
        binary: this.get('OCR_TESSERACT_PATH'),
        timeoutMs: this.get('OCR_TIMEOUT_MS'),
      },
    };
  }

  /** Inbound company mailbox. Credentials are read here and never leave the server. */
  get email() {
    return {
      provider: this.get('EMAIL_PROVIDER'),
      syncEnabled: this.get('EMAIL_SYNC_ENABLED'),
      syncIntervalMinutes: this.get('EMAIL_SYNC_INTERVAL_MINUTES'),
      syncBatchSize: this.get('EMAIL_SYNC_BATCH_SIZE'),
      maxAttachmentBytes: this.get('EMAIL_MAX_ATTACHMENT_MB') * 1024 * 1024,
      maxBodyChars: this.get('EMAIL_MAX_BODY_CHARS'),
      aiEnabled: this.get('EMAIL_AI_ENABLED'),
      aiMinConfidence: this.get('EMAIL_AI_MIN_CONFIDENCE'),
      aiMaxAttempts: this.get('EMAIL_AI_MAX_ATTEMPTS'),
      initialSyncDays: this.get('EMAIL_INITIAL_SYNC_DAYS'),
      maxPagesPerSync: this.get('EMAIL_SYNC_MAX_PAGES'),
      oauth: {
        redirectUri: this.get('EMAIL_OAUTH_REDIRECT_URI'),
        returnUrl: this.get('EMAIL_OAUTH_RETURN_URL'),
        tokenEncryptionKey: this.get('EMAIL_TOKEN_ENCRYPTION_KEY'),
        gmail: { clientId: this.get('GMAIL_CLIENT_ID'), clientSecret: this.get('GMAIL_CLIENT_SECRET') },
        microsoft: {
          clientId: this.get('MS_GRAPH_CLIENT_ID'),
          clientSecret: this.get('MS_GRAPH_CLIENT_SECRET'),
          tenantId: this.get('MS_GRAPH_TENANT_ID'),
        },
      },
      imap: {
        host: this.get('IMAP_HOST'),
        port: this.get('IMAP_PORT'),
        secure: this.get('IMAP_SECURE'),
        user: this.get('IMAP_USER'),
        password: this.get('IMAP_PASSWORD'),
        mailbox: this.get('IMAP_MAILBOX'),
      },
    };
  }

  get payouts() {
    return {
      provider: this.get('PAYOUT_PROVIDER'),
      razorpayx: {
        baseUrl: this.get('RAZORPAYX_BASE_URL'),
        keyId: this.get('RAZORPAYX_KEY_ID'),
        keySecret: this.get('RAZORPAYX_KEY_SECRET'),
        accountNumber: this.get('RAZORPAYX_ACCOUNT_NUMBER'),
        webhookSecret: this.get('RAZORPAYX_WEBHOOK_SECRET'),
      },
    };
  }

  get fileStorage() {
    return {
      provider: this.get('FILE_STORAGE_PROVIDER'),
      localRoot: this.get('FILE_STORAGE_LOCAL_ROOT'),
      cloudinary: {
        cloudName: this.get('CLOUDINARY_CLOUD_NAME'),
        apiKey: this.get('CLOUDINARY_API_KEY'),
        apiSecret: this.get('CLOUDINARY_API_SECRET'),
        folder: this.get('CLOUDINARY_FOLDER'),
      },
    };
  }

  /** Fleet location thresholds and the tracking strategy served to the driver app. */
  get location() {
    return {
      rawRetentionDays: this.get('GPS_RAW_RETENTION_DAYS'),
      cleanupEnabled: this.get('GPS_RAW_CLEANUP_ENABLED'),
      cleanupIntervalHours: this.get('GPS_RAW_CLEANUP_INTERVAL_HOURS'),
      cleanupBatchSize: this.get('GPS_RAW_CLEANUP_BATCH_SIZE'),
      staleAfterMinutes: this.get('LOCATION_STALE_AFTER_MINUTES'),
      offlineAfterMinutes: this.get('LOCATION_OFFLINE_AFTER_MINUTES'),
      stationaryRadiusMeters: this.get('STATIONARY_RADIUS_METERS'),
      stationaryDurationMinutes: this.get('STATIONARY_DURATION_MINUTES'),
      stationaryMaxAccuracyMeters: this.get('STATIONARY_MAX_ACCURACY_METERS'),
      maxAccuracyMeters: this.get('LOCATION_MAX_ACCURACY_METERS'),
      maxClockSkewMinutes: this.get('LOCATION_MAX_CLOCK_SKEW_MINUTES'),
      maxBacklogHours: this.get('LOCATION_MAX_BACKLOG_HOURS'),
      maxFixesPerMinute: this.get('LOCATION_MAX_FIXES_PER_MINUTE'),
      trackingIntervalSeconds: this.get('LOCATION_TRACKING_INTERVAL'),
      trackingStationaryIntervalSeconds: this.get('LOCATION_TRACKING_STATIONARY_INTERVAL'),
      trackingDistanceMeters: this.get('LOCATION_TRACKING_DISTANCE'),
      deviceBufferLimit: this.get('LOCATION_DEVICE_BUFFER_LIMIT'),
      maxBatchSize: this.get('LOCATION_MAX_BATCH_SIZE'),
      fleetRefreshSeconds: this.get('FLEET_REFRESH_INTERVAL'),
    };
  }
}
