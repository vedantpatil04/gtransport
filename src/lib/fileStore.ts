/**
 * Local file store for uploaded images/documents (IndexedDB, with an in-memory fallback).
 * In production this is replaced by the upload API; callers only deal with file ids.
 */
const DB_NAME = 'gangamata-files';
const STORE = 'files';
const memory = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putFile(id: string, dataUrl: string) {
  memory.set(id, dataUrl);
  try {
    await run('readwrite', (s) => s.put(dataUrl, id));
  } catch {
    /* memory fallback already holds it */
  }
}

export async function getFile(id: string): Promise<string | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  try {
    const value = await run<string | undefined>('readonly', (s) => s.get(id));
    if (value) memory.set(id, value);
    return value ?? null;
  } catch {
    return null;
  }
}

export async function clearFiles() {
  memory.clear();
  try {
    await run('readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}
