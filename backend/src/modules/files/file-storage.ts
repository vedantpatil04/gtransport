/** Provider-agnostic object storage. Business modules depend only on this class. */
export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
}

export interface StoredObject {
  key: string;
  bucket: string | null;
  sizeBytes: number;
  checksumSha256: string;
}

/**
 * Abstract base used as the DI token. Implementations live in this module only
 * (LocalDiskFileStorage today, CloudflareR2Storage later) so no R2-specific code
 * can leak into business modules.
 *
 * Note there is deliberately no delete(): stored originals — receipts, documents —
 * are retained. Removal will be an explicit, audited archival operation.
 */
export abstract class FileStorage {
  abstract readonly provider: 'LOCAL' | 'R2' | 'CLOUDINARY';

  abstract put(input: PutObjectInput): Promise<StoredObject>;

  abstract get(key: string): Promise<Uint8Array>;

  abstract exists(key: string): Promise<boolean>;

  /**
   * Temporary download URL for clients. Returns null for providers that cannot issue one
   * (local disk), in which case the API streams the bytes itself.
   */
  abstract createTemporaryDownloadUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}
