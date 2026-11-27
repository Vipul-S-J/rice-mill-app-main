import { useCallback, useEffect, useRef, useState } from 'react';
import { useDB } from '../context';
import { Button, Card, Input, Modal, Select, toast } from './ui';
import { passwordBaseKey } from '../backup/crypto';
import { clearBaseKey, isDue, loadAuto, runAutoBackup, saveBaseKey } from '../backup/auto';
import type { AutoSettings } from '../backup/auto';
import { NeedPermission, allowFolderAccess, folderSupported, forgetFolder, listFolderFiles, openFolder, pickFolder } from '../backup/folder';
import type { BackupMeta } from '../backup/store';
import { PasswordFields, checkPw, fmtSize, useAutoSettings } from './backupUi';

/** Runs the automatic backups while the app is open (on a schedule, and shortly after changes). Renders nothing. */
export function AutoBackupRunner() {
  const { db } = useDB();
  const dbRef = useRef(db);
  dbRef.current = db;
  const first = useRef(true);
  const run = useCallback(async (reason: string) => {
    try { await runAutoBackup(dbRef.current, reason); }
    catch (e: any) { toast(`Automatic backup failed: ${e?.message || e}`, 'error'); }
  }, []);
  useEffect(() => {
    const tick = () => { const s = loadAuto(); if (s.enabled && isDue(s)) void run('scheduled'); };
    const t0 = setTimeout(tick, 8000);
    const iv = setInterval(tick, 60000);
    const vis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearTimeout(t0); clearInterval(iv); document.removeEventListener('visibilitychange', vis); };
  }, [run]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!loadAuto().onChange) return;
    // wait for a quiet moment after the last change; at most one change-triggered backup per 10 minutes
    const t = setTimeout(() => {
      const n = loadAuto();
      const last = n.lastSuccess ? Date.parse(n.lastSuccess) : 0;
      if (n.enabled && n.onChange && Date.now() - last > 10 * 60 * 1000) void run('after changes');
    }, 90000);
    return () => clearTimeout(t);
  }, [db, run]);
  return null;
}

export function AutoBackupCard({ history, busy, setBusy, refresh }: { history: BackupMeta[]; busy: string; setBusy: (s: string) => void; refresh: () => void }) {
  const { db } = useDB();
  const [auto, setAuto] = useAutoSettings();
  const [showEnc, setShowEnc] = useState(false);
  const [apw, setApw] = useState(''); const [apw2, setApw2] = useState('');
  const [note, setNote] = useState('');
  const [usage, setUsage] = useState('');
  useEffect(() => {
    (async () => {
      let txt = `${fmtSize(history.reduce((s, b) => s + b.size, 0))} inside the app`;
      if (auto.folder) {
        try { const f = (await listFolderFiles(auto.folder)).filter(x => /^SPRM_/.test(x.name)); txt += ` · ${fmtSize(f.reduce((s, x) => s + x.size, 0))} in the chosen folder`; }
        catch { txt += ' · folder size not available'; }
      }
      setUsage(txt);
    })();
  }, [history, auto.folder]);
  const setPassword = async () => {
    const bad = checkPw(apw, apw2); if (bad) { toast(bad, 'error'); return; }
    await saveBaseKey(await passwordBaseKey(apw));
    setAuto({ encrypt: true }); setShowEnc(false); setApw(''); setApw2('');
    toast('Automatic backups will now be encrypted');
  };
  const choose = async () => {
    try { const f = await pickFolder(); setAuto({ folder: f }); setNote(''); toast(`Backups will also be saved to “${f.name}”`); }
    catch (e: any) { if (!/cancel|abort/i.test(String(e?.message || e?.name))) toast(`Could not choose the folder: ${e?.message || e}`, 'error'); }
  };
  const backupNow = async () => {
    setBusy('Backing up…');
    try { await runAutoBackup(db, 'manual run'); toast('Backup done'); refresh(); }
    catch (e: any) { toast(`Backup failed: ${e?.message || e}`, 'error'); }
    finally { setBusy(''); }
  };
  const k = auto.keep;
  const num = (v: string, min: number) => Math.max(min, Math.floor(Number(v) || 0));
  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-bold text-forest-800">Automatic backup</h3>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={auto.enabled} onChange={e => setAuto({ enabled: e.target.checked })} /> Turn on automatic backup</label>
      <div className="grid grid-cols-2 gap-2">
        <Select label="How often" value={auto.frequency} onChange={e => setAuto({ frequency: e.target.value as AutoSettings['frequency'] })}
          options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} />
        <label className="flex items-end gap-2 text-xs font-semibold text-gray-700 pb-2.5"><input type="checkbox" checked={auto.onChange} onChange={e => setAuto({ onChange: e.target.checked })} /> Also after changes</label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input label="Keep daily" type="number" min={1} value={k.daily} onChange={e => setAuto({ keep: { ...k, daily: num(e.target.value, 1) } })} />
        <Input label="Keep weekly" type="number" min={0} value={k.weekly} onChange={e => setAuto({ keep: { ...k, weekly: num(e.target.value, 0) } })} />
        <Input label="Keep monthly" type="number" min={0} value={k.monthly} onChange={e => setAuto({ keep: { ...k, monthly: num(e.target.value, 0) } })} />
      </div>
      <p className="text-[11px] text-gray-500">Old automatic backups are removed only after the new one is saved, and the newest is never removed. Manual backups are never removed automatically.</p>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 p-2.5">
        <div className="text-xs"><div className="font-semibold">Encrypt automatic backups</div><div className="text-gray-500">{auto.encrypt ? 'On: encrypted with your password.' : 'Off: plain JSON files.'}</div></div>
        {auto.encrypt
          ? <div className="flex gap-1.5"><Button size="sm" variant="secondary" onClick={() => setShowEnc(true)}>Change</Button><Button size="sm" variant="ghost" onClick={async () => { await clearBaseKey(); setAuto({ encrypt: false }); toast('Automatic backups are no longer encrypted'); }}>Turn off</Button></div>
          : <Button size="sm" onClick={() => setShowEnc(true)}>Set password</Button>}
      </div>
      <FolderBox auto={auto} setAuto={setAuto} note={note} setNote={setNote} choose={choose} />
      <Button className="w-full" variant="secondary" onClick={backupNow} disabled={!!busy}>Back up now</Button>
      <p className="text-[11px] text-gray-500">Storage used: {usage || '—'}</p>
      <Modal open={showEnc} onClose={() => setShowEnc(false)} title="Password for automatic backups" maxWidth="max-w-sm"
        footer={<><Button variant="secondary" onClick={() => setShowEnc(false)}>Cancel</Button><Button onClick={setPassword}>Save password</Button></>}>
        <PasswordFields pw={apw} pw2={apw2} setPw={setApw} setPw2={setApw2} />
      </Modal>
    </Card>
  );
}

function FolderBox({ auto, setAuto, note, setNote, choose }: { auto: AutoSettings; setAuto: (p: Partial<AutoSettings>) => void; note: string; setNote: (s: string) => void; choose: () => void }) {
  const f = auto.folder;
  return (
    <div className="rounded-xl border border-gray-200 p-2.5 space-y-2">
      <div className="text-xs font-semibold">Backup folder (optional)</div>
      <div className="text-xs text-gray-600">{f ? <>Saving copies to <b>{f.name}</b></> : 'Not set. Backups stay inside the app and are lost if the app is uninstalled. Choose a folder to keep copies on the phone.'}</div>
      <div className="flex flex-wrap gap-1.5">
        {folderSupported() ? <Button size="sm" variant="secondary" onClick={choose}>{f ? 'Change folder' : 'Choose folder'}</Button> : <span className="text-[11px] text-gray-500">This browser cannot choose a backup folder.</span>}
        {f?.kind === 'web' && <Button size="sm" variant="secondary" onClick={async () => { try { await allowFolderAccess(); setNote('Folder access allowed.'); } catch (e: any) { setNote(e instanceof NeedPermission ? e.message : e.message); } }}>Allow folder access</Button>}
        {f && <Button size="sm" variant="secondary" onClick={async () => { try { await openFolder(f); } catch (e: any) { setNote(e.message); } }}>Open location</Button>}
        {f && <Button size="sm" variant="ghost" onClick={async () => { await forgetFolder(f); setAuto({ folder: null }); }}>Remove</Button>}
      </div>
      {note && <div className="text-[11px] text-amber-700">{note}</div>}
    </div>
  );
}
