import { useMemo, useState } from 'react';
import { useDB } from '../context';
import { fmtDate, fmtINR, round2, today } from '../db';
import type { Advance } from '../types';
import { Badge, Button, Card, Confirm, EmptyState, Expandable, Input, MiniBtn, Modal, SearchBar, Select, toast } from './ui';
import { usePaymentModes } from './pages';
import { esc } from '../utils/print';
import { savePdfWithToast, sharePdfWithToast } from './pdfActions';
import { markLabel, nameOf, outstandingAdvance, staffOf, workerLedger, workersOf } from '../staff';

export function AdvancesTab() {
  const { db, saveAdvance, deleteAdvance } = useDB();
  const [q, setQ] = useState('');
  const [worker, setWorker] = useState('all');
  const [edit, setEdit] = useState<Advance | 'new' | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const list = useMemo(() => db.advances.filter(a => (worker === 'all' || a.workerId === worker) && (!q.trim() || `${nameOf(db, a.workerId)} ${a.remarks || ''} ${a.mode}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => b.date.localeCompare(a.date)), [db, q, worker]);
  const total = round2(list.reduce((s, a) => s + a.amount, 0));
  const open = worker !== 'all' ? outstandingAdvance(db, worker, today()) : round2(workersOf(db).reduce((s, w) => s + outstandingAdvance(db, w.id, today()), 0));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Select value={worker} onChange={e => setWorker(e.target.value)} options={[{ value: 'all', label: 'All workers' }, ...workersOf(db).map(w => ({ value: w.id, label: w.name }))]} />
        <Button onClick={() => setEdit('new')}>＋ Give advance</Button>
      </div>
      <SearchBar value={q} onChange={setQ} placeholder="Search remarks, worker, mode…" />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-white border border-gray-100 p-3 shadow-soft"><div className="text-[10px] font-semibold text-gray-500 uppercase">Advances listed</div><div className="text-lg font-extrabold">{fmtINR(total, { decimals: 0 })}</div></div>
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3"><div className="text-[10px] font-semibold text-amber-800 uppercase">Outstanding now</div><div className="text-lg font-extrabold text-amber-800">{fmtINR(open, { decimals: 0 })}</div></div>
      </div>
      <Card>
        {list.length === 0 ? <EmptyState title="No advances" subtitle="Advances are recovered from salary when payroll is finalised." /> : list.map(a => (
          <div key={a.id} className="px-3 py-2.5 border-b border-gray-100 last:border-0">
            <Expandable head={
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="text-sm font-semibold truncate">{nameOf(db, a.workerId)}</div><div className="text-[11px] text-gray-500">{fmtDate(a.date)} · {a.mode}</div></div>
                <b className="text-sm shrink-0">{fmtINR(a.amount)}</b>
              </div>
            }>
              <div className="text-[11px] text-gray-600">{a.remarks || 'No remarks'}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">Outstanding advance of this worker now: <b>{fmtINR(outstandingAdvance(db, a.workerId, today()))}</b></div>
              <div className="flex gap-1.5 mt-2"><MiniBtn tone="blue" onClick={() => setEdit(a)}>✎ Edit</MiniBtn><MiniBtn tone="danger" onClick={() => setDel(a.id)}>🗑 Delete</MiniBtn></div>
            </Expandable>
          </div>
        ))}
      </Card>
      {edit && <AdvanceForm adv={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSave={saveAdvance} presetWorker={worker !== 'all' ? worker : ''} />}
      <Confirm open={!!del} onClose={() => setDel(null)} title="Delete this advance?" confirmText="Delete"
        message="The advance and its cashbook entry are removed. Payroll amounts are recalculated from what is left." onConfirm={() => { if (del) deleteAdvance(del); setDel(null); toast('Advance deleted'); }} />
    </div>
  );
}

function AdvanceForm({ adv, onClose, onSave, presetWorker }: { adv: Advance | null; onClose: () => void; onSave: (e: any) => void; presetWorker: string }) {
  const { db } = useDB();
  const modes = usePaymentModes();
  const [date, setDate] = useState(adv?.date || today());
  const [worker, setWorker] = useState(adv?.workerId || presetWorker);
  const [amount, setAmount] = useState(adv ? String(adv.amount) : '');
  const [mode, setMode] = useState(adv?.mode || modes[0] || 'Cash');
  const [remarks, setRemarks] = useState(adv?.remarks || '');
  const [saving, setSaving] = useState(false);
  const save = () => {
    if (saving) return;
    if (!worker) { toast('Choose the worker', 'error'); return; }
    if (!(Number(amount) > 0)) { toast('Enter the advance amount', 'error'); return; }
    setSaving(true);
    onSave({ id: adv?.id, date, workerId: worker, amount: round2(Number(amount)), mode, remarks: remarks.trim() || undefined });
    toast(adv ? 'Advance updated' : 'Advance saved'); onClose();
  };
  return (
    <Modal open onClose={onClose} title={adv ? 'Edit advance' : 'Give advance'} maxWidth="max-w-sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>Save</Button></>}>
      <div className="space-y-3">
        <Select label="Worker *" value={worker} onChange={e => setWorker(e.target.value)} options={[{ value: '', label: '— Select —' }, ...workersOf(db).map(w => ({ value: w.id, label: w.name }))]} />
        <div className="grid grid-cols-2 gap-2"><Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} /><Input label="Amount (₹) *" type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <Select label="Paid by" value={mode} onChange={e => setMode(e.target.value)} options={modes.length ? modes : ['Cash', 'UPI', 'Bank']} />
        <Input label="Remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
        <p className="text-[11px] text-gray-500">A cashbook payment is recorded automatically. Do not enter the same advance again in the Cashbook.</p>
      </div>
    </Modal>
  );
}

const KIND_TONE: Record<string, 'green' | 'red' | 'gold' | 'blue' | 'gray'> = { Wages: 'green', 'Hulling wages': 'green', Advance: 'gold', Payment: 'blue', Deduction: 'red', Opening: 'gray' };

export function LedgerTab({ presetWorker }: { presetWorker: string }) {
  const { db } = useDB();
  const [worker, setWorker] = useState(presetWorker);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [q, setQ] = useState(''); const [desc, setDesc] = useState(false);
  const w = db.parties.find(p => p.id === worker);
  const all = useMemo(() => (worker ? workerLedger(db, worker) : []), [db, worker]);
  const rows = useMemo(() => {
    const r = all.filter(l => (!from || !l.date || l.date >= from) && (!to || !l.date || l.date <= to) && (!q.trim() || `${l.kind} ${l.text}`.toLowerCase().includes(q.trim().toLowerCase())));
    return desc ? [...r].reverse() : r;
  }, [all, from, to, q, desc]);
  const sum = (k: string[]) => round2(rows.filter(l => k.includes(l.kind)).reduce((s, l) => s + l.credit, 0));
  const earned = sum(['Wages', 'Hulling wages']);
  const advances = round2(rows.filter(l => l.kind === 'Advance').reduce((s, l) => s + l.debit, 0));
  const paid = round2(rows.filter(l => l.kind === 'Payment').reduce((s, l) => s + l.debit, 0));
  const deductions = round2(rows.filter(l => l.kind === 'Deduction').reduce((s, l) => s + l.debit, 0));
  const pending = all.length ? all[all.length - 1].balance : 0;
  const att = useMemo(() => db.attendance.filter(a => a.workerId === worker && (!from || a.date >= from) && (!to || a.date <= to)).sort((a, b) => b.date.localeCompare(a.date)), [db.attendance, worker, from, to]);
  const html = () => `<div class="vch"><div class="c"><h1>${esc(db.settings.millName)}</h1><div class="muted">Worker ledger · ${esc(w?.name || '')}${from || to ? ` · ${from || '…'} to ${to || '…'}` : ''}</div></div>
    <table><tr><th>Date</th><th>Type</th><th>Particulars</th><th class="r">Earned</th><th class="r">Paid / adv.</th><th class="r">Balance</th></tr>
    ${rows.map(l => `<tr><td>${l.date ? fmtDate(l.date) : '-'}</td><td>${esc(l.kind)}</td><td>${esc(l.text)}</td><td class="r">${l.credit ? fmtINR(l.credit) : ''}</td><td class="r">${l.debit ? fmtINR(l.debit) : ''}</td><td class="r">${fmtINR(l.balance)}</td></tr>`).join('')}
    <tr class="tot"><td colspan="5">${pending >= 0 ? 'Mill owes the worker' : 'Worker owes the mill (advance)'}</td><td class="r">${fmtINR(Math.abs(pending))}</td></tr></table></div>`;
  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <Select label="Worker" value={worker} onChange={e => setWorker(e.target.value)} options={[{ value: '', label: '— Select worker —' }, ...workersOf(db).map(x => ({ value: x.id, label: x.name }))]} />
        {worker && <>
          <div className="grid grid-cols-2 gap-2"><Input label="From" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input label="To" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <SearchBar value={q} onChange={setQ} placeholder="Search the ledger…" />
        </>}
      </Card>
      {!worker ? <Card className="p-6 text-center text-xs text-gray-500">Choose a worker to see the ledger.</Card> : <>
        <div className="grid grid-cols-2 gap-2">
          {[['Wages earned', earned, 'text-forest-700'], ['Advances given', advances, 'text-amber-700'], ['Salary / wages paid', paid, 'text-blue-700'], ['Deductions', deductions, 'text-red-600']].map(([l, v, c]) => (
            <div key={l as string} className="rounded-2xl bg-white border border-gray-100 p-3 shadow-soft"><div className="text-[10px] font-semibold text-gray-500 uppercase">{l as string}</div><div className={`text-lg font-extrabold ${c}`}>{fmtINR(v as number, { decimals: 0 })}</div></div>
          ))}
        </div>
        <div className={`rounded-2xl border p-3 ${pending >= 0 ? 'bg-forest-50 border-forest-200 text-forest-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <div className="text-[11px] font-semibold uppercase">Pending balance (all dates)</div>
          <div className="text-2xl font-extrabold">{fmtINR(Math.abs(pending))}</div>
          <div className="text-xs font-semibold">{pending > 0.009 ? 'The mill owes the worker' : pending < -0.009 ? 'The worker owes the mill (unrecovered advance)' : 'Settled'}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setDesc(d => !d)}>{desc ? '↑ Oldest first' : '↓ Newest first'}</Button>
          <Button variant="secondary" className="flex-1" onClick={() => sharePdfWithToast(`Ledger ${w?.name}`, html(), `${db.settings.millName}\nWorker ledger: ${w?.name}\nPending: ${fmtINR(pending)}`)}>Share PDF</Button>
          <Button variant="gold" className="flex-1" onClick={() => savePdfWithToast(`Ledger ${w?.name}`, html())}>Print / PDF</Button>
        </div>
        <Card>
          {rows.length === 0 ? <EmptyState title="No entries" /> : rows.map((l, i) => (
            <div key={i} className="px-3 py-2 border-b border-gray-100 last:border-0 flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="flex items-center gap-1.5"><Badge tone={KIND_TONE[l.kind]}>{l.kind}</Badge><span className="text-[11px] text-gray-500">{l.date ? fmtDate(l.date) : ''}</span></div><div className="text-xs mt-0.5">{l.text}</div></div>
              <div className="text-right shrink-0"><div className={`text-sm font-bold ${l.credit ? 'text-forest-700' : 'text-red-600'}`}>{l.credit ? `+${fmtINR(l.credit)}` : `−${fmtINR(l.debit)}`}</div><div className="text-[10px] text-gray-500">Bal {fmtINR(l.balance, { decimals: 0 })}</div></div>
            </div>
          ))}
        </Card>
        <Card className="p-3">
          <Expandable head={<div className="text-sm font-bold">Attendance history ({att.length})</div>}>
            {att.length === 0 ? <div className="text-xs text-gray-500">No attendance saved.</div> : <div className="grid grid-cols-2 gap-x-3 text-[11px]">{att.map(a => <div key={a.id} className="flex justify-between border-b border-gray-50 py-0.5"><span>{fmtDate(a.date)}</span><span>{markLabel(a.status)}{a.overtimeHours ? ` +${a.overtimeHours}h` : ''}</span></div>)}</div>}
            <div className="text-[10px] text-gray-500 mt-1">Rate {w?.staff ? fmtINR(staffOf(w).wageRate) : '—'}. Farm / other work and wages for a month appear here once that month's payroll is finalised.</div>
          </Expandable>
        </Card>
      </>}
    </div>
  );
}
