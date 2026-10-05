import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';

/**
 * Prepares a captured or selected receipt for upload.
 * The source URI from camera or gallery is directly usable by React Native
 * Image preview and FormData upload without requiring incompatible local filesystem operations.
 */

export interface LocalReceipt {
  uri: string;
  mimeType: string;
  name: string;
}

export async function persistReceipt(sourceUri: string, mimeType = 'image/jpeg'): Promise<LocalReceipt> {
  const extension =
    mimeType === 'application/pdf'
      ? 'pdf'
      : mimeType === 'image/png'
        ? 'png'
        : mimeType === 'image/webp'
          ? 'webp'
          : mimeType === 'image/heic'
            ? 'heic'
            : 'jpg';
  const name = `${randomUUID()}.${extension}`;
  return { uri: sourceUri, mimeType, name };
}

/** Deletes a kept receipt once the server has it, or when the driver removes it. */
export function discardReceipt(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file?.exists) file.delete();
  } catch {
    // In environments where File class is not supported, safely ignore.
  }
}

