import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory } from 'expo-file-system';
import { safeFilename, saveConsoleFile } from '../downloads';

const written: { folder: string; name: string; mimeType: string; data: string; encoding?: string }[] = [];
let failWritesIn: string | null = null;

beforeAll(() => {
  const proto = Directory.prototype as unknown as { createFile: (name: string, mimeType: string) => unknown };
  proto.createFile = function (this: { uri: string }, name: string, mimeType: string) {
    const folder = this.uri;
    if (folder === failWritesIn) throw new Error('permission revoked');
    return { write: (data: string, options?: { encoding?: string }) => written.push({ folder, name, mimeType, data, encoding: options?.encoding }) };
  };
});

const pick = jest.fn<Promise<Directory>, [string?]>();
(Directory as unknown as { pickDirectoryAsync: typeof pick }).pickDirectoryAsync = pick;

const report = { filename: 'Fuel report.pdf', mimeType: 'application/pdf', data: 'JVBERi0xLjQK' };

beforeEach(async () => {
  written.length = 0;
  failWritesIn = null;
  pick.mockReset();
  await AsyncStorage.clear();
});

describe('saving console files', () => {
  it('asks for a folder once, writes the real bytes, then reuses the folder', async () => {
    pick.mockResolvedValue(new Directory('content://tree/Gangamata'));
    const confirm = jest.fn(async () => true);

    expect(await saveConsoleFile(report, confirm)).toEqual({ status: 'saved', filename: 'Fuel report.pdf' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(written).toEqual([{ folder: 'content://tree/Gangamata', name: 'Fuel report.pdf', mimeType: 'application/pdf', data: 'JVBERi0xLjQK', encoding: 'base64' }]);

    expect(await saveConsoleFile({ ...report, filename: 'Ledger.xlsx' }, confirm)).toMatchObject({ status: 'saved' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('saves nothing — and claims nothing — when the user backs out', async () => {
    expect(await saveConsoleFile(report, async () => false)).toEqual({ status: 'cancelled' });
    pick.mockRejectedValue(new Error('cancelled'));
    expect(await saveConsoleFile(report, async () => true)).toEqual({ status: 'cancelled' });
    expect(written).toEqual([]);
  });

  it('forgets a folder that stopped working and asks again', async () => {
    await AsyncStorage.setItem('gangamata.console.downloadFolder', 'content://tree/Gone');
    failWritesIn = 'content://tree/Gone';
    pick.mockResolvedValue(new Directory('content://tree/New'));
    expect(await saveConsoleFile(report, async () => true)).toMatchObject({ status: 'saved' });
    expect(written[0]?.folder).toBe('content://tree/New');
  });

  it('reports a failed write as failed', async () => {
    failWritesIn = 'content://tree/ReadOnly';
    pick.mockResolvedValue(new Directory('content://tree/ReadOnly'));
    expect(await saveConsoleFile(report, async () => true)).toEqual({ status: 'failed' });
  });

  it('keeps the console’s file name, minus characters a file system refuses', () => {
    expect(safeFilename('Fuel report 2026-10.pdf')).toBe('Fuel report 2026-10.pdf');
    expect(safeFilename('../a/b:c?.xlsx')).toBe('_a_b_c_.xlsx');
    expect(safeFilename('   ')).toBe('download');
  });
});
