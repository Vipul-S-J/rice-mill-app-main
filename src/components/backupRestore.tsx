import { useEffect, useMemo, useRef, useState } from 'react';
import { useDB } from '../context';
import type { Database } from '../types';
import { Badge, Button, Card, Confirm, Input, toast } from './ui';
import { saveFile } from '../utils/pdf';
import { decryptEnvelope } from '../backup/crypto';
import type { Envelope } from '../backup/crypto';
import { COLLECTIONS, inspectBackup } from '../backup/format';
import { deleteBackup, getBackupText } from '../backup/store';
import type { BackupMeta } from '../backup/store';
import { createSafetyBackup } from '../backup/auto';
import { fmtSize, fmtWhen } from './backupUi';

type Loaded = { db: Database; counts: Record<string, number>; createdAt?: string };

export function RestoreCard({ history, busy, setBusy, refresh, openText }: {
  history: BackupMeta[]; busy: string; setBusy: (s: string) => void; refresh: () => void; openText: { text: string; label: string; n: number } | null;
}) {
  const { db, restoreFrom } = useDB();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [env, setEnv] = useState<Envelope | null>(null);
  const [pw, setPw] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [confirm, setConfirm] = useState<'replace' | 'merge' | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  const reset = () => { setEnv(null); setPw(''); setLoaded(null); setConfirm(null); setLabel(''); };
  const open = (text: string, name: string) => {
    reset();
    try {
      const ins = inspectBackup(text);
      setLabel(name);
      if (ins.kind === 'encrypted') setEnv(ins.envelope); else setLoaded({ db: ins.db, counts: ins.counts, createdAt: ins.createdAt });
    } catch (e: any) { toast(e.message, 'error'); }
  };
  // a copy chosen from the history list below
  useEffect(() => { if (openText) open(openText.text, openText.label); }, [openText?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlock = async () => {
    if (!env) return;
    setBusy('Decrypting…');
    try {
      const ins = inspectBackup(await decryptEnvelope(env, pw));
      if (ins.kind !== 'plain') throw new Error('The decrypted file is not a valid backup. Nothing was restored.');
      setLoaded({ db: ins.db, counts: ins.counts, createdAt: ins.createdAt || env.createdAt }); setEnv(null); setPw('');
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const doRestore = async (mode: 'replace' | 'merge') => {
    if (!loaded) return;
    setBusy('Restoring…');
    try {
      const safety = await createSafetyBackup(db, mode === 'replace' ? 'before full restore' : 'before merge');
      if (mode === 'replace') {
        restoreFrom(loaded.db, 'replace');
        setReport(['Full restore finished.', `Your previous data was saved first as “${safety.name}” (see the list below).`]);
      } else {
        const r = restoreFrom(loaded.db, 'merge');
        const lines = Object.entries(r.added).map(([k, v]) => `${COLLECTIONS.find(c => c.key === k)?.label || k}: ${v} added`);
        setReport(['Merge finished.', ...(lines.length ? lines : ['Nothing new to add. Everything was already here.']),
          ...(r.conflicts ? [`${r.conflicts} record(s) already existed with different details and were left as they are.`] : [])]);
      }
      reset(); refresh();
    } catch (e: any) { toast(`Restore failed: ${e?.message || e}`, 'error'); } finally { setBusy(''); setConfirm(null); }
  };
  const nowCounts = useMemo(() => Object.fromEntries(COLLECTIONS.map(c => [c.key, ((db as any)[c.key] || []).length])), [db]);
  void history;
  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-bold text-forest-800">Restore from a backup</h3>
      <p className="text-xs text-gray-600">Choose a .json or .sprmbackup file. Backups made before this update also work. Encrypted files ask for their password first.</p>
      <input ref={fileRef} type="file" className="hidden" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(await f.text(), f.name); }} />
      <Button variant="secondary" className="w-full" onClick={() => fileRef.current?.click()}>Choose backup file…</Button>
      {env && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
          <div className="text-xs font-semibold text-amber-900">🔒 “{label}” is encrypted. Enter its password.</div>
          <Input type="password" autoComplete="off" value={pw} onChange={e => setPw(e.target.value)} placeholder="Backup password" />
          <div className="flex gap-2"><Button size="sm" onClick={unlock} disabled={!pw || !!busy}>Unlock</Button><Button size="sm" variant="secondary" onClick={reset}>Cancel</Button></div>
        </div>
      )}
      {loaded && (
        <div className="rounded-xl border border-forest-200 p-3 space-y-2">
          <div className="text-xs"><b className="break-all">{label}</b>{loaded.createdAt ? <> · made {fmtWhen(loaded.createdAt)}</> : null}</div>
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-gray-500"><th>Records</th><th className="text-right">In backup</th><th className="text-right">In app now</th></tr></thead>
            <tbody>{COLLECTIONS.map(c => { const n = loaded.counts[c.key] || 0, cur = nowCounts[c.key] || 0; return n || cur ? <tr key={c.key} className="border-t border-gray-100"><td>{c.label}</td><td className="text-right font-semibold">{n}</td><td className="text-right">{cur}</td></tr> : null; })}</tbody>
          </table>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirm('merge')}>Merge / Import</Button>
            <Button variant="danger" onClick={() => setConfirm('replace')}>Full Restore</Button>
          </div>
          <p className="text-[11px] text-gray-500"><b>Merge</b> adds records that are not here yet and never changes existing ones. <b>Full Restore</b> replaces everything with this backup, after saving a safety copy of the current data.</p>
        </div>
      )}
      {report && <div className="rounded-xl bg-forest-50 border border-forest-200 p-3 text-xs space-y-0.5">{report.map((l, i) => <div key={i} className={i === 0 ? 'font-bold text-forest-800' : ''}>{l}</div>)}<button className="text-forest-700 font-semibold mt-1" onClick={() => setReport(null)}>Close</button></div>}
      <Confirm open={confirm === 'merge'} onClose={() => setConfirm(null)} variant="primary" title="Merge this backup?" confirmText="Merge"
        message="Records that are not in the app yet will be added. Existing records are not changed. A safety copy of your current data is saved first." onConfirm={() => void doRestore('merge')} />
      <Confirm open={confirm === 'replace'} onClose={() => setConfirm(null)} title="Replace ALL current data?" confirmText="Yes, replace everything"
        message="Everything in the app (customers, entries, payments, stock, settings) will be replaced by this backup. A safety copy of the current data is saved first, then you continue with the backup's data." onConfirm={() => void doRestore('replace')} />
    </Card>
  );
}

export function HistoryCard({ history, refresh, onRestore }: { history: BackupMeta[]; refresh: () => void; onRestore: (text: string, label: string) => void }) {
  const [del, setDel] = useState<string | null>(null);
  const kindLabel = (k: BackupMeta['kind']) => (k === 'auto' ? 'Automatic' : k === 'manual' ? 'Manual' : k === 'safety' ? 'Safety copy' : 'Before upgrade');
  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-bold text-forest-800">Backups kept inside the app ({history.length})</h3>
      {history.length === 0 ? <div className="text-xs text-gray-500">None yet.</div> : history.map(b => (
        <div key={b.name} className="rounded-xl border border-gray-100 p-2.5 text-xs space-y-1">
          <div className="font-semibold break-all">{b.name}</div>
          <div className="flex flex-wrap gap-1 items-center text-gray-500">
            {fmtWhen(b.createdAt)} · {fmtSize(b.size)}
            <Badge tone={b.kind === 'auto' ? 'blue' : b.kind === 'manual' ? 'green' : 'gold'}>{kindLabel(b.kind)}</Badge>
            {b.encrypted && <Badge tone="gray">🔒 Encrypted</Badge>}
          </div>
          <div className="flex gap-3 pt-0.5">
            <button className="font-semibold text-blue-700" onClick={async () => { const t = await getBackupText(b.name); if (t) onRestore(t, b.name); }}>Restore…</button>
            <button className="font-semibold text-forest-700" onClick={async () => {
              const t = await getBackupText(b.name); if (!t) return;
              try { const r = await saveFile(b.name, b.encrypted ? 'application/octet-stream' : 'application/json', new Blob([t])); if (r !== 'cancelled') toast('Copy saved'); } catch (e: any) { toast(e.message, 'error'); }
            }}>Save a copy</button>
            <button className="font-semibold text-red-600" onClick={() => setDel(b.name)}>Delete</button>
          </div>
        </div>
      ))}
      <Confirm open={!!del} onClose={() => setDel(null)} title="Delete this backup copy?" confirmText="Delete"
        message={history.length <= 1 ? 'This is the only backup kept inside the app. Create another one before deleting it.' : 'Only this copy inside the app is deleted. Files you saved elsewhere are not touched.'}
        onConfirm={async () => { if (del && history.length > 1) { await deleteBackup(del); refresh(); toast('Deleted'); } else toast('Not deleted: it is the only backup', 'error'); }} />
    </Card>
  );
}
