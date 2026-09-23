import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalDiskFileStorage } from './local-disk.storage';
import { assertSafeObjectKey, buildObjectKey } from './object-key';

describe('LocalDiskFileStorage', () => {
  let root: string;
  let storage: LocalDiskFileStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'gangamata-storage-'));
    storage = new LocalDiskFileStorage(root);
  });

  it('stores bytes and reports size and checksum', async () => {
    const body = new TextEncoder().encode('receipt bytes');
    const stored = await storage.put({ key: 'companies/c1/receipts/2026/03/file.jpg', body, contentType: 'image/jpeg' });

    expect(stored.sizeBytes).toBe(body.byteLength);
    // sha256 of "receipt bytes"
    expect(stored.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(path.join(root, stored.key))).toEqual(Buffer.from(body));
  });

  it('round-trips content through get()', async () => {
    const body = new Uint8Array([0, 1, 2, 250]);
    await storage.put({ key: 'companies/c1/docs/a.bin', body, contentType: 'application/octet-stream' });
    expect(await storage.get('companies/c1/docs/a.bin')).toEqual(body);
  });

  it('leaves no temporary files behind', async () => {
    await storage.put({ key: 'companies/c1/docs/a.bin', body: new Uint8Array([1]), contentType: 'application/octet-stream' });
    const files = await readdir(path.join(root, 'companies/c1/docs'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });

  it('reports existence accurately', async () => {
    await expect(storage.exists('companies/c1/docs/missing.bin')).resolves.toBe(false);
    await storage.put({ key: 'companies/c1/docs/there.bin', body: new Uint8Array([1]), contentType: 'application/octet-stream' });
    await expect(storage.exists('companies/c1/docs/there.bin')).resolves.toBe(true);
  });

  it('refuses keys that try to escape the storage root', async () => {
    for (const key of ['../escape.txt', 'companies/../../etc/passwd', '/etc/passwd', 'a//b']) {
      await expect(storage.get(key)).rejects.toThrow();
    }
  });

  it('cannot sign URLs, so callers fall back to streaming', async () => {
    await expect(storage.createTemporaryDownloadUrl()).resolves.toBeNull();
  });
});

describe('object keys', () => {
  it('partitions by company and month and keeps the extension', () => {
    const key = buildObjectKey({ companyId: 'c1', category: 'receipts', filename: 'bill.JPG', now: new Date('2026-03-04T00:00:00Z') });
    expect(key).toMatch(/^companies\/c1\/receipts\/2026\/03\/[0-9a-f-]{36}\.jpg$/);
  });

  it('rejects unsafe keys', () => {
    expect(() => assertSafeObjectKey('../x')).toThrow();
    expect(() => assertSafeObjectKey('')).toThrow();
  });
});
