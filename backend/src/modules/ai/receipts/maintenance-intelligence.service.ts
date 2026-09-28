import { Injectable } from '@nestjs/common';
import { OperationCategory, Prisma, RecordStatus, ServiceReceiptAIStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ServiceReceiptExtractionSchema } from '../schema';

/**
 * What the service history is telling the office.
 *
 * Three rules shape everything here, and they are the reason this is arithmetic over confirmed
 * records rather than a model being asked what it thinks:
 *
 *  1. **Only verified records count.** Every figure below is computed from service records an
 *     administrator confirmed. An extraction nobody has checked contributes nothing — it is a
 *     suggestion about a document, not a fact about a truck (§13, §14).
 *  2. **Observations, not instructions.** A reminder derived from an average interval is an
 *     estimate from past behaviour. It never authorises a repair, never books anything, and is
 *     labelled as an estimate everywhere it appears (§13).
 *  3. **Nothing safety-critical is asserted.** "This vehicle has been serviced four times in
 *     ninety days" is a fact worth someone's attention. "This vehicle is unsafe" is a claim this
 *     system is not entitled to make, and does not.
 */
@Injectable()
export class MaintenanceIntelligenceService {
  /** Below this many confirmed services, an interval estimate is noise rather than a pattern. */
  private static readonly MIN_SERVICES_FOR_INTERVAL = 3;
  /** Services within this window that count as "unusually frequent" and worth a look. */
  private static readonly FREQUENT_WINDOW_DAYS = 90;
  private static readonly FREQUENT_THRESHOLD = 4;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A vehicle's service history, and what can honestly be said about it.
   *
   * Returns an empty set of observations rather than inventing any when there is not enough
   * confirmed history — which is the common case for a new vehicle, and is not a failure.
   */
  async forVehicle(companyId: string, vehicleId: string, now = new Date()): Promise<VehicleMaintenanceIntelligence> {
    const services = await this.prisma.vehicleExpense.findMany({
      where: {
        companyId,
        vehicleId,
        category: OperationCategory.MAINTENANCE,
        status: RecordStatus.ACTIVE,
        // The load-bearing filter: verified history only.
        aiStatus: ServiceReceiptAIStatus.CONFIRMED,
      },
      select: {
        id: true,
        amount: true,
        expenseDate: true,
        vendorName: true,
        description: true,
        acceptedResult: { select: { extraction: true } },
      },
      orderBy: { expenseDate: 'desc' },
      take: 60,
    });

    const observations: MaintenanceObservation[] = [];

    if (services.length === 0) {
      return {
        vehicleId,
        confirmedServices: 0,
        totalSpend: '0.00',
        lastServiceDate: null,
        averageIntervalDays: null,
        estimatedNextServiceDate: null,
        frequentParts: [],
        observations,
        basis: 'No confirmed service records yet. Figures appear once receipts have been verified.',
      };
    }

    const dates = services.map((s) => s.expenseDate).sort((a, b) => a.getTime() - b.getTime());
    const totalSpend = services.reduce((sum, s) => sum.add(s.amount), new Prisma.Decimal(0));
    const lastServiceDate = dates[dates.length - 1]!;

    // ── Interval between services ──
    let averageIntervalDays: number | null = null;
    let estimatedNextServiceDate: string | null = null;
    if (dates.length >= MaintenanceIntelligenceService.MIN_SERVICES_FOR_INTERVAL) {
      const gaps: number[] = [];
      for (let i = 1; i < dates.length; i += 1) {
        gaps.push(Math.round((dates[i]!.getTime() - dates[i - 1]!.getTime()) / 86_400_000));
      }
      const usable = gaps.filter((gap) => gap > 0);
      if (usable.length) {
        averageIntervalDays = Math.round(usable.reduce((a, b) => a + b, 0) / usable.length);
        const estimate = new Date(lastServiceDate.getTime() + averageIntervalDays * 86_400_000);
        estimatedNextServiceDate = estimate.toISOString().slice(0, 10);

        const overdueDays = Math.round((now.getTime() - estimate.getTime()) / 86_400_000);
        if (overdueDays > 0) {
          observations.push({
            kind: 'estimated_reminder',
            severity: overdueDays > averageIntervalDays ? 'attention' : 'info',
            message:
              `Past services have averaged about ${averageIntervalDays} days apart. On that pattern this vehicle ` +
              `would have been due around ${estimatedNextServiceDate}, ${overdueDays} day${overdueDays === 1 ? '' : 's'} ago.`,
          });
        }
      }
    }

    // ── Unusually frequent servicing ──
    const windowStart = new Date(now.getTime() - MaintenanceIntelligenceService.FREQUENT_WINDOW_DAYS * 86_400_000);
    const recent = dates.filter((date) => date >= windowStart);
    if (recent.length >= MaintenanceIntelligenceService.FREQUENT_THRESHOLD) {
      observations.push({
        kind: 'frequent_service',
        severity: 'attention',
        message:
          `${recent.length} confirmed services in the last ${MaintenanceIntelligenceService.FREQUENT_WINDOW_DAYS} days. ` +
          'That is more often than usual for this fleet and may be worth looking into.',
      });
    }

    // ── Parts that keep coming back ──
    const frequentParts = this.countParts(services);
    const repeated = frequentParts.filter((part) => part.occurrences >= 3);
    if (repeated.length) {
      observations.push({
        kind: 'repeated_part',
        severity: 'info',
        message:
          `Replaced repeatedly on verified invoices: ${repeated.slice(0, 3).map((p) => `${p.name} (${p.occurrences}×)`).join(', ')}.`,
      });
    }

    // ── Where the money goes ──
    const byVendor = new Map<string, number>();
    for (const service of services) {
      const vendor = service.vendorName?.trim();
      if (vendor) byVendor.set(vendor, (byVendor.get(vendor) ?? 0) + 1);
    }
    const topVendor = [...byVendor.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topVendor && topVendor[1] >= 3) {
      observations.push({
        kind: 'recurring_vendor',
        severity: 'info',
        message: `${topVendor[0]} has carried out ${topVendor[1]} of the last ${services.length} confirmed services.`,
      });
    }

    return {
      vehicleId,
      confirmedServices: services.length,
      totalSpend: totalSpend.toFixed(2),
      lastServiceDate: lastServiceDate.toISOString().slice(0, 10),
      averageIntervalDays,
      estimatedNextServiceDate,
      frequentParts: frequentParts.slice(0, 8),
      observations,
      basis: `Based on ${services.length} confirmed service record${services.length === 1 ? '' : 's'}. Unverified extractions are not included.`,
    };
  }

  /**
   * Parts counted from the extraction each service was *confirmed against* — so a part only
   * counts once an administrator accepted the invoice it appeared on.
   */
  private countParts(
    services: { acceptedResult: { extraction: Prisma.JsonValue } | null }[],
  ): { name: string; occurrences: number }[] {
    const counts = new Map<string, { name: string; occurrences: number }>();

    for (const service of services) {
      if (!service.acceptedResult) continue;
      const parsed = ServiceReceiptExtractionSchema.safeParse(service.acceptedResult.extraction);
      if (!parsed.success) continue;

      // One count per service, however many lines mention the part on the same invoice.
      const seen = new Set<string>();
      for (const part of parsed.data.parts) {
        const name = part.name?.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = counts.get(key);
        if (existing) existing.occurrences += 1;
        else counts.set(key, { name, occurrences: 1 });
      }
    }

    return [...counts.values()].sort((a, b) => b.occurrences - a.occurrences);
  }

  /** Fleet-wide summary for the maintenance screen. Verified records only, as above. */
  async fleetSummary(companyId: string, now = new Date()): Promise<FleetMaintenanceSummary> {
    const windowStart = new Date(now.getTime() - MaintenanceIntelligenceService.FREQUENT_WINDOW_DAYS * 86_400_000);

    const [confirmed, awaitingReview, spend] = await Promise.all([
      this.prisma.vehicleExpense.count({
        where: {
          companyId,
          category: OperationCategory.MAINTENANCE,
          status: RecordStatus.ACTIVE,
          aiStatus: ServiceReceiptAIStatus.CONFIRMED,
          expenseDate: { gte: windowStart },
        },
      }),
      this.prisma.vehicleExpense.count({
        where: {
          companyId,
          category: OperationCategory.MAINTENANCE,
          status: RecordStatus.ACTIVE,
          aiStatus: { in: [ServiceReceiptAIStatus.COMPLETED, ServiceReceiptAIStatus.REVIEW_REQUIRED, ServiceReceiptAIStatus.FAILED] },
        },
      }),
      this.prisma.vehicleExpense.aggregate({
        where: {
          companyId,
          category: OperationCategory.MAINTENANCE,
          status: RecordStatus.ACTIVE,
          aiStatus: ServiceReceiptAIStatus.CONFIRMED,
          expenseDate: { gte: windowStart },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      windowDays: MaintenanceIntelligenceService.FREQUENT_WINDOW_DAYS,
      confirmedServices: confirmed,
      awaitingReview,
      confirmedSpend: (spend._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      basis: 'Confirmed service records only. Receipts still awaiting review are counted separately and excluded from the spend.',
    };
  }
}

/** Always a suggestion or an observation — never an instruction, and never a safety judgement. */
export interface MaintenanceObservation {
  kind: 'estimated_reminder' | 'frequent_service' | 'repeated_part' | 'recurring_vendor';
  severity: 'info' | 'attention';
  message: string;
}

export interface VehicleMaintenanceIntelligence {
  vehicleId: string;
  confirmedServices: number;
  totalSpend: string;
  lastServiceDate: string | null;
  averageIntervalDays: number | null;
  /** An estimate from past intervals, not a manufacturer schedule. */
  estimatedNextServiceDate: string | null;
  frequentParts: { name: string; occurrences: number }[];
  observations: MaintenanceObservation[];
  /** Stated in the response so the UI can always show what the numbers rest on. */
  basis: string;
}

export interface FleetMaintenanceSummary {
  windowDays: number;
  confirmedServices: number;
  awaitingReview: number;
  confirmedSpend: string;
  basis: string;
}
