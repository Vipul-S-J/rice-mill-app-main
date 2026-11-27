/** Backup copies kept inside the app (IndexedDB). This file must not import db.ts (db.ts imports it). */
export type BackupKind = 'auto' | 'manual' | 'safety' | 'premigration';
export interface BackupMeta { name: string; createdAt: string; size: number; encrypted: boolean; kind: BackupKind; note?: string }

const DB_NAME = 'sprm-backups';
let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('meta', { keyPath: 'name' });
        d.createObjectStore('blobs');
        d.createObjectStore('keys');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error); };
    });
  }
  return dbp;
}
const run = <T,>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> =>
  open().then(d => new Promise<T>((resolve, reject) => {
    const tx = d.transaction(stores, mode);
    const r = fn(tx);
    tx.oncomplete = () => resolve((r ? (r as IDBRequest<T>).result : undefined) as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));

export async function putBackup(meta: BackupMeta, text: string): Promise<void> {
  await run(['meta', 'blobs'], 'readwrite', tx => { tx.objectStore('meta').put(meta); tx.objectStore('blobs').put(text, meta.name); });
}
export async function listBackups(): Promise<BackupMeta[]> {
  const all = await run<BackupMeta[]>(['meta'], 'readonly', tx => tx.objectStore('meta').getAll());
  return (all || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getBackupText(name: string): Promise<string | undefined> {
  return run<string | undefined>(['blobs'], 'readonly', tx => tx.objectStore('blobs').get(name));
}
export async function deleteBackup(name: string): Promise<void> {
  await run(['meta', 'blobs'], 'readwrite', tx => { tx.objectStore('meta').delete(name); tx.objectStore('blobs').delete(name); });
}
export async function putKey(id: string, value: unknown): Promise<void> { await run(['keys'], 'readwrite', tx => { tx.objectStore('keys').put(value, id); }); }
export async function getKey<T>(id: string): Promise<T | undefined> { return run<T | undefined>(['keys'], 'readonly', tx => tx.objectStore('keys').get(id)); }
export async function deleteKey(id: string): Promise<void> { await run(['keys'], 'readwrite', tx => { tx.objectStore('keys').delete(id); }); }

/** Keeps the newest `max` backups of a kind (used for safety / pre-upgrade copies). */
export async function pruneKind(kind: BackupKind, max: number): Promise<void> {
  const list = (await listBackups()).filter(b => b.kind === kind);
  for (const b of list.slice(max)) await deleteBackup(b.name);
}

/** Called before a data upgrade or when saved data cannot be read: stores the untouched raw text. Fire and forget. */
export function snapshotRaw(raw: string, note: string): void {
  try {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const name = `SPRM_${note}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.json`;
    void putBackup({ name, createdAt: d.toISOString(), size: raw.length, encrypted: false, kind: 'premigration', note }, raw)
      .then(() => pruneKind('premigration', 3)).catch(() => { /* IndexedDB unavailable */ });
  } catch { /* ignore */ }
}
