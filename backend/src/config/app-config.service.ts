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
    };
  }

  get fileStorage() {
    return { provider: this.get('FILE_STORAGE_PROVIDER'), localRoot: this.get('FILE_STORAGE_LOCAL_ROOT') };
  }
}
