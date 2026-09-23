import { Injectable, NotFoundException } from '@nestjs/common';
import { StorageProvider } from '@prisma/client';
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
        provider: this.storage.provider === 'R2' ? StorageProvider.R2 : StorageProvider.LOCAL,
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

  async read(companyId: string, fileId: string): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, companyId, deletedAt: null } });
    if (!file) throw new NotFoundException('File not found.');
    return { bytes: await this.storage.get(file.objectKey), mimeType: file.mimeType, filename: file.originalFilename };
  }
}
