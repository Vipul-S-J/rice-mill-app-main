import React, { useMemo, useRef, useState } from 'react';
import { useDB } from '../context';
import {
  fmtINR, fmtQtlKg, fmtNumber, fmtDate, today, calcGST, round2, sumPayments, paymentStatus,
  inRange, withDraftPayment, uid,
} from '../db';
import type { HullingEntry, Payment } from '../types';
import {
  Button, Input, Select, Card, Modal, Confirm, EmptyState, SearchBar, TotalBar, GSTPanel,
  CalcField, QtyInput, PayBox, PhotoAttach, DateFilter, MiniBtn, toast,
} from './ui';
import type { DateFilterValue } from './ui';
import {
  PartyInput, TaxSummary, useEnsureParty, usePaymentModes, partyName, statusBadge,
  AddPaymentModal, ReceiptModal,
} from './pages';
import { useRoundedTotal } from './amount';

type HullingSave = Omit<HullingEntry, 'id' | 'createdAt' | 'updatedAt' | 'receiptNumber'>;

// ============================================================
// PAGE
// ============================================================
export function HullingPage() {
  const { db, addHulling, updateHulling, deleteHulling, addHullingPayment } = useDB();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date-desc');
  const [dateF, setDateF] = useState<DateFilterValue>({ preset: 'all' });
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState<HullingEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [viewEntry, setViewEntry] = useState<HullingEntry | null>(null);
  const [payEntry, setPayEntry] = useState<HullingEntry | null>(null);
  const modeOptions = usePaymentModes();

  const entries = useMemo(() => {
    let list = [...db.hulling];
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter(h => {
        const party = db.parties.find(p => p.id === h.partyId);
        return h.receiptNumber.toLowerCase().includes(s) ||
          (party?.name || '').toLowerCase().includes(s) ||
          (party?.phone || '').includes(s) ||
          (h.vehicleNumber || '').toLowerCase().includes(s) ||
          h.date.includes(s);
      });
    }
    list = list.filter(h => inRange(h.date, dateF));
    if (statusFilter !== 'all') list = list.filter(h => paymentStatus(h.finalTotal, sumPayments(h.payments)) === statusFilter);
    list.sort((a, b) => {
      switch (sort) {
        case 'date-asc': return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
        case 'qty-asc': return a.quantityKg - b.quantityKg;
        case 'qty-desc': return b.quantityKg - a.quantityKg;
        case 'amt-asc': return a.finalTotal - b.finalTotal;
        case 'amt-desc': return b.finalTotal - a.finalTotal;
        default: return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
      }
    });
    return list;
  }, [db, search, sort, dateF, statusFilter]);

  const totals = useMemo(() => ({
    count: entries.length,
    qty: entries.reduce((s, h) => s + h.quantityKg, 0),
    total: entries.reduce((s, h) => s + h.finalTotal, 0),
    paid: entries.reduce((s, h) => s + sumPayments(h.payments), 0),
  }), [entries]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => { setEditing(null); setShowForm(true); }}>＋ New Hulling Entry</Button>
        <Button variant="gold" onClick={() => setShowBulk(true)}>⚡ Bulk Entry</Button>
      </div>

      <div className="space-y-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Receipt, customer, phone, vehicle, date…" />
        <DateFilter value={dateF} onChange={setDateF} />
        <div className="flex gap-2">
          <Select wrapperClassName="flex-1" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            options={[{ value: 'all', label: 'All Status' }, { value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'overdue', label: 'Overdue' }]} />
          <Select wrapperClassName="flex-1" value={sort} onChange={e => setSort(e.target.value)}
            options={[
              { value: 'date-desc', label: 'Newest first' }, { value: 'date-asc', label: 'Oldest first' },
              { value: 'qty-asc', label: 'Qty: small → large' }, { value: 'qty-desc', label: 'Qty: large → small' },
              { value: 'amt-asc', label: 'Amount: low → high' }, { value: 'amt-desc', label: 'Amount: high → low' },
            ]} />
        </div>
      </div>

      {entries.length > 0 && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
            <div className="text-gray-500">📦 {fmtNumber(totals.count, 0)} receipts</div>
            <div className="font-bold text-gray-900">{fmtQtlKg(totals.qty)}</div>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
            <div className="text-gray-500">💰 Hulling income</div>
            <div className="font-bold text-forest-700">{fmtINR(totals.total)}</div>
          </div>
        </div>
      )}

      <Card>
        {entries.length === 0 ? (
          <EmptyState title={db.hulling.length ? 'No receipts match these filters' : 'No hulling entries yet'}
            subtitle={db.hulling.length ? 'Clear the search or date filter to see all records.' : 'Tap “New Hulling Entry” or “Bulk Entry” to start.'} />
        ) : entries.map(h => {
          const paid = sumPayments(h.payments);
          const st = paymentStatus(h.finalTotal, paid);
          const due = round2(h.finalTotal - paid);
          return (
            <div key={h.id} className="px-3 py-3 border-b border-gray-100 last:border-0">
              <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => setViewEntry(h)}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold text-forest-700 bg-forest-50 border border-forest-100 rounded px-1.5 py-0.5">{h.receiptNumber}</span>
                    <span className="text-sm font-semibold text-gray-900 truncate">{partyName(db, h.partyId)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {fmtDate(h.date)}{h.vehicleNumber ? ` · ${h.vehicleNumber}` : ''}{h.bagsCount ? ` · ${h.bagsCount} bags` : ''}
                  </div>
                  <div className="text-xs text-gray-700 mt-1">
                    {fmtQtlKg(h.quantityKg)} @ {fmtINR(h.ratePerQtl, { decimals: 0 })}/Qtl
                  </div>
                  {h.roundAdjustment !== 0 && (
                    <div className="text-[10px] text-amber-700 mt-0.5">Rounded +{fmtINR(h.roundAdjustment)} (from {fmtINR(h.roundOriginal)})</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-[15px] text-gray-900">{fmtINR(h.finalTotal)}</div>
                  <div className="mt-0.5">{statusBadge(st)}</div>
                  {due > 0.009 && <div className="text-[10px] text-red-600 mt-0.5">Due {fmtINR(due)}</div>}
                </div>
              </div>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                <MiniBtn onClick={() => { setEditing(h); setShowForm(true); }} tone="blue">✎ Edit</MiniBtn>
                <MiniBtn onClick={() => setViewEntry(h)}>🧾 Receipt</MiniBtn>
                {due > 0.009 && <MiniBtn onClick={() => setPayEntry(h)} tone="green">＋ Pay</MiniBtn>}
                <MiniBtn onClick={() => setDelId(h.id)} tone="danger">🗑</MiniBtn>
              </div>
            </div>
          );
        })}
      </Card>

      {entries.length > 0 && (
        <TotalBar items={[
          { label: 'Paid', value: fmtINR(totals.paid), tone: 'green' },
          { label: 'Due', value: fmtINR(totals.total - totals.paid), tone: totals.total - totals.paid > 0.009 ? 'red' : 'default' },
        ]} />
      )}

      <HullingForm
        open={showForm}
        initial={editing}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSave={(data) => {
          if (editing) { updateHulling(editing.id, data); toast('Hulling entry updated'); }
          else { addHulling(data); toast('Hulling entry saved'); }
          setShowForm(false); setEditing(null);
        }}
      />
      <BulkHullingModal open={showBulk} onClose={() => setShowBulk(false)} />
      <Confirm open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => { if (delId) { deleteHulling(delId); toast('Deleted'); } }}
        message="Delete this hulling entry? Its payments and ledger/cashbook effects are reversed." />
      {viewEntry && <ReceiptModal entry={db.hulling.find(h => h.id === viewEntry.id) || viewEntry} onClose={() => setViewEntry(null)} type="hulling" />}
      {payEntry && (
        <AddPaymentModal open total={payEntry.finalTotal} paid={sumPayments(payEntry.payments)} modes={modeOptions}
          onClose={() => setPayEntry(null)}
          onSave={(p: Omit<Payment, 'id' | 'createdAt'>) => { addHullingPayment(payEntry.id, p); setPayEntry(null); toast('Payment added'); }} />
      )}
    </div>
  );
}

// ============================================================
// SINGLE ENTRY FORM
// ============================================================
function HullingForm({ open, initial, onClose, onSave }: {
  open: boolean; initial: HullingEntry | null; onClose: () => void; onSave: (d: HullingSave) => void;
}) {
  const { db } = useDB();
  const modeOptions = usePaymentModes();
  const ensureParty = useEnsureParty();
  const saving = useRef(false);

  const [date, setDate] = useState(today());
  const [customer, setCustomer] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [bags, setBags] = useState('');
  const [qtyKg, setQtyKg] = useState(0);
  const [rate, setRate] = useState('');
  const [gstMode, setGstMode] = useState<'none' | 'exclusive' | 'inclusive'>('none');
  const [gstRate, setGstRate] = useState('0');
  const [baseOverride, setBaseOverride] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  const [existing, setExisting] = useState<Payment[]>([]);
  const [payAmt, setPayAmt] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [payDate, setPayDate] = useState(today());

  const baseCalc = round2((qtyKg / 100) * (Number(rate) || 0));
  const base = baseOverride !== null ? Number(baseOverride) || 0 : baseCalc;
  const g = calcGST(base, gstMode, Number(gstRate) || 0);
  const rt = useRoundedTotal(g.total, 'up');

  React.useEffect(() => {
    if (!open) return;
    saving.current = false;
    const i = initial;
    setDate(i?.date || today());
    setCustomer(i?.partyId ? partyName(db, i.partyId) : '');
    setVehicle(i?.vehicleNumber || '');
    setBags(i?.bagsCount ? String(i.bagsCount) : '');
    setQtyKg(i?.quantityKg || 0);
    setRate(String(i?.ratePerQtl ?? db.settings.defaultHullingRate));
    setGstMode(i?.gstMode || (db.settings.taxMode === 'gst' ? 'exclusive' : 'none'));
    setGstRate(String(i?.gstRate ?? db.settings.defaultGstRate ?? 0));
    setBaseOverride(i?.manualOverrides?.baseAmount ? String(i.baseAmount) : null);
    setNotes(i?.notes || '');
    setPhoto(i?.billPhoto);
    setExisting(i?.payments || []);
    setPayAmt('');
    setPayMode(modeOptions[0] || 'Cash');
    setPayDate(today());
    rt.reset(i ? { final: i.finalTotal, roundAdj: i.roundAdjustment, original: i.roundOriginal, manual: !!i.manualOverrides?.finalTotal } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const anyManual = baseOverride !== null || rt.manual;
  const recalc = () => { setBaseOverride(null); rt.recalc(); };

  const handleSave = () => {
    if (saving.current) return;
    if (!customer.trim()) { toast('Enter the customer name', 'error'); return; }
    if (qtyKg <= 0) { toast('Enter the quantity (Qtl / Kg)', 'error'); return; }
    if (!(Number(rate) > 0)) { toast('Enter the hulling rate per Qtl', 'error'); return; }
    const payments = withDraftPayment(existing, payAmt, payMode, payDate);
    if (sumPayments(payments) > rt.final + 0.01) { toast('Amount paid is more than the total', 'error'); return; }
    saving.current = true;
    const pid = ensureParty(customer, 'customer');
    onSave({
      date, partyId: pid, vehicleNumber: vehicle || undefined, bagsCount: Number(bags) || undefined,
      quantityKg: qtyKg, ratePerQtl: Number(rate) || 0,
      gstMode, gstRate: Number(gstRate) || 0,
      baseAmount: base, taxableAmount: g.taxable, cgst: g.cgst, sgst: g.sgst, totalTax: g.totalTax,
      roundOriginal: rt.original, roundAdjustment: rt.adj, finalTotal: rt.final,
      manualOverrides: { baseAmount: baseOverride !== null, finalTotal: rt.manual },
      notes: notes || undefined, billPhoto: photo, payments,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.receiptNumber}` : 'New Hulling Entry'} maxWidth="max-w-xl" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave}>💾 {initial ? 'Update Entry' : 'Save Entry'}</Button>
      </>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Date *" value={date} onChange={e => setDate(e.target.value)} />
          <Input label="Vehicle No" value={vehicle} onChange={e => setVehicle(e.target.value.toUpperCase())} placeholder="KA 01 AH 1234" />
        </div>
        <PartyInput label="Customer Name" required value={customer} onChange={setCustomer} types={['customer']} placeholder="Type name — saved automatically" />

        <div className="grid grid-cols-[70px_1fr_88px] gap-2 items-start">
          <Input label="Bags" type="number" inputMode="numeric" value={bags} onChange={e => setBags(e.target.value)} placeholder="opt." />
          <QtyInput label="Qty (Qtl + Kg) *" valueKg={qtyKg} onChange={setQtyKg} />
          <Input label="Rate/Qtl (₹) *" type="number" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />
        </div>
        <div className="text-[10px] text-gray-400 -mt-2">Bags are for reference only — bag stock is tracked in Paddy Purchase.</div>
        {qtyKg > 0 && (
          <div className="bg-forest-700 text-white rounded-lg px-3 py-2 text-sm font-semibold flex justify-between">
            <span>{fmtQtlKg(qtyKg)} ({fmtNumber(qtyKg / 100, 2)} Qtl)</span>
            <span>{fmtINR(base)}</span>
          </div>
        )}

        <GSTPanel mode={gstMode} rate={gstRate} onModeChange={setGstMode} onRateChange={setGstRate}
          summary={<TaxSummary base={base} mode={gstMode} rate={Number(gstRate) || 0} />}
          defaultOpen={gstMode !== 'none'} />

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-gray-700">Total Amount Payable</span>
            <div className="flex gap-1.5">
              <Button type="button" size="sm" variant="gold" onClick={rt.round}>↑ Round Total Up</Button>
              {anyManual || rt.adj !== 0 ? <Button type="button" size="sm" variant="secondary" onClick={recalc}>Recalculate</Button> : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CalcField label="Base (Qtl × rate)" value={base as any} manual={baseOverride !== null}
              onChange={v => { setBaseOverride(String(v)); }} onRecalc={() => setBaseOverride(null)} />
            <CalcField label="Final Total" value={rt.final as any} manual={rt.manual}
              onChange={v => rt.setManual(String(v))} onRecalc={rt.recalc} />
          </div>
          {rt.adj !== 0 && (
            <div className="text-[11px] text-amber-700 font-medium">
              Original {fmtINR(rt.original)} → rounded {rt.adj > 0 ? '+' : ''}{fmtINR(rt.adj)} = {fmtINR(rt.final)}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-forest-100 bg-white p-3">
          <PayBox total={rt.final} existing={existing} onRemoveExisting={i => setExisting(ex => ex.filter((_, k) => k !== i))}
            amount={payAmt} onAmount={setPayAmt} mode={payMode} onMode={setPayMode} date={payDate} onDate={setPayDate} modes={modeOptions} />
        </div>

        <PhotoAttach value={photo} onChange={setPhoto} />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
      </div>
    </Modal>
  );
}

// ============================================================
// BULK HULLING ENTRY
// ============================================================
interface BRow { id: string; customer: string; bags: string; qtl: string; rate: string; rounded: boolean; paid: string }
const emptyRow = (): BRow => ({ id: uid(), customer: '', bags: '', qtl: '', rate: '', rounded: false, paid: '' });

function BulkHullingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, addHullingBatch } = useDB();
  const modeOptions = usePaymentModes();
  const saving = useRef(false);
  const [date, setDate] = useState(today());
  const [commonRate, setCommonRate] = useState('');
  const [mode, setMode] = useState('Cash');
  const [rows, setRows] = useState<BRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [allowDup, setAllowDup] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    saving.current = false;
    setDate(today());
    setCommonRate(String(db.settings.defaultHullingRate));
    setMode(modeOptions[0] || 'Cash');
    setRows([emptyRow(), emptyRow(), emptyRow()]);
    setAllowDup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const gstOn = db.settings.taxMode === 'gst' && db.settings.defaultGstRate > 0;
  const upd = (id: string, patch: Partial<BRow>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));

  const calcRow = (r: BRow) => {
    const rateN = r.rate !== '' ? Number(r.rate) : Number(commonRate);
    const qtl = Number(r.qtl) || 0;
    const base = round2(qtl * (rateN || 0));
    const g = calcGST(base, gstOn ? 'exclusive' : 'none', gstOn ? db.settings.defaultGstRate : 0);
    const adj = r.rounded ? round2(Math.ceil(g.total - 1e-9) - g.total) : 0;
    return { rateN, qtl, base, g, adj, final: round2(g.total + adj), kg: round2(qtl * 100) };
  };

  const analysed = useMemo(() => {
    const seen = new Set<string>();
    return rows.map(r => {
      const c = calcRow(r);
      const empty = !r.customer.trim() && !r.qtl && !r.bags && !r.paid;
      const errors: string[] = [];
      if (!empty) {
        if (!r.customer.trim()) errors.push('Customer name required');
        if (!(c.qtl > 0)) errors.push('Enter quantity in Qtl');
        if (!(c.rateN > 0)) errors.push('Enter a rate');
        if (r.paid && Number(r.paid) > c.final + 0.01) errors.push('Paid is more than total');
      }
      const key = `${r.customer.trim().toLowerCase()}|${date}|${c.kg}|${c.rateN}`;
      let dup = false;
      if (!empty && errors.length === 0) {
        dup = seen.has(key) || db.hulling.some(h =>
          h.date === date && h.quantityKg === c.kg && h.ratePerQtl === c.rateN &&
          partyName(db, h.partyId).trim().toLowerCase() === r.customer.trim().toLowerCase());
        seen.add(key);
      }
      return { r, c, empty, errors, dup };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, commonRate, date, db.hulling, gstOn]);

  const valid = analysed.filter(a => !a.empty && a.errors.length === 0);
  const toSave = valid.filter(a => !a.dup || allowDup);
  const errCount = analysed.filter(a => a.errors.length > 0).length;
  const dupCount = valid.filter(a => a.dup).length;
  const sumQty = toSave.reduce((s, a) => s + a.c.kg, 0);
  const sumAmt = toSave.reduce((s, a) => s + a.c.final, 0);

  const save = () => {
    if (saving.current) return;
    if (toSave.length === 0) { toast('Nothing valid to save yet', 'error'); return; }
    saving.current = true;
    const items = toSave.map(({ r, c }) => ({
      customerName: r.customer.trim(),
      entry: {
        date, bagsCount: Number(r.bags) || undefined, quantityKg: c.kg, ratePerQtl: c.rateN,
        gstMode: gstOn ? 'exclusive' as const : 'none' as const, gstRate: gstOn ? db.settings.defaultGstRate : 0,
        baseAmount: c.base, taxableAmount: c.g.taxable, cgst: c.g.cgst, sgst: c.g.sgst, totalTax: c.g.totalTax,
        roundOriginal: c.g.total, roundAdjustment: c.adj, finalTotal: c.final,
        manualOverrides: {}, payments: withDraftPayment([], r.paid, mode, date), notes: 'Bulk entry',
      },
    }));
    const n = addHullingBatch(items);
    const skipped = analysed.filter(a => !a.empty).length - n;
    toast(skipped > 0 ? `Saved ${n} entries · ${skipped} skipped (errors/duplicates)` : `Saved ${n} hulling entries`);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="⚡ Bulk Hulling Entry" maxWidth="max-w-xl" footer={
      <Button className="w-full" onClick={save} disabled={toSave.length === 0}>
        💾 Save All Bulk Entries ({toSave.length})
      </Button>
    }>
      <div className="space-y-3">
        <div className="bg-forest-50 border border-forest-100 rounded-lg px-3 py-2 text-xs text-forest-800">
          📋 Enter many hulling entries at once. Common date & rate apply to all rows unless a row has its own rate.
          {gstOn && <div className="mt-1 text-amber-700">GST {db.settings.defaultGstRate}% (exclusive) from Settings is added to every row.</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Common Date" value={date} onChange={e => setDate(e.target.value)} />
          <Input type="number" inputMode="decimal" label="Common Rate (₹/Qtl)" value={commonRate} onChange={e => setCommonRate(e.target.value)} />
        </div>
        <Select label="Payment mode (for amounts paid)" value={mode} onChange={e => setMode(e.target.value)} options={modeOptions} />

        {analysed.map(({ r, c, errors, dup, empty }, idx) => (
          <div key={r.id} className={`rounded-xl border p-3 space-y-2 ${errors.length ? 'border-red-300 bg-red-50/30' : dup ? 'border-amber-300 bg-amber-50/40' : 'border-forest-100 bg-white'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold bg-forest-50 text-forest-700 rounded-full px-2 py-0.5">#{idx + 1}</span>
              <button type="button" onClick={() => setRows(rs => rs.length > 1 ? rs.filter(x => x.id !== r.id) : [emptyRow()])}
                className="text-[11px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">✕ Remove</button>
            </div>
            <PartyInput label="Customer name *" value={r.customer} onChange={v => upd(r.id, { customer: v })} types={['customer']} placeholder="Enter customer name" />
            <div className="grid grid-cols-3 gap-2">
              <Input label="Bags" type="number" inputMode="numeric" value={r.bags} onChange={e => upd(r.id, { bags: e.target.value })} placeholder="0" />
              <Input label="Qty (Qtl) *" type="number" inputMode="decimal" value={r.qtl} onChange={e => upd(r.id, { qtl: e.target.value, rounded: false })} placeholder="0.00" />
              <Input label="Rate (₹/Qtl)" type="number" inputMode="decimal" value={r.rate} onChange={e => upd(r.id, { rate: e.target.value, rounded: false })} placeholder={commonRate} />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <Input label="Paid now (₹, optional)" type="number" inputMode="decimal" value={r.paid} onChange={e => upd(r.id, { paid: e.target.value })} placeholder="0" />
              <Button type="button" size="md" variant="secondary" disabled={c.final <= 0} onClick={() => upd(r.id, { paid: String(c.final) })}>Full</Button>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-dashed border-gray-200 pt-2">
              {r.rounded ? (
                <button type="button" onClick={() => upd(r.id, { rounded: false })} className="text-[11px] font-semibold text-amber-700 border border-amber-300 bg-amber-50 rounded-full px-2.5 py-1">
                  ✓ Rounded +{fmtINR(c.adj)} · Undo
                </button>
              ) : (
                <button type="button" disabled={c.final <= 0 || Number.isInteger(c.g.total)}
                  onClick={() => upd(r.id, { rounded: true })}
                  className="text-[11px] font-semibold text-forest-800 border border-forest-200 rounded-full px-2.5 py-1 disabled:opacity-40">↑ Round Up</button>
              )}
              <span className="text-xs font-bold text-gray-800">{c.qtl > 0 ? `${fmtQtlKg(c.kg)} = ${fmtINR(c.final)}` : <span className="text-gray-400 font-normal">Enter qty to see total</span>}</span>
            </div>
            {errors.map((e, i) => <div key={i} className="text-[11px] text-red-600 font-medium">⚠ {e}</div>)}
            {dup && !empty && <div className="text-[11px] text-amber-700 font-medium">⚠ Possible duplicate (same customer, date, qty and rate already exists)</div>}
          </div>
        ))}

        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setRows(rs => [...rs, emptyRow()])}>＋ Add Row</Button>
          <Button type="button" variant="secondary" onClick={() => setRows([emptyRow(), emptyRow(), emptyRow()])}>Clear All</Button>
        </div>

        {dupCount > 0 && (
          <label className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
            <input type="checkbox" checked={allowDup} onChange={e => setAllowDup(e.target.checked)} className="mt-0.5" />
            <span>Also save the {dupCount} row(s) flagged as possible duplicates. Unticked rows are skipped and reported.</span>
          </label>
        )}

        <div className="bg-forest-800 text-white rounded-xl p-3 text-xs space-y-1">
          <div className="font-bold text-sm">Before you save</div>
          <div className="flex justify-between"><span>Rows to save</span><b>{toSave.length}</b></div>
          <div className="flex justify-between"><span>Total quantity</span><b>{fmtQtlKg(sumQty)}</b></div>
          <div className="flex justify-between"><span>Total amount</span><b>{fmtINR(sumAmt)}</b></div>
          {errCount > 0 && <div className="text-red-300">{errCount} row(s) have errors and will be skipped until fixed.</div>}
          {dupCount > 0 && !allowDup && <div className="text-amber-300">{dupCount} possible duplicate(s) will be skipped.</div>}
        </div>
      </div>
    </Modal>
  );
}
