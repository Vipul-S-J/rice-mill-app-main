import type { Database } from '../types';
import { migrateDB } from '../db';
import { isEnvelope } from './crypto';
import type { Envelope } from './crypto';

export const APP_NAME = 'SPRM Rice Mill';
export const COLLECTIONS: { key: keyof Database; label: string }[] = [
  { key: 'parties', label: 'Customers & suppliers' }, { key: 'hulling', label: 'Hulling' }, { key: 'purchases', label: 'Paddy purchases' },
  { key: 'production', label: 'Production' }, { key: 'sales', label: 'Sales' }, { key: 'dispatches', label: 'Paddy / husk dispatch' },
  { key: 'expenses', label: 'Expenses' }, { key: 'labour', label: 'Hulling labour wages' }, { key: 'electricity', label: 'Electricity' },
  { key: 'cashbook', label: 'Cashbook' }, { key: 'stockAdjustments', label: 'Stock adjustments' }, { key: 'trading', label: 'Trading' },
  { key: 'attendance', label: 'Attendance' }, { key: 'workRecords', label: 'Work records' },
  { key: 'advances', label: 'Advances' }, { key: 'payrolls', label: 'Payroll' },
];
export const countsOf = (db: Database): Record<string, number> =>
  Object.fromEntries(COLLECTIONS.map(c => [c.key, Array.isArray((db as any)[c.key]) ? (db as any)[c.key].length : 0]));

export interface BackupFile {
  app: string; format: 'sprm-backup'; formatVersion: 1; createdAt: string; schemaVersion: number;
  counts: Record<string, number>; data: Database;
}
export const buildPlain = (db: Database): string => {
  const f: BackupFile = { app: APP_NAME, format: 'sprm-backup', formatVersion: 1, createdAt: new Date().toISOString(), schemaVersion: db.version, counts: countsOf(db), data: db };
  return JSON.stringify(f);
};

const p2 = (n: number) => String(n).padStart(2, '0');
export const stamp = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
/** unique, timestamped names so a backup never overwrites another one */
export const fileName = (encrypted: boolean, auto = false) => `SPRM_${auto ? 'AutoBackup' : 'Backup'}_${stamp()}.${encrypted ? 'sprmbackup' : 'json'}`;
export const parseStamp = (name: string): Date | null => {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
};

export type Inspected =
  | { kind: 'encrypted'; envelope: Envelope }
  | { kind: 'plain'; db: Database; createdAt?: string; counts: Record<string, number> };

const KNOWN = ['parties', 'hulling', 'purchases', 'production', 'dispatches', 'sales', 'expenses', 'labour', 'electricity', 'cashbook', 'trading'];
/** Reads a backup file's text. Accepts the new wrapper, old plain JSON backups and encrypted files. Throws if it is not a valid backup. */
export function inspectBackup(text: string): Inspected {
  let raw: any;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('This file is not a valid backup (it could not be read).'); }
  if (isEnvelope(raw)) return { kind: 'encrypted', envelope: raw };
  const payload = raw && raw.format === 'sprm-backup' && raw.data ? raw.data : raw;
  if (!payload || typeof payload !== 'object' || !KNOWN.some(k => Array.isArray(payload[k]))) throw new Error('This file is not an SPRM backup.');
  const db = migrateDB(JSON.parse(JSON.stringify(payload)));
  return { kind: 'plain', db, createdAt: raw.createdAt, counts: countsOf(db) };
}
