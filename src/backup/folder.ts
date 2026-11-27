/** A folder chosen by the user for backup copies: Android folder picker, or a desktop folder (File System Access API). */
import { FileSave, isNative } from '../utils/pdf';
import { getKey, putKey, deleteKey } from './store';

export interface FolderInfo { kind: 'saf' | 'web'; name: string; uri?: string }
const P = FileSave;
const HANDLE_KEY = 'backupFolderHandle';
export class NeedPermission extends Error { constructor() { super('Folder permission is needed. Open Backup and tap "Allow folder access".'); } }

export const folderSupported = () => isNative() || typeof (window as any).showDirectoryPicker === 'function';

export async function pickFolder(): Promise<FolderInfo> {
  if (isNative()) { const r = await P.pickFolder(); return { kind: 'saf', name: r.name, uri: r.uri }; }
  const h = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  await putKey(HANDLE_KEY, h);
  return { kind: 'web', name: h.name };
}
export async function forgetFolder(f: FolderInfo | null) { if (f?.kind === 'web') await deleteKey(HANDLE_KEY); }

async function webHandle(request: boolean): Promise<any> {
  const h: any = await getKey(HANDLE_KEY);
  if (!h) throw new Error('The backup folder is no longer available. Choose it again.');
  let perm = await h.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted' && request) perm = await h.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new NeedPermission();
  return h;
}
/** Desktop: ask the browser again for access (needs a tap). */
export async function allowFolderAccess(): Promise<void> { await webHandle(true); }

export async function writeFileToFolder(f: FolderInfo, filename: string, mimeType: string, base64: string, text?: string): Promise<void> {
  if (f.kind === 'saf') { await P.writeToFolder({ treeUri: f.uri!, filename, mimeType, data: base64 }); return; }
  const h = await webHandle(false);
  const fh = await h.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(text ?? new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))]));
  await w.close();
}
export async function listFolderFiles(f: FolderInfo): Promise<{ name: string; size: number }[]> {
  if (f.kind === 'saf') return (await P.listFolder({ treeUri: f.uri! })).files;
  const h = await webHandle(false);
  const out: { name: string; size: number }[] = [];
  for await (const [name, handle] of h.entries()) if (handle.kind === 'file') out.push({ name, size: (await handle.getFile()).size });
  return out;
}
export async function deleteFolderFile(f: FolderInfo, filename: string): Promise<void> {
  if (f.kind === 'saf') { await P.deleteInFolder({ treeUri: f.uri!, filename }); return; }
  const h = await webHandle(false);
  await h.removeEntry(filename);
}
/** Android only: opens the folder in the Files app. Desktop browsers cannot do this. */
export async function openFolder(f: FolderInfo): Promise<void> {
  if (f.kind !== 'saf') throw new Error('Browsers cannot open a folder. Open it yourself in your file manager.');
  await P.openFolder({ treeUri: f.uri! });
}
