import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Keeps a receipt photo somewhere the OS will not clear. The camera and gallery hand back
 * files in a cache directory that Android may empty under storage pressure — so a receipt
 * captured offline is copied into the app's documents folder until it has been uploaded.
 */

const receiptsDir = () => new Directory(Paths.document, 'pending-receipts');

export interface LocalReceipt {
  uri: string;
  mimeType: string;
  name: string;
}

export async function persistReceipt(sourceUri: string, mimeType = 'image/jpeg'): Promise<LocalReceipt> {
  const dir = receiptsDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

  const extension =
    mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/heic' ? 'heic' : 'jpg';
  const name = `${randomUUID()}.${extension}`;
  const destination = new File(dir, name);
  await new File(sourceUri).copy(destination);
  return { uri: destination.uri, mimeType, name };
}

/** Deletes a kept receipt once the server has it, or when the driver removes it. */
export function discardReceipt(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone; nothing to clean up.
  }
}
