import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerDirection, LedgerEntryType, LedgerSourceType, Prisma, RecordStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { toIsoDate } from '../../common/dates/financial-year';
import { pastOrTodayDate } from '../../common/dates/request-dates';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { CreateManualLedgerEntryDto, UpdateManualLedgerEntryDto } from './dto/finance.dto';
import { LEDGER_VIEW, LedgerService, type DesiredPosting } from './ledger.service';

type Tx = Prisma.TransactionClient;

const INCOME_TYPES = new Set<LedgerEntryType>([LedgerEntryType.CUSTOMER_PAYMENT, LedgerEntryType.OTHER_INCOME]);

/** Income or expense follows from the type, so a hand entry can never be filed the wrong way round. */
export const directionFor = (type: LedgerEntryType): LedgerDirection => (INCOME_TYPES.has(type) ? LedgerDirection.INCOME : LedgerDirection.EXPENSE);

export const MANUAL_ENTRY_VIEW = {
  id: true,
  transactionDate: true,
  type: true,
  direction: true,
  amount: true,
  description: true,
  employeeId: true,
  vehicleId: true,
  paymentMethod: true,
  reference: true,
  remarks: true,
  status: true,
  archivedAt: true,
  archiveReason: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
  employee: { select: { id: true, fullName: true, employeeCode: true, driver: { select: { id: true } } } },
  vehicle: { select: { id: true, registrationNumber: true } },
} as const;

export type ManualEntryRow = Prisma.ManualLedgerEntryGetPayload<{ select: typeof MANUAL_ENTRY_VIEW }>;

/** The fields an audit record compares, as plain JSON. */
function snapshot(entry: ManualEntryRow) {
  return {
    transactionDate: toIsoDate(entry.transactionDate),
    type: entry.type,
    direction: entry.direction,
    amount: entry.amount.toFixed(2),
    description: entry.description,
    employeeId: entry.employeeId,
    vehicleId: entry.vehicleId,
    paymentMethod: entry.paymentMethod,
    reference: entry.reference,
    remarks: entry.remarks,
  };
}

function posting(entry: ManualEntryRow): DesiredPosting | null {
  if (entry.status !== RecordStatus.ACTIVE) return null;
  return {
    transactionDate: entry.transactionDate,
    type: entry.type,
    direction: entry.direction,
    amount: entry.amount,
    description: entry.description,
    employeeId: entry.employeeId,
    driverId: entry.employee?.driver?.id ?? null,
    vehicleId: entry.vehicleId,
  };
}

const trimOrNull = (value: string | null | undefined) => (value === null ? null : value?.trim() || null);

/**
 * Ledger entries the office keeps by hand. The entry is an ordinary editable record; the ledger
 * follows it append-only (LedgerService.syncSource), so every correction is a reversal plus a new
 * line, and archiving takes it out of the totals without erasing anything. Each change is audited
 * with its before and after values.
 */
@Injectable()
export class ManualLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateManualLedgerEntryDto): Promise<ManualEntryRow> {
    await this.assertParties(user.companyId, dto.employeeId, dto.vehicleId);
    const entry = await this.withLedger(user, (tx) =>
      tx.manualLedgerEntry.create({
        data: {
          companyId: user.companyId,
          transactionDate: pastOrTodayDate(dto.transactionDate),
          type: dto.type,
          direction: directionFor(dto.type),
          amount: dto.amount,
          description: dto.description.trim(),
          employeeId: dto.employeeId ?? null,
          vehicleId: dto.vehicleId ?? null,
          paymentMethod: dto.paymentMethod ?? null,
          reference: trimOrNull(dto.reference),
          remarks: trimOrNull(dto.remarks),
          createdById: user.id,
          updatedById: user.id,
        },
        select: MANUAL_ENTRY_VIEW,
      }),
    );
    await this.record(user, 'ledger.manual_created', entry, { after: snapshot(entry) });
    return entry;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateManualLedgerEntryDto): Promise<ManualEntryRow> {
    const before = await this.find(user.companyId, id);
    if (before.status === RecordStatus.ARCHIVED) throw new ConflictException('Restore this entry before editing it.');
    await this.assertParties(user.companyId, dto.employeeId ?? undefined, dto.vehicleId ?? undefined);

    const data: Prisma.ManualLedgerEntryUncheckedUpdateInput = {
      ...(dto.transactionDate !== undefined ? { transactionDate: pastOrTodayDate(dto.transactionDate) } : {}),
      ...(dto.type !== undefined ? { type: dto.type, direction: directionFor(dto.type) } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
      ...(dto.employeeId !== undefined ? { employeeId: dto.employeeId } : {}),
      ...(dto.vehicleId !== undefined ? { vehicleId: dto.vehicleId } : {}),
      ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod } : {}),
      ...(dto.reference !== undefined ? { reference: trimOrNull(dto.reference) } : {}),
      ...(dto.remarks !== undefined ? { remarks: trimOrNull(dto.remarks) } : {}),
    };

    const entry = await this.withLedger(user, (tx) =>
      tx.manualLedgerEntry.update({ where: { id: before.id }, data: { ...data, updatedById: user.id }, select: MANUAL_ENTRY_VIEW }),
    );

    // Only what actually changed is recorded, before and after.
    const was = snapshot(before);
    const now = snapshot(entry);
    const changed = (Object.keys(now) as (keyof typeof now)[]).filter((key) => was[key] !== now[key]);
    if (changed.length > 0) {
      await this.record(
        user,
        'ledger.manual_updated',
        entry,
        { before: Object.fromEntries(changed.map((k) => [k, was[k]])), after: Object.fromEntries(changed.map((k) => [k, now[k]])) },
        dto.reason?.trim() ? { reason: dto.reason.trim() } : undefined,
      );
    }
    return entry;
  }

  /** Takes the entry out of the ledger totals with a reversal line; the record and its history stay. */
  async archive(user: AuthenticatedUser, id: string, reason: string): Promise<ManualEntryRow> {
    const before = await this.find(user.companyId, id);
    if (before.status === RecordStatus.ARCHIVED) return before;
    const entry = await this.withLedger(user, (tx) =>
      tx.manualLedgerEntry.update({
        where: { id: before.id },
        data: { status: RecordStatus.ARCHIVED, archivedAt: new Date(), archiveReason: reason.trim(), updatedById: user.id },
        select: MANUAL_ENTRY_VIEW,
      }),
    );
    await this.record(user, 'ledger.manual_reversed', entry, { amount: entry.amount.toFixed(2) }, { reason: reason.trim() });
    return entry;
  }

  async restore(user: AuthenticatedUser, id: string): Promise<ManualEntryRow> {
    const before = await this.find(user.companyId, id);
    if (before.status === RecordStatus.ACTIVE) return before;
    const entry = await this.withLedger(user, (tx) =>
      tx.manualLedgerEntry.update({
        where: { id: before.id },
        data: { status: RecordStatus.ACTIVE, archivedAt: null, archiveReason: null, updatedById: user.id },
        select: MANUAL_ENTRY_VIEW,
      }),
    );
    await this.record(user, 'ledger.manual_restored', entry, { amount: entry.amount.toFixed(2) });
    return entry;
  }

  async find(companyId: string, id: string): Promise<ManualEntryRow> {
    const entry = await this.prisma.manualLedgerEntry.findFirst({ where: { id, companyId }, select: MANUAL_ENTRY_VIEW });
    if (!entry) throw new NotFoundException('Ledger entry not found.');
    return entry;
  }

  /** The entry, every ledger line it has produced, and who changed what, oldest first. */
  async detail(companyId: string, id: string) {
    const entry = await this.find(companyId, id);
    const [lines, audit] = await Promise.all([
      this.prisma.financeLedgerEntry.findMany({
        where: { companyId, sourceType: LedgerSourceType.MANUAL, sourceId: id },
        select: LEDGER_VIEW,
        orderBy: { sequence: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: { companyId, entityType: 'ManualLedgerEntry', entityId: id },
        orderBy: { occurredAt: 'asc' },
        select: { id: true, action: true, occurredAt: true, actorUserId: true, actorRole: true, changes: true, metadata: true },
      }),
    ]);
    const actorIds = [...new Set(audit.map((a) => a.actorUserId).filter((v): v is string => Boolean(v)))];
    const actors = await this.prisma.user.findMany({
      where: { companyId, id: { in: actorIds } },
      select: { id: true, email: true, phone: true, employee: { select: { fullName: true } } },
    });
    const name = new Map(actors.map((u) => [u.id, u.employee?.fullName ?? u.email ?? u.phone ?? 'Unknown']));
    return {
      entry,
      lines,
      history: audit.map((a) => ({ ...a, actorName: a.actorUserId ? (name.get(a.actorUserId) ?? 'Unknown') : null })),
    };
  }

  /** Current hand-entry details for ledger lines that came from hand entries, in one query. */
  async forLines(companyId: string, sourceIds: string[]) {
    if (sourceIds.length === 0) return new Map<string, Pick<ManualEntryRow, 'id' | 'status' | 'description' | 'paymentMethod' | 'reference' | 'remarks'>>();
    const rows = await this.prisma.manualLedgerEntry.findMany({
      where: { companyId, id: { in: sourceIds } },
      select: { id: true, status: true, description: true, paymentMethod: true, reference: true, remarks: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  /** The row change and the ledger change happen together or not at all. */
  private withLedger(user: AuthenticatedUser, change: (tx: Tx) => Promise<ManualEntryRow>): Promise<ManualEntryRow> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await change(tx);
      await this.ledger.syncSource(tx, { companyId: user.companyId, sourceType: LedgerSourceType.MANUAL, sourceId: entry.id, actorId: user.id }, posting(entry));
      return entry;
    });
  }

  private async assertParties(companyId: string, employeeId?: string, vehicleId?: string): Promise<void> {
    const [employee, vehicle] = await Promise.all([
      employeeId ? this.prisma.employee.findFirst({ where: { id: employeeId, companyId, deletedAt: null }, select: { id: true } }) : Promise.resolve(true),
      vehicleId ? this.prisma.vehicle.findFirst({ where: { id: vehicleId, companyId, deletedAt: null }, select: { id: true } }) : Promise.resolve(true),
    ]);
    if (!employee) throw new BadRequestException({ message: 'Employee not found.', details: [{ field: 'employeeId', messages: ['Employee not found.'] }] });
    if (!vehicle) throw new BadRequestException({ message: 'Vehicle not found.', details: [{ field: 'vehicleId', messages: ['Vehicle not found.'] }] });
  }

  private record(user: AuthenticatedUser, action: string, entry: ManualEntryRow, changes: Prisma.InputJsonValue, metadata?: Prisma.InputJsonValue) {
    return this.audit.record({
      action,
      entityType: 'ManualLedgerEntry',
      entityId: entry.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes,
      metadata,
    });
  }
}
