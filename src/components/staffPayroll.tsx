import { useMemo, useState } from 'react';
import { useDB } from '../context';
import { fmtDate, fmtINR, round2, today } from '../db';
import type { PayrollEntry } from '../types';
import { Badge, Button, Card, Confirm, EmptyState, Expandable, Input, MiniBtn, Modal, PayQuick, roundPay, Select, Textarea, toast, warnExtraPaid } from './ui';
import { usePaymentModes } from './pages';
import { WAGE_LABEL, computePayrollAuto, monthLabel, nameOf, payrollSheet, staffOf, workersOf } from '../staff';

export function PayrollTab() {
  const { db, savePayroll, setPayrollStatus, deletePayroll } = useDB();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [edit, setEdit] = useState<PayrollEntry | null>(null);
  const [pay, setPay] = useState<PayrollEntry | null>(null);
  const [ask, setAsk] = useState<{ kind: 'final' | 'reopen' | 'delete'; p: PayrollEntry } | null>(null);
  const list = useMemo(() => db.payrolls.filter(p => p.month === month).sort((a, b) => nameOf(db, a.workerId).localeCompare(nameOf(db, b.workerId))), [db, month]);
  const eligible = workersOf(db).filter(w => !w.staff?.inactive && w.staff && w.staff.wageType !== 'contract');
  const missing = eligible.filter(w => !db.payrolls.some(p => p.workerId === w.id && p.month === month));
  const generate = () => {
    if (missing.length === 0) { toast('Payroll already exists for every staff member this month', 'info'); return; }
    for (const w of missing) {
      const a = computePayrollAuto(db, w.id, month);
      savePayroll({ workerId: w.id, month, wageType: a.wageType, rate: a.rate, fullDays: a.fullDays, halfDays: a.halfDays, absentDays: a.absentDays, leaveDays: a.leaveDays,
        hours: a.hours, overtimeHours: a.overtimeHours, gross: a.gross, deductions: a.deductions, autoGross: a.gross, autoDeductions: a.deductions });
    }
    toast(`Draft payroll created for ${missing.length} worker(s). Review it, then finalise.`);
  };
  const totals = useMemo(() => {
    let net = 0, paid = 0, remaining = 0;
    for (const p of list) { const s = payrollSheet(db, p); net += s.net; paid += s.paid; remaining += s.remaining; }
    return { net: round2(net), paid: round2(paid), remaining: round2(remaining) };
  }, [db, list]);
  return (
    <div className="space-y-3">
      <Card className="p-3 grid grid-cols-[1fr_auto] gap-2 items-end">
        <Input label="Payroll month" type="month" value={month} onChange={e => setMonth(e.target.value)} />
        <Button onClick={generate}>Generate</Button>
        <p className="col-span-2 text-[11px] text-gray-500">Creates a <b>draft</b> from attendance, overtime and farm / other work. Nothing counts as an expense or can be paid until you finalise it. Contract (hulling) workers are paid under Hulling Labour Wages.</p>
      </Card>
      {list.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Net payable', totals.net], ['Paid', totals.paid], ['Remaining', totals.remaining]].map(([l, v]) => (
            <div key={l as string} className="rounded-2xl bg-white border border-gray-100 p-2.5 shadow-soft"><div className="text-[10px] font-semibold text-gray-500 uppercase">{l as string}</div><div className="text-sm font-extrabold">{fmtINR(v as number, { decimals: 0 })}</div></div>
          ))}
        </div>
      )}
      <Card>
        {list.length === 0 ? <EmptyState title={`No payroll for ${monthLabel(month)}`} subtitle="Tap Generate to create drafts for your staff." /> : list.map(p => {
          const s = payrollSheet(db, p);
          const fresh = computePayrollAuto(db, p.workerId, p.month);
          const stale = p.status === 'draft' && (Math.abs(fresh.gross - p.autoGross) > 0.009 || Math.abs(fresh.deductions - p.autoDeductions) > 0.009);
          const edited = Math.abs(p.gross - p.autoGross) > 0.009 || Math.abs(p.deductions - p.autoDeductions) > 0.009;
          return (
            <div key={p.id} className="px-3 py-2.5 border-b border-gray-100 last:border-0">
              <Expandable head={
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="text-sm font-semibold truncate">{nameOf(db, p.workerId)}</div>
                    <div className="text-[11px] text-gray-500">{WAGE_LABEL[p.wageType]} · Net {fmtINR(s.net, { decimals: 0 })}</div></div>
                  <div className="text-right shrink-0">{p.status === 'final' ? <Badge tone="green">Final</Badge> : <Badge tone="gold">Draft</Badge>}
                    <div className={`text-[11px] font-bold mt-0.5 ${s.remaining > 0.009 ? 'text-red-600' : 'text-green-700'}`}>{s.remaining > 0.009 ? `Due ${fmtINR(s.remaining, { decimals: 0 })}` : s.remaining < -0.009 ? `Extra ${fmtINR(-s.remaining, { decimals: 0 })}` : 'Settled'}</div></div>
                </div>
              }>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[12px]">
                  <dt className="text-gray-500">Working days · Half · Absent · Leave</dt><dd>{p.fullDays} · {p.halfDays} · {p.absentDays} · {p.leaveDays}</dd>
                  {p.wageType === 'hourly' && <><dt className="text-gray-500">Hours</dt><dd>{p.hours}</dd></>}
                  <dt className="text-gray-500">Overtime hours</dt><dd>{p.overtimeHours}</dd>
                  <dt className="text-gray-500">Gross wages</dt><dd className="font-semibold">{fmtINR(p.gross)}</dd>
                  <dt className="text-gray-500">Deductions</dt><dd className="font-semibold text-red-600">− {fmtINR(p.deductions)}</dd>
                  <dt className="text-gray-500">Previous pending</dt><dd className="font-semibold">{s.previous < 0 ? '−' : ''}{fmtINR(Math.abs(s.previous))}</dd>
                  <dt className="text-gray-500">Advances this month</dt><dd className="font-semibold text-red-600">− {fmtINR(s.advances)}</dd>
                  <dt className="font-bold">Net payable</dt><dd className="font-extrabold">{fmtINR(s.net)}</dd>
                  <dt className="text-gray-500">Paid</dt><dd className="font-semibold text-green-700">{fmtINR(s.paid)}</dd>
                  <dt className="font-bold">Remaining</dt><dd className="font-extrabold">{fmtINR(s.remaining)}</dd>
                </dl>
                {(stale || edited) && <div className="text-[11px] text-amber-700 mt-1">{stale ? '⚠ Attendance or work changed since this draft was made. Edit → “Reset to automatic” to refresh. ' : ''}{edited ? 'Figures were edited by hand.' : ''}</div>}
                {p.notes && <div className="text-[11px] text-gray-500 italic mt-1">{p.notes}</div>}
                {p.payments.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    <div className="text-[11px] font-bold text-gray-600">Payment history</div>
                    {p.payments.map(x => <PayLine key={x.id} p={p} id={x.id} />)}
                  </div>
                )}
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {p.status === 'draft' && <MiniBtn tone="blue" onClick={() => setEdit(p)}>✎ Review / edit</MiniBtn>}
                  {p.status === 'draft' && <MiniBtn tone="green" onClick={() => setAsk({ kind: 'final', p })}>✓ Finalise</MiniBtn>}
                  {p.status === 'draft' && <MiniBtn tone="danger" onClick={() => setAsk({ kind: 'delete', p })}>🗑</MiniBtn>}
                  {p.status === 'final' && <MiniBtn tone="green" onClick={() => setPay(p)}>＋ Record payment</MiniBtn>}
                  {p.status === 'final' && p.payments.length === 0 && <MiniBtn onClick={() => setAsk({ kind: 'reopen', p })}>Reopen</MiniBtn>}
                </div>
              </Expandable>
            </div>
          );
        })}
      </Card>
      {edit && <EditPayroll p={edit} onClose={() => setEdit(null)} />}
      {pay && <PayModal p={pay} onClose={() => setPay(null)} />}
      <Confirm open={ask?.kind === 'final'} onClose={() => setAsk(null)} variant="primary" title="Finalise this payroll?" confirmText="Finalise"
        message={ask ? `${nameOf(db, ask.p.workerId)} · ${monthLabel(ask.p.month)}. Wages ${fmtINR(ask.p.gross)} less deductions ${fmtINR(ask.p.deductions)} will count as an expense and can then be paid. You can reopen it only while no payment is recorded.` : ''}
        onConfirm={() => { if (ask) { setPayrollStatus(ask.p.id, 'final'); toast('Payroll finalised'); } }} />
      <Confirm open={ask?.kind === 'reopen'} onClose={() => setAsk(null)} title="Reopen this payroll?" confirmText="Reopen" message="It goes back to draft and stops counting as an expense until you finalise it again."
        onConfirm={() => { if (ask) { setPayrollStatus(ask.p.id, 'draft'); toast('Payroll reopened'); } }} />
      <Confirm open={ask?.kind === 'delete'} onClose={() => setAsk(null)} title="Delete this draft?" confirmText="Delete" message="Only the draft is deleted. Attendance and other records are not touched."
        onConfirm={() => { if (ask) { deletePayroll(ask.p.id); toast('Draft deleted'); } }} />
    </div>
  );
}

function PayLine({ p, id }: { p: PayrollEntry; id: string }) {
  const { removePayrollPayment } = useDB();
  const [ask, setAsk] = useState(false);
  const x = p.payments.find(y => y.id === id)!;
  return (
    <div className="flex items-center justify-between text-[11px] bg-green-50 border border-green-100 rounded-lg px-2 py-1">
      <span>{fmtDate(x.date)} · {x.mode}{x.reference ? ` · ${x.reference}` : ''}</span>
      <span className="flex items-center gap-2"><b>{fmtINR(x.amount)}</b><button className="text-red-500 text-base leading-none" aria-label="Remove payment" onClick={() => setAsk(true)}>×</button></span>
      <Confirm open={ask} onClose={() => setAsk(false)} title="Remove this payment?" confirmText="Remove" message="The payment and its cashbook entry are removed." onConfirm={() => removePayrollPayment(p.id, id)} />
    </div>
  );
}

function EditPayroll({ p, onClose }: { p: PayrollEntry; onClose: () => void }) {
  const { db, savePayroll } = useDB();
  const [gross, setGross] = useState(String(p.gross));
  const [ded, setDed] = useState(String(p.deductions));
  const [notes, setNotes] = useState(p.notes || '');
  const sp = staffOf(db.parties.find(x => x.id === p.workerId));
  const reset = () => { const a = computePayrollAuto(db, p.workerId, p.month); setGross(String(a.gross)); setDed(String(a.deductions)); };
  const save = () => {
    const a = computePayrollAuto(db, p.workerId, p.month);
    savePayroll({ workerId: p.workerId, month: p.month, wageType: a.wageType, rate: a.rate, fullDays: a.fullDays, halfDays: a.halfDays, absentDays: a.absentDays, leaveDays: a.leaveDays, hours: a.hours,
      overtimeHours: a.overtimeHours, gross: round2(Number(gross) || 0), deductions: round2(Number(ded) || 0), autoGross: a.gross, autoDeductions: a.deductions, notes: notes.trim() || undefined });
    toast('Draft saved'); onClose();
  };
  return (
    <Modal open onClose={onClose} title={`${nameOf(db, p.workerId)} · ${monthLabel(p.month)}`} maxWidth="max-w-sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save draft</Button></>}>
      <div className="space-y-3">
        <p className="text-[11px] text-gray-500">{WAGE_LABEL[sp.wageType]} {sp.wageRate ? `₹${sp.wageRate}` : ''}. The amounts below are calculated from attendance. You can change them.</p>
        <Input label="Gross wages (₹)" type="number" inputMode="decimal" value={gross} onChange={e => setGross(e.target.value)} />
        <Input label="Deductions (₹)" type="number" inputMode="decimal" value={ded} onChange={e => setDed(e.target.value)} />
        <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
        <Button variant="secondary" size="sm" onClick={reset}>Reset to automatic</Button>
      </div>
    </Modal>
  );
}

function PayModal({ p, onClose }: { p: PayrollEntry; onClose: () => void }) {
  const { db, addPayrollPayment } = useDB();
  const modes = usePaymentModes();
  const s = payrollSheet(db, p);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(String(Math.max(0, s.remaining)));
  const [mode, setMode] = useState(modes[0] || 'Cash');
  const [ref, setRef] = useState('');
  const [ask, setAsk] = useState(false);
  const amt = round2(Number(amount) || 0);
  const go = () => {
    addPayrollPayment(p.id, { date, amount: amt, mode, reference: ref.trim() || undefined });
    warnExtraPaid(round2(amt - s.remaining));
    toast('Payment recorded'); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Record salary payment" maxWidth="max-w-sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => (amt > 0 ? setAsk(true) : toast('Enter the amount', 'error'))}>Continue</Button></>}>
      <div className="space-y-3">
        <div className="text-xs bg-forest-50 rounded-xl p-2.5">{nameOf(db, p.workerId)} · {monthLabel(p.month)}<br />Net payable <b>{fmtINR(s.net)}</b> · Paid <b>{fmtINR(s.paid)}</b> · Remaining <b>{fmtINR(s.remaining)}</b></div>
        <div className="grid grid-cols-2 gap-2"><Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} /><Input label="Amount (₹)" type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <PayQuick onFull={() => setAmount(String(Math.max(0, s.remaining)))} onUp={() => setAmount(String(roundPay(amount, Math.max(0, s.remaining), 'up')))} onDown={() => setAmount(String(roundPay(amount, Math.max(0, s.remaining), 'down')))} />
        <Select label="Payment mode" value={mode} onChange={e => setMode(e.target.value)} options={modes.length ? modes : ['Cash', 'UPI', 'Bank']} />
        <Input label="Reference" value={ref} onChange={e => setRef(e.target.value)} placeholder="Optional" />
        {amt > s.remaining + 0.009 && <div className="text-[11px] text-amber-700">⚠ {fmtINR(round2(amt - s.remaining))} more than the remaining amount. It will be saved and flagged as extra paid.</div>}
      </div>
      <Confirm open={ask} onClose={() => setAsk(false)} variant="primary" title="Confirm payment" confirmText="Record payment"
        message={`Record ${fmtINR(amt)} paid to ${nameOf(db, p.workerId)} by ${mode} on ${fmtDate(date)}? A cashbook payment is created automatically.`} onConfirm={go} />
    </Modal>
  );
}
