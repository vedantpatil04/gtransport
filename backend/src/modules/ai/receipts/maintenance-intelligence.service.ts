import { Injectable } from '@nestjs/common';
import { OperationCategory, Prisma, RecordStatus, ServiceReceiptAIStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { todayInIndia, toIsoDate } from '../../../common/dates/financial-year';

/**
 * What the service history is telling the office.
 *
 * Three rules shape everything here, and they are the reason this is arithmetic over verified
 * records rather than a model being asked what it thinks:
 *
 *  1. **Only verified records count.** Every figure below is computed from service records an
 *     administrator verified. An extraction nobody has checked contributes nothing — it is a
 *     suggestion about a document, not a fact about a truck (§13, §14).
 *  2. **Observations, not instructions.** A due date printed by the workshop is reported as the
 *     workshop's; a reminder derived from an average interval is labelled an estimate. Neither
 *     authorises a repair, books anything, or takes a vehicle off the road (§13).
 *  3. **Nothing safety-critical is asserted.** "Brake pads were replaced twice in 90 days" is a
 *     fact worth someone's attention. "This vehicle is unsafe" is a claim this system is not
 *     entitled to make, and does not.
 */

const DAY_MS = 86_400_000;

/** Below this many verified services, an interval estimate is noise rather than a pattern. */
const MIN_SERVICES_FOR_INTERVAL = 3;
/** Window for "unusually frequent" servicing. */
const FREQUENT_WINDOW_DAYS = 90;
const FREQUENT_THRESHOLD = 4;
/** The same part or service type this many times within the window is a repeated issue. */
const REPEAT_WINDOW_DAYS = 180;
const REPEAT_THRESHOLD = 2;
/** A verified next-service date this close is "upcoming". */
const UPCOMING_DAYS = 30;
/** History considered at all. Older records do not describe the vehicle as it is now. */
const HISTORY_DAYS = 3 * 365;

const VERIFIED_SERVICE = {
  category: OperationCategory.MAINTENANCE,
  status: RecordStatus.ACTIVE,
  // The load-bearing filter: verified history only.
  aiStatus: ServiceReceiptAIStatus.VERIFIED,
} as const;

const SERVICE_VIEW = {
  id: true,
  vehicleId: true,
  amount: true,
  expenseDate: true,
  vendorName: true,
  serviceType: true,
  invoiceNumber: true,
  odometerKm: true,
  nextServiceDate: true,
  nextServiceKm: true,
  serviceLineItems: true,
  vehicle: { select: { id: true, registrationNumber: true } },
} as const;

type ServiceRow = Prisma.VehicleExpenseGetPayload<{ select: typeof SERVICE_VIEW }>;

@Injectable()
export class MaintenanceIntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A vehicle's verified service history, and what can honestly be said about it.
   *
   * Returns an empty set of observations rather than inventing any when there is not enough
   * verified history — which is the common case for a new vehicle, and is not a failure.
   */
  async forVehicle(companyId: string, vehicleId: string, now = new Date()): Promise<VehicleMaintenanceIntelligence> {
    const services = await this.prisma.vehicleExpense.findMany({
      where: { companyId, vehicleId, ...VERIFIED_SERVICE, expenseDate: { gte: new Date(now.getTime() - HISTORY_DAYS * DAY_MS) } },
      select: SERVICE_VIEW,
      orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return analyseVehicle(vehicleId, services, now);
  }

  /** Fleet-wide view for the maintenance screen. Verified records only, as above. */
  async fleetSummary(companyId: string, now = new Date()): Promise<FleetMaintenanceSummary> {
    const windowStart = new Date(now.getTime() - FREQUENT_WINDOW_DAYS * DAY_MS);

    const [services, awaitingReview] = await Promise.all([
      this.prisma.vehicleExpense.findMany({
        where: { companyId, ...VERIFIED_SERVICE, expenseDate: { gte: new Date(now.getTime() - HISTORY_DAYS * DAY_MS) } },
        select: SERVICE_VIEW,
        orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
        take: 3_000,
      }),
      this.prisma.vehicleExpense.count({
        where: {
          companyId,
          category: OperationCategory.MAINTENANCE,
          status: RecordStatus.ACTIVE,
          aiStatus: { in: [ServiceReceiptAIStatus.SUCCEEDED, ServiceReceiptAIStatus.NEEDS_REVIEW, ServiceReceiptAIStatus.FAILED] },
        },
      }),
    ]);

    const byVehicle = new Map<string, ServiceRow[]>();
    for (const service of services) {
      const list = byVehicle.get(service.vehicleId) ?? [];
      list.push(service);
      byVehicle.set(service.vehicleId, list);
    }

    const due: DueService[] = [];
    const repeatedIssues: (RepeatedIssue & { vehicle: { id: string; registrationNumber: string } })[] = [];
    for (const [vehicleId, list] of byVehicle) {
      const analysis = analyseVehicle(vehicleId, list, now);
      if (analysis.nextService && analysis.nextService.status !== 'scheduled') {
        due.push({ vehicle: list[0]!.vehicle, ...analysis.nextService });
      }
      for (const issue of analysis.repeatedIssues) repeatedIssues.push({ ...issue, vehicle: list[0]!.vehicle });
    }

    const inWindow = services.filter((service) => service.expenseDate >= windowStart);
    const spend = inWindow.reduce((sum, service) => sum.add(service.amount), new Prisma.Decimal(0));

    return {
      windowDays: FREQUENT_WINDOW_DAYS,
      verifiedServices: inWindow.length,
      awaitingReview,
      verifiedSpend: spend.toFixed(2),
      // Overdue first, then the soonest due.
      dueServices: due.sort((a, b) => (a.status === b.status ? (a.dueDate ?? '').localeCompare(b.dueDate ?? '') : a.status === 'overdue' ? -1 : 1)).slice(0, 25),
      repeatedIssues: repeatedIssues.sort((a, b) => b.occurrences - a.occurrences).slice(0, 15),
      recent: services.slice(0, 10).map(presentService),
      basis:
        'Verified service records only. Receipts still awaiting review are counted separately and excluded from every figure. ' +
        'Due dates come from the workshop where printed; otherwise they are estimates from past intervals.',
    };
  }
}

// ───────────────────────────── analysis (pure) ─────────────────────────────

/**
 * Everything about one vehicle, from its verified services (newest first).
 *
 * Exported for tests: the rules are arithmetic and deserve to be checked without a database.
 */
export function analyseVehicle(vehicleId: string, services: ServiceRow[], now: Date): VehicleMaintenanceIntelligence {
  const observations: MaintenanceObservation[] = [];
  // "Today" as the office means it — the date in India — so a due date flips at local midnight.
  const today = todayInIndia(now);

  if (services.length === 0) {
    return {
      vehicleId,
      verifiedServices: 0,
      totalSpend: '0.00',
      lastServiceDate: null,
      lastOdometerKm: null,
      averageIntervalDays: null,
      servicesLast90Days: 0,
      servicesLast365Days: 0,
      nextService: null,
      repeatedIssues: [],
      recent: [],
      observations,
      basis: 'No verified service records yet. Figures appear once receipts have been verified.',
    };
  }

  const newestFirst = [...services].sort((a, b) => b.expenseDate.getTime() - a.expenseDate.getTime());
  const latest = newestFirst[0]!;
  const dates = newestFirst.map((s) => s.expenseDate).reverse();
  const totalSpend = services.reduce((sum, s) => sum.add(s.amount), new Prisma.Decimal(0));
  const lastOdometerKm = newestFirst.find((s) => s.odometerKm !== null)?.odometerKm ?? null;

  // ── Frequency ──
  const countSince = (days: number) => dates.filter((date) => date.getTime() >= today.getTime() - days * DAY_MS).length;
  const servicesLast90Days = countSince(90);
  const servicesLast365Days = countSince(365);

  let averageIntervalDays: number | null = null;
  if (dates.length >= MIN_SERVICES_FOR_INTERVAL) {
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i += 1) gaps.push(Math.round((dates[i]!.getTime() - dates[i - 1]!.getTime()) / DAY_MS));
    const usable = gaps.filter((gap) => gap > 0);
    if (usable.length) averageIntervalDays = Math.round(usable.reduce((a, b) => a + b, 0) / usable.length);
  }

  if (servicesLast90Days >= FREQUENT_THRESHOLD) {
    observations.push({
      kind: 'frequent_service',
      severity: 'attention',
      message:
        `${servicesLast90Days} verified services in the last ${FREQUENT_WINDOW_DAYS} days. ` +
        'That is more often than usual and may be worth looking into.',
    });
  }

  // ── Next service: the workshop's printed date first, an estimate only when there is none ──
  let nextService: NextService | null = null;
  if (latest.nextServiceDate) {
    nextService = dueFrom(latest.nextServiceDate, 'workshop', latest, today);
  } else if (averageIntervalDays !== null) {
    nextService = dueFrom(new Date(latest.expenseDate.getTime() + averageIntervalDays * DAY_MS), 'estimate', latest, today);
  } else if (latest.nextServiceKm !== null) {
    // Due by distance only. Without a current odometer reading, whether it has been reached is
    // unknown — and is reported as unknown rather than guessed.
    nextService = {
      source: 'workshop',
      status: 'scheduled',
      dueDate: null,
      daysRemaining: null,
      dueKm: latest.nextServiceKm,
      lastServiceDate: toIsoDate(latest.expenseDate),
      lastOdometerKm: latest.odometerKm,
    };
  }
  if (nextService && nextService.status !== 'scheduled') {
    const when =
      nextService.status === 'overdue'
        ? `${Math.abs(nextService.daysRemaining ?? 0)} day(s) ago (${nextService.dueDate})`
        : `in ${nextService.daysRemaining} day(s) (${nextService.dueDate})`;
    observations.push({
      kind: nextService.source === 'workshop' ? 'service_due' : 'estimated_reminder',
      severity: nextService.status === 'overdue' ? 'attention' : 'info',
      message:
        nextService.source === 'workshop'
          ? `The workshop set the next service ${nextService.status === 'overdue' ? 'for' : 'due'} ${when}.`
          : `Past services have averaged about ${averageIntervalDays} days apart; on that pattern the next would be due ${when}. This is an estimate.`,
    });
  }

  // ── Repeated issues: the same part, labour item or service type, again and again ──
  const repeatedIssues = findRepeatedIssues(newestFirst, today);
  if (repeatedIssues.length) {
    observations.push({
      kind: 'repeated_issue',
      severity: 'attention',
      message:
        `Recurring on verified invoices in the last ${REPEAT_WINDOW_DAYS} days: ` +
        repeatedIssues.slice(0, 3).map((issue) => `${issue.label} (${issue.occurrences}×)`).join(', ') + '.',
    });
  }

  // ── Where the work goes ──
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
      message: `${topVendor[0]} has carried out ${topVendor[1]} of the last ${services.length} verified services.`,
    });
  }

  return {
    vehicleId,
    verifiedServices: services.length,
    totalSpend: totalSpend.toFixed(2),
    lastServiceDate: toIsoDate(latest.expenseDate),
    lastOdometerKm,
    averageIntervalDays,
    servicesLast90Days,
    servicesLast365Days,
    nextService,
    repeatedIssues,
    recent: newestFirst.slice(0, 5).map(presentService),
    observations,
    basis: `Based on ${services.length} verified service record${services.length === 1 ? '' : 's'}. Unverified extractions are not included.`,
  };
}

function dueFrom(dueDate: Date, source: 'workshop' | 'estimate', latest: ServiceRow, today: Date): NextService {
  const daysRemaining = Math.round((startOfDay(dueDate).getTime() - today.getTime()) / DAY_MS);
  return {
    source,
    status: daysRemaining < 0 ? 'overdue' : daysRemaining <= UPCOMING_DAYS ? 'upcoming' : 'scheduled',
    dueDate: toIsoDate(dueDate),
    daysRemaining,
    dueKm: source === 'workshop' ? latest.nextServiceKm : null,
    lastServiceDate: toIsoDate(latest.expenseDate),
    lastOdometerKm: latest.odometerKm,
  };
}

/**
 * Parts, labour items and service types that recur within the repeat window. One count per
 * service, however many lines on the same invoice mention it.
 */
function findRepeatedIssues(services: ServiceRow[], today: Date): RepeatedIssue[] {
  const since = today.getTime() - REPEAT_WINDOW_DAYS * DAY_MS;
  const counts = new Map<string, RepeatedIssue>();

  const count = (key: string, label: string, kind: RepeatedIssue['kind'], date: Date) => {
    const existing = counts.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (toIsoDate(date) < existing.firstSeen) existing.firstSeen = toIsoDate(date);
      if (toIsoDate(date) > existing.lastSeen) existing.lastSeen = toIsoDate(date);
    } else {
      counts.set(key, { kind, label, occurrences: 1, firstSeen: toIsoDate(date), lastSeen: toIsoDate(date) });
    }
  };

  for (const service of services) {
    if (service.expenseDate.getTime() < since) continue;
    const seen = new Set<string>();
    const type = service.serviceType?.trim().replace(/\s+/g, ' ');
    if (type) {
      const key = `type:${normalise(type)}`;
      seen.add(key);
      count(key, type, 'service_type', service.expenseDate);
    }
    for (const line of readLineItems(service.serviceLineItems)) {
      if (line.kind === 'OTHER') continue;
      const key = `${line.kind === 'LABOUR' ? 'labour' : 'part'}:${normalise(line.description)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      count(key, line.description.replace(/\s+/g, ' '), line.kind === 'LABOUR' ? 'labour' : 'part', service.expenseDate);
    }
  }

  return [...counts.values()].filter((issue) => issue.occurrences >= REPEAT_THRESHOLD).sort((a, b) => b.occurrences - a.occurrences);
}

/** Verified line items as stored by verification. Anything malformed is skipped, not guessed at. */
function readLineItems(value: Prisma.JsonValue): { description: string; kind: string | null }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const description = (entry as { description?: unknown }).description;
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof description !== 'string' || !description.trim()) return [];
    return [{ description: description.trim(), kind: typeof kind === 'string' ? kind : null }];
  });
}

function presentService(service: ServiceRow): RecentService {
  return {
    id: service.id,
    vehicle: service.vehicle,
    serviceDate: toIsoDate(service.expenseDate),
    vendorName: service.vendorName,
    serviceType: service.serviceType,
    invoiceNumber: service.invoiceNumber,
    amount: service.amount.toFixed(2),
    odometerKm: service.odometerKm,
  };
}

const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const startOfDay = (date: Date) => new Date(`${toIsoDate(date)}T00:00:00.000Z`);
// ───────────────────────────── types ─────────────────────────────

/** Always a suggestion or an observation — never an instruction, and never a safety judgement. */
export interface MaintenanceObservation {
  kind: 'service_due' | 'estimated_reminder' | 'frequent_service' | 'repeated_issue' | 'recurring_vendor';
  severity: 'info' | 'attention';
  message: string;
}

export interface NextService {
  /** `workshop`: printed on a verified receipt. `estimate`: from past intervals, and labelled so. */
  source: 'workshop' | 'estimate';
  status: 'overdue' | 'upcoming' | 'scheduled';
  dueDate: string | null;
  /** Negative when overdue. */
  daysRemaining: number | null;
  /** The workshop's next-service odometer reading, when printed. Reported, never assessed. */
  dueKm: number | null;
  lastServiceDate: string;
  lastOdometerKm: number | null;
}

export interface RepeatedIssue {
  kind: 'part' | 'labour' | 'service_type';
  label: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
}

export interface RecentService {
  id: string;
  vehicle: { id: string; registrationNumber: string };
  serviceDate: string;
  vendorName: string | null;
  serviceType: string | null;
  invoiceNumber: string | null;
  amount: string;
  odometerKm: number | null;
}

export interface VehicleMaintenanceIntelligence {
  vehicleId: string;
  verifiedServices: number;
  totalSpend: string;
  lastServiceDate: string | null;
  lastOdometerKm: number | null;
  averageIntervalDays: number | null;
  servicesLast90Days: number;
  servicesLast365Days: number;
  nextService: NextService | null;
  repeatedIssues: RepeatedIssue[];
  recent: RecentService[];
  observations: MaintenanceObservation[];
  /** Stated in the response so the UI can always show what the numbers rest on. */
  basis: string;
}

export type DueService = NextService & { vehicle: { id: string; registrationNumber: string } };

export interface FleetMaintenanceSummary {
  windowDays: number;
  verifiedServices: number;
  awaitingReview: number;
  verifiedSpend: string;
  dueServices: DueService[];
  repeatedIssues: (RepeatedIssue & { vehicle: { id: string; registrationNumber: string } })[];
  recent: RecentService[];
  basis: string;
}
