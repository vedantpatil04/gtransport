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

  const { port } = config.http;
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`Gangamata API listening on port ${port} (${config.nodeEnv})`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  if (error instanceof EnvValidationError) {
    logger.fatal(error.message);
  } else {
    logger.fatal('Failed to start the API', error instanceof Error ? error.stack : String(error));
  }
  process.exitCode = 1;
});
