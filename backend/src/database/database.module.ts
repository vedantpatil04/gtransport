import { Global, Module } from '@nestjs/common';
import { MigrationStatusService } from './migration-status.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, MigrationStatusService],
  exports: [PrismaService, MigrationStatusService],
})
export class DatabaseModule {}
