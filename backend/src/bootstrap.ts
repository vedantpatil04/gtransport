import { ConsoleLogger, INestApplication, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { requestIdMiddleware } from './common/http/request-context';
import { createValidationPipe } from './common/http/validation.pipe';
import { AppConfigService } from './config/app-config.service';

/** Routes live under /api/v1; /health stays at the root for infrastructure probes. */
export const API_PREFIX = 'api/v1';

/**
 * Applies every cross-cutting HTTP concern. Shared by main.ts and the e2e tests so what is
 * tested is exactly what runs in production.
 */
export function configureApp(app: INestApplication, config: AppConfigService): void {
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  app.use(requestIdMiddleware);
  app.use(helmet());

  if (config.http.trustProxy) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.enableCors({
    origin: config.http.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    maxAge: 600,
  });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}

export function createLogger(logLevel: string, json: boolean): ConsoleLogger {
  const levels = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
  const index = levels.indexOf(logLevel as (typeof levels)[number]);
  return new ConsoleLogger({
    json,
    logLevels: levels.slice(0, index === -1 ? 4 : index + 1) as unknown as ConsoleLogger['options']['logLevels'],
  });
}

export { VersioningType };
