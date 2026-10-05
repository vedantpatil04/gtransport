import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { StorageProvider, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { FileStorage } from './file-storage';
import { buildObjectKey } from './object-key';

export interface StoreFileInput {
  companyId: string;
  uploadedById?: string | null;
  category: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** Photos from any phone camera or gallery, plus PDFs for e-receipts. */
/** Photos from any phone camera or gallery, plus PDFs for e-receipts. */
export const RECEIPT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);
export const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Stores the bytes in object storage first, then records the metadata row. If the metadata
 * write fails the object is simply orphaned — never the other way round, so a referenced
 * file always exists.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
  ) {}

  async store(input: StoreFileInput): Promise<{ id: string; objectKey: string }> {
    const key = buildObjectKey({ companyId: input.companyId, category: input.category, filename: input.filename });
    const stored = await this.storage.put({ key, body: input.bytes, contentType: input.mimeType });

    const record = await this.prisma.storedFile.create({
      data: {
        companyId: input.companyId,
        provider:
          this.storage.provider === 'CLOUDINARY'
            ? StorageProvider.CLOUDINARY
            : this.storage.provider === 'R2'
              ? StorageProvider.R2
              : StorageProvider.LOCAL,
        bucket: stored.bucket,
        objectKey: stored.key,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: BigInt(stored.sizeBytes),
        checksumSha256: stored.checksumSha256,
        uploadedById: input.uploadedById ?? null,
      },
      select: { id: true, objectKey: true },
    });

    return record;
  }

  /**
   * Stores a receipt photo or PDF. Idempotent per uploader: sending the same bytes again
   * (a retried upload on a weak network) returns the file already stored instead of a copy.
   */
  async storeReceipt(input: StoreFileInput): Promise<{ id: string; deduplicated: boolean }> {
    const rawMime = input.mimeType?.toLowerCase().split(';')[0].trim() || '';
    if (!RECEIPT_MIME_TYPES.has(rawMime)) {
      throw new BadRequestException('Receipts must be a photo (JPEG, PNG, WebP, HEIC) or a PDF.');
    }
    if (input.bytes.byteLength === 0) throw new BadRequestException('The receipt file is empty.');
    if (input.bytes.byteLength > RECEIPT_MAX_BYTES) throw new BadRequestException('The receipt is larger than 15 MB.');

    const cleanMimeType = rawMime === 'image/jpg' || rawMime === 'image/pjpeg' ? 'image/jpeg' : rawMime;

    const checksumSha256 = createHash('sha256').update(input.bytes).digest('hex');
    const existing = await this.prisma.storedFile.findFirst({
      where: { companyId: input.companyId, uploadedById: input.uploadedById ?? null, checksumSha256, deletedAt: null },
      select: { id: true },
    });
    if (existing) return { id: existing.id, deduplicated: true };

    const stored = await this.store({ ...input, mimeType: cleanMimeType });
    return { id: stored.id, deduplicated: false };
  }

  /**
   * Opens a file for the given user. Office roles see any file in their company; a driver sees
   * only files they uploaded themselves.
   */
  async readFor(
    user: { id: string; companyId: string; role: UserRole },
    fileId: string,
  ): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
    const file = await this.prisma.storedFile.findFirst({
      where: { id: fileId, companyId: user.companyId, deletedAt: null },
      select: { uploadedById: true },
    });
    if (!file) throw new NotFoundException('File not found.');
    if (user.role === UserRole.DRIVER && file.uploadedById !== user.id && !(await this.driverMayOpenDocumentFile(user, fileId))) {
      throw new ForbiddenException('You can only open your own files and your vehicle\'s documents.');
    }
    return this.read(user.companyId, fileId);
  }

  /**
   * A driver may open a file attached to a current document they are allowed to see: one of
   * their own, or one belonging to the vehicle currently assigned to them. Checked here, on the
   * server, so hiding a button in the app is never the only protection.
   */
  private async driverMayOpenDocumentFile(user: { id: string; companyId: string }, fileId: string): Promise<boolean> {
    const account = await this.prisma.user.findFirst({
      where: { id: user.id, companyId: user.companyId },
      select: { employee: { select: { id: true, driver: { select: { currentAssignment: { select: { vehicleId: true } } } } } } },
    });
    const employeeId = account?.employee?.id;
    const vehicleId = account?.employee?.driver?.currentAssignment?.vehicleId;
    if (!employeeId) return false;

    const visible = await this.prisma.document.count({
      where: {
        companyId: user.companyId,
        fileId,
        state: 'CURRENT',
        deletedAt: null,
        OR: [{ employeeId }, ...(vehicleId ? [{ vehicleId }] : [])],
      },
    });
    return visible > 0;
  }

  /** Confirms a file exists in the company before a record points at it. */
  async assertUsable(companyId: string, fileId: string, uploadedById?: string): Promise<void> {
    const file = await this.prisma.storedFile.findFirst({
      where: { id: fileId, companyId, deletedAt: null, ...(uploadedById ? { uploadedById } : {}) },
      select: { id: true },
    });
    if (!file) throw new BadRequestException('The receipt could not be found. Upload it again.');
  }

  async read(companyId: string, fileId: string): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, companyId, deletedAt: null } });
    if (!file) throw new NotFoundException('File not found.');
    return { bytes: await this.storage.get(file.objectKey), mimeType: file.mimeType, filename: file.originalFilename };
  }
}
