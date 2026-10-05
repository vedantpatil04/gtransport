import { EnvValidationError, validateEnv } from './env.schema';

const BASE = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32) + 'b3f9',
};

describe('validateEnv', () => {
  it('applies documented defaults', () => {
    const env = validateEnv({ ...BASE });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.AI_PROVIDER).toBe('ollama');
    expect(env.OLLAMA_MODEL).toBe('gemma4');
    expect(env.FILE_STORAGE_PROVIDER).toBe('local');
    expect(env.CLOUDINARY_FOLDER).toBe('gangamata');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.GPS_RAW_RETENTION_DAYS).toBe(7);
    expect(env.GPS_RAW_CLEANUP_ENABLED).toBe(true);
    expect(env.GPS_RAW_CLEANUP_INTERVAL_HOURS).toBe(6);
    expect(env.GPS_RAW_CLEANUP_BATCH_SIZE).toBe(1000);
  });

  it('validates GPS_RAW_RETENTION_DAYS bounds and coercion', () => {
    const custom = validateEnv({ ...BASE, GPS_RAW_RETENTION_DAYS: '14' });
    expect(custom.GPS_RAW_RETENTION_DAYS).toBe(14);

    expect(() => validateEnv({ ...BASE, GPS_RAW_RETENTION_DAYS: '0' })).toThrow(EnvValidationError);
    expect(() => validateEnv({ ...BASE, GPS_RAW_RETENTION_DAYS: '-5' })).toThrow(EnvValidationError);
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateEnv({ ...BASE, JWT_SECRET: 'too-short' })).toThrow(EnvValidationError);
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => validateEnv({ ...BASE, DATABASE_URL: 'mysql://localhost/db' })).toThrow(/PostgreSQL/);
  });

  it('requires Dify credentials only when Dify is selected', () => {
    expect(() => validateEnv({ ...BASE, AI_PROVIDER: 'dify' })).toThrow(/DIFY_API_KEY/);
    expect(() => validateEnv({ ...BASE, AI_PROVIDER: 'dify', DIFY_API_KEY: 'key' })).toThrow(/DIFY_APP_ID/);
    expect(validateEnv({ ...BASE, AI_PROVIDER: 'dify', DIFY_API_KEY: 'key', DIFY_APP_ID: 'app' }).AI_PROVIDER).toBe('dify');
    // Unused Dify credentials must not block the Ollama default.
    expect(validateEnv({ ...BASE }).DIFY_API_KEY).toBe('');
  });

  it('validates Cloudinary credentials in production when Cloudinary is the active provider', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        NODE_ENV: 'production',
        FILE_STORAGE_PROVIDER: 'cloudinary',
      }),
    ).toThrow(/CLOUDINARY_CLOUD_NAME/);

    const valid = validateEnv({
      ...BASE,
      NODE_ENV: 'production',
      FILE_STORAGE_PROVIDER: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'gangamata-prod',
      CLOUDINARY_API_KEY: '123456789012345',
      CLOUDINARY_API_SECRET: 'abcdefghijklmnopqrstuvwxyz01',
    });
    expect(valid.FILE_STORAGE_PROVIDER).toBe('cloudinary');
    expect(valid.CLOUDINARY_CLOUD_NAME).toBe('gangamata-prod');
  });

  it('rejects placeholder secrets and wildcard CORS in production only', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production', JWT_SECRET: 'change-me' })).toThrow(EnvValidationError);
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(/Wildcard/);
    expect(validateEnv({ ...BASE, NODE_ENV: 'development', CORS_ORIGINS: '*' }).CORS_ORIGINS).toEqual(['*']);
  });

  it('normalises URLs and lists', () => {
    const env = validateEnv({ ...BASE, OLLAMA_BASE_URL: 'http://127.0.0.1:11434/', CORS_ORIGINS: 'http://a.test/, http://b.test ' });
    expect(env.OLLAMA_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects an invalid provider URL and a bad token duration', () => {
    expect(() => validateEnv({ ...BASE, OLLAMA_BASE_URL: 'ftp://nope' })).toThrow(EnvValidationError);
    expect(() => validateEnv({ ...BASE, JWT_EXPIRES_IN: '12 hours' })).toThrow(/JWT_EXPIRES_IN/);
  });

  it('lists every problem at once', () => {
    try {
      validateEnv({ DATABASE_URL: 'nope', JWT_SECRET: 'short' });
      fail('expected validation to throw');
    } catch (error) {
      expect((error as EnvValidationError).issues).toHaveLength(2);
    }
  });
});

describe('validateEnv — Phase 7 OCR and mailbox settings', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64');
  const GMAIL = {
    ...BASE,
    EMAIL_PROVIDER: 'gmail',
    GMAIL_CLIENT_ID: 'id.apps.googleusercontent.com',
    GMAIL_CLIENT_SECRET: 'secret',
    EMAIL_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/v1/inbox/oauth/callback',
    EMAIL_TOKEN_ENCRYPTION_KEY: KEY,
  };

  it('defaults OCR to auto and email AI to sensible thresholds', () => {
    const env = validateEnv({ ...BASE });
    expect(env.OCR_ENGINE).toBe('auto');
    expect(env.OCR_LANGUAGES).toBe('eng');
    expect(env.EMAIL_AI_MIN_CONFIDENCE).toBe(0.5);
    expect(env.EMAIL_AI_MAX_ATTEMPTS).toBe(3);
  });

  it('accepts a complete Gmail configuration', () => {
    expect(validateEnv(GMAIL).EMAIL_PROVIDER).toBe('gmail');
  });

  it('refuses an OAuth mailbox without its client, callback or encryption key', () => {
    expect(() => validateEnv({ ...GMAIL, GMAIL_CLIENT_SECRET: '' })).toThrow(/GMAIL_CLIENT_SECRET/);
    expect(() => validateEnv({ ...GMAIL, EMAIL_OAUTH_REDIRECT_URI: '' })).toThrow(/EMAIL_OAUTH_REDIRECT_URI/);
    expect(() => validateEnv({ ...GMAIL, EMAIL_TOKEN_ENCRYPTION_KEY: '' })).toThrow(/EMAIL_TOKEN_ENCRYPTION_KEY/);
    expect(() => validateEnv({ ...BASE, EMAIL_PROVIDER: 'microsoft_graph' })).toThrow(/MS_GRAPH_CLIENT_ID/);
  });

  it('refuses an encryption key that is not 32 bytes', () => {
    expect(() => validateEnv({ ...GMAIL, EMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 random bytes/);
  });

  it('requires HTTPS for the OAuth callback in production', () => {
    const production = { ...GMAIL, NODE_ENV: 'production', JWT_SECRET: 'x9'.repeat(24), CORS_ORIGINS: 'https://admin.example.com' };
    expect(() => validateEnv(production)).toThrow(/HTTPS in production/);
    expect(validateEnv({ ...production, EMAIL_OAUTH_REDIRECT_URI: 'https://api.example.com/api/v1/inbox/oauth/callback' }).EMAIL_PROVIDER).toBe('gmail');
  });

  it('refuses a malformed OCR language list', () => {
    expect(() => validateEnv({ ...BASE, OCR_LANGUAGES: 'eng; rm -rf' })).toThrow(/OCR_LANGUAGES/);
    expect(validateEnv({ ...BASE, OCR_LANGUAGES: 'eng+hin' }).OCR_LANGUAGES).toBe('eng+hin');
  });
});
