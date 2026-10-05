import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from 'cloudinary';
import { FileStorage, type PutObjectInput, type StoredObject } from './file-storage';
import { assertSafeObjectKey } from './object-key';

export interface CloudinaryStorageConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder?: string;
}

/**
 * Cloudinary storage provider for production receipt and document images.
 * Implements the FileStorage abstraction so business modules never depend directly
 * on Cloudinary specifics and can transition to Cloudflare R2 in the future without changes.
 */
@Injectable()
export class CloudinaryFileStorage extends FileStorage {
  readonly provider = 'CLOUDINARY' as const;
  private readonly logger = new Logger(CloudinaryFileStorage.name);
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly folder: string;

  constructor(config: CloudinaryStorageConfig) {
    super();
    this.cloudName = config.cloudName;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.folder = config.folder ? config.folder.replace(/\/+$/, '') : '';

    if (this.isConfigured) {
      cloudinary.config({
        cloud_name: this.cloudName,
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        secure: true,
      });
    }
  }

  get isConfigured(): boolean {
    return Boolean(
      this.cloudName &&
        this.apiKey &&
        this.apiSecret &&
        !this.cloudName.includes('placeholder') &&
        !this.apiKey.includes('placeholder'),
    );
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    if (!this.isConfigured) {
      throw new Error(
        'Cloudinary credentials are not configured. Please supply CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in environment variables.',
      );
    }

    assertSafeObjectKey(input.key);
    const checksumSha256 = createHash('sha256').update(input.body).digest('hex');
    const isPdf = input.contentType === 'application/pdf';
    const resourceType = isPdf ? 'raw' : 'image';

    // Normalize public ID: prefix folder if configured, strip file extension for images so Cloudinary manages formats
    const baseKey = isPdf ? input.key : input.key.replace(/\.[^/.]+$/, '');
    const publicId = this.folder ? `${this.folder}/${baseKey}` : baseKey;

    const options: UploadApiOptions = {
      public_id: publicId,
      resource_type: resourceType,
      overwrite: true,
      unique_filename: false,
    };

    const isDocument = input.key.includes('/documents/');
    if (!isPdf && !isDocument) {
      // Optimise everyday receipt photos for fast transfer while preserving text and number legibility.
      // Official compliance documents (RC, Insurance, PUC, etc.) are preserved exactly as uploaded.
      options.quality = 'auto:good';
      options.fetch_format = 'auto';
    }

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(options, (error, uploadResult) => {
        if (error || !uploadResult) {
          this.logger.error(`Cloudinary upload failed for ${publicId}: ${error?.message || 'unknown error'}`);
          return reject(error || new Error('Cloudinary upload returned empty response.'));
        }
        resolve(uploadResult);
      });

      uploadStream.end(Buffer.from(input.body));
    });

    return {
      key: result.public_id,
      bucket: result.secure_url,
      sizeBytes: result.bytes ?? input.body.byteLength,
      checksumSha256,
    };
  }

  async get(key: string): Promise<Uint8Array> {
    if (!this.isConfigured) {
      throw new Error('Cloudinary credentials are not configured.');
    }

    const isRaw = key.endsWith('.pdf');
    const url = cloudinary.url(key, {
      secure: true,
      resource_type: isRaw ? 'raw' : 'image',
    });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to retrieve file from Cloudinary (status ${response.status}): ${key}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConfigured) return false;
    try {
      const isRaw = key.endsWith('.pdf');
      await cloudinary.api.resource(key, { resource_type: isRaw ? 'raw' : 'image' });
      return true;
    } catch {
      return false;
    }
  }

  async createTemporaryDownloadUrl(key: string): Promise<string | null> {
    if (!this.isConfigured) return null;
    const isRaw = key.endsWith('.pdf');
    return cloudinary.url(key, {
      secure: true,
      resource_type: isRaw ? 'raw' : 'image',
    });
  }

  logConfig(): void {
    if (this.isConfigured) {
      this.logger.log(`Active file storage provider: Cloudinary (cloud: ${this.cloudName}, folder: ${this.folder || 'root'})`);
    } else {
      this.logger.warn('Cloudinary is set as storage provider but credentials are not yet configured.');
    }
  }
}
