import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory } from 'expo-file-system';

/**
 * Saves a file the office console produced (a PDF or Excel report, an attachment) where the user
 * chooses, through Android's own folder picker (the Storage Access Framework). The folder is asked
 * for once and remembered; Android keeps the grant across restarts.
 *
 * This needs no storage permission on any Android version — 7 to 9 included — and never touches
 * anything outside the chosen folder, so it respects scoped storage on Android 10 and later.
 * (Ordinary https downloads, such as a public file link, go through the WebView's own
 * DownloadManager path instead, which asks for the legacy permission only on Android 9 and older.)
 */

const FOLDER_KEY = 'gangamata.console.downloadFolder';

/** Where the picker opens first: the phone's Downloads folder (Android 8+ honours it). */
const DOWNLOADS_HINT = 'content://com.android.externalstorage.documents/document/primary%3ADownload';

export type SaveOutcome = { status: 'saved'; filename: string } | { status: 'cancelled' } | { status: 'failed' };

/** Keeps the name the console chose, minus anything a file system would refuse. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  return (cleaned || 'download').slice(0, 120);
}

async function rememberedFolder(): Promise<Directory | null> {
  try {
    const uri = await AsyncStorage.getItem(FOLDER_KEY);
    return uri ? new Directory(uri) : null;
  } catch {
    return null;
  }
}

/** Opens the folder picker. Null when the user backs out. */
async function chooseFolder(): Promise<Directory | null> {
  try {
    const folder = await Directory.pickDirectoryAsync(DOWNLOADS_HINT);
    await AsyncStorage.setItem(FOLDER_KEY, folder.uri);
    return folder;
  } catch {
    return null;
  }
}

function write(folder: Directory, filename: string, mimeType: string, base64: string): void {
  // The provider adds " (1)" itself when the name is taken; nothing is overwritten.
  const file = folder.createFile(filename, mimeType);
  file.write(base64, { encoding: 'base64' });
}

/**
 * `confirmChoice` runs before the picker is shown, so the user knows why it appears; returning
 * false cancels. A remembered folder that no longer works (deleted, access revoked) is forgotten
 * and the user is asked again once.
 */
export async function saveConsoleFile(
  file: { filename: string; mimeType: string; data: string },
  confirmChoice: () => Promise<boolean>,
): Promise<SaveOutcome> {
  const filename = safeFilename(file.filename);
  const remembered = await rememberedFolder();
  if (remembered) {
    try {
      write(remembered, filename, file.mimeType, file.data);
      return { status: 'saved', filename };
    } catch {
      await AsyncStorage.removeItem(FOLDER_KEY).catch(() => undefined);
    }
  }

  if (!(await confirmChoice())) return { status: 'cancelled' };
  const folder = await chooseFolder();
  if (!folder) return { status: 'cancelled' };
  try {
    write(folder, filename, file.mimeType, file.data);
    return { status: 'saved', filename };
  } catch {
    await AsyncStorage.removeItem(FOLDER_KEY).catch(() => undefined);
    return { status: 'failed' };
  }
}
