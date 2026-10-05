import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentOwnerType, DocumentState, DocumentType, DocumentVerificationStatus, LedgerSourceType, OperationCategory, Prisma, RecordStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { toPage, type Page } from '../../common/pagination/pagination';
import { toIsoDate } from '../../common/dates/financial-year';
import { businessDate, dateRangeFilter, pastOrTodayDate } from '../../common/dates/request-dates';
import { requireDriverScope } from '../auth/access-scope';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { FilesService } from '../files/files.service';
import { DocumentsService } from '../documents/documents.service';
import { LedgerService } from '../finance/ledger.service';
import { expensePosting } from '../finance/ledger-postings';
import { ReceiptJobService } from '../ai/receipts/receipt-job.service';
import type {
  ArchiveOperationDto, CreateOfficeOperationDto, CreateOfficeTyreInsuranceDto, CreateOperationDto,
  CreateTyreInsuranceDto, MyOperationsQuery, OperationBreakdownQuery, OperationFilterQuery, UpdateOperationDto,
} from './dto/operation.dto';

export const OPERATION_VIEW = {
  id: true,
  category: true,
  amount: true,
  expenseDate: true,
  vendorName: true,
  description: true,
  receiptFileId: true,
  status: true,
  archivedAt: true,
  archiveReason: true,
  clientSubmissionId: true,
  createdAt: true,
  updatedAt: true,
  vehicle: { select: { id: true, registrationNumber: true } },
  driver: { select: { id: true, driverCode: true, employee: { select: { fullName: true } } } },
} as const;

export type OperationRow = Prisma.VehicleExpenseGetPayload<{ select: typeof OPERATION_VIEW }>;

export const TYRE_INSURANCE_VIEW = {
  id: true,
  issuer: true,
  documentNumber: true,
  amount: true,
  issueDate: true,
  expiryDate: true,
  fileId: true,
  verificationStatus: true,
  clientSubmissionId: true,
  createdAt: true,
  vehicle: { select: { id: true, registrationNumber: true } },
} as const;

export type TyreInsuranceRow = Prisma.DocumentGetPayload<{ select: typeof TYRE_INSURANCE_VIEW }>;

const OPERATION_ORDER: Prisma.VehicleExpenseOrderByWithRelationInput[] = [{ expenseDate: 'desc' }, { id: 'desc' }];

const money = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(2);

/**
 * Daily operations other than fuel: RTO, tyre and maintenance/service expenses, plus tyre
 * insurance policies. Like fuel, a driver's entries are tied to their current vehicle by the
 * server, and every create is idempotent on the device's submission id.
 *
 * A service receipt is stored as an untouched original and queued for Service AI reading; the
 * reading never changes the record by itself (see ai/receipts). Nothing here calls a model.
 */
@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly documents: DocumentsService,
    private readonly ledger: LedgerService,
    private readonly receiptJobs: ReceiptJobService,
  ) {}

  /** Runs a write and brings the ledger into line with its result, atomically. */
  private withLedger(user: AuthenticatedUser, write: (tx: Prisma.TransactionClient) => Promise<OperationRow>): Promise<OperationRow> {
    return this.prisma.$transaction(async (tx) => {
      const row = await write(tx);
      await this.ledger.syncSource(tx, { companyId: user.companyId, sourceType: LedgerSourceType.VEHICLE_EXPENSE, sourceId: row.id, actorId: user.id }, expensePosting(row));
      return row;
    });
  }

  // ───────────────────────────── Driver ─────────────────────────────

  async createForDriver(user: AuthenticatedUser, dto: CreateOperationDto): Promise<{ record: OperationRow; created: boolean }> {
    const { driverId } = requireDriverScope(user);

    if (dto.clientSubmissionId) {
      const replay = await this.findExpenseBySubmission(user.companyId, dto.clientSubmissionId);
      if (replay) return { record: this.assertOwnExpense(replay, driverId), created: false };
    }

    const vehicleId = await this.assignedVehicle(user.companyId, driverId);
    if (dto.receiptFileId) await this.files.assertUsable(user.companyId, dto.receiptFileId, user.id);

    return this.createExpense(user, { ...dto, vehicleId, driverId });
  }

  async listForDriver(user: AuthenticatedUser, query: MyOperationsQuery): Promise<Page<OperationRow> & { total: string }> {
    const { driverId } = requireDriverScope(user);
    const range = dateRangeFilter(query);
    const where: Prisma.VehicleExpenseWhereInput = {
      companyId: user.companyId,
      driverId,
      status: RecordStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
      ...(range ? { expenseDate: range } : {}),
    };
    const [rows, aggregate] = await Promise.all([
      this.prisma.vehicleExpense.findMany({ where, select: OPERATION_VIEW, orderBy: OPERATION_ORDER, ...this.cursorArgs(query.limit, query.cursor) }),
      this.prisma.vehicleExpense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return { ...toPage(rows, query.limit), total: money(aggregate._sum.amount) };
  }

  async createTyreInsuranceForDriver(user: AuthenticatedUser, dto: CreateTyreInsuranceDto): Promise<{ record: TyreInsuranceRow; created: boolean }> {
    const { driverId } = requireDriverScope(user);

    if (dto.clientSubmissionId) {
      const replay = await this.findPolicyBySubmission(user.companyId, dto.clientSubmissionId);
      if (replay) {
        if (replay.createdById !== user.id) throw new ForbiddenException('That submission belongs to someone else.');
        const { createdById: _omit, ...rest } = replay;
        return { record: rest, created: false };
      }
    }

    const vehicleId = await this.assignedVehicle(user.companyId, driverId);
    if (dto.receiptFileId) await this.files.assertUsable(user.companyId, dto.receiptFileId, user.id);
    return this.createPolicy(user, { ...dto, vehicleId });
  }

  // ───────────────────────────── Office ─────────────────────────────

  async createForOffice(user: AuthenticatedUser, dto: CreateOfficeOperationDto): Promise<{ record: OperationRow; created: boolean }> {
    if (dto.clientSubmissionId) {
      const replay = await this.findExpenseBySubmission(user.companyId, dto.clientSubmissionId);
      if (replay) {
        const { driverId: _omit, ...rest } = replay;
        return { record: rest, created: false };
      }
    }
    await this.assertVehicle(user.companyId, dto.vehicleId);
    if (dto.driverId) await this.assertDriver(user.companyId, dto.driverId);
    if (dto.receiptFileId) await this.files.assertUsable(user.companyId, dto.receiptFileId);
    return this.createExpense(user, { ...dto, driverId: dto.driverId ?? null });
  }

  async createTyreInsuranceForOffice(user: AuthenticatedUser, dto: CreateOfficeTyreInsuranceDto): Promise<{ record: TyreInsuranceRow; created: boolean }> {
    await this.assertVehicle(user.companyId, dto.vehicleId);
    if (dto.receiptFileId) await this.files.assertUsable(user.companyId, dto.receiptFileId);
    return this.createPolicy(user, dto);
  }

  async list(companyId: string, query: OperationFilterQuery): Promise<Page<OperationRow> & { total: string; count: number }> {
    const where = this.buildWhere(companyId, query);
    const [rows, aggregate] = await Promise.all([
      this.prisma.vehicleExpense.findMany({ where, select: OPERATION_VIEW, orderBy: OPERATION_ORDER, ...this.cursorArgs(query.limit, query.cursor) }),
      this.prisma.vehicleExpense.aggregate({ where, _count: true, _sum: { amount: true } }),
    ]);
    return { ...toPage(rows, query.limit), total: money(aggregate._sum.amount), count: aggregate._count };
  }

  async findById(companyId: string, id: string): Promise<OperationRow> {
    const record = await this.prisma.vehicleExpense.findFirst({ where: { id, companyId }, select: OPERATION_VIEW });
    if (!record) throw new NotFoundException('Record not found.');
    return record;
  }

  /** Total spend per vehicle or per category for the filtered range. */
  async breakdown(companyId: string, query: OperationBreakdownQuery) {
    const where = this.buildWhere(companyId, query);
    const field = query.by === 'vehicle' ? 'vehicleId' : 'category';
    const grouped = await this.prisma.vehicleExpense.groupBy({
      by: [field],
      where,
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 500,
    });

    const labels =
      query.by === 'vehicle'
        ? new Map(
            (
              await this.prisma.vehicle.findMany({
                where: { companyId, id: { in: grouped.map((row) => String(row[field])) } },
                select: { id: true, registrationNumber: true },
              })
            ).map((v) => [v.id, v.registrationNumber]),
          )
        : new Map<string, string>();

    return grouped.map((row) => ({
      key: String(row[field]),
      label: labels.get(String(row[field])) ?? String(row[field]),
      entries: row._count._all,
      amount: money(row._sum.amount),
    }));
  }

  async listTyreInsurance(companyId: string, vehicleId?: string): Promise<TyreInsuranceRow[]> {
    return this.prisma.document.findMany({
      where: { companyId, type: DocumentType.TYRE_INSURANCE, state: DocumentState.CURRENT, deletedAt: null, ...(vehicleId ? { vehicleId } : {}) },
      select: TYRE_INSURANCE_VIEW,
      orderBy: [{ expiryDate: 'desc' }, { id: 'desc' }],
      take: 200,
    });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateOperationDto): Promise<OperationRow> {
    const before = await this.findById(user.companyId, id);
    if (before.status === RecordStatus.ARCHIVED) throw new ConflictException('Restore this record before editing it.');
    if (dto.receiptFileId) await this.files.assertUsable(user.companyId, dto.receiptFileId);

    const record = await this.withLedger(user, (tx) => tx.vehicleExpense.update({
      where: { id: before.id },
      data: {
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.expenseDate !== undefined ? { expenseDate: pastOrTodayDate(dto.expenseDate) } : {}),
        ...(dto.vendorName !== undefined ? { vendorName: dto.vendorName.trim() || null } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.receiptFileId !== undefined ? { receiptFileId: dto.receiptFileId } : {}),
        updatedById: user.id,
      },
      select: OPERATION_VIEW,
    }));

    // A receipt newly attached to a service record is read like one a driver uploaded.
    if (dto.receiptFileId && dto.receiptFileId !== before.receiptFileId) {
      await this.queueReceiptAI(user, record.id, { category: record.category, receiptFileId: dto.receiptFileId });
    }

    await this.audit.record({
      action: 'operation.updated',
      entityType: 'VehicleExpense',
      entityId: record.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: {
        category: record.category,
        before: { amount: before.amount.toFixed(2), expenseDate: toIsoDate(before.expenseDate) },
        after: { amount: record.amount.toFixed(2), expenseDate: toIsoDate(record.expenseDate) },
      },
    });
    return record;
  }

  async archive(user: AuthenticatedUser, id: string, dto: ArchiveOperationDto): Promise<OperationRow> {
    const before = await this.findById(user.companyId, id);
    if (before.status === RecordStatus.ARCHIVED) return before;
    const record = await this.withLedger(user, (tx) => tx.vehicleExpense.update({
      where: { id: before.id },
      data: { status: RecordStatus.ARCHIVED, archivedAt: new Date(), archiveReason: dto.reason.trim(), updatedById: user.id },
      select: OPERATION_VIEW,
    }));
    await this.audit.record({
      action: 'operation.archived',
      entityType: 'VehicleExpense',
      entityId: record.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { category: record.category, amount: record.amount.toFixed(2) },
      metadata: { reason: dto.reason.trim() },
    });
    return record;
  }

  async restore(user: AuthenticatedUser, id: string): Promise<OperationRow> {
    const before = await this.findById(user.companyId, id);
    if (before.status === RecordStatus.ACTIVE) return before;
    const record = await this.withLedger(user, (tx) => tx.vehicleExpense.update({
      where: { id: before.id },
      data: { status: RecordStatus.ACTIVE, archivedAt: null, archiveReason: null, updatedById: user.id },
      select: OPERATION_VIEW,
    }));
    await this.audit.record({
      action: 'operation.restored',
      entityType: 'VehicleExpense',
      entityId: record.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
    });
    return record;
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  /**
   * Queues AI reading of a newly attached service receipt.
   *
   * Only maintenance records: an RTO challan or a tyre purchase has no service data to extract.
   * Deliberately best-effort — if the queue write fails the expense is still saved and the
   * original receipt is still stored, and the office can ask for processing from the review
   * screen. Losing the AI read is an inconvenience; losing the driver's expense is not
   * acceptable, so the two are not tied together.
   */
  private async queueReceiptAI(
    user: AuthenticatedUser,
    vehicleExpenseId: string,
    input: { category: OperationCategory; receiptFileId?: string | null },
  ): Promise<void> {
    if (input.category !== OperationCategory.MAINTENANCE || !input.receiptFileId) return;

    try {
      const queued = await this.receiptJobs.enqueue({
        companyId: user.companyId,
        vehicleExpenseId,
        receiptFileId: input.receiptFileId,
        requestedById: user.id,
      });
      await this.audit.record({
        action: 'service_receipt.uploaded',
        entityType: 'VehicleExpense',
        entityId: vehicleExpenseId,
        companyId: user.companyId,
        actorUserId: user.id,
        actorRole: user.role,
        changes: { receiptFileId: input.receiptFileId, jobId: queued.jobId || null, queued: queued.queued, reason: queued.reason ?? null },
      });
    } catch (error) {
      this.logger.warn(
        `Could not queue AI reading for service record ${vehicleExpenseId}; the receipt is stored and can be processed from review. ` +
          `${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  private async createExpense(
    user: AuthenticatedUser,
    input: CreateOperationDto & { vehicleId: string; driverId: string | null },
  ): Promise<{ record: OperationRow; created: boolean }> {
    try {
      const record = await this.withLedger(user, (tx) => tx.vehicleExpense.create({
        data: {
          companyId: user.companyId,
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          category: input.category,
          amount: input.amount,
          expenseDate: pastOrTodayDate(input.expenseDate),
          vendorName: input.vendorName?.trim() || null,
          description: input.description?.trim() || null,
          receiptFileId: input.receiptFileId ?? null,
          clientSubmissionId: input.clientSubmissionId ?? null,
          createdById: user.id,
          updatedById: user.id,
        },
        select: OPERATION_VIEW,
      }));

      await this.audit.record({
        action: 'operation.created',
        entityType: 'VehicleExpense',
        entityId: record.id,
        companyId: user.companyId,
        actorUserId: user.id,
        actorRole: user.role,
        changes: { category: record.category, amount: record.amount.toFixed(2), vehicleId: record.vehicle.id },
      });

      // A service receipt is queued for reading — after the record exists, and without waiting
      // for it. The driver's upload returns as soon as the file is safely stored; a model call
      // taking a minute must never be something they sit through on a garage forecourt (§15).
      await this.queueReceiptAI(user, record.id, input);

      return { record, created: true };
    } catch (error) {
      if (input.clientSubmissionId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findExpenseBySubmission(user.companyId, input.clientSubmissionId);
        if (replay) {
          const { driverId: _omit, ...rest } = replay;
          return { record: rest, created: false };
        }
      }
      throw error;
    }
  }

  /**
   * Tyre insurance is a policy document, stored through the central documents module so a new
   * policy supersedes the previous one (kept as history) instead of adding a duplicate.
   */
  private async createPolicy(
    user: AuthenticatedUser,
    input: CreateTyreInsuranceDto & { vehicleId: string },
  ): Promise<{ record: TyreInsuranceRow; created: boolean }> {
    const expiryDate = businessDate(input.expiryDate);
    const issueDate = input.startDate ? businessDate(input.startDate) : null;
    if (issueDate && issueDate > expiryDate) throw new BadRequestException('The start date must be on or before the expiry date.');

    const { document, created } = await this.documents.upload(
      user,
      { type: DocumentType.TYRE_INSURANCE, ownerType: DocumentOwnerType.VEHICLE, vehicleId: input.vehicleId, employeeId: null },
      {
        issuer: input.insurer,
        documentNumber: input.policyNumber,
        amount: input.premium,
        issueDate: input.startDate,
        expiryDate: input.expiryDate,
        fileId: input.receiptFileId,
        clientSubmissionId: input.clientSubmissionId,
      },
      user.role === UserRole.DRIVER ? DocumentVerificationStatus.PENDING : DocumentVerificationStatus.VERIFIED,
    );
    const record = await this.prisma.document.findUniqueOrThrow({ where: { id: document.id }, select: TYRE_INSURANCE_VIEW });
    return { record, created };
  }

  private buildWhere(companyId: string, query: OperationFilterQuery): Prisma.VehicleExpenseWhereInput {
    const range = dateRangeFilter(query);
    return {
      companyId,
      status: query.status ?? RecordStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(range ? { expenseDate: range } : {}),
    };
  }

  private async assignedVehicle(companyId: string, driverId: string): Promise<string> {
    const driver = await this.prisma.driver.findFirst({
      where: { id: driverId, companyId, deletedAt: null },
      select: { currentAssignment: { select: { vehicleId: true } } },
    });
    if (!driver?.currentAssignment) {
      throw new BadRequestException('No vehicle is assigned to you. Ask the office to assign one first.');
    }
    return driver.currentAssignment.vehicleId;
  }

  private async assertVehicle(companyId: string, vehicleId: string): Promise<void> {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, companyId, deletedAt: null }, select: { id: true } });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
  }

  private async assertDriver(companyId: string, driverId: string): Promise<void> {
    const driver = await this.prisma.driver.findFirst({ where: { id: driverId, companyId, deletedAt: null }, select: { id: true } });
    if (!driver) throw new NotFoundException('Driver not found.');
  }

  private cursorArgs(limit: number, cursor?: string) {
    return { take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) };
  }

  private findExpenseBySubmission(companyId: string, clientSubmissionId: string) {
    return this.prisma.vehicleExpense.findUnique({
      where: { companyId_clientSubmissionId: { companyId, clientSubmissionId } },
      select: { ...OPERATION_VIEW, driverId: true },
    });
  }

  private findPolicyBySubmission(companyId: string, clientSubmissionId: string) {
    return this.prisma.document.findUnique({
      where: { companyId_clientSubmissionId: { companyId, clientSubmissionId } },
      select: { ...TYRE_INSURANCE_VIEW, createdById: true },
    });
  }

  private assertOwnExpense(record: OperationRow & { driverId: string | null }, driverId: string): OperationRow {
    if (record.driverId !== driverId) throw new ForbiddenException('That submission belongs to another driver.');
    const { driverId: _omit, ...rest } = record;
    return rest;
  }
}

