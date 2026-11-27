import { useMemo, useState } from 'react';
import { useDB } from '../context';
import { fmtDate, fmtINR, today } from '../db';
import type { Party, StaffProfile, WageType } from '../types';
import { Badge, Button, Card, Chips, Confirm, EmptyState, Expandable, Input, MiniBtn, Modal, SearchBar, Select, Textarea, toast } from './ui';
import { WAGE_LABEL, ledgerPending, otRateOf, staffOf, workersOf } from '../staff';

const digits = (s?: string) => (s || '').replace(/\D/g, '');
const rateUnit = (t: WageType) => (t === 'daily' ? 'per day' : t === 'monthly' ? 'per month' : t === 'hourly' ? 'per hour' : '');

export function StaffTab({ onLedger }: { onLedger: (workerId: string) => void }) {
  const { db } = useDB();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'inactive' | 'all'>('active');
  const [edit, setEdit] = useState<Party | 'new' | null>(null);
  const list = useMemo(() => workersOf(db)
    .filter(w => (show === 'all' ? true : show === 'inactive' ? !!w.staff?.inactive : !w.staff?.inactive))
    .filter(w => !q.trim() || `${w.name} ${w.phone || ''} ${w.staff?.role || ''} ${w.village || ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [db, q, show]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1"><SearchBar value={q} onChange={setQ} placeholder="Search name, mobile, role…" /></div>
        <Button onClick={() => setEdit('new')}>＋ Add</Button>
      </div>
      <Chips value={show} onChange={v => setShow(v as typeof show)} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} />
      <Card>
        {list.length === 0 ? <EmptyState title="No staff found" subtitle="Tap Add to register a worker. Workers from your old hulling wage entries appear here automatically." /> : list.map(w => {
          const sp = staffOf(w);
          const pending = ledgerPending(db, w.id);
          return (
            <div key={w.id} className="px-3 py-2.5 border-b border-gray-100 last:border-0">
              <Expandable head={
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{w.name}</div>
                    <div className="text-[11px] text-gray-500">{sp.role || 'Worker'} · {w.staff ? `${WAGE_LABEL[sp.wageType]}${sp.wageRate ? ` ₹${sp.wageRate} ${rateUnit(sp.wageType)}` : ''}` : 'Hulling wage worker'}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {sp.inactive ? <Badge tone="gray">Inactive</Badge> : <Badge tone="green">Active</Badge>}
                    {pending !== 0 && <span className={`text-[10px] font-bold ${pending > 0 ? 'text-red-600' : 'text-amber-700'}`}>{pending > 0 ? `Owed ${fmtINR(pending, { decimals: 0 })}` : `Advance ${fmtINR(-pending, { decimals: 0 })}`}</span>}
                  </div>
                </div>
              }>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                  <dt className="text-gray-500">Mobile</dt><dd>{w.phone || '—'}</dd>
                  <dt className="text-gray-500">Village / address</dt><dd>{w.village || w.address || '—'}</dd>
                  <dt className="text-gray-500">Joined</dt><dd>{sp.joiningDate ? fmtDate(sp.joiningDate) : '—'}</dd>
                  <dt className="text-gray-500">Overtime / hour</dt><dd>{otRateOf(sp) ? fmtINR(otRateOf(sp)) : '—'}</dd>
                  <dt className="text-gray-500">Remarks</dt><dd>{sp.remarks || '—'}</dd>
                </dl>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <MiniBtn tone="blue" onClick={() => setEdit(w)}>✎ Edit</MiniBtn>
                  <MiniBtn onClick={() => onLedger(w.id)}>📒 Ledger</MiniBtn>
                </div>
              </Expandable>
            </div>
          );
        })}
      </Card>
      {edit && <StaffForm worker={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function StaffForm({ worker, onClose }: { worker: Party | null; onClose: () => void }) {
  const { db, upsertParty } = useDB();
  const sp = staffOf(worker || undefined);
  const [name, setName] = useState(worker?.name || '');
  const [phone, setPhone] = useState(worker?.phone || '');
  const [village, setVillage] = useState(worker?.village || worker?.address || '');
  const [role, setRole] = useState(sp.role || '');
  const [joined, setJoined] = useState(sp.joiningDate || today());
  const [type, setType] = useState<WageType>(worker?.staff ? sp.wageType : 'daily');
  const [rate, setRate] = useState(sp.wageRate ? String(sp.wageRate) : '');
  const [ot, setOt] = useState(sp.otRate ? String(sp.otRate) : '');
  const [remarks, setRemarks] = useState(sp.remarks || '');
  const [active, setActive] = useState(!sp.inactive);
  const [reuse, setReuse] = useState<Party | null>(null);
  const profile = (): StaffProfile => ({
    role: role.trim() || undefined, joiningDate: joined || undefined, wageType: type, wageRate: Number(rate) || 0,
    otRate: Number(ot) > 0 ? Number(ot) : undefined, remarks: remarks.trim() || undefined, inactive: active ? undefined : true,
  });
  const write = (p: Party | null) => {
    const base = { name: name.trim(), phone: phone.trim() || undefined, village: village.trim() || undefined, staff: profile() };
    if (p) upsertParty({ id: p.id, ...base, types: p.types.includes('worker') ? p.types : [...p.types, 'worker'] });
    else upsertParty({ ...base, types: ['worker'], active: true, openingBalance: 0 });
    toast(worker ? 'Staff details saved' : 'Worker registered');
    onClose();
  };
  const save = () => {
    if (!name.trim()) { toast('Enter the worker name', 'error'); return; }
    if (type !== 'contract' && !(Number(rate) > 0)) { toast('Enter the wage rate', 'error'); return; }
    if (worker) { write(worker); return; }
    // never create a second record for someone who is already in the app
    const n = name.trim().toLowerCase();
    const same = db.parties.find(p => p.name.trim().toLowerCase() === n || (digits(phone).length >= 7 && digits(p.phone) === digits(phone)));
    if (same?.types.includes('worker')) { toast(`“${same.name}” is already registered as a worker. Edit that record instead.`, 'error'); return; }
    if (same) { setReuse(same); return; }
    write(null);
  };
  return (
    <Modal open onClose={onClose} title={worker ? 'Edit staff member' : 'Register worker'} maxWidth="max-w-md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Input label="Worker name *" value={name} onChange={e => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Mobile number" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
          <Input label="Job role" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Machine operator" />
        </div>
        <Input label="Village / address" value={village} onChange={e => setVillage(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Joining date" type="date" value={joined} onChange={e => setJoined(e.target.value)} />
          <Select label="Wage type" value={type} onChange={e => setType(e.target.value as WageType)} options={(Object.keys(WAGE_LABEL) as WageType[]).map(k => ({ value: k, label: WAGE_LABEL[k] }))} />
        </div>
        {type !== 'contract' ? (
          <div className="grid grid-cols-2 gap-2">
            <Input label={`Wage rate (₹ ${rateUnit(type)}) *`} type="number" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />
            <Input label="Overtime ₹ / hour" type="number" inputMode="decimal" value={ot} onChange={e => setOt(e.target.value)} placeholder="blank = automatic" />
          </div>
        ) : <p className="text-[11px] text-gray-500">Contract / piece-rate workers are paid per quintal in <b>Hulling Labour Wages</b> or by manual entries. They are not part of monthly payroll.</p>}
        <Textarea label="Remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active (currently working)</label>
      </div>
      <Confirm open={!!reuse} onClose={() => setReuse(null)} variant="primary" title="Use the existing record?" confirmText="Use existing record"
        message={`“${reuse?.name}” is already in the app (${reuse?.types.join(', ')}). The staff details will be added to that same record so there is no duplicate, and nothing is lost.`}
        onConfirm={() => write(reuse)} />
    </Modal>
  );
}
