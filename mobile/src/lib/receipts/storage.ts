import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { ApiError } from '../api/client';

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


/**
 * Throws a clear, retry-able-by-choosing-again error when a kept photo or file has gone from the
 * phone (Android clears cache folders; a file can be moved or deleted). Without this the upload
 * fails deep inside the network layer with a message that blames the connection.
 *
 * Only file:// paths can be checked cheaply. Anything else (or an environment where the file API is
 * unavailable) is left to the upload itself, so a check can never block a file that would have sent.
 */
export function assertLocalFileExists(uri: string): void {
  if (!uri.startsWith('file:')) return;
  let exists = true;
  try {
    exists = new File(uri).exists;
  } catch {
    return;
  }
  if (!exists) throw new ApiError('file', 0, 'The photo or file is no longer on this phone.');
}
