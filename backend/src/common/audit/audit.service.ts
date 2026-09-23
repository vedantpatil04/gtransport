import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  companyId?: string | null;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  changes?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Append-only audit trail. Writes are best-effort: an audit failure must never fail the
 * business operation it describes, but it is always logged. The audit_logs table itself
 * rejects UPDATE/DELETE at the database level.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          companyId: entry.companyId ?? null,
          actorUserId: entry.actorUserId ?? null,
          actorRole: entry.actorRole ?? null,
          changes: entry.changes,
          metadata: entry.metadata,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
          requestId: entry.requestId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit entry "${entry.action}"`, error instanceof Error ? error.stack : String(error));
    }
  }
}
