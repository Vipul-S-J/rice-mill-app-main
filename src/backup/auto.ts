import type { Database } from '../types';
import { buildPlain, fileName, parseStamp } from './format';
import { encryptText } from './crypto';
import { deleteBackup, getKey, listBackups, pruneKind, putBackup, putKey, deleteKey } from './store';
import type { BackupMeta } from './store';
import { deleteFolderFile, effectiveFolder, listFolderFiles, writeFileToFolder } from './folder';
import type { FolderInfo } from './folder';
import { toB64 } from './crypto';

export interface AutoSettings {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  onChange: boolean;
  encrypt: boolean;
  keep: { daily: number; weekly: number; monthly: number };
  folder: FolderInfo | null;
  lastSuccess?: string;
  lastError?: { time: string; message: string };
  latest?: { name: string; size: number; encrypted: boolean; where: string };
}
export const DEFAULT_AUTO: AutoSettings = { enabled: false, frequency: 'daily', onChange: true, encrypt: false, keep: { daily: 7, weekly: 4, monthly: 3 }, folder: null };
const KEY = 'sprm-backup-settings';
export const loadAuto = (): AutoSettings => {
  try { return { ...DEFAULT_AUTO, ...JSON.parse(localStorage.getItem(KEY) || '{}'), keep: { ...DEFAULT_AUTO.keep, ...(JSON.parse(localStorage.getItem(KEY) || '{}').keep || {}) } }; } catch { return { ...DEFAULT_AUTO }; }
};
export const saveAuto = (s: AutoSettings) => { localStorage.setItem(KEY, JSON.stringify(s)); window.dispatchEvent(new Event('sprm-backup-settings')); };
export const patchAuto = (p: Partial<AutoSettings>) => { const s = { ...loadAuto(), ...p }; saveAuto(s); return s; };

// ---- password key for encrypted automatic backups (the password itself is never stored) ----
const BASE_KEY = 'autoBackupBaseKey';
export const saveBaseKey = (k: CryptoKey) => putKey(BASE_KEY, k);
export const loadBaseKey = () => getKey<CryptoKey>(BASE_KEY);
export const clearBaseKey = () => deleteKey(BASE_KEY);

// ---- retention: newest of each of the last N days / weeks / months; the newest backup is always kept ----
const weekKey = (d: Date) => { const t = new Date(d); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`; };
export function selectDelete(items: { name: string; at: Date }[], keep: AutoSettings['keep']): string[] {
  const sorted = [...items].sort((a, b) => b.at.getTime() - a.at.getTime());
  if (sorted.length <= 1) return [];
  const keepSet = new Set<string>([sorted[0].name]);
  const take = (keyOf: (d: Date) => string, n: number) => {
    const seen = new Set<string>();
    for (const it of sorted) { const k = keyOf(it.at); if (!seen.has(k)) { if (seen.size >= n) break; seen.add(k); keepSet.add(it.name); } }
  };
  take(d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, Math.max(1, keep.daily));
  take(weekKey, Math.max(0, keep.weekly));
  take(d => `${d.getFullYear()}-${d.getMonth()}`, Math.max(0, keep.monthly));
  return sorted.filter(i => !keepSet.has(i.name)).map(i => i.name);
}

export interface Created { meta: BackupMeta; text: string }
/** Builds the backup text (encrypted with a password, or with the stored key), without saving it anywhere. */
export async function makeBackupText(db: Database, enc: { base: CryptoKey } | null): Promise<string> {
  const plain = buildPlain(db);
  return enc ? encryptText(plain, enc.base) : plain;
}

let running: Promise<void> | null = null;
/** Automatic backup: saved inside the app, and into the chosen folder if there is one. Never replaces an older backup before the new one is saved. */
export function runAutoBackup(db: Database, reason: string): Promise<void> {
  if (running) return running;
  running = (async () => {
    const s = loadAuto();
    try {
      let base: CryptoKey | undefined;
      if (s.encrypt) {
        base = await loadBaseKey();
        if (!base) throw new Error('Encryption is on but the password key is missing. Open Backup and set the password again. No unencrypted copy was made.');
      }
      const text = await makeBackupText(db, base ? { base } : null);
      const name = fileName(!!s.encrypt, true);
      const meta: BackupMeta = { name, createdAt: new Date().toISOString(), size: new Blob([text]).size, encrypted: !!s.encrypt, kind: 'auto', note: reason };
      await putBackup(meta, text);
      let where = 'Inside the app only';
      let folderWarning = '';
      const dest = effectiveFolder(s.folder);
      if (dest) {
        try {
          await writeFileToFolder(dest, name, s.encrypt ? 'application/octet-stream' : 'application/json', toB64(new TextEncoder().encode(text)), text);
          where = `On the phone: ${dest.name} (and inside the app)`;
        } catch (e: any) { folderWarning = `Saved inside the app, but NOT on the phone: ${e?.message || e}`; }
      }
      await applyRetention(s);
      patchAuto({ lastSuccess: meta.createdAt, latest: { name, size: meta.size, encrypted: meta.encrypted, where }, lastError: folderWarning ? { time: meta.createdAt, message: folderWarning } : undefined });
    } catch (e: any) {
      patchAuto({ lastError: { time: new Date().toISOString(), message: e?.message || String(e) } });
      throw e;
    } finally { running = null; }
  })();
  return running;
}
async function applyRetention(s: AutoSettings) {
  const own = (await listBackups()).filter(b => b.kind === 'auto');
  for (const n of selectDelete(own.map(b => ({ name: b.name, at: new Date(b.createdAt) })), s.keep)) await deleteBackup(n);
  const dest = effectiveFolder(s.folder);
  if (dest) {
    try {
      const files = (await listFolderFiles(dest)).filter(f => /^SPRM_AutoBackup_/.test(f.name));
      const items = files.map(f => ({ name: f.name, at: parseStamp(f.name) })).filter((x): x is { name: string; at: Date } => !!x.at);
      for (const n of selectDelete(items, s.keep)) await deleteFolderFile(dest, n);
    } catch { /* folder not reachable right now; retention runs again next time */ }
  }
}
/** A safety copy taken right before a full restore or other destructive step. Kept inside the app. */
export async function createSafetyBackup(db: Database, why: string): Promise<BackupMeta> {
  const text = buildPlain(db);
  const meta: BackupMeta = { name: fileName(false).replace('SPRM_Backup_', 'SPRM_Safety_'), createdAt: new Date().toISOString(), size: new Blob([text]).size, encrypted: false, kind: 'safety', note: why };
  await putBackup(meta, text);
  await pruneKind('safety', 5);
  return meta;
}

// ---- when is the next automatic backup due? ----
export function nextDue(s: AutoSettings): Date | null {
  if (!s.enabled) return null;
  if (!s.lastSuccess) return new Date();
  const last = new Date(s.lastSuccess);
  const n = new Date(last);
  if (s.frequency === 'daily') { n.setDate(n.getDate() + 1); n.setHours(0, 0, 0, 0); }
  else if (s.frequency === 'weekly') n.setDate(n.getDate() + 7);
  else n.setMonth(n.getMonth() + 1);
  return n;
}
export const isDue = (s: AutoSettings, now = new Date()) => { const d = nextDue(s); return !!d && d.getTime() <= now.getTime(); };
