import { useEffect, useMemo, useState } from 'react';
import { useDB } from '../context';
import { fmtDate, fmtINR, round2, today } from '../db';
import type { AttendanceStatus, WorkRecord } from '../types';
import { Badge, Button, Card, Chips, Confirm, EmptyState, Expandable, Input, MiniBtn, Modal, SearchBar, Select, toast } from './ui';
import { WAGE_LABEL, dayWage, markLabel, monthOf, nameOf, staffOf, workersOf } from '../staff';

const STATUSES: { v: AttendanceStatus; label: string; on: string }[] = [
  { v: 'present', label: 'Present', on: 'bg-green-600 text-white border-green-600' },
  { v: 'half', label: 'Half day', on: 'bg-amber-500 text-white border-amber-500' },
  { v: 'absent', label: 'Absent', on: 'bg-red-600 text-white border-red-600' },
  { v: 'leave', label: 'Leave', on: 'bg-sky-600 text-white border-sky-600' },
];
type Draft = { status?: AttendanceStatus; hours: string; ot: string };

export function AttendanceTab() {
  const [sub, setSub] = useState<'daily' | 'monthly' | 'other'>('daily');
  return (
    <div className="space-y-3">
      <Chips value={sub} onChange={v => setSub(v as typeof sub)} options={[{ value: 'daily', label: 'Mark attendance' }, { value: 'monthly', label: 'Monthly view' }, { value: 'other', label: 'Farm / other work' }]} />
      {sub === 'daily' ? <DailyMarking /> : sub === 'monthly' ? <MonthlyView /> : <OtherWork />}
    </div>
  );
}

function DailyMarking() {
  const { db, saveAttendanceBatch, deleteAttendance } = useDB();
  const [date, setDate] = useState(today());
  const [q, setQ] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [del, setDel] = useState<string | null>(null);
  const staff = useMemo(() => workersOf(db).filter(w => !w.staff?.inactive && (!q.trim() || w.name.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)), [db, q]);
  const saved = useMemo(() => new Map(db.attendance.filter(a => a.date === date).map(a => [a.workerId, a])), [db.attendance, date]);
  // when the date (or saved data) changes, start from what is already saved for that day
  useEffect(() => {
    const d: Record<string, Draft> = {};
    saved.forEach((a, id) => { d[id] = { status: a.status, hours: a.hours ? String(a.hours) : '', ot: a.overtimeHours ? String(a.overtimeHours) : '' }; });
    setDrafts(d);
  }, [date, saved]);
  const get = (id: string): Draft => drafts[id] || { hours: '', ot: '' };
  const set = (id: string, p: Partial<Draft>) => setDrafts(d => ({ ...d, [id]: { ...get(id), ...p } }));
  const markAll = (status: AttendanceStatus) => setDrafts(d => { const n = { ...d }; staff.forEach(w => { n[w.id] = { ...(n[w.id] || { hours: '', ot: '' }), status }; }); return n; });
  const rows = staff.filter(w => get(w.id).status);
  const save = () => {
    if (!date) { toast('Choose the date', 'error'); return; }
    if (rows.length === 0) { toast('Mark at least one worker', 'error'); return; }
    const r = saveAttendanceBatch(rows.map(w => ({ date, workerId: w.id, status: get(w.id).status!, hours: Number(get(w.id).hours) || undefined, overtimeHours: Number(get(w.id).ot) || undefined })));
    toast(`Attendance saved: ${r.added} new, ${r.updated} updated`);
  };
  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2 items-end">
          <Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          <div className="text-[11px] text-gray-500 pb-2.5">{saved.size} saved · {rows.length} marked</div>
        </div>
        <SearchBar value={q} onChange={setQ} placeholder="Search worker…" />
        <div className="flex gap-1.5 flex-wrap">
          <MiniBtn tone="green" onClick={() => markAll('present')}>All present</MiniBtn>
          <MiniBtn tone="danger" onClick={() => markAll('absent')}>All absent</MiniBtn>
          <MiniBtn onClick={() => setDrafts({})}>Clear</MiniBtn>
        </div>
        <p className="text-[11px] text-gray-500">This is <b>rice-mill</b> attendance. If a worker did farm work instead, mark Absent here and record the farm work under “Farm / other work”.</p>
      </Card>
      <Card>
        {staff.length === 0 ? <EmptyState title="No staff to mark" subtitle="Register workers in the Staff tab first." /> : staff.map(w => {
          const dr = get(w.id), sp = staffOf(w), rec = saved.get(w.id);
          return (
            <div key={w.id} className="px-3 py-2.5 border-b border-gray-100 last:border-0 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0"><div className="text-sm font-semibold truncate">{w.name}</div><div className="text-[10px] text-gray-500">{w.staff ? WAGE_LABEL[sp.wageType] : 'Hulling wage worker'}{rec ? ' · saved' : ''}</div></div>
                {rec && <button className="text-[11px] font-semibold text-red-600" onClick={() => setDel(rec.id)}>Remove</button>}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {STATUSES.map(s => (
                  <button key={s.v} type="button" onClick={() => set(w.id, { status: dr.status === s.v ? undefined : s.v })}
                    className={`py-1.5 rounded-lg border text-[11px] font-bold ${dr.status === s.v ? s.on : 'bg-white border-gray-200 text-gray-600'}`}>{s.label}</button>
                ))}
              </div>
              {dr.status && dr.status !== 'absent' && dr.status !== 'leave' && (
                <div className="grid grid-cols-2 gap-2">
                  {sp.wageType === 'hourly' && <Input label="Hours worked" type="number" inputMode="decimal" value={dr.hours} onChange={e => set(w.id, { hours: e.target.value })} placeholder={dr.status === 'half' ? '4' : '8'} />}
                  <Input label="Overtime hours" type="number" inputMode="decimal" value={dr.ot} onChange={e => set(w.id, { ot: e.target.value })} placeholder="0" />
                </div>
              )}
            </div>
          );
        })}
      </Card>
      <Button className="w-full" size="lg" onClick={save}>💾 Save attendance</Button>
      <Confirm open={!!del} onClose={() => setDel(null)} title="Remove this attendance record?" confirmText="Remove" message="Only this day's record for this worker is removed."
        onConfirm={() => { if (del) deleteAttendance(del); setDel(null); }} />
    </div>
  );
}

function MonthlyView() {
  const { db } = useDB();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [worker, setWorker] = useState('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => workersOf(db)
    .filter(w => (worker === 'all' || w.id === worker) && (!q.trim() || w.name.toLowerCase().includes(q.trim().toLowerCase())))
    .map(w => {
      const recs = db.attendance.filter(a => a.workerId === w.id && monthOf(a.date) === month).sort((a, b) => a.date.localeCompare(b.date));
      const c = (s: AttendanceStatus) => recs.filter(a => a.status === s).length;
      return { w, recs, present: c('present'), half: c('half'), absent: c('absent'), leave: c('leave'), ot: round2(recs.reduce((s, a) => s + (a.overtimeHours || 0), 0)), wage: round2(recs.reduce((s, a) => s + dayWage(a), 0)) };
    }).filter(r => r.recs.length > 0 || worker !== 'all'), [db, month, worker, q]);
  return (
    <div className="space-y-3">
      <Card className="p-3 grid grid-cols-2 gap-2">
        <Input label="Month" type="month" value={month} onChange={e => setMonth(e.target.value)} />
        <Select label="Worker" value={worker} onChange={e => setWorker(e.target.value)} options={[{ value: 'all', label: 'All workers' }, ...workersOf(db).map(w => ({ value: w.id, label: w.name }))]} />
        <div className="col-span-2"><SearchBar value={q} onChange={setQ} placeholder="Search worker…" /></div>
      </Card>
      <Card>
        {rows.length === 0 ? <EmptyState title="No attendance saved for this month" /> : rows.map(r => (
          <div key={r.w.id} className="px-3 py-2.5 border-b border-gray-100 last:border-0">
            <Expandable head={
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="text-sm font-semibold truncate">{r.w.name}</div>
                  <div className="text-[11px] text-gray-500">Present {r.present} · Half {r.half} · Absent {r.absent} · Leave {r.leave}{r.ot ? ` · OT ${r.ot}h` : ''}</div></div>
                {r.wage > 0 && <b className="text-xs shrink-0">{fmtINR(r.wage, { decimals: 0 })}</b>}
              </div>
            }>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                {r.recs.map(a => (
                  <div key={a.id} className="flex justify-between border-b border-gray-50 py-0.5">
                    <span>{fmtDate(a.date)}</span>
                    <span className={a.status === 'present' ? 'text-green-700' : a.status === 'absent' ? 'text-red-600' : 'text-amber-700'}>{markLabel(a.status)}{a.overtimeHours ? ` +${a.overtimeHours}h` : ''}</span>
                  </div>
                ))}
              </div>
            </Expandable>
          </div>
        ))}
      </Card>
    </div>
  );
}

function OtherWork() {
  const { db, saveWorkRecord, deleteWorkRecord } = useDB();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [edit, setEdit] = useState<WorkRecord | 'new' | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const list = useMemo(() => db.workRecords.filter(r => monthOf(r.date) === month).sort((a, b) => b.date.localeCompare(a.date)), [db.workRecords, month]);
  const total = round2(list.reduce((s, r) => s + r.amount, 0));
  return (
    <div className="space-y-3">
      <Card className="p-3 grid grid-cols-[1fr_auto] gap-2 items-end">
        <Input label="Month" type="month" value={month} onChange={e => setMonth(e.target.value)} />
        <Button onClick={() => setEdit('new')}>＋ Add</Button>
      </Card>
      <div className="text-[11px] text-gray-500 px-1">Farm or other work has its <b>own rate</b>. It is never worked out from the mill wage. These amounts are added to the worker's payroll for the month.</div>
      <Card>
        {list.length === 0 ? <EmptyState title="No farm / other work recorded this month" /> : list.map(r => (
          <div key={r.id} className="px-3 py-2.5 border-b border-gray-100 last:border-0 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{nameOf(db, r.workerId)}</div>
              <div className="text-[11px] text-gray-500">{fmtDate(r.date)} · <Badge tone="gold">{r.location}</Badge> {r.qty} {r.basis} @ {fmtINR(r.rate)}{r.description ? ` · ${r.description}` : ''}</div>
              <div className="flex gap-3 mt-1"><button className="text-[11px] font-semibold text-blue-700" onClick={() => setEdit(r)}>Edit</button><button className="text-[11px] font-semibold text-red-600" onClick={() => setDel(r.id)}>Delete</button></div>
            </div>
            <b className="text-sm shrink-0">{fmtINR(r.amount)}</b>
          </div>
        ))}
      </Card>
      {list.length > 0 && <div className="text-xs bg-white border border-gray-100 rounded-xl px-3 py-2 flex justify-between"><span>{list.length} record(s)</span><b>Total {fmtINR(total)}</b></div>}
      {edit && <WorkForm rec={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSave={saveWorkRecord} />}
      <Confirm open={!!del} onClose={() => setDel(null)} title="Delete this record?" confirmText="Delete" message="If it was already included in a finalised payroll, that payroll keeps its saved amount."
        onConfirm={() => { if (del) deleteWorkRecord(del); setDel(null); }} />
    </div>
  );
}

function WorkForm({ rec, onClose, onSave }: { rec: WorkRecord | null; onClose: () => void; onSave: (e: any) => void }) {
  const { db } = useDB();
  const [date, setDate] = useState(rec?.date || today());
  const [worker, setWorker] = useState(rec?.workerId || '');
  const [location, setLocation] = useState(rec?.location || 'Farm');
  const [desc, setDesc] = useState(rec?.description || '');
  const [basis, setBasis] = useState<WorkRecord['basis']>(rec?.basis || 'days');
  const [qty, setQty] = useState(rec ? String(rec.qty) : '');
  const [rate, setRate] = useState(rec ? String(rec.rate) : '');
  const [amount, setAmount] = useState<string | null>(rec ? String(rec.amount) : null);
  const auto = round2((Number(qty) || 0) * (Number(rate) || 0));
  const shown = amount ?? String(auto);
  const save = () => {
    if (!worker) { toast('Choose the worker', 'error'); return; }
    if (!(Number(qty) > 0)) { toast('Enter the quantity', 'error'); return; }
    if (!(Number(rate) > 0)) { toast('Enter the rate for this work', 'error'); return; }
    onSave({ id: rec?.id, date, workerId: worker, location: location.trim() || 'Farm', description: desc.trim() || undefined, basis, qty: Number(qty), rate: Number(rate), amount: round2(Number(shown) || 0) });
    toast('Work saved'); onClose();
  };
  return (
    <Modal open onClose={onClose} title={rec ? 'Edit work' : 'Add farm / other work'} maxWidth="max-w-md" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          <Select label="Worker *" value={worker} onChange={e => setWorker(e.target.value)} options={[{ value: '', label: '— Select —' }, ...workersOf(db).map(w => ({ value: w.id, label: w.name }))]} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Work place" list="work-places" value={location} onChange={e => setLocation(e.target.value)} />
          <datalist id="work-places"><option value="Farm" /><option value="Other" /></datalist>
          <Select label="Counted in" value={basis} onChange={e => setBasis(e.target.value as WorkRecord['basis'])} options={[{ value: 'days', label: 'Days' }, { value: 'hours', label: 'Hours' }, { value: 'piece', label: 'Piece / job' }]} />
        </div>
        <Input label="What work" value={desc} onChange={e => setDesc(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label={`Quantity (${basis}) *`} type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />
          <Input label={`Rate per ${basis === 'piece' ? 'piece' : basis.slice(0, -1)} (₹) *`} type="number" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />
        </div>
        <Input label="Amount (₹) — you can edit it" type="number" inputMode="decimal" value={shown} onChange={e => setAmount(e.target.value)} />
      </div>
    </Modal>
  );
}
