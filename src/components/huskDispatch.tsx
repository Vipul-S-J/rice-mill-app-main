import React, { useMemo, useState } from 'react';
import { useDB } from '../context';
import { computeStock, dispatchDue, fmtDate, fmtINR, inRange, nextTripNo, paymentStatus, round2, sumPayments, today, uid } from '../db';
import type { DispatchEntry, HuskDispatchDetail, Payment } from '../types';
import { Badge, Button, Card, Confirm, DateRangePresets, EmptyState, Input, Select, toast } from './ui';
import { AddPaymentModal, PartyInput, ReceiptModal, partyName, statusBadge, useEnsureParty, usePaymentModes } from './pages';

type Measure = 'bags' | 'weight';
type PayStatus = 'paid' | 'partial' | 'unpaid';
type Lot = { qty: string; rate: string };
const num = (s: string | number | undefined) => Number(s) || 0;
const fmt2 = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(round2(n));
const seg = (on: boolean) => `flex-1 px-2 py-2.5 rounded-xl text-[13px] font-bold border flex items-center justify-center gap-1.5 ${on ? 'bg-[#fff1dc] border-amber-500 text-[#7a4a10] shadow-sm' : 'bg-white border-gray-200 text-gray-600'}`;

function Section({ title, icon, tone = 'bg-white', children }: { title: string; icon: string; tone?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-gray-200 ${tone} p-3 space-y-3`}>
      <h3 className="text-[12px] font-extrabold tracking-wide text-gray-700 uppercase">{icon} {title}</h3>
      {children}
    </section>
  );
}

export function HuskDispatchPage() {
  const { db, addDispatch, updateDispatch, deleteDispatch, addDispatchPayment } = useDB();
  const modes = usePaymentModes();
  const ensureParty = useEnsureParty();
  const huskStockKg = useMemo(() => (computeStock(db) as any).huskKg || 0, [db]);

  const [editing, setEditing] = useState<DispatchEntry | null>(null);
  const [date, setDate] = useState(today());
  const [vehicle, setVehicle] = useState('');
  const [buyer, setBuyer] = useState('');
  const [driver, setDriver] = useState('');
  const [measure, setMeasure] = useState<Measure>('weight');
  const [lots, setLots] = useState<Lot[]>([{ qty: '', rate: '' }]);
  const [approx, setApprox] = useState('');
  const [totalOverride, setTotalOverride] = useState<string | null>(null);
  const [coolie, setCoolie] = useState('');
  const [transport, setTransport] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [payStatus, setPayStatus] = useState<PayStatus>('paid');
  const [partialAmt, setPartialAmt] = useState('');
  const [payTouched, setPayTouched] = useState(false);
  const [remarks, setRemarks] = useState('');

  const [search, setSearch] = useState('');
  const [range, setRange] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [order, setOrder] = useState('old');
  const [viewEntry, setViewEntry] = useState<DispatchEntry | null>(null);
  const [payEntry, setPayEntry] = useState<DispatchEntry | null>(null);
  const [delEntry, setDelEntry] = useState<DispatchEntry | null>(null);

  const unit = measure === 'bags' ? 'Bag' : 'Kg';
  const amounts = lots.map(l => round2(num(l.qty) * num(l.rate)));
  const lotsTotal = round2(amounts.reduce((s, a) => s + a, 0));
  const total = totalOverride !== null ? num(totalOverride) : lotsTotal;
  const deductions = round2(num(coolie) + num(transport));
  const net = round2(total - deductions);
  const qtySum = round2(lots.reduce((s, l) => s + num(l.qty), 0));
  const kg = measure === 'weight' ? qtySum : num(approx);

  const resetAll = () => {
    setEditing(null); setDate(today()); setVehicle(''); setBuyer(''); setDriver(''); setMeasure('weight');
    setLots([{ qty: '', rate: '' }]); setApprox(''); setTotalOverride(null); setCoolie(''); setTransport('');
    setPayMode(modes[0] || 'Cash'); setPayStatus('paid'); setPartialAmt(''); setPayTouched(false); setRemarks('');
  };
  const changeMeasure = (m: Measure) => { if (m !== measure) { setMeasure(m); setLots([{ qty: '', rate: '' }]); setApprox(''); setTotalOverride(null); } };
  const patchLot = (i: number, p: Partial<Lot>) => setLots(ls => ls.map((l, x) => (x === i ? { ...l, ...p } : l)));

  const startEdit = (d: DispatchEntry) => {
    const h = d.husk; if (!h) return;
    setEditing(d); setDate(d.date); setVehicle(d.vehicleNumber || ''); setBuyer(partyName(db, d.partyId)); setDriver(h.driverName || '');
    setMeasure(h.measureBy);
    setLots(h.lots.length ? h.lots.map(l => ({ qty: String(l.qty), rate: String(l.rate) })) : [{ qty: '', rate: '' }]);
    setApprox(String((h.measureBy === 'bags' ? h.approxKg : h.approxBags) || ''));
    const sum = round2(h.lots.reduce((s, l) => s + l.qty * l.rate, 0));
    setTotalOverride(Math.abs(sum - h.totalAmount) > 0.01 ? String(h.totalAmount) : null);
    setCoolie(h.coolie ? String(h.coolie) : ''); setTransport(h.transport ? String(h.transport) : '');
    setPayMode(h.paymentMode || 'Cash');
    const paid = sumPayments(d.payments);
    setPayStatus(paid >= h.netReceivable - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
    setPartialAmt(paid > 0 && paid < h.netReceivable - 0.01 ? String(paid) : '');
    setPayTouched(false); setRemarks(d.notes || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = () => {
    const fail = (m: string) => toast(m, 'error');
    if (!buyer.trim()) return fail('Enter the recipient (vendor / buyer).');
    if (!(qtySum > 0)) return fail(`Enter the ${measure === 'bags' ? 'number of bags' : 'weight'}.`);
    if (lots.some(l => num(l.qty) > 0 && !(num(l.rate) > 0))) return fail('Enter the rate for every lot.');
    if (!(total > 0)) return fail('Total amount is zero.');
    if (net < 0) return fail('Deductions are more than the total amount.');
    const pid = ensureParty(buyer, 'customer');
    if (!pid) return fail('Enter the recipient (vendor / buyer).');

    const detail: HuskDispatchDetail = {
      measureBy: measure,
      lots: lots.filter(l => num(l.qty) > 0).map(l => ({ qty: num(l.qty), rate: num(l.rate), amount: round2(num(l.qty) * num(l.rate)) })),
      approxBags: measure === 'weight' ? (num(approx) || undefined) : undefined,
      approxKg: measure === 'bags' ? (num(approx) || undefined) : undefined,
      driverName: driver.trim() || undefined,
      totalAmount: total, coolie: num(coolie), transport: num(transport), netReceivable: net,
      paymentMode: payMode, paymentStatus: payStatus,
    };
    let payments: Payment[];
    if (editing && !payTouched) payments = editing.payments;
    else {
      const amt = payStatus === 'paid' ? net : payStatus === 'partial' ? Math.min(num(partialAmt), net) : 0;
      if (payStatus === 'partial' && !(amt > 0)) return fail('Enter the amount received for a partial payment.');
      payments = amt > 0 ? [{ id: uid(), date, amount: round2(amt), mode: payMode, createdAt: new Date().toISOString() }] : [];
    }
    const data: Omit<DispatchEntry, 'id' | 'createdAt' | 'updatedAt' | 'dispatchNumber'> = {
      date, partyId: pid, vehicleNumber: vehicle.trim() || undefined, productId: 'pr_husk',
      grossKg: kg, tareKg: 0, bagWeightKg: 0, otherDeductionsKg: 0, netKg: kg, billableQtl: round2(kg / 100),
      ratePerQtl: kg > 0 ? round2(total / (kg / 100)) : 0, baseAmount: total,
      transportCost: num(transport), loadingCost: num(coolie), unloadingCost: 0, driverBata: 0, snacksCost: 0, otherCosts: 0, totalCosts: deductions,
      gstMode: 'none', gstRate: 0, taxableAmount: total, cgst: 0, sgst: 0, totalTax: 0,
      roundOriginal: total, roundAdjustment: 0, finalTotal: total, manualOverrides: {},
      notes: remarks.trim() || undefined, payments, husk: detail,
    } as any;
    if (editing) { updateDispatch(editing.id, data); toast(`Updated ${editing.dispatchNumber}`); }
    else { addDispatch(data); toast('Husk dispatch saved'); }
    resetAll();
  };

  const records = useMemo(() => {
    const s = search.trim().toLowerCase();
    return db.dispatches
      .filter(d => d.husk)
      .filter(d => inRange(d.date, { preset: range as any }))
      .filter(d => statusF === 'all' || paymentStatus(dispatchDue(d), sumPayments(d.payments)) === statusF)
      .filter(d => !s || partyName(db, d.partyId).toLowerCase().includes(s) || (d.vehicleNumber || '').toLowerCase().includes(s) || d.dispatchNumber.toLowerCase().includes(s) || (d.tripNumber || '').toLowerCase().includes(s))
      .sort((a, b) => (order === 'old' ? 1 : -1) * (a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)));
  }, [db, search, range, statusF, order]);
  const totals = useMemo(() => ({
    kg: records.reduce((s, d) => s + d.netKg, 0),
    total: records.reduce((s, d) => s + d.husk!.totalAmount, 0),
    ded: records.reduce((s, d) => s + d.husk!.coolie + d.husk!.transport, 0),
    net: records.reduce((s, d) => s + d.husk!.netReceivable, 0),
  }), [records]);

  const nextNo = `${db.settings.invoicePrefixes.dispatch}-${String(db.settings.nextNumbers.dispatch || 1).padStart(4, '0')}`;

  return (
    <div className="p-3 pb-10 space-y-3">
      <Card className="p-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold text-[#0b3d2c] leading-tight">{editing ? `Edit ${editing.dispatchNumber}` : 'New Husk Dispatch'}</h2>
            <div className="text-[11px] font-bold text-amber-700">{editing ? `Trip ${editing.tripNumber || '—'}` : `Next: ${nextNo} · ${nextTripNo(db.dispatches)}`}</div>
          </div>
          {editing && <button onClick={resetAll} className="text-xs font-bold text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5">Cancel edit</button>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Date *" type="date" value={date} onChange={e => setDate(e.target.value)} />
          <Input label="Vehicle No" placeholder="KA 01 AH 1234" value={vehicle} onChange={e => setVehicle(e.target.value.toUpperCase())} />
          <PartyInput label="Recipient (Vendor / Buyer) *" value={buyer} onChange={setBuyer} types={['customer']} placeholder="Vendor name" />
          <Input label="Driver Name" placeholder="Driver name" value={driver} onChange={e => setDriver(e.target.value)} />
        </div>
        <div className="text-[11px] text-gray-500">Husk in stock: <b className="text-gray-800">{fmt2(huskStockKg)} Kg</b></div>
      </Card>

      <Section title="Measure by" icon="⚖️">
        <div className="flex gap-2">
          <button className={seg(measure === 'bags')} onClick={() => changeMeasure('bags')}>👜 Number of Bags</button>
          <button className={seg(measure === 'weight')} onClick={() => changeMeasure('weight')}>⚖️ Total Weight (Kg)</button>
        </div>
      </Section>

      <Section title="Quantity & rate lots" icon="📦" tone="bg-[#fbf3ea]">
        <div className="space-y-2">
          {lots.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <Input label={i === 0 ? (measure === 'bags' ? 'Bags' : 'Weight (Kg)') : undefined} type="number" inputMode="decimal" placeholder={unit === 'Bag' ? 'Bags' : 'Kg'} value={l.qty} onChange={e => patchLot(i, { qty: e.target.value })} />
              <Input label={i === 0 ? `Rate/${unit} (₹)` : undefined} type="number" inputMode="decimal" step="0.01" placeholder={`₹/${unit}`} value={l.rate} onChange={e => patchLot(i, { rate: e.target.value })} />
              <div className="flex items-center gap-1.5 pb-1">
                <div className="min-w-[70px] text-right text-sm font-extrabold">{fmtINR(amounts[i])}</div>
                {lots.length > 1 && <button onClick={() => setLots(ls => ls.filter((_, x) => x !== i))} className="w-8 h-8 rounded-lg border border-red-200 bg-red-50 text-red-600 font-bold" aria-label="Remove lot">×</button>}
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => setLots(ls => [...ls, { qty: '', rate: '' }])} className="w-full rounded-xl border-2 border-dashed border-amber-400 text-amber-800 text-sm font-bold py-2">+ Add Another Rate</button>
        <Input label={measure === 'bags' ? 'Approx Total Weight (Kg) (optional)' : 'Approx No. of Bags (optional)'} type="number" inputMode="decimal" placeholder="optional" value={approx} onChange={e => setApprox(e.target.value)} />
        {measure === 'bags' && !(num(approx) > 0) && <div className="text-[11px] text-amber-700">Enter the approx weight if you want husk stock to reduce for this dispatch.</div>}
        {kg > huskStockKg + 0.01 && kg > 0 && <div className="text-[11px] text-red-600">⚠ {fmt2(kg)} Kg is more than the husk stock recorded ({fmt2(huskStockKg)} Kg).</div>}
      </Section>

      <Section title="Total amount" icon="₹" tone="bg-[#f1f1ef]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-500">Auto-calculated from rate lots.<br />Tap the amount to edit.{totalOverride !== null && <button className="ml-1 font-bold text-forest-700" onClick={() => setTotalOverride(null)}>Recalc</button>}</div>
          <input type="number" inputMode="decimal" step="0.01" value={totalOverride !== null ? totalOverride : (lotsTotal ? String(lotsTotal) : '')} placeholder="0.00"
            onChange={e => setTotalOverride(e.target.value)} className="w-40 text-right text-2xl font-extrabold bg-transparent outline-none border-b-2 border-dashed border-gray-300 focus:border-forest-500" />
        </div>
      </Section>

      <Section title="Deductions" icon="▼" tone="bg-[#fffaec]">
        <div className="grid grid-cols-2 gap-2">
          <Input label="Coolie / Loading Charges (₹)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={coolie} onChange={e => setCoolie(e.target.value)} />
          <Input label="Vehicle / Transport Charges (₹)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={transport} onChange={e => setTransport(e.target.value)} />
        </div>
        <div className="flex justify-between text-sm border-t border-dashed border-amber-300 pt-2"><span className="font-bold text-amber-800">Total Deductions</span><b className="text-red-600">{fmtINR(deductions)}</b></div>
      </Section>

      <Section title="Net amount receivable" icon="✓" tone="bg-[#eef6f1]">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-gray-500">Total Amount − Coolie − Transport</div>
          <div className={`text-2xl font-extrabold ${net < 0 ? 'text-red-600' : 'text-[#0b3d2c]'}`}>{fmtINR(net)}</div>
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-2">
        <Select label="Payment Mode" value={payMode} onChange={e => { setPayMode(e.target.value); setPayTouched(true); }} options={(modes.length ? modes : ['Cash']).map(m => ({ value: m, label: m }))} />
        <Select label="Payment Status" value={payStatus} onChange={e => { setPayStatus(e.target.value as PayStatus); setPayTouched(true); }}
          options={[{ value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' }, { value: 'unpaid', label: 'Unpaid' }]} />
      </div>
      {payStatus === 'partial' && <Input label="Amount received (₹)" type="number" inputMode="decimal" step="0.01" value={partialAmt} onChange={e => { setPartialAmt(e.target.value); setPayTouched(true); }} />}
      <Input label="Remarks" placeholder="Optional" value={remarks} onChange={e => setRemarks(e.target.value)} />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button className="w-full py-3" onClick={save}>🚚 {editing ? 'Update Dispatch' : 'Save Dispatch'}</Button>
        <Button variant="secondary" onClick={resetAll}>↺</Button>
      </div>

      {/* records */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-[#0b3d2c]">Husk Dispatch Records</h3>
          <Badge tone="gray">{records.length} found</Badge>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Recipient, vehicle, trip no…" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-forest-500" />
        <div className="flex gap-2 flex-wrap items-center">
          <DateRangePresets value={range} onChange={p => setRange(p)} />
          <Select value={statusF} onChange={e => setStatusF(e.target.value)} wrapperClassName="w-auto"
            options={[{ value: 'all', label: 'All' }, { value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' }, { value: 'pending', label: 'Unpaid' }]} />
          <Select value={order} onChange={e => setOrder(e.target.value)} wrapperClassName="w-auto"
            options={[{ value: 'old', label: '↑ Oldest First' }, { value: 'new', label: '↓ Newest First' }]} />
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[11px] bg-gray-50 rounded-xl p-2">
          <div>Weight <b>{fmt2(totals.kg)} Kg</b></div>
          <div>Total <b>{fmtINR(totals.total)}</b></div>
          <div>Deductions <b className="text-red-600">{fmtINR(totals.ded)}</b></div>
          <div>Net <b className="text-emerald-700">{fmtINR(totals.net)}</b></div>
        </div>
        {records.length === 0 && <EmptyState title="No dispatches found" />}
        <div className="space-y-2">
          {records.map(d => {
            const h = d.husk!;
            const due = dispatchDue(d);
            const st = paymentStatus(due, sumPayments(d.payments));
            const qtyTxt = h.measureBy === 'bags' ? `${h.lots.reduce((s, l) => s + l.qty, 0)} bags${h.approxKg ? ` (~${fmt2(h.approxKg)} Kg)` : ''}` : `${fmt2(h.lots.reduce((s, l) => s + l.qty, 0))} Kg`;
            return (
              <div key={d.id} className="rounded-xl border border-gray-200 p-2.5 space-y-1.5">
                <div className="flex justify-between gap-2" onClick={() => setViewEntry(d)}>
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold truncate">{d.tripNumber || d.dispatchNumber} · {partyName(db, d.partyId)}</div>
                    <div className="text-[11px] text-gray-500">{fmtDate(d.date)} · {d.dispatchNumber}{d.vehicleNumber ? ` · ${d.vehicleNumber}` : ''}{h.driverName ? ` · ${h.driverName}` : ''}</div>
                  </div>
                  <div className="text-right shrink-0"><div className="text-sm font-extrabold">{fmtINR(due)}</div><div className="text-[10px] text-gray-500">{qtyTxt}</div></div>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <Badge tone="gold">Husk</Badge>{statusBadge(st)}
                  <span className="text-[10px] text-gray-500">Total {fmtINR(h.totalAmount)} − deductions {fmtINR(h.coolie + h.transport)}</span>
                </div>
                <div className="flex gap-3 pt-0.5">
                  <button onClick={() => setViewEntry(d)} className="text-[11px] text-gray-700 font-bold">Slip</button>
                  <button onClick={() => startEdit(d)} className="text-[11px] text-blue-700 font-bold">Edit</button>
                  <button onClick={() => setPayEntry(d)} className="text-[11px] text-green-700 font-bold">Add Pay</button>
                  <button onClick={() => setDelEntry(d)} className="text-[11px] text-red-600 font-bold">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {viewEntry && <ReceiptModal entry={viewEntry} onClose={() => setViewEntry(null)} type="dispatch" />}
      {payEntry && (
        <AddPaymentModal open total={dispatchDue(payEntry)} paid={sumPayments(payEntry.payments)} existingPayments={payEntry.payments} modes={modes}
          onClose={() => setPayEntry(null)} onSave={pm => { addDispatchPayment(payEntry.id, pm); setPayEntry(null); toast('Payment added'); }} />
      )}
      <Confirm open={!!delEntry} onClose={() => setDelEntry(null)} title="Delete dispatch?" message={`Delete ${delEntry?.dispatchNumber}? Its payments are removed from the cashbook.`} confirmText="Delete"
        onConfirm={() => { if (delEntry) { deleteDispatch(delEntry.id); if (editing?.id === delEntry.id) resetAll(); toast('Deleted'); setDelEntry(null); } }} />
    </div>
  );
}
