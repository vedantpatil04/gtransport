import { Injectable } from '@nestjs/common';
import { DocumentState, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { todayInIndia, toIsoDate } from '../../common/dates/financial-year';
import { assessExpiry, EXPIRING_SOON_DAYS } from './document-expiry.policy';

/**
 * Turns document expiry into durable events a later notification phase can deliver.
 *
 * Each run records, for every current document inside the warning window, the threshold it has
 * reached (DAYS_30 … DAYS_1, EXPIRED). The (document, threshold, expiry date) key is unique, so
 * running the scan hourly or twice by mistake never records a warning twice — and nothing is
 * sent from here. Undelivered events are simply those with no notifiedAt.
 */
@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async scanExpiryEvents(today: Date = todayInIndia(), companyId?: string): Promise<{ scanned: number; recorded: number }> {
    const horizon = new Date(today.getTime() + EXPIRING_SOON_DAYS * 86_400_000);
    let scanned = 0;
    let recorded = 0;
    let cursor: string | undefined;

    // Paged, so a very large fleet is processed in bounded memory.
    for (;;) {
      const batch = await this.prisma.document.findMany({
        where: {
          state: DocumentState.CURRENT,
          deletedAt: null,
          expiryDate: { not: null, lte: horizon },
          ...(companyId ? { companyId } : {}),
        },
        select: { id: true, companyId: true, expiryDate: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;
      scanned += batch.length;

      const events: Prisma.DocumentExpiryEventCreateManyInput[] = [];
      for (const document of batch) {
        const assessment = assessExpiry(document.expiryDate, today);
        if (!assessment.threshold || assessment.daysRemaining === null) continue;
        events.push({
          companyId: document.companyId,
          documentId: document.id,
          threshold: assessment.threshold,
          expiryDate: document.expiryDate as Date,
          daysRemaining: assessment.daysRemaining,
        });
      }
      if (events.length > 0) {
        const result = await this.prisma.documentExpiryEvent.createMany({ data: events, skipDuplicates: true });
        recorded += result.count;
      }
      cursor = batch[batch.length - 1]?.id;
    }
    return { scanned, recorded };
  }

  /** The feed a notification phase will read: events not yet delivered, oldest first. */
  async undelivered(companyId: string, limit = 100) {
    const events = await this.prisma.documentExpiryEvent.findMany({
      where: { companyId, notifiedAt: null },
      orderBy: { detectedAt: 'asc' },
      take: Math.min(limit, 500),
      select: {
        id: true,
        threshold: true,
        expiryDate: true,
        daysRemaining: true,
        detectedAt: true,
        document: { select: { id: true, type: true, vehicle: { select: { registrationNumber: true } }, employee: { select: { fullName: true } } } },
      },
    });
    return events.map((event) => ({ ...event, expiryDate: toIsoDate(event.expiryDate), detectedAt: event.detectedAt.toISOString() }));
  }
}
