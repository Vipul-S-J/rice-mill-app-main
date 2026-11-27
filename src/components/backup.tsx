import { useCallback, useEffect, useState } from 'react';
import { useDB } from '../context';
import { fmtINR, fmtQty, fmtTradeQty } from '../db';
import { Badge, Button, Card, toast } from './ui';
import { partyName, varietyName } from './pages';
import { saveFile, saveFileDetailed } from '../utils/pdf';
import { passwordBaseKey } from '../backup/crypto';
import { COLLECTIONS, fileName } from '../backup/format';
import { listBackups, putBackup } from '../backup/store';
import type { BackupMeta } from '../backup/store';
import { makeBackupText, nextDue } from '../backup/auto';
import { PasswordFields, checkPw, fmtSize, fmtWhen, useAutoSettings } from './backupUi';
import { AutoBackupCard } from './backupAuto';
import { HistoryCard, RestoreCard } from './backupRestore';

type Saved = { name: string; format: string; at: string; size: number; where?: string };

export function BackupPage() {
  const { db } = useDB();
  const [auto] = useAutoSettings();
  const [history, setHistory] = useState<BackupMeta[]>([]);
  const [busy, setBusy] = useState('');
  const [openText, setOpenText] = useState<{ text: string; label: string; n: number } | null>(null);
  const refresh = useCallback(() => { listBackups().then(setHistory).catch(() => setHistory([])); }, []);
  useEffect(() => {
    refresh();
    window.addEventListener('sprm-backup-settings', refresh);
    return () => window.removeEventListener('sprm-backup-settings', refresh);
  }, [refresh]);

  // ---- manual backup ----
  const [encrypt, setEncrypt] = useState(false);
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [saved, setSaved] = useState<Saved | null>(null);
  const createManual = async () => {
    if (encrypt) { const bad = checkPw(pw, pw2); if (bad) { toast(bad, 'error'); return; } }
    setBusy('Creating backup…');
    try {
      const base = encrypt ? await passwordBaseKey(pw) : null;
      const text = await makeBackupText(db, base ? { base } : null);
      const name = fileName(encrypt, false);
      const mime = encrypt ? 'application/octet-stream' : 'application/json';
      const blob = new Blob([text], { type: mime });
      const r = await saveFileDetailed(name, mime, blob);
      if (r.status === 'cancelled') { toast('Backup cancelled. Nothing was saved.', 'info'); return; }
      await putBackup({ name, createdAt: new Date().toISOString(), size: blob.size, encrypted: encrypt, kind: 'manual' }, text).catch(() => undefined);
      setSaved({ name, format: encrypt ? 'Encrypted (.sprmbackup, AES-256-GCM)' : 'JSON (.json, not encrypted)', at: new Date().toISOString(), size: blob.size, where: r.where });
      setPw(''); setPw2(''); refresh();
      toast('Backup saved');
    } catch (e: any) { toast(`Backup failed: ${e?.message || e}`, 'error'); } finally { setBusy(''); }
  };
  const exportCSV = async () => {
    const rows = [
      ['Module', 'Type', 'ID', 'Date', 'Party', 'Details', 'Amount'],
      ...db.hulling.map(h => ['Hulling', 'Receipt', h.receiptNumber, h.date, partyName(db, h.partyId), `${fmtQty(h.quantityKg)} @ ${fmtINR(h.ratePerQtl)}/Qtl`, String(h.finalTotal)]),
      ...db.purchases.map(p => ['Purchase', 'Voucher', p.voucherNumber, p.date, partyName(db, p.partyId), `${fmtQty(p.netKg)} ${varietyName(db, p.varietyId)}`, String(p.finalTotal)]),
      ...db.sales.map(s => ['Sale', 'Invoice', s.invoiceNumber, s.date, partyName(db, s.partyId), fmtQty(s.quantityKg), String(s.finalTotal)]),
      ...db.dispatches.map(d => ['Dispatch', 'Slip', d.dispatchNumber, d.date, partyName(db, d.partyId), fmtQty(d.netKg), String(d.finalTotal)]),
      ...db.expenses.map(e => ['Expense', 'Expense', e.id, e.date, e.payee || '', '', String(e.amount)]),
      ...db.trading.map(t => [t.kind === 'buy' ? 'Trading Buy' : 'Trading Sell', 'Entry', t.id, t.date, t.partyId ? partyName(db, t.partyId) : t.party || '', `${t.itemName}: ${fmtTradeQty(t.qty, t.unit)} @ ${fmtINR(t.rate)}/${t.rateUnit}`, String(t.total)]),
    ];
    const csv = '\ufeff' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    try {
      const r = await saveFile(`sprm-export-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      if (r !== 'cancelled') toast('CSV exported');
    } catch (e: any) { toast(`Could not save the CSV: ${e?.message || e}`, 'error'); }
  };
  const nd = nextDue(auto);
  const counts = COLLECTIONS.map(c => ({ ...c, n: ((db as any)[c.key] || []).length })).filter(c => c.n > 0);

  return (
    <div className="p-3 space-y-3 pb-6">
      {busy && <div className="fixed inset-x-0 top-16 z-[120] mx-auto w-fit bg-slate-800 text-white text-xs font-semibold rounded-full px-4 py-2 shadow-lg">{busy}</div>}
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between"><h3 className="font-bold text-forest-800">Backup status</h3>
          <Badge tone={auto.enabled ? 'green' : 'gray'}>{auto.enabled ? 'Automatic: ON' : 'Automatic: OFF'}</Badge></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-gray-500">Last successful</dt><dd className="font-semibold">{fmtWhen(auto.lastSuccess)}</dd>
          <dt className="text-gray-500">Next scheduled</dt><dd className="font-semibold">{auto.enabled && nd ? (nd.getTime() <= Date.now() ? 'Due now (runs while the app is open)' : fmtWhen(nd.toISOString())) : '—'}</dd>
          <dt className="text-gray-500">Latest file</dt><dd className="font-semibold break-all">{auto.latest?.name || '—'}</dd>
          <dt className="text-gray-500">Size · Encryption</dt><dd className="font-semibold">{auto.latest ? `${fmtSize(auto.latest.size)} · ${auto.latest.encrypted ? 'Encrypted' : 'Not encrypted'}` : '—'}</dd>
          <dt className="text-gray-500">Saved to</dt><dd className="font-semibold">{auto.latest?.where || '—'}</dd>
        </dl>
        {auto.lastError && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">⚠ {fmtWhen(auto.lastError.time)}: {auto.lastError.message}</div>}
        <p className="text-[11px] text-gray-500">Automatic backups run while the app is open. A scheduled backup happens the next time the app is opened.</p>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-bold text-forest-800">Create a backup now</h3>
        <p className="text-xs text-gray-600">You choose where the file is saved. It holds all records: customers, staff, hulling, purchases, sales, dispatches, cashbook, expenses and settings.</p>
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-700"><input type="checkbox" checked={encrypt} onChange={e => setEncrypt(e.target.checked)} /> Protect with a password (encrypted .sprmbackup)</label>
        {encrypt && <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} />}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={createManual} disabled={!!busy}>💾 Create Backup</Button>
          <Button variant="secondary" onClick={exportCSV}>Export CSV</Button>
        </div>
        {saved && (
          <div className="rounded-xl bg-forest-50 border border-forest-200 p-3 text-xs space-y-0.5">
            <div className="font-bold text-forest-800">✓ Backup saved</div>
            <div>File: <b className="break-all">{saved.name}</b></div>
            <div>Format: {saved.format}</div>
            <div>Date &amp; time: {fmtWhen(saved.at)}</div>
            <div>Size: {fmtSize(saved.size)}</div>
            <div>Location: {saved.where || 'Not reported by this device'}</div>
          </div>
        )}
      </Card>

      <AutoBackupCard history={history} busy={busy} setBusy={setBusy} refresh={refresh} />
      <RestoreCard history={history} busy={busy} setBusy={setBusy} refresh={refresh} openText={openText} />
      <HistoryCard history={history} refresh={refresh} onRestore={(text, label) => setOpenText(o => ({ text, label, n: (o?.n || 0) + 1 }))} />

      <Card className="p-3 text-xs text-gray-600 space-y-1">
        <div className="font-semibold text-forest-800">Records in the app now</div>
        <div className="grid grid-cols-2 gap-x-3">{counts.map(c => <div key={c.key} className="flex justify-between"><span>{c.label}</span><b>{c.n}</b></div>)}</div>
      </Card>
    </div>
  );
}
