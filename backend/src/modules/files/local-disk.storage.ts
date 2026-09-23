import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileStorage, type PutObjectInput, type StoredObject } from './file-storage';
import { assertSafeObjectKey } from './object-key';

/**
 * Local filesystem storage for development and tests.
 *
 * Production is expected to use object storage (Cloudflare R2); this adapter exists so the
 * upload path is exercised end to end without cloud credentials.
 */
@Injectable()
export class LocalDiskFileStorage extends FileStorage {
  readonly provider = 'LOCAL' as const;
  private readonly logger = new Logger(LocalDiskFileStorage.name);
  private readonly root: string;

  constructor(root: string) {
    super();
    this.root = path.resolve(root);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const target = this.resolve(input.key);
    await mkdir(path.dirname(target), { recursive: true });

    // Write to a temporary file first, then rename: a reader never sees a half-written object.
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, input.body, { flag: 'wx' });
    await rename(temporary, target);

    return {
      key: input.key,
      bucket: null,
      sizeBytes: input.body.byteLength,
      checksumSha256: createHash('sha256').update(input.body).digest('hex'),
    };
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(key)));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async createTemporaryDownloadUrl(): Promise<string | null> {
    return null; // Local disk cannot sign URLs; the API streams these files itself.
  }

  /** Resolves a key inside the storage root and rejects anything that escapes it. */
  private resolve(key: string): string {
    const resolved = path.resolve(this.root, assertSafeObjectKey(key));
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error('Resolved storage path escapes the storage root');
    }
    return resolved;
  }

  logRoot(): void {
    this.logger.log(`Local file storage root: ${this.root}`);
  }
}
