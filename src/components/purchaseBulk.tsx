import React, { useMemo, useRef, useState } from 'react';
import { useDB } from '../context';
import { fmtINR, fmtQtlKg, today, round2, withDraftPayment, uid, sizeForVariety, now } from '../db';
import type { PaddySize, BagGivenType, PurchaseEntry, PurchaseLine, BagMovement } from '../types';
import { Button, Input, Select, Modal, Chips, toast } from './ui';
import { PartyInput, usePaymentModes, partyName, varietyName } from './pages';

// ---------- shared small pieces (also used by the single-entry form) ----------
export function SizeToggle({ value, onChange, compact }: { value: PaddySize; onChange: (v: PaddySize) => void; compact?: boolean }) {
  const opt = (v: PaddySize, icon: string, label: string, short: string) => (
    <button type="button" key={v} onClick={() => onChange(v)}
      className={`flex-1 rounded-lg border-2 transition-colors ${compact ? 'px-2 py-2 text-xs' : 'px-3 py-2.5 text-sm'} font-bold ${
        value === v ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-200 bg-white text-gray-500'}`}>
      {icon} {compact ? short : label}
      {!compact && value === v && <div className="text-[10px] font-semibold text-green-700">✓ Selected</div>}
    </button>
  );
  return <div className="flex gap-2">{opt('small', '🌾', 'Small Paddy', 'S')}{opt('big', '🌱', 'Big Paddy', 'B')}</div>;
}

export function NewVarietyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { upsertVariety } = useDB();
  const [name, setName] = useState('');
  const [cat, setCat] = useState<'small' | 'big' | 'other'>('small');
  React.useEffect(() => { if (open) { setName(''); setCat('small'); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="New Paddy Variety" maxWidth="max-w-sm" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => {
          if (!name.trim()) { toast('Enter a variety name', 'error'); return; }
          upsertVariety({ name: name.trim(), category: cat, usage: ['paddy'] });
          toast(`“${name.trim()}” added — pick it from the variety list`);
          onClose();
        }}>Add Variety</Button>
      </>
    }>
      <div className="space-y-3">
        <Input label="Variety name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sona Masuri, FIT (White)" />
        <div>
          <div className="text-xs font-medium text-gray-700 mb-1">Default paddy size (Small / Big)</div>
          <Chips value={cat} onChange={v => setCat(v as any)} options={[{ value: 'small', label: '🌾 Small' }, { value: 'big', label: '🌱 Big' }, { value: 'other', label: 'Other' }]} />
          <p className="text-[11px] text-gray-500 mt-1">You can change the size on each purchase line. The mapping is editable in Settings.</p>
        </div>
      </div>
    </Modal>
  );
}

// ---------- BULK PADDY PURCHASE ----------
interface BLine { id: string; varietyId: string; size: PaddySize; qtl: string; rate: string }
interface BRow {
  id: string; customer: string;
  /** bags typed once for the row (bags the paddy came in / total bags handled) */
  bags: string;
  /** Mixed split - used only when bagType is 'mixed'; New + Old auto-add-up to `bags` */
  newBags: string; oldBags: string;
  lines: BLine[]; bagType: BagGivenType; rounded: boolean; paid: string;
  /** Mixed only: keep New + Old adding up to the Bags count */
  autoTotal: boolean;
}

export function BulkPurchaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, stock, addPurchaseBatch } = useDB();
  const modeOptions = usePaymentModes();
  const saving = useRef(false);
  const activeVarieties = db.varieties.filter(v => v.active && (v.usage || ['paddy', 'rice']).includes('paddy'));

  const newLine = (): BLine => {
    const v = activeVarieties[0];
    return { id: uid(), varietyId: v?.id || '', size: sizeForVariety(db, v?.id || ''), qtl: '', rate: '' };
  };
  const newRow = (): BRow => ({ id: uid(), customer: '', bags: '', newBags: '', oldBags: '', lines: [newLine()], bagType: 'none', rounded: false, paid: '', autoTotal: true });

  const [date, setDate] = useState(today());
  const [commonRate, setCommonRate] = useState('');
  const [mode, setMode] = useState('Cash');
  const [rows, setRows] = useState<BRow[]>([]);
  const [allowDup, setAllowDup] = useState(false);
  const [showNewVar, setShowNewVar] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    saving.current = false;
    setDate(today()); setCommonRate(''); setMode(modeOptions[0] || 'Cash'); setAllowDup(false);
    setRows([newRow(), newRow(), newRow()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updRow = (id: string, patch: Partial<BRow>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch, rounded: patch.rounded ?? false } : r));
  const updLine = (rid: string, lid: string, patch: Partial<BLine>) =>
    setRows(rs => rs.map(r => r.id !== rid ? r : { ...r, rounded: false, lines: r.lines.map(l => l.id === lid ? { ...l, ...patch } : l) }));

  const analysed = useMemo(() => {
    const seen = new Set<string>();
    return rows.map(r => {
      const lines = r.lines.map(l => {
        const rate = l.rate !== '' ? Number(l.rate) : Number(commonRate);
        const qtl = Number(l.qtl) || 0;
        return { l, rate: rate || 0, qtl, kg: round2(qtl * 100), amount: round2(qtl * (rate || 0)) };
      });
      const used = lines.filter(x => x.qtl > 0);
      const total = round2(used.reduce((s, x) => s + x.amount, 0));
      const adj = r.rounded ? round2(Math.floor(total + 1e-9) - total) : 0;
      const final = round2(total + adj);
      const kg = round2(used.reduce((s, x) => s + x.kg, 0));
      // The Bags count is the bags the customer brought in. New/Old send them all back
      // automatically; Mixed uses the split entered under the chips.
      const bagsN = Number(r.bags) || 0;
      const newGiven = r.bagType === 'new' ? bagsN : r.bagType === 'mixed' ? (Number(r.newBags) || 0) : 0;
      const oldGiven = r.bagType === 'old' ? bagsN : r.bagType === 'mixed' ? (Number(r.oldBags) || 0) : 0;
      const pending = bagsN - newGiven - oldGiven;
      const empty = !r.customer.trim() && !r.bags && !r.newBags && !r.oldBags && !r.paid && used.length === 0;
      const errors: string[] = [];
      if (!empty) {
        if (!r.customer.trim()) errors.push('Customer name required');
        if (used.length === 0) errors.push('Enter quantity (Qtl) for at least one variety');
        used.forEach(x => {
          if (!x.l.varietyId) errors.push('Choose a variety');
          if (!(x.rate > 0)) errors.push('Enter a rate (row or common rate)');
        });
        if ((r.bagType === 'new' || r.bagType === 'old') && !(bagsN > 0)) errors.push('Enter number of bags');
        if (r.paid && Number(r.paid) > final + 0.01) errors.push('Paid is more than total');
      }
      let dup = false;
      if (!empty && errors.length === 0) {
        const key = `${r.customer.trim().toLowerCase()}|${date}|${kg}`;
        dup = seen.has(key) || db.purchases.some(p => p.date === date && Math.abs(p.netKg - kg) < 0.01 &&
          partyName(db, p.partyId).trim().toLowerCase() === r.customer.trim().toLowerCase());
        seen.add(key);
      }
      return { r, lines, used, total, adj, final, kg, empty, errors: [...new Set(errors)], dup, bagsN, newGiven, oldGiven, pending };
    });
  }, [rows, commonRate, date, db.purchases]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = analysed.filter(a => !a.empty && a.errors.length === 0);
  const toSave = valid.filter(a => !a.dup || allowDup);
  const errCount = analysed.filter(a => a.errors.length > 0).length;
  const dupCount = valid.filter(a => a.dup).length;
  const sumKg = toSave.reduce((s, a) => s + a.kg, 0);
  const sumAmt = toSave.reduce((s, a) => s + a.final, 0);
  const newBagsNeeded = toSave.reduce((s, a) => s + a.newGiven, 0);
  const oldBagsNeeded = toSave.reduce((s, a) => s + a.oldGiven, 0);

  const save = () => {
    if (saving.current) return;
    if (toSave.length === 0) { toast('Nothing valid to save yet', 'error'); return; }
    saving.current = true;
    const items = toSave.map(a => {
      const bags = a.bagsN;
      const lines: PurchaseLine[] = a.used.map((x, i) => ({
        id: uid(), varietyId: x.l.varietyId, size: x.l.size, bags: i === 0 ? bags : 0,
        qtyKg: x.kg, ratePerQtl: x.rate, amount: x.amount,
      }));
      const newGiven = a.newGiven;
      const oldGiven = a.oldGiven;
      const unit = stock.avgBagCost;
      const bm: BagMovement = {
        id: uid(), date, bagsReceived: bags, newBagsIssued: newGiven, oldBagsIssued: oldGiven,
        newBagsReturned: 0, oldBagsReturned: 0, newBagCharge: 0, newBagLoss: round2(newGiven * unit),
        bagUnitCost: unit, chargeCustomer: false, givenType: a.r.bagType, createdAt: now(),
      };
      const entry: Omit<PurchaseEntry, 'id' | 'createdAt' | 'updatedAt' | 'voucherNumber' | 'partyId'> = {
        date, varietyId: lines[0].varietyId, lines,
        grossKg: 0, tareKg: 0, bagWeightKg: 0, otherDeductionsKg: 0, moistureDeductionKg: 0,
        netKg: a.kg, billableQtl: round2(a.kg / 100), ratePerQtl: a.kg > 0 ? round2(a.total / (a.kg / 100)) : 0,
        baseAmount: a.total, gstMode: 'none', gstRate: 0, taxableAmount: a.total, cgst: 0, sgst: 0, totalTax: 0,
        roundOriginal: a.total, roundAdjustment: a.adj, finalTotal: a.final,
        manualOverrides: {}, notes: 'Bulk entry', payments: withDraftPayment([], a.r.paid, mode, date),
        bagMovements: [bm],
      };
      return { customerName: a.r.customer.trim(), entry };
    });
    const n = addPurchaseBatch(items);
    const skipped = analysed.filter(a => !a.empty).length - n;
    toast(skipped > 0 ? `Saved ${n} purchases · ${skipped} skipped (errors/duplicates)` : `Saved ${n} purchases`);
    onClose();
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="⚡ Bulk Paddy Purchase Entry" maxWidth="max-w-xl" footer={
        <Button className="w-full" onClick={save} disabled={toSave.length === 0}>💾 Save All Purchase Entries ({toSave.length})</Button>
      }>
        <div className="space-y-3">
          <div className="rounded-xl border border-forest-100 bg-forest-50/60 p-3 space-y-2">
            <div className="text-[11px] font-bold tracking-wide text-forest-800">📋 COMMON FIELDS (APPLY TO ALL ROWS)</div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" label="Date" value={date} onChange={e => setDate(e.target.value)} />
              <Input type="number" inputMode="decimal" label="Common Rate (₹/Qtl)" value={commonRate} onChange={e => setCommonRate(e.target.value)} placeholder="e.g. 2200" />
            </div>
            <Select label="Payment mode (for amounts paid)" value={mode} onChange={e => setMode(e.target.value)} options={modeOptions} />
            <button type="button" onClick={() => setShowNewVar(true)} className="text-[11px] font-semibold text-forest-700 underline">＋ New variety</button>
          </div>

          {analysed.map(({ r, used, final, errors, dup, empty, adj, total, kg, bagsN, pending, newGiven, oldGiven }, idx) => (
            <div key={r.id} className={`rounded-xl border p-3 space-y-2.5 ${errors.length ? 'border-red-300 bg-red-50/30' : dup ? 'border-amber-300 bg-amber-50/40' : 'border-forest-100 bg-forest-50/30'}`}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold bg-forest-100 text-forest-700 rounded-full px-2.5 py-1 shrink-0">Row {idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <PartyInput label="" value={r.customer} onChange={v => updRow(r.id, { customer: v, rounded: r.rounded })} placeholder="Customer name *" />
                </div>
                <input type="number" inputMode="numeric" value={r.bags} placeholder="Bags" title="Bags for this row"
                  onChange={e => {
                    const patch: Partial<BRow> = { bags: e.target.value, rounded: r.rounded };
                    // Mixed: keep New + Old adding up to the bags typed here
                    if (r.bagType === 'mixed') patch.oldBags = String(Math.max(0, (Number(e.target.value) || 0) - (Number(r.newBags) || 0)));
                    updRow(r.id, patch);
                  }}
                  className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-center" />
                <button type="button" onClick={() => setRows(rs => rs.length > 1 ? rs.filter(x => x.id !== r.id) : [newRow()])}
                  className="w-8 h-8 rounded-lg bg-red-50 border border-red-200 text-red-600 font-bold shrink-0">✕</button>
              </div>

              {r.lines.map(l => (
                <div key={l.id} className="rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                    <Select label="Variety" value={l.varietyId}
                      onChange={e => updLine(r.id, l.id, { varietyId: e.target.value, size: sizeForVariety(db, e.target.value) })}
                      options={[{ value: '', label: '— Variety —' }, ...activeVarieties.map(v => ({ value: v.id, label: v.name }))]} />
                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1">Size</div>
                      <SizeToggle compact value={l.size} onChange={v => updLine(r.id, l.id, { size: v })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                    <Input label="Qty (Qtl) *" type="number" inputMode="decimal" value={l.qtl} onChange={e => updLine(r.id, l.id, { qtl: e.target.value })} placeholder="0.00" />
                    <Input label="Rate (₹/Qtl)" type="number" inputMode="decimal" value={l.rate} onChange={e => updLine(r.id, l.id, { rate: e.target.value })} placeholder={commonRate || 'Rate'} />
                    <button type="button" disabled={r.lines.length < 2}
                      onClick={() => setRows(rs => rs.map(x => x.id !== r.id ? x : { ...x, rounded: false, lines: x.lines.filter(y => y.id !== l.id) }))}
                      className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 disabled:opacity-30">✕</button>
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setRows(rs => rs.map(x => x.id !== r.id ? x : { ...x, rounded: false, lines: [...x.lines, newLine()] }))}
                  className="px-3 py-1.5 rounded-full border border-forest-300 text-forest-800 text-xs font-semibold">＋ Add Variety</button>
                {r.rounded ? (
                  <button type="button" onClick={() => updRow(r.id, { rounded: false })}
                    className="px-3 py-1.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold">✓ Rounded {fmtINR(adj)} · Undo</button>
                ) : (
                  <button type="button" disabled={total <= 0 || Number.isInteger(total)} onClick={() => updRow(r.id, { rounded: true })}
                    className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold disabled:opacity-40">↓ Round Down</button>
                )}
                <span className="ml-auto text-xs font-bold text-gray-800">
                  {used.length ? `${fmtQtlKg(kg)} = ${fmtINR(final)}` : <span className="font-normal text-gray-400">Enter qty to see total</span>}
                </span>
              </div>

              <div className="border-t border-dashed border-gray-300 pt-2 space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-gray-700">🛍 Bags Given:</span>
                  <Chips value={r.bagType} onChange={v => {
                    const patch: Partial<BRow> = { bagType: v as BagGivenType, rounded: r.rounded };
                    // Choosing Mixed: Old auto-fills with whatever of the bags count is not New
                    if (v === 'mixed') { patch.oldBags = String(Math.max(0, (Number(r.bags) || 0) - (Number(r.newBags) || 0))); patch.autoTotal = true; }
                    updRow(r.id, patch);
                  }}
                    options={[{ value: 'none', label: 'None' }, { value: 'old', label: '🧺 Old' }, { value: 'new', label: '🆕 New' }, { value: 'mixed', label: '🔀 Mixed' }]} />
                </div>
                {(r.bagType === 'new' || r.bagType === 'old') && (
                  <div className="text-[11px] text-gray-500">
                    {Number(r.bags) > 0
                      ? <>All <b>{r.bags}</b> bags are sent back as {r.bagType === 'new' ? '🆕 new' : '🧺 old'} bags (automatic) → pending <b>0</b>.</>
                      : <>Type the number of bags in the <b>Bags</b> box above — they are sent back as {r.bagType === 'new' ? 'new' : 'old'} bags.</>}
                  </div>
                )}
                {r.bagType === 'mixed' && (
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <input type="checkbox" checked={r.autoTotal} onChange={e => updRow(r.id, {
                        autoTotal: e.target.checked, rounded: r.rounded,
                        oldBags: e.target.checked ? String(Math.max(0, (Number(r.bags) || 0) - (Number(r.newBags) || 0))) : r.oldBags,
                      })} />
                      <span>🔗 Auto-total: New + Old = {Number(r.bags) || 0} bags (uncheck to send back less)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="🆕 New bags given" type="number" inputMode="numeric" value={r.newBags} placeholder="0"
                        onChange={e => updRow(r.id, {
                          newBags: e.target.value,
                          // with auto-total on, the other side fills itself up to the Bags count
                          oldBags: r.autoTotal ? String(Math.max(0, (Number(r.bags) || 0) - (Number(e.target.value) || 0))) : r.oldBags,
                          rounded: r.rounded,
                        })} />
                      <Input label="🧺 Old bags given" type="number" inputMode="numeric" value={r.oldBags} placeholder="0"
                        onChange={e => updRow(r.id, {
                          oldBags: e.target.value,
                          newBags: r.autoTotal ? String(Math.max(0, (Number(r.bags) || 0) - (Number(e.target.value) || 0))) : r.newBags,
                          rounded: r.rounded,
                        })} />
                    </div>
                    <div className="text-[11px] text-gray-500">
                      🔗 New + Old auto-add-up to the <b>{Number(r.bags) || 0}</b> bags typed above
                      {(Number(r.newBags) || 0) + (Number(r.oldBags) || 0) !== (Number(r.bags) || 0) && Number(r.bags) > 0
                        ? <> · totalling <b>{(Number(r.newBags) || 0) + (Number(r.oldBags) || 0)}</b> → pending <b>{(Number(r.bags) || 0) - (Number(r.newBags) || 0) - (Number(r.oldBags) || 0)}</b></>
                        : null}
                      {(Number(r.newBags) || 0) > stock.newBags && <> · ⚠ only {stock.newBags} new bags in stock</>}
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <Input label="Paid now (₹, optional)" type="number" inputMode="decimal" value={r.paid} onChange={e => updRow(r.id, { paid: e.target.value, rounded: r.rounded })} placeholder="0" />
                <Button type="button" variant="secondary" disabled={final <= 0} onClick={() => updRow(r.id, { paid: String(final), rounded: r.rounded })}>Full</Button>
              </div>
              {errors.map((e, i) => <div key={i} className="text-[11px] text-red-600 font-medium">⚠ {e}</div>)}
              {dup && !empty && <div className="text-[11px] text-amber-700 font-medium">⚠ Possible duplicate (same customer, date and quantity already saved)</div>}
              {used.length > 0 && !errors.length && used.length > 1 && (
                <div className="text-[10px] text-gray-500">{used.map(x => `${varietyName(db, x.l.varietyId)} ${fmtQtlKg(x.kg)}`).join(' · ')}</div>
              )}
              {bagsN > 0 && pending > 0 && (
                <div className="text-[11px] font-semibold text-amber-700">⏳ {pending} bags still pending (sent back {newGiven + oldGiven} of {bagsN})</div>
              )}
            </div>
          ))}

          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setRows(rs => [...rs, newRow()])}>＋ Add Row</Button>
            <Button type="button" variant="secondary" onClick={() => setRows([newRow(), newRow(), newRow()])}>Clear All</Button>
          </div>

          {(newBagsNeeded > stock.newBags || oldBagsNeeded > stock.oldBags) && (
            <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              ⚠ Stock warning: giving {newBagsNeeded} new bags (stock {stock.newBags}) and {oldBagsNeeded} old bags (stock {stock.oldBags}) will make bag stock negative. You can still save.
            </div>
          )}
          {dupCount > 0 && (
            <label className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <input type="checkbox" checked={allowDup} onChange={e => setAllowDup(e.target.checked)} className="mt-0.5" />
              <span>Also save the {dupCount} row(s) flagged as possible duplicates. Unticked rows are skipped and reported.</span>
            </label>
          )}
          <div className="bg-forest-800 text-white rounded-xl p-3 text-xs space-y-1">
            <div className="font-bold text-sm">Before you save</div>
            <div className="flex justify-between"><span>Rows to save</span><b>{toSave.length}</b></div>
            <div className="flex justify-between"><span>Total quantity</span><b>{fmtQtlKg(sumKg)}</b></div>
            <div className="flex justify-between"><span>Total payable</span><b>{fmtINR(sumAmt)}</b></div>
            {errCount > 0 && <div className="text-red-300">{errCount} row(s) have errors and will be skipped until fixed.</div>}
            {dupCount > 0 && !allowDup && <div className="text-amber-300">{dupCount} possible duplicate(s) will be skipped.</div>}
          </div>
        </div>
      </Modal>
      <NewVarietyModal open={showNewVar} onClose={() => setShowNewVar(false)} />
    </>
  );
}
