import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DocumentOwnerType, DocumentState, DocumentType, DocumentVerificationStatus, LedgerSourceType, Prisma, UserRole, VehicleStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { toPage, type Page } from '../../common/pagination/pagination';
import { todayInIndia, toIsoDate } from '../../common/dates/financial-year';
import { businessDate } from '../../common/dates/request-dates';
import { requireDriverScope } from '../auth/access-scope';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { assessExpiry, expiryWindow, type ComplianceStatus } from '../compliance/document-expiry.policy';
import { LedgerService } from '../finance/ledger.service';
import { premiumPosting } from '../finance/ledger-postings';
import type { CreateDocumentDto, CreateMyDocumentDto, DocumentDetailsDto, ListDocumentsQuery } from './dto/list-documents.dto';

/** Documents that belong to a vehicle. */
export const VEHICLE_DOCUMENT_TYPES: DocumentType[] = [
  DocumentType.RC, DocumentType.INSURANCE, DocumentType.PUC, DocumentType.TYRE_INSURANCE, DocumentType.FITNESS, DocumentType.PERMIT,
];
/** Documents that belong to a person. */
export const PERSON_DOCUMENT_TYPES: DocumentType[] = [DocumentType.DRIVING_LICENCE];

/**
 * Documents each vehicle / driver is expected to have. A missing one is NOT_UPLOADED, which the
 * compliance overview reports separately from EXPIRED. Kept as data so the list can change.
 */
export const REQUIRED_VEHICLE_DOCUMENTS = VEHICLE_DOCUMENT_TYPES;
export const REQUIRED_DRIVER_DOCUMENTS = PERSON_DOCUMENT_TYPES;
/** What a driver sees for their vehicle, per the approved driver screen. */
export const DRIVER_VISIBLE_VEHICLE_DOCUMENTS: DocumentType[] = [DocumentType.RC, DocumentType.INSURANCE, DocumentType.PUC, DocumentType.TYRE_INSURANCE];

export const DOCUMENT_VIEW = {
  id: true,
  type: true,
  customName: true,
  ownerType: true,
  vehicleId: true,
  employeeId: true,
  documentNumber: true,
  issuer: true,
  issueDate: true,
  expiryDate: true,
  amount: true,
  fileId: true,
  state: true,
  verificationStatus: true,
  verifiedAt: true,
  verifiedById: true,
  rejectionReason: true,
  supersededAt: true,
  archivedAt: true,
  archiveReason: true,
  notes: true,
  createdAt: true,
  createdById: true,
  vehicle: { select: { id: true, registrationNumber: true } },
  employee: { select: { id: true, fullName: true, driver: { select: { id: true, driverCode: true } } } },
  file: { select: { id: true, originalFilename: true, mimeType: true, sizeBytes: true, createdAt: true } },
} as const;

export type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_VIEW }>;

export interface ComplianceItem {
  type: DocumentType;
  status: ComplianceStatus;
  daysRemaining: number | null;
  document: DocumentRow | null;
}

const ORDER: Prisma.DocumentOrderByWithRelationInput[] = [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }];

const dateOrNull = (value?: string) => (value ? businessDate(value) : null);

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  // ───────────────────────────── Reading ─────────────────────────────

  /** Office list and driver-scoped list. Filters narrow; a driver can never widen their scope. */
  async list(user: AuthenticatedUser, query: ListDocumentsQuery): Promise<Page<DocumentRow>> {
    const today = todayInIndia();
    const employeeId = query.employeeId ?? (query.driverId ? await this.employeeOfDriver(user.companyId, query.driverId) : undefined);

    const where: Prisma.DocumentWhereInput = {
      companyId: user.companyId,
      deletedAt: null,
      state: query.state ?? DocumentState.CURRENT,
      ...(query.type ? { type: query.type } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(employeeId ? { employeeId } : {}),
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
      ...(query.status ? (expiryWindow(query.status, today) as Prisma.DocumentWhereInput) : {}),
      ...(query.expiryFrom || query.expiryTo
        ? { AND: [{ expiryDate: { ...(query.expiryFrom ? { gte: businessDate(query.expiryFrom) } : {}), ...(query.expiryTo ? { lte: businessDate(query.expiryTo) } : {}) } }] }
        : {}),
      ...(user.role === UserRole.DRIVER ? await this.driverVisibility(user) : {}),
    };

    const rows = await this.prisma.document.findMany({
      where,
      select: DOCUMENT_VIEW,
      orderBy: ORDER,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, query.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<DocumentRow> {
    const document = await this.prisma.document.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null, ...(user.role === UserRole.DRIVER ? await this.driverVisibility(user) : {}) },
      select: DOCUMENT_VIEW,
    });
    if (!document) throw new NotFoundException('Document not found.');
    return document;
  }

  /** Earlier versions of a document, newest first, with the file each one held. */
  async history(user: AuthenticatedUser, id: string): Promise<DocumentRow[]> {
    const start = await this.findById(user, id);
    const versions: DocumentRow[] = [];
    let cursorId: string | null = start.id;
    // A chain longer than this would mean decades of weekly replacements; stop defensively.
    for (let depth = 0; depth < 50 && cursorId; depth += 1) {
      const previous: DocumentRow | null = await this.prisma.document.findFirst({
        where: { supersededById: cursorId, companyId: user.companyId },
        select: DOCUMENT_VIEW,
      });
      if (!previous) break;
      versions.push(previous);
      cursorId = previous.id;
    }
    return versions;
  }

  /** Name of the person who uploaded, for the detail screen. */
  async uploaderName(companyId: string, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { email: true, phone: true, employee: { select: { fullName: true } } },
    });
    return user?.employee?.fullName ?? user?.email ?? user?.phone ?? null;
  }

  /** Required documents for one vehicle, with NOT_UPLOADED for anything missing. */
  async vehicleCompliance(companyId: string, vehicleId: string, types = REQUIRED_VEHICLE_DOCUMENTS): Promise<ComplianceItem[]> {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, companyId, deletedAt: null }, select: { id: true } });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    const current = await this.prisma.document.findMany({
      where: { companyId, vehicleId, state: DocumentState.CURRENT, deletedAt: null, type: { in: types } },
      select: DOCUMENT_VIEW,
    });
    return this.matrix(types, current);
  }

  /** Required documents for one person (e.g. the driving licence). */
  async personCompliance(companyId: string, employeeId: string, types = REQUIRED_DRIVER_DOCUMENTS): Promise<ComplianceItem[]> {
    const current = await this.prisma.document.findMany({
      where: { companyId, employeeId, state: DocumentState.CURRENT, deletedAt: null, type: { in: types } },
      select: DOCUMENT_VIEW,
    });
    return this.matrix(types, current);
  }

  /** The driver's own view: their assigned vehicle's documents and their own licence. */
  async mine(user: AuthenticatedUser) {
    const { driverId, employeeId } = requireDriverScope(user);
    const vehicle = await this.assignedVehicle(user.companyId, driverId);
    return {
      vehicle: vehicle
        ? { id: vehicle.id, registrationNumber: vehicle.registrationNumber, documents: await this.vehicleCompliance(user.companyId, vehicle.id, DRIVER_VISIBLE_VEHICLE_DOCUMENTS) }
        : null,
      personal: await this.personCompliance(user.companyId, employeeId),
    };
  }

  /**
   * Company-wide compliance overview per document type. Counts come from indexed date-window
   * queries, not by loading documents, so this stays fast with years of history.
   */
  async summary(companyId: string) {
    const today = todayInIndia();
    const base: Prisma.DocumentWhereInput = { companyId, state: DocumentState.CURRENT, deletedAt: null };
    const count = (where: Prisma.DocumentWhereInput) =>
      this.prisma.document.groupBy({ by: ['type'], where: { ...base, ...where }, _count: { _all: true } });

    const activeVehicle: Prisma.DocumentWhereInput = { vehicle: { deletedAt: null, status: { not: VehicleStatus.RETIRED } } };
    const activeDriver: Prisma.DocumentWhereInput = { employee: { deletedAt: null, driver: { deletedAt: null } } };

    const [expired, within7, expiringSoon, valid, pending, vehicleDocs, driverDocs, activeVehicles, activeDrivers] = await Promise.all([
      count(expiryWindow('EXPIRED', today) as Prisma.DocumentWhereInput),
      count(expiryWindow('WITHIN_7_DAYS', today) as Prisma.DocumentWhereInput),
      count(expiryWindow('EXPIRING_SOON', today) as Prisma.DocumentWhereInput),
      count(expiryWindow('VALID', today) as Prisma.DocumentWhereInput),
      count({ verificationStatus: DocumentVerificationStatus.PENDING }),
      count({ type: { in: REQUIRED_VEHICLE_DOCUMENTS }, ...activeVehicle }),
      count({ type: { in: REQUIRED_DRIVER_DOCUMENTS }, ...activeDriver }),
      this.prisma.vehicle.count({ where: { companyId, deletedAt: null, status: { not: VehicleStatus.RETIRED } } }),
      this.prisma.driver.count({ where: { companyId, deletedAt: null } }),
    ]);

    const of = (rows: { type: DocumentType; _count: { _all: number } }[], type: DocumentType) =>
      rows.find((row) => row.type === type)?._count._all ?? 0;

    return Object.values(DocumentType).map((type) => {
      const required = REQUIRED_VEHICLE_DOCUMENTS.includes(type) ? activeVehicles : REQUIRED_DRIVER_DOCUMENTS.includes(type) ? activeDrivers : null;
      const held = REQUIRED_VEHICLE_DOCUMENTS.includes(type) ? of(vehicleDocs, type) : of(driverDocs, type);
      return {
        type,
        expired: of(expired, type),
        within7Days: of(within7, type),
        expiringSoon: of(expiringSoon, type),
        valid: of(valid, type),
        pendingVerification: of(pending, type),
        // Only for required types; "Other" has no expectation, so nothing can be missing.
        notUploaded: required === null ? null : Math.max(0, required - held),
      };
    });
  }

  // ───────────────────────────── Writing ─────────────────────────────

  /** Office upload for any company vehicle or person. Replaces the current one of that type. */
  async createForOffice(user: AuthenticatedUser, dto: CreateDocumentDto): Promise<{ document: DocumentRow; created: boolean }> {
    const owner = await this.resolveOfficeOwner(user.companyId, dto);
    return this.upload(user, { ...owner, type: dto.type }, dto, DocumentVerificationStatus.VERIFIED);
  }

  /**
   * Driver upload. The owner comes from the session: vehicle documents go on the assigned
   * vehicle, a licence goes on the driver. Uploads await office verification — a driver can
   * never mark their own document verified.
   */
  async createForDriver(user: AuthenticatedUser, dto: CreateMyDocumentDto): Promise<{ document: DocumentRow; created: boolean }> {
    const { driverId, employeeId } = requireDriverScope(user);
    if (dto.type === DocumentType.OTHER) throw new BadRequestException('Ask the office to add other documents.');

    if (PERSON_DOCUMENT_TYPES.includes(dto.type)) {
      return this.upload(user, { type: dto.type, ownerType: DocumentOwnerType.EMPLOYEE, vehicleId: null, employeeId }, dto, DocumentVerificationStatus.PENDING);
    }
    const vehicle = await this.assignedVehicle(user.companyId, driverId);
    if (!vehicle) throw new BadRequestException('No vehicle is assigned to you. Ask the office to assign one first.');
    return this.upload(user, { type: dto.type, ownerType: DocumentOwnerType.VEHICLE, vehicleId: vehicle.id, employeeId: null }, dto, DocumentVerificationStatus.PENDING);
  }

  /** Replaces a document with a new version for the same owner and type. */
  async replace(user: AuthenticatedUser, id: string, dto: DocumentDetailsDto): Promise<{ document: DocumentRow; created: boolean }> {
    const existing = await this.findById(user, id);
    if (existing.state !== DocumentState.CURRENT) throw new ConflictException('Only the current version can be replaced.');
    const status = user.role === UserRole.DRIVER ? DocumentVerificationStatus.PENDING : DocumentVerificationStatus.VERIFIED;
    return this.upload(
      user,
      { type: existing.type, ownerType: existing.ownerType, vehicleId: existing.vehicleId, employeeId: existing.employeeId },
      dto,
      status,
    );
  }

  async verify(user: AuthenticatedUser, id: string): Promise<DocumentRow> {
    const existing = await this.currentForOffice(user, id);
    const document = await this.prisma.document.update({
      where: { id: existing.id },
      data: { verificationStatus: DocumentVerificationStatus.VERIFIED, verifiedAt: new Date(), verifiedById: user.id, rejectionReason: null, updatedById: user.id },
      select: DOCUMENT_VIEW,
    });
    await this.record(user, 'document.verified', document, { from: existing.verificationStatus });
    return document;
  }

  async reject(user: AuthenticatedUser, id: string, reason: string): Promise<DocumentRow> {
    const existing = await this.currentForOffice(user, id);
    const document = await this.prisma.document.update({
      where: { id: existing.id },
      data: { verificationStatus: DocumentVerificationStatus.REJECTED, verifiedAt: new Date(), verifiedById: user.id, rejectionReason: reason.trim(), updatedById: user.id },
      select: DOCUMENT_VIEW,
    });
    await this.record(user, 'document.rejected', document, { from: existing.verificationStatus, reason: reason.trim() });
    return document;
  }

  /** Archives the current version. The record and its file stay; the requirement shows as missing. */
  async archive(user: AuthenticatedUser, id: string, reason: string): Promise<DocumentRow> {
    const existing = await this.currentForOffice(user, id);
    const document = await this.prisma.$transaction(async (tx) => {
      const archived = await tx.document.update({
        where: { id: existing.id },
        data: { state: DocumentState.ARCHIVED, archivedAt: new Date(), archiveReason: reason.trim(), updatedById: user.id },
        select: DOCUMENT_VIEW,
      });
      if (archived.type === DocumentType.TYRE_INSURANCE) {
        await this.ledger.syncSource(tx, { companyId: user.companyId, sourceType: LedgerSourceType.DOCUMENT, sourceId: archived.id, actorId: user.id }, null);
      }
      return archived;
    });
    await this.record(user, 'document.archived', document, { reason: reason.trim() });
    return document;
  }

  /**
   * Stores a new CURRENT document, superseding the previous one of the same type for the same
   * owner in one transaction. The previous record keeps its file and becomes history.
   */
  async upload(
    user: AuthenticatedUser,
    owner: { type: DocumentType; ownerType: DocumentOwnerType; vehicleId: string | null; employeeId: string | null },
    details: Omit<DocumentDetailsDto, 'fileId'> & { fileId?: string },
    verificationStatus: DocumentVerificationStatus,
  ): Promise<{ document: DocumentRow; created: boolean }> {
    if (details.clientSubmissionId) {
      const replay = await this.findReplay(user, details.clientSubmissionId);
      if (replay) return { document: replay, created: false };
    }

    if (details.fileId) await this.assertFileUsable(user, details.fileId);
    const issueDate = dateOrNull(details.issueDate);
    const expiryDate = dateOrNull(details.expiryDate);
    if (issueDate && expiryDate && issueDate > expiryDate) throw new BadRequestException('The issue date must be on or before the expiry date.');
    const isVerified = verificationStatus === DocumentVerificationStatus.VERIFIED;

    let saved: { document: DocumentRow; previous: { id: string; fileId: string | null; expiryDate: Date | null } | null };
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        // "Other" documents coexist; every other type has exactly one current version per owner.
        const previousDoc =
          owner.type === DocumentType.OTHER
            ? null
            : await tx.document.findFirst({
                where: {
                  companyId: user.companyId,
                  type: owner.type,
                  state: DocumentState.CURRENT,
                  deletedAt: null,
                  ...(owner.vehicleId ? { vehicleId: owner.vehicleId } : { employeeId: owner.employeeId }),
                },
                select: { id: true, fileId: true, expiryDate: true },
              });

        const now = new Date();
        if (previousDoc) {
          await tx.document.update({ where: { id: previousDoc.id }, data: { state: DocumentState.SUPERSEDED, supersededAt: now, updatedById: user.id } });
        }

        const created = await tx.document.create({
          data: {
            companyId: user.companyId,
            type: owner.type,
            ownerType: owner.ownerType,
            vehicleId: owner.vehicleId,
            employeeId: owner.employeeId,
            customName: details.customName?.trim() || null,
            documentNumber: details.documentNumber?.trim() || null,
            issuer: details.issuer?.trim() || null,
            issueDate,
            expiryDate,
            amount: details.amount ?? null,
            fileId: details.fileId ?? null,
            notes: details.notes?.trim() || null,
            clientSubmissionId: details.clientSubmissionId ?? null,
            verificationStatus,
            ...(isVerified ? { verifiedAt: now, verifiedById: user.id } : {}),
            createdById: user.id,
            updatedById: user.id,
          },
          select: DOCUMENT_VIEW,
        });

        if (previousDoc) {
          await tx.document.update({ where: { id: previousDoc.id }, data: { supersededById: created.id } });
        }
        // A tyre-insurance premium is money spent: it goes into the finance ledger with the policy.
        // (A superseded policy's premium stays in the ledger — it was genuinely paid.)
        if (created.type === DocumentType.TYRE_INSURANCE) {
          await this.ledger.syncSource(
            tx,
            { companyId: user.companyId, sourceType: LedgerSourceType.DOCUMENT, sourceId: created.id, actorId: user.id },
            premiumPosting({ ...created, archived: false }),
          );
        }
        return { document: created, previous: previousDoc };
      });
    } catch (error) {
      // Two sends of the same submission overlapped (a double tap, or a phone retrying while the first
      // request was still running on a slow server): the unique key let one in and stopped the other.
      // The second is a repeat, so it gets the document the first stored — not a conflict error.
      if (details.clientSubmissionId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findReplay(user, details.clientSubmissionId);
        if (replay) return { document: replay, created: false };
      }
      throw error;
    }
    const { document, previous } = saved;

    await this.record(user, previous ? 'document.replaced' : 'document.uploaded', document, {
      fileId: document.fileId,
      expiryDate: document.expiryDate ? toIsoDate(document.expiryDate) : null,
      ...(previous
        ? { previousDocumentId: previous.id, previousFileId: previous.fileId, previousExpiryDate: previous.expiryDate ? toIsoDate(previous.expiryDate) : null }
        : {}),
    });
    return { document, created: true };
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  /** The document an earlier send of this submission stored, if there is one — and only for the person who sent it. */
  private async findReplay(user: AuthenticatedUser, clientSubmissionId: string): Promise<DocumentRow | null> {
    const replay = await this.prisma.document.findUnique({
      where: { companyId_clientSubmissionId: { companyId: user.companyId, clientSubmissionId } },
      select: { ...DOCUMENT_VIEW },
    });
    if (!replay) return null;
    if (replay.createdById !== user.id) throw new ForbiddenException('That submission belongs to someone else.');
    return replay;
  }

  private matrix(types: DocumentType[], current: DocumentRow[]): ComplianceItem[] {
    const today = todayInIndia();
    return types.map((type) => {
      const document = current.find((row) => row.type === type) ?? null;
      if (!document) return { type, status: 'NOT_UPLOADED', daysRemaining: null, document: null };
      const assessment = assessExpiry(document.expiryDate, today);
      return { type, status: assessment.status, daysRemaining: assessment.daysRemaining, document };
    });
  }

  /** A driver sees their own documents and those of the vehicle currently assigned to them. */
  async driverVisibility(user: AuthenticatedUser): Promise<Prisma.DocumentWhereInput> {
    const { driverId, employeeId } = requireDriverScope(user);
    const vehicle = await this.assignedVehicle(user.companyId, driverId);
    const visible: Prisma.DocumentWhereInput[] = [{ employeeId }];
    if (vehicle) visible.push({ vehicleId: vehicle.id });
    return { AND: [{ OR: visible }] };
  }

  private assignedVehicle(companyId: string, driverId: string) {
    return this.prisma.vehicle.findFirst({
      where: { currentAssignment: { driverId }, companyId, deletedAt: null },
      select: { id: true, registrationNumber: true },
    });
  }

  private async currentForOffice(user: AuthenticatedUser, id: string): Promise<DocumentRow> {
    const existing = await this.findById(user, id);
    if (existing.state !== DocumentState.CURRENT) throw new ConflictException('Only the current version can be changed.');
    return existing;
  }

  private async employeeOfDriver(companyId: string, driverId: string): Promise<string> {
    const driver = await this.prisma.driver.findFirst({ where: { id: driverId, companyId }, select: { employeeId: true } });
    if (!driver) throw new NotFoundException('Driver not found.');
    return driver.employeeId;
  }

  private async resolveOfficeOwner(companyId: string, dto: CreateDocumentDto) {
    if (VEHICLE_DOCUMENT_TYPES.includes(dto.type) || (dto.type === DocumentType.OTHER && dto.vehicleId)) {
      if (!dto.vehicleId) throw new BadRequestException(`${dto.type} belongs to a vehicle: choose one.`);
      const vehicle = await this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, companyId, deletedAt: null }, select: { id: true } });
      if (!vehicle) throw new NotFoundException('Vehicle not found.');
      return { ownerType: DocumentOwnerType.VEHICLE, vehicleId: vehicle.id, employeeId: null };
    }
    if (!dto.employeeId) throw new BadRequestException(`${dto.type} belongs to a person: choose one.`);
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    return { ownerType: DocumentOwnerType.EMPLOYEE, vehicleId: null, employeeId: employee.id };
  }

  /** The file must exist in the company; a driver may only attach a file they uploaded. */
  private async assertFileUsable(user: AuthenticatedUser, fileId: string): Promise<void> {
    const file = await this.prisma.storedFile.findFirst({
      where: { id: fileId, companyId: user.companyId, deletedAt: null, ...(user.role === UserRole.DRIVER ? { uploadedById: user.id } : {}) },
      select: { id: true },
    });
    if (!file) throw new BadRequestException('The file could not be found. Upload it again.');
  }

  private async record(user: AuthenticatedUser, action: string, document: DocumentRow, changes: Record<string, unknown>) {
    await this.audit.record({
      action,
      entityType: 'Document',
      entityId: document.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { type: document.type, vehicleId: document.vehicleId, employeeId: document.employeeId, ...changes },
    });
  }
}
