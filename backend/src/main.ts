import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, createLogger } from './bootstrap';
import { AppConfigService } from './config/app-config.service';
import { EnvValidationError } from './config/env.schema';

async function bootstrap(): Promise<void> {
  // Logs are buffered until configuration is validated, so a config error is the first thing shown.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfigService);

  app.useLogger(createLogger(config.logLevel, config.isProduction));
  configureApp(app, config);

  const { port, host } = config.http;
  await app.listen(port, host);

  const logger = new Logger('Bootstrap');
  logger.log(`Gangamata API listening on ${host}:${port} (environment: ${config.nodeEnv})`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  if (error instanceof EnvValidationError) {
    logger.fatal(error.message);
  } else {
    const raw = error instanceof Error ? (error.stack || error.message) : String(error);
    const sanitized = raw.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1****$2');
    logger.fatal('Failed to start the API', sanitized);
  }
  process.exitCode = 1;
});
