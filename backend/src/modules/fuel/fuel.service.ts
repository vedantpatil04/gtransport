import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FuelType, LedgerSourceType, Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { toPage, type Page } from '../../common/pagination/pagination';
import { financialYearOf, monthStart, todayInIndia, toIsoDate } from '../../common/dates/financial-year';
import { dateRangeFilter, pastOrTodayDate } from '../../common/dates/request-dates';
import { requireDriverScope } from '../auth/access-scope';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { FilesService } from '../files/files.service';
import { LedgerService } from '../finance/ledger.service';
import { fuelPosting } from '../finance/ledger-postings';
import type { ArchiveDto, CreateFuelEntryDto, FuelBreakdownQuery, FuelFilterQuery, MyFuelQuery, UpdateFuelEntryDto } from './dto/fuel.dto';
import { totalsFromAggregate, type FuelTotals } from './fuel.maths';

export const FUEL_VIEW = {
  id: true,
  fuelType: true,
  amount: true,
  litres: true,
  fuelStation: true,
  transactionDate: true,
  receiptFileId: true,
  status: true,
  notes: true,
  archivedAt: true,
  archiveReason: true,
  clientSubmissionId: true,
  createdAt: true,
  updatedAt: true,
  driver: { select: { id: true, driverCode: true, employee: { select: { fullName: true } } } },
  vehicle: { select: { id: true, registrationNumber: true } },
} as const;

export type FuelRow = Prisma.FuelEntryGetPayload<{ select: typeof FUEL_VIEW }>;

/** Newest fill-up first; id breaks ties so paging is stable. */
const FUEL_ORDER: Prisma.FuelEntryOrderByWithRelationInput[] = [{ transactionDate: 'desc' }, { id: 'desc' }];

export interface PeriodSummary extends FuelTotals {
  from: string;
  to: string;
  byFuelType: Record<FuelType, { amount: Prisma.Decimal; litres: Prisma.Decimal; entries: number }>;
}

@Injectable()
export class FuelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly ledger: LedgerService,
  ) {}

  /** Runs a write and brings the ledger into line with its result, atomically. */
  private withLedger(user: AuthenticatedUser, write: (tx: Prisma.TransactionClient) => Promise<FuelRow>): Promise<FuelRow> {
    return this.prisma.$transaction(async (tx) => {
      const row = await write(tx);
      await this.ledger.syncSource(tx, { companyId: user.companyId, sourceType: LedgerSourceType.FUEL_ENTRY, sourceId: row.id, actorId: user.id }, fuelPosting(row));
      return row;
    });
  }

  // ───────────────────────────── Driver ─────────────────────────────

  /**
   * Records a fill-up for the signed-in driver. The vehicle is the driver's current
   * assignment; nothing the app sends can point the entry at another driver or vehicle.
   *
   * Idempotent on clientSubmissionId: a retry of an entry that already reached the server
   * returns the original record rather than creating a second one.
   */
  async createForDriver(user: AuthenticatedUser, dto: CreateFuelEntryDto): Promise<{ entry: FuelRow; created: boolean }> {
    const { driverId } = requireDriverScope(user);

    if (dto.clientSubmissionId) {
      const existing = await this.findBySubmission(user.companyId, dto.clientSubmissionId);
      if (existing) return { entry: this.assertOwnReplay(existing, driverId), created: false };
    }

    const driver = await this.prisma.driver.findFirst({
      where: { id: driverId, companyId: user.companyId, deletedAt: null },
      select: { status: true, currentAssignment: { select: { vehicleId: true } } },
    });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    if (!driver.currentAssignment) {
      throw new BadRequestException('No vehicle is assigned to you. Ask the office to assign one before adding fuel.');
    }

    const assignedVehicleId = driver.currentAssignment.vehicleId;
    const transactionDate = this.validDate(dto.transactionDate);
    if (dto.receiptFileId) await this.files.assertUsable(user.companyId, dto.receiptFileId, user.id);

    try {
      const entry = await this.withLedger(user, (tx) => tx.fuelEntry.create({
        data: {
          companyId: user.companyId,
          driverId,
          vehicleId: assignedVehicleId,
          fuelType: dto.fuelType,
          amount: dto.amount,
          litres: dto.litres,
          fuelStation: dto.fuelStation.trim(),
          transactionDate,
          receiptFileId: dto.receiptFileId ?? null,
          notes: dto.notes?.trim() || null,
          clientSubmissionId: dto.clientSubmissionId ?? null,
          createdById: user.id,
          updatedById: user.id,
        },
        select: FUEL_VIEW,
      }));

      await this.audit.record({
        action: 'fuel.created',
        entityType: 'FuelEntry',
        entityId: entry.id,
        companyId: user.companyId,
        actorUserId: user.id,
        actorRole: user.role,
        changes: {
          fuelType: entry.fuelType,
          amount: entry.amount.toFixed(2),
          litres: entry.litres.toFixed(3),
          vehicleId: entry.vehicle.id,
          transactionDate: toIsoDate(entry.transactionDate),
        },
      });
      return { entry, created: true };
    } catch (error) {
      // Two retries raced past the lookup: the unique key caught the second, so return the first.
      if (dto.clientSubmissionId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findBySubmission(user.companyId, dto.clientSubmissionId);
        if (existing) return { entry: this.assertOwnReplay(existing, driverId), created: false };
      }
      throw error;
    }
  }

  /** A driver's own active entries in a date range, with totals for that range. */
  async listForDriver(user: AuthenticatedUser, query: MyFuelQuery): Promise<Page<FuelRow> & { totals: FuelTotals }> {
    const { driverId } = requireDriverScope(user);
    const where: Prisma.FuelEntryWhereInput = {
      companyId: user.companyId,
      driverId,
      status: RecordStatus.ACTIVE,
      ...this.dateRange(query.from, query.to),
    };

    const [rows, aggregate] = await Promise.all([
      this.prisma.fuelEntry.findMany({ where, select: FUEL_VIEW, orderBy: FUEL_ORDER, ...this.cursorArgs(query.limit, query.cursor) }),
      this.prisma.fuelEntry.aggregate({ where, _count: true, _sum: { amount: true, litres: true } }),
    ]);
    return { ...toPage(rows, query.limit), totals: totalsFromAggregate(aggregate) };
  }

  async findForDriver(user: AuthenticatedUser, id: string): Promise<FuelRow> {
    const { driverId } = requireDriverScope(user);
    const entry = await this.prisma.fuelEntry.findFirst({ where: { id, companyId: user.companyId, driverId }, select: FUEL_VIEW });
    if (!entry) throw new NotFoundException('Fuel entry not found.');
    return entry;
  }

  /** Recently used stations, most frequent first — suggestions only, never a fixed list. */
  async recentStations(user: AuthenticatedUser): Promise<string[]> {
    const { driverId } = requireDriverScope(user);
    const since = new Date(todayInIndia().getTime() - 180 * 24 * 60 * 60 * 1000);
    const grouped = await this.prisma.fuelEntry.groupBy({
      by: ['fuelStation'],
      where: { companyId: user.companyId, driverId, transactionDate: { gte: since } },
      _count: { fuelStation: true },
      orderBy: { _count: { fuelStation: 'desc' } },
      take: 8,
    });
    return grouped.map((row) => row.fuelStation);
  }

  // ───────────────────────────── Office ─────────────────────────────

  async list(companyId: string, query: FuelFilterQuery): Promise<Page<FuelRow> & { totals: FuelTotals }> {
    const where = this.buildWhere(companyId, query);
    const [rows, aggregate] = await Promise.all([
      this.prisma.fuelEntry.findMany({ where, select: FUEL_VIEW, orderBy: FUEL_ORDER, ...this.cursorArgs(query.limit, query.cursor) }),
      this.prisma.fuelEntry.aggregate({ where, _count: true, _sum: { amount: true, litres: true } }),
    ]);
    return { ...toPage(rows, query.limit), totals: totalsFromAggregate(aggregate) };
  }

  async findById(companyId: string, id: string): Promise<FuelRow> {
    const entry = await this.prisma.fuelEntry.findFirst({ where: { id, companyId }, select: FUEL_VIEW });
    if (!entry) throw new NotFoundException('Fuel entry not found.');
    return entry;
  }

  /** Today, this month and the current financial year, each with a petrol/diesel split. */
  async summary(companyId: string): Promise<{ today: PeriodSummary; month: PeriodSummary; financialYear: PeriodSummary & { label: string; code: string } }> {
    const today = todayInIndia();
    const fy = financialYearOf(today);

    const [todaySummary, month, year] = await Promise.all([
      this.periodSummary(companyId, today, today),
      this.periodSummary(companyId, monthStart(today), today),
      this.periodSummary(companyId, fy.start, fy.end),
    ]);
    return { today: todaySummary, month, financialYear: { ...year, label: fy.label, code: fy.code } };
  }

  /** Totals grouped by vehicle, driver, day or station for the filtered range. */
  async breakdown(companyId: string, query: FuelBreakdownQuery) {
    const where = this.buildWhere(companyId, query);
    const field = { vehicle: 'vehicleId', driver: 'driverId', day: 'transactionDate', station: 'fuelStation' }[query.by] as
      | 'vehicleId'
      | 'driverId'
      | 'transactionDate'
      | 'fuelStation';

    const grouped = await this.prisma.fuelEntry.groupBy({
      by: [field],
      where,
      _count: { _all: true },
      _sum: { amount: true, litres: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 500,
    });

    const labels = await this.labelsFor(companyId, query.by, grouped.map((row) => String(row[field])));
    return grouped.map((row) => {
      const key = row[field] instanceof Date ? toIsoDate(row[field] as Date) : String(row[field]);
      return {
        key,
        label: labels.get(String(row[field])) ?? key,
        ...totalsFromAggregate({ _count: row._count._all, _sum: row._sum }),
      };
    });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateFuelEntryDto): Promise<FuelRow> {
    const before = await this.findById(user.companyId, id);
    if (before.status === RecordStatus.ARCHIVED) throw new ConflictException('Restore this entry before editing it.');
    if (dto.receiptFileId) await this.files.assertUsable(user.companyId, dto.receiptFileId);

    const entry = await this.withLedger(user, (tx) => tx.fuelEntry.update({
      where: { id: before.id },
      data: {
        ...(dto.fuelType !== undefined ? { fuelType: dto.fuelType } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.litres !== undefined ? { litres: dto.litres } : {}),
        ...(dto.fuelStation !== undefined ? { fuelStation: dto.fuelStation.trim() } : {}),
        ...(dto.transactionDate !== undefined ? { transactionDate: this.validDate(dto.transactionDate) } : {}),
        ...(dto.receiptFileId !== undefined ? { receiptFileId: dto.receiptFileId } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        updatedById: user.id,
      },
      select: FUEL_VIEW,
    }));

    // Money changes are recorded before-and-after, so a correction is always explainable.
    await this.audit.record({
      action: 'fuel.updated',
      entityType: 'FuelEntry',
      entityId: entry.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: {
        before: { amount: before.amount.toFixed(2), litres: before.litres.toFixed(3), fuelType: before.fuelType, transactionDate: toIsoDate(before.transactionDate) },
        after: { amount: entry.amount.toFixed(2), litres: entry.litres.toFixed(3), fuelType: entry.fuelType, transactionDate: toIsoDate(entry.transactionDate) },
      },
    });
    return entry;
  }

  /** Archives rather than deletes: the entry leaves totals but stays on record. */
  async archive(user: AuthenticatedUser, id: string, dto: ArchiveDto): Promise<FuelRow> {
    const before = await this.findById(user.companyId, id);
    if (before.status === RecordStatus.ARCHIVED) return before;

    const entry = await this.withLedger(user, (tx) => tx.fuelEntry.update({
      where: { id: before.id },
      data: { status: RecordStatus.ARCHIVED, archivedAt: new Date(), archiveReason: dto.reason.trim(), updatedById: user.id },
      select: FUEL_VIEW,
    }));
    await this.audit.record({
      action: 'fuel.archived',
      entityType: 'FuelEntry',
      entityId: entry.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { amount: entry.amount.toFixed(2), litres: entry.litres.toFixed(3) },
      metadata: { reason: dto.reason.trim() },
    });
    return entry;
  }

  async restore(user: AuthenticatedUser, id: string): Promise<FuelRow> {
    const before = await this.findById(user.companyId, id);
    if (before.status === RecordStatus.ACTIVE) return before;

    const entry = await this.withLedger(user, (tx) => tx.fuelEntry.update({
      where: { id: before.id },
      data: { status: RecordStatus.ACTIVE, archivedAt: null, archiveReason: null, updatedById: user.id },
      select: FUEL_VIEW,
    }));
    await this.audit.record({
      action: 'fuel.restored',
      entityType: 'FuelEntry',
      entityId: entry.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
    });
    return entry;
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private async periodSummary(companyId: string, from: Date, to: Date): Promise<PeriodSummary> {
    const where: Prisma.FuelEntryWhereInput = { companyId, status: RecordStatus.ACTIVE, transactionDate: { gte: from, lte: to } };
    const [aggregate, byType] = await Promise.all([
      this.prisma.fuelEntry.aggregate({ where, _count: true, _sum: { amount: true, litres: true } }),
      this.prisma.fuelEntry.groupBy({ by: ['fuelType'], where, _count: { _all: true }, _sum: { amount: true, litres: true } }),
    ]);

    const zero = () => ({ amount: new Prisma.Decimal(0), litres: new Prisma.Decimal(0), entries: 0 });
    const byFuelType = { PETROL: zero(), DIESEL: zero() } as PeriodSummary['byFuelType'];
    for (const row of byType) {
      byFuelType[row.fuelType] = {
        amount: row._sum.amount ?? new Prisma.Decimal(0),
        litres: row._sum.litres ?? new Prisma.Decimal(0),
        entries: row._count._all,
      };
    }
    return { from: toIsoDate(from), to: toIsoDate(to), ...totalsFromAggregate(aggregate), byFuelType };
  }

  /**
   * Shared filter builder. Archived entries are excluded unless explicitly asked for, so every
   * total — list, statement, dashboard — counts the same set of records.
   */
  buildWhere(companyId: string, query: FuelFilterQuery): Prisma.FuelEntryWhereInput {
    const station = query.station?.trim();
    return {
      companyId,
      status: query.status ?? RecordStatus.ACTIVE,
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.fuelType ? { fuelType: query.fuelType } : {}),
      ...(station ? { fuelStation: { contains: station, mode: Prisma.QueryMode.insensitive } } : {}),
      ...this.periodFilter(query),
    };
  }

  private periodFilter(query: FuelFilterQuery): Prisma.FuelEntryWhereInput {
    const range = dateRangeFilter(query);
    return range ? { transactionDate: range } : {};
  }

  private dateRange(from?: string, to?: string): Prisma.FuelEntryWhereInput {
    const range = dateRangeFilter({ from, to });
    return range ? { transactionDate: range } : {};
  }

  /** Fill-ups can be back-dated but never dated in the future (India time). */
  private validDate(value: string): Date {
    return pastOrTodayDate(value);
  }

  private cursorArgs(limit: number, cursor?: string) {
    return { take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) };
  }

  private findBySubmission(companyId: string, clientSubmissionId: string) {
    return this.prisma.fuelEntry.findUnique({
      where: { companyId_clientSubmissionId: { companyId, clientSubmissionId } },
      select: { ...FUEL_VIEW, driverId: true },
    });
  }

  /** A replayed submission id must belong to the same driver, or it is refused. */
  private assertOwnReplay(entry: FuelRow & { driverId: string }, driverId: string): FuelRow {
    if (entry.driverId !== driverId) throw new ForbiddenException('That submission belongs to another driver.');
    const { driverId: _omit, ...rest } = entry;
    return rest;
  }

  private async labelsFor(companyId: string, by: FuelBreakdownQuery['by'], keys: string[]): Promise<Map<string, string>> {
    if (by === 'vehicle') {
      const vehicles = await this.prisma.vehicle.findMany({ where: { companyId, id: { in: keys } }, select: { id: true, registrationNumber: true } });
      return new Map(vehicles.map((v) => [v.id, v.registrationNumber]));
    }
    if (by === 'driver') {
      const drivers = await this.prisma.driver.findMany({
        where: { companyId, id: { in: keys } },
        select: { id: true, employee: { select: { fullName: true } } },
      });
      return new Map(drivers.map((d) => [d.id, d.employee.fullName]));
    }
    return new Map();
  }
}
