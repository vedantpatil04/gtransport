import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';

/**
 * Prisma client bound to the application lifecycle.
 *
 * Uses the driver adapter (`@prisma/adapter-pg`) so the runtime needs no native query engine
 * binary — which keeps VPS deployment and container images simple, and matches the direction
 * Prisma itself is moving in.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfigService) {
    const { url, poolMax } = config.database;
    super({
      adapter: new PrismaPg({ connectionString: url, max: poolMax }),
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      await this.ping();
      this.logger.log('Database connection established successfully');
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const sanitized = rawMessage.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1****$2');
      this.logger.error(`Database connection failed: ${sanitized}`);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /** Lightweight liveness probe used by the health endpoint. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
