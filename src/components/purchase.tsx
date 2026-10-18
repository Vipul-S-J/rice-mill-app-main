import React, { useMemo, useRef, useState } from 'react';
import { useDB } from '../context';
import {
  fmtINR, fmtQtlKg, fmtNumber, fmtDate, today, calcGST, round2, sumPayments, paymentStatus, inRange,
  withDraftPayment, uid, now, bagSummary, sizeForVariety,
} from '../db';
import type { PurchaseEntry, PurchaseLine, BagMovement, Payment, PaddySize, BagGivenType } from '../types';
import {
  Button, Input, Select, Card, Modal, Confirm, Badge, EmptyState, SearchBar, GSTPanel, CalcField,
  QtyInput, PayBox, PhotoAttach, DateFilter, MiniBtn, Chips, Collapsible, toast,
} from './ui';
import type { DateFilterValue } from './ui';
import {
  PartyInput, TaxSummary, useEnsureParty, usePaymentModes, partyName, varietyName, statusBadge, AddPaymentModal,
} from './pages';
import { useRoundedTotal } from './amount';
import { PurchaseVoucherModal } from './purchaseVoucher';
import { BulkPurchaseModal, SizeToggle, NewVarietyModal } from './purchaseBulk';

type PurchaseSave = Omit<PurchaseEntry, 'id' | 'createdAt' | 'updatedAt' | 'voucherNumber'>;

// ============================================================
// PAGE
// ============================================================
export function PurchasePage() {
  const { db, addPurchase, updatePurchase, deletePurchase, addPurchasePayment, addPurchaseBagReturn } = useDB();
  const modeOptions = usePaymentModes();
  const [sizeTab, setSizeTab] = useState<'all' | 'small' | 'big'>('all');
  const [search, setSearch] = useState('');
  const [varietyFilter, setVarietyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('date-desc');
  const [dateF, setDateF] = useState<DateFilterValue>({ preset: 'all' });
  const [editing, setEditing] = useState<PurchaseEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [payEntry, setPayEntry] = useState<PurchaseEntry | null>(null);
  const [bagEntry, setBagEntry] = useState<PurchaseEntry | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);

  const entries = useMemo(() => {
    let list = [...db.purchases];
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter(p => {
        const party = db.parties.find(x => x.id === p.partyId);
        return p.voucherNumber.toLowerCase().includes(s) || (party?.name || '').toLowerCase().includes(s) ||
          (party?.phone || '').includes(s) || (p.vehicleNumber || '').toLowerCase().includes(s) ||
          p.lines.some(l => varietyName(db, l.varietyId).toLowerCase().includes(s)) || p.date.includes(s);
      });
    }
    if (sizeTab !== 'all') list = list.filter(p => p.lines.some(l => l.size === sizeTab));
    if (varietyFilter !== 'all') list = list.filter(p => p.lines.some(l => l.varietyId === varietyFilter));
    list = list.filter(p => inRange(p.date, dateF));
    if (statusFilter === 'bags') list = list.filter(p => bagSummary(p.bagMovements).pending > 0);
    else if (statusFilter !== 'all') list = list.filter(p => paymentStatus(p.finalTotal, sumPayments(p.payments)) === statusFilter);
    list.sort((a, b) => {
      switch (sort) {
        case 'date-asc': return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
        case 'qty-asc': return a.netKg - b.netKg;
        case 'qty-desc': return b.netKg - a.netKg;
        case 'amt-asc': return a.finalTotal - b.finalTotal;
        case 'amt-desc': return b.finalTotal - a.finalTotal;
        default: return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
      }
    });
    return list;
  }, [db, sizeTab, search, varietyFilter, statusFilter, sort, dateF]);

  const totals = useMemo(() => {
    const total = entries.reduce((s, p) => s + p.finalTotal, 0);
    const paid = entries.reduce((s, p) => s + sumPayments(p.payments), 0);
    return {
      count: entries.length, qty: entries.reduce((s, p) => s + p.netKg, 0), total, paid, due: round2(total - paid),
      bags: entries.reduce((s, p) => s + bagSummary(p.bagMovements).pending, 0),
    };
  }, [entries]);

  const viewEntry = viewId ? db.purchases.find(p => p.id === viewId) : null;
  const toggleSel = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => { setEditing(null); setShowForm(true); }}>＋ New Purchase Entry</Button>
        <Button variant="gold" onClick={() => setShowBulk(true)}>⚡ Bulk Entry</Button>
      </div>

      <div className="space-y-2">
        <Chips value={sizeTab} onChange={v => setSizeTab(v as any)} options={[{ value: 'all', label: 'All' }, { value: 'small', label: '🌾 Small' }, { value: 'big', label: '🌱 Big' }]} />
        <SearchBar value={search} onChange={setSearch} placeholder="Customer, voucher, vehicle, variety…" />
        <div className="flex gap-2">
          <Select wrapperClassName="flex-1" value={varietyFilter} onChange={e => setVarietyFilter(e.target.value)}
            options={[{ value: 'all', label: 'All varieties' }, ...db.varieties.filter(v => v.active).map(v => ({ value: v.id, label: v.name }))]} />
          <Select wrapperClassName="flex-1" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            options={[{ value: 'all', label: 'All Status' }, { value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'bags', label: 'Bags pending' }]} />
        </div>
        <DateFilter value={dateF} onChange={setDateF} />
        <div className="flex gap-2">
          <Select wrapperClassName="flex-1" value={sort} onChange={e => setSort(e.target.value)}
            options={[
              { value: 'date-desc', label: '↓ Newest first' }, { value: 'date-asc', label: '↑ Oldest first' },
              { value: 'qty-asc', label: 'Qty: small → large' }, { value: 'qty-desc', label: 'Qty: large → small' },
              { value: 'amt-asc', label: 'Amount: low → high' }, { value: 'amt-desc', label: 'Amount: high → low' },
            ]} />
          <button type="button" onClick={() => { setSelectMode(m => !m); setSelected([]); }}
            className={`px-3 rounded-lg border text-sm font-semibold ${selectMode ? 'bg-forest-700 text-white border-forest-700' : 'bg-white text-forest-800 border-forest-200'}`}>
            ☑ Select
          </button>
        </div>
      </div>

      {entries.length > 0 && (
        <div className="bg-forest-50 border border-forest-100 rounded-xl p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-gray-600">📦 {fmtNumber(totals.count, 0)} records</span><b className="text-gray-900">Total: {fmtQtlKg(totals.qty)}</b></div>
          <div className="flex justify-between"><span className="text-gray-600">💰 Amount</span><b className="text-forest-800">{fmtINR(totals.total)}</b></div>
          <div className="flex justify-between"><span className="text-gray-600">Paid {fmtINR(totals.paid)}</span><b className={totals.due > 0.009 ? 'text-red-600' : 'text-green-700'}>Due {fmtINR(totals.due)}</b></div>
          {totals.bags !== 0 && <div className="text-amber-700">⏳ {fmtNumber(totals.bags, 0)} bags pending return</div>}
        </div>
      )}

      {selectMode && (
        <div className="flex items-center justify-between bg-white border border-forest-200 rounded-xl px-3 py-2">
          <span className="text-xs text-gray-600">{selected.length} selected</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setSelected(entries.map(e => e.id))}>Select all shown</Button>
            <Button size="sm" variant="danger" disabled={!selected.length} onClick={() => setConfirmBulkDel(true)}>Delete</Button>
          </div>
        </div>
      )}

      <Card>
        {entries.length === 0 ? (
          <EmptyState title={db.purchases.length ? 'No purchases match these filters' : 'No paddy purchases yet'}
            subtitle={db.purchases.length ? 'Clear the search or filters to see all records.' : 'Tap “New Purchase Entry” or “Bulk Entry” to begin.'} />
        ) : entries.map(p => {
          const paid = sumPayments(p.payments);
          const st = paymentStatus(p.finalTotal, paid);
          const due = round2(p.finalTotal - paid);
          const bag = bagSummary(p.bagMovements);
          const sizes = [...new Set(p.lines.map(l => l.size))];
          const totalBags = p.lines.reduce((s, l) => s + (l.bags || 0), 0);
          return (
            <div key={p.id} className="px-3 py-3 border-b border-gray-100 last:border-0">
              <div className="flex items-start gap-2">
                {selectMode && <input type="checkbox" className="mt-1.5 w-4 h-4" checked={selected.includes(p.id)} onChange={() => toggleSel(p.id)} />}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => selectMode ? toggleSel(p.id) : setViewId(p.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">{p.voucherNumber}</span>
                        <span className="text-sm font-semibold text-gray-900 truncate">{partyName(db, p.partyId)}</span>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap">
                        <span>{fmtDate(p.date)}</span>
                        {sizes.map(s => <Badge key={s} tone={s === 'small' ? 'gold' : 'green'}>{s === 'small' ? '🌾 Small' : '🌱 Big'}</Badge>)}
                        {totalBags > 0 && <span>· {totalBags} Bags</span>}
                        {p.vehicleNumber && <span>· {p.vehicleNumber}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-[15px] text-gray-900">{fmtINR(p.finalTotal)}</div>
                      <div className="mt-0.5">{statusBadge(st)}</div>
                      {due > 0.009 && <div className="text-[10px] text-red-600 mt-0.5">Due {fmtINR(due)}</div>}
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1.5">• Total: <b className="text-gray-800">{fmtQtlKg(p.netKg)}</b></div>
                  {p.lines.map(l => (
                    <div key={l.id} className="mt-1 bg-gray-50 rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-800">
                      {varietyName(db, l.varietyId)} {fmtQtlKg(l.qtyKg)} @ {fmtINR(l.ratePerQtl)}/Qtl
                    </div>
                  ))}
                  {p.roundAdjustment !== 0 && <div className="text-[10px] text-amber-700 mt-1">Rounded {fmtINR(p.roundAdjustment)} from {fmtINR(p.roundOriginal)}</div>}
                  <div className="flex gap-1.5 flex-wrap mt-1.5">
                    {bag.newIssued > 0 && (
                      <span className="text-[10px] font-semibold rounded-md px-2 py-1 bg-red-50 text-red-700 border border-red-100">
                        🆕 {bag.newIssued} New Bags given {bag.charge > 0 ? `(charged ${fmtINR(bag.charge)})` : `(loss ${fmtINR(bag.loss)})`}
                      </span>
                    )}
                    {bag.oldIssued > 0 && <span className="text-[10px] font-semibold rounded-md px-2 py-1 bg-amber-50 text-amber-700 border border-amber-100">🧺 {bag.oldIssued} Old Bags given</span>}
                    {bag.pending !== 0 && <span className="text-[10px] font-semibold rounded-md px-2 py-1 bg-yellow-50 text-yellow-800 border border-yellow-200">⏳ {bag.pending} bags pending</span>}
                  </div>
                </div>
              </div>
              {!selectMode && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <MiniBtn onClick={() => { setEditing(p); setShowForm(true); }} tone="blue">✎ Edit</MiniBtn>
                  <MiniBtn onClick={() => setViewId(p.id)}>🧾 Receipt</MiniBtn>
                  {due > 0.009 && <MiniBtn onClick={() => setPayEntry(p)} tone="green">＋ Pay</MiniBtn>}
                  <MiniBtn onClick={() => setBagEntry(p)} tone="gold">👜 Bags</MiniBtn>
                  <MiniBtn onClick={() => setDelId(p.id)} tone="danger">🗑</MiniBtn>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <PurchaseForm
        open={showForm} initial={editing}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSave={(data) => {
          if (editing) { updatePurchase(editing.id, data); toast('Purchase updated'); }
          else { addPurchase(data); toast('Purchase saved'); }
          setShowForm(false); setEditing(null);
        }}
      />
      <BulkPurchaseModal open={showBulk} onClose={() => setShowBulk(false)} />
      <Confirm open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => { if (delId) { deletePurchase(delId); toast('Purchase deleted — stock, bags and ledger reversed'); } }}
        message="Delete this purchase? Paddy stock, bag stock, payments and ledger effects are reversed." />
      <Confirm open={confirmBulkDel} onClose={() => setConfirmBulkDel(false)}
        onConfirm={() => { selected.forEach(id => deletePurchase(id)); toast(`${selected.length} purchases deleted`); setSelected([]); setSelectMode(false); }}
        message={`Delete ${selected.length} selected purchases? Stock, bags and ledger effects of each are reversed.`} confirmText="Delete all selected" />
      {viewEntry && <PurchaseVoucherModal db={db} entry={viewEntry} onClose={() => setViewId(null)} />}
      {payEntry && (
        <AddPaymentModal open total={payEntry.finalTotal} paid={sumPayments(payEntry.payments)} modes={modeOptions}
          onClose={() => setPayEntry(null)}
          onSave={(p: Omit<Payment, 'id' | 'createdAt'>) => { addPurchasePayment(payEntry.id, p); setPayEntry(null); toast('Payment added'); }} />
      )}
      {bagEntry && (
        <BagReturnModal entry={db.purchases.find(p => p.id === bagEntry.id) || bagEntry} onClose={() => setBagEntry(null)}
          onSave={(bm) => { addPurchaseBagReturn(bagEntry.id, bm); setBagEntry(null); toast('Bag record saved'); }} />
      )}
    </div>
  );
}

// ============================================================
// SINGLE ENTRY FORM
// ============================================================
interface LineState { id: string; varietyId: string; size: PaddySize; bags: string; qtyKg: number; rate: string }

function PurchaseForm({ open, initial, onClose, onSave }: {
  open: boolean; initial: PurchaseEntry | null; onClose: () => void; onSave: (d: PurchaseSave) => void;
}) {
  const { db, stock } = useDB();
  const modeOptions = usePaymentModes();
  const ensureParty = useEnsureParty();
  const saving = useRef(false);
  // Guards the sync effect for the first commit after opening, so the values loaded
  // by the reset effect below always win (no auto-fill stomping an edited entry).
  const formReady = useRef(false);
  const activeVarieties = db.varieties.filter(v => v.active && (v.usage || ['paddy', 'rice']).includes('paddy'));

  const blankLine = (): LineState => {
    const v = activeVarieties[0];
    return { id: uid(), varietyId: v?.id || '', size: sizeForVariety(db, v?.id || ''), bags: '', qtyKg: 0, rate: '' };
  };

  const [date, setDate] = useState(today());
  const [vehicle, setVehicle] = useState('');
  const [customer, setCustomer] = useState('');
  const [lines, setLines] = useState<LineState[]>([]);
  const [gstMode, setGstMode] = useState<'none' | 'exclusive' | 'inclusive'>('none');
  const [gstRate, setGstRate] = useState('0');
  const [wb, setWb] = useState({ gross: '', tare: '', bagW: '', moist: '', other: '' });
  const [wbLine, setWbLine] = useState(0);
  const [bagType, setBagType] = useState<BagGivenType>('none');
  const [newGiven, setNewGiven] = useState('0');
  const [oldGiven, setOldGiven] = useState('0');
  // The bags number is typed ONCE on the variety lines (bags the customer brought in).
  // "Sent back" counts follow it automatically; Mixed links the two counts to the same total.
  const [newSync, setNewSync] = useState(false);
  const [oldSync, setOldSync] = useState(false);
  const [balance, setBalance] = useState(true);
  const [unitCost, setUnitCost] = useState('0');
  const [chargeBags, setChargeBags] = useState(false);
  const [adjQty, setAdjQty] = useState('0');
  const [adjReason, setAdjReason] = useState('');
  const [existing, setExisting] = useState<Payment[]>([]);
  const [payAmt, setPayAmt] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [payDate, setPayDate] = useState(today());
  const [photo, setPhoto] = useState<string | undefined>();
  const [notes, setNotes] = useState('');
  const [showNewVar, setShowNewVar] = useState(false);

  // ---- derived amounts ----
  const lineAmt = (l: LineState) => round2((l.qtyKg / 100) * (Number(l.rate) || 0));
  const paddyValue = round2(lines.reduce((s, l) => s + lineAmt(l), 0));
  const totalKg = round2(lines.reduce((s, l) => s + l.qtyKg, 0));
  const totalBags = lines.reduce((s, l) => s + (Number(l.bags) || 0), 0);
  const g = calcGST(paddyValue, gstMode, Number(gstRate) || 0);
  const effNew = bagType === 'new' || bagType === 'mixed' ? Number(newGiven) || 0 : 0;
  const effOld = bagType === 'old' || bagType === 'mixed' ? Number(oldGiven) || 0 : 0;
  const unit = Number(unitCost) || 0;
  const bagCharge = chargeBags && effNew > 0 ? round2(effNew * unit) : 0;
  const bagLoss = !chargeBags && effNew > 0 ? round2(effNew * unit) : 0;
  const rt = useRoundedTotal(round2(g.total - bagCharge), 'down');

  const m0 = initial?.bagMovements[0];
  // new-bag stock available for THIS entry (add back what this entry already took)
  const newAvail = stock.newBags + (initial?.bagMovements || []).reduce((sum, m) => sum + (m.newBagsIssued || 0) + (m.newBagsReturned || 0), 0);
  const givenTotal = effNew + effOld;
  // pending = bags brought in − bags sent back (+ authorised adjustment). Fully sent back → 0.
  const pendingBags = totalBags - givenTotal + (Number(adjQty) || 0);

  // ---- reset when opened ----
  React.useEffect(() => {
    if (!open) return;
    saving.current = false;
    formReady.current = false;
    const i = initial;
    const b = i?.bagMovements[0];
    setDate(i?.date || today());
    setVehicle(i?.vehicleNumber || '');
    setCustomer(i?.partyId ? partyName(db, i.partyId) : '');
    setLines(i ? i.lines.map(l => ({ id: l.id, varietyId: l.varietyId, size: l.size, bags: l.bags ? String(l.bags) : '', qtyKg: l.qtyKg, rate: String(l.ratePerQtl) })) : [blankLine()]);
    setGstMode(i?.gstMode || 'none');
    setGstRate(String(i?.gstRate ?? db.settings.defaultGstRate ?? 0));
    setWb({
      gross: i?.grossKg ? String(i.grossKg) : '', tare: i?.tareKg ? String(i.tareKg) : '', bagW: i?.bagWeightKg ? String(i.bagWeightKg) : '',
      moist: i?.moistureDeductionKg ? String(i.moistureDeductionKg) : '', other: i?.otherDeductionsKg ? String(i.otherDeductionsKg) : '',
    });
    setWbLine(0);
    const nIss = b?.newBagsIssued || 0, oIss = b?.oldBagsIssued || 0;
    setBagType(b ? (b.givenType || (nIss && oIss ? 'mixed' : nIss ? 'new' : oIss ? 'old' : 'none')) : 'none');
    setNewGiven(String(nIss)); setOldGiven(String(oIss));
    // Editing an old entry: its saved counts are loaded as-is and never auto-moved.
    setNewSync(false); setOldSync(false); setBalance(true);
    setUnitCost(String(b?.bagUnitCost ?? (stock.avgBagCost || db.settings.defaultBagCost || 0)));
    setChargeBags(!!b?.chargeCustomer);
    setAdjQty(String(b?.manualAdjustment || 0));
    setAdjReason(b?.manualAdjustmentReason || '');
    setExisting(i?.payments || []);
    setPayAmt(''); setPayMode(modeOptions[0] || 'Cash'); setPayDate(today());
    setPhoto(i?.billPhoto);
    setNotes(i?.notes || '');
    rt.reset(i ? { final: i.finalTotal, roundAdj: i.roundAdjustment, original: i.roundOriginal, manual: !!i.manualOverrides?.finalTotal } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // ---- Bags: pending = bags brought in − sent back. Everything updates automatically. ----
  React.useEffect(() => {
    if (!open) return;
    if (!formReady.current) { formReady.current = true; return; } // opening commit: loaded values win
    if (bagType === 'new' && newSync) setNewGiven(String(totalBags));
    else if (bagType === 'old' && oldSync) setOldGiven(String(totalBags));
    else if (bagType === 'mixed' && balance) {
      setOldGiven(prev => {
        const next = String(Math.max(0, totalBags - (Number(newGiven) || 0)));
        return prev === next ? prev : next;
      });
    }
  }, [open, bagType, totalBags, newSync, oldSync, balance, newGiven]);

  const clampGiven = (v: string) => (totalBags > 0 && (Number(v) || 0) > totalBags ? String(totalBags) : v);

  const chooseBagType = (v: BagGivenType) => {
    setBagType(v);
    if (v === 'new') { setNewSync(true); setNewGiven(String(totalBags)); setOldGiven('0'); setOldSync(false); }
    else if (v === 'old') { setOldSync(true); setOldGiven(String(totalBags)); setNewGiven('0'); setNewSync(false); }
    else if (v === 'mixed') { setNewGiven('0'); setOldGiven(String(totalBags)); setBalance(true); setNewSync(false); setOldSync(false); }
    else { setNewGiven('0'); setOldGiven('0'); setNewSync(false); setOldSync(false); }
  };

  const onNewGiven = (v: string) => {
    setNewSync(false);
    setNewGiven(clampGiven(v));
    if (bagType === 'mixed' && balance) setOldGiven(String(Math.max(0, totalBags - (Number(v) || 0))));
  };
  const onOldGiven = (v: string) => {
    setOldSync(false);
    setOldGiven(clampGiven(v));
    if (bagType === 'mixed' && balance) setNewGiven(String(Math.max(0, totalBags - (Number(v) || 0))));
  };

  const updLine = (id: string, patch: Partial<LineState>) => {
    setLines(ls => ls.map(l => l.id === id ? { ...l, ...patch } : l));
  };
  const activeOpts = (l: LineState) => {
    const base = activeVarieties.map(v => ({ value: v.id, label: v.name }));
    if (l.varietyId && !base.find(o => o.value === l.varietyId)) base.push({ value: l.varietyId, label: varietyName(db, l.varietyId) });
    return base;
  };

  const wbNet = Math.max(0, (Number(wb.gross) || 0) - (Number(wb.tare) || 0) - (Number(wb.bagW) || 0) - (Number(wb.moist) || 0) - (Number(wb.other) || 0));
  const recalcAll = () => rt.recalc();

  const handleSave = () => {
    if (saving.current) return;
    if (!customer.trim()) { toast('Enter the customer name', 'error'); return; }
    const used = lines.filter(l => l.qtyKg > 0 || (Number(l.bags) || 0) > 0 || Number(l.rate) > 0);
    if (used.length === 0) { toast('Enter quantity for at least one variety', 'error'); return; }
    for (const l of used) {
      if (!l.varietyId) { toast('Choose a variety on every line', 'error'); return; }
      if (!(l.qtyKg > 0)) { toast('Enter the quantity (Qtl + Kg) on every line', 'error'); return; }
      if (!(Number(l.rate) > 0)) { toast('Enter the rate per Qtl on every line', 'error'); return; }
    }
    if (rt.final < 0) { toast('Bag charge is more than the paddy value', 'error'); return; }
    if ((Number(adjQty) || 0) !== 0 && !adjReason.trim()) { toast('Give a reason for the manual bag adjustment', 'error'); return; }
    const payments = withDraftPayment(existing, payAmt, payMode, payDate);
    if (sumPayments(payments) > rt.final + 0.01) { toast('Amount paid is more than the total payable', 'error'); return; }

    saving.current = true;
    const pid = ensureParty(customer, 'supplier');
    const purchaseLines: PurchaseLine[] = used.map(l => ({
      id: l.id, varietyId: l.varietyId, size: l.size, bags: Number(l.bags) || 0,
      qtyKg: l.qtyKg, ratePerQtl: Number(l.rate) || 0, amount: lineAmt(l),
    }));
    const net = round2(purchaseLines.reduce((s, l) => s + l.qtyKg, 0));
    const base = round2(purchaseLines.reduce((s, l) => s + l.amount, 0));
    const bm: BagMovement = {
      id: m0?.id || uid(), date, bagsReceived: totalBags,
      newBagsIssued: effNew, oldBagsIssued: effOld,
      newBagsReturned: 0, oldBagsReturned: 0,
      newBagCharge: bagCharge, newBagLoss: bagLoss, bagUnitCost: unit, chargeCustomer: chargeBags && effNew > 0,
      givenType: bagType, manualAdjustment: Number(adjQty) || 0, manualAdjustmentReason: adjReason.trim() || undefined,
      createdAt: m0?.createdAt || now(),
    };
    onSave({
      date, partyId: pid, vehicleNumber: vehicle || undefined, varietyId: purchaseLines[0].varietyId, lines: purchaseLines,
      grossKg: Number(wb.gross) || 0, tareKg: Number(wb.tare) || 0, bagWeightKg: Number(wb.bagW) || 0,
      otherDeductionsKg: Number(wb.other) || 0, moistureDeductionKg: Number(wb.moist) || 0,
      netKg: net, billableQtl: round2(net / 100), ratePerQtl: net > 0 ? round2(base / (net / 100)) : 0, baseAmount: base,
      gstMode, gstRate: Number(gstRate) || 0, taxableAmount: g.taxable, cgst: g.cgst, sgst: g.sgst, totalTax: g.totalTax,
      roundOriginal: rt.original, roundAdjustment: rt.adj, finalTotal: rt.final,
      manualOverrides: { finalTotal: rt.manual },
      notes: notes || undefined, billPhoto: photo, payments,
      bagMovements: [bm, ...(initial?.bagMovements.slice(1) || [])],
    });
  };

  const sizeLabel = (s: PaddySize) => (s === 'small' ? 'Small' : 'Big');

  return (
    <>
      <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.voucherNumber}` : 'New Purchase Entry'} maxWidth="max-w-xl" footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" title="Reset form" onClick={() => {
            setLines([blankLine()]); setCustomer(''); setVehicle(''); setBagType('none'); setNewSync(false); setOldSync(false); setBalance(true);
            setNewGiven('0'); setOldGiven('0'); setPayAmt(''); setPhoto(undefined); setNotes('');
            setExisting([]); setAdjQty('0'); setAdjReason(''); setGstMode('none'); rt.reset();
          }}>↺</Button>
          <Button className="flex-1" onClick={handleSave}>💾 {initial ? 'Update Purchase' : 'Save Purchase'}</Button>
        </>
      }>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" label="Date *" value={date} onChange={e => setDate(e.target.value)} />
            <Input label="Vehicle No" value={vehicle} onChange={e => setVehicle(e.target.value.toUpperCase())} placeholder="KA 01 AH 1234" />
          </div>
          <PartyInput label="Customer Name" required value={customer} onChange={setCustomer} placeholder="Type name — saved automatically" />

          {/* Variety lines */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-forest-800">Variety / Qty / Rate Lines</div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setLines(ls => [...ls, blankLine()])} className="px-2.5 py-1 rounded-full border border-forest-300 text-forest-800 text-[11px] font-semibold">＋ Add Variety</button>
              <button type="button" onClick={() => setShowNewVar(true)} className="px-2.5 py-1 rounded-full border border-amber-300 text-amber-800 text-[11px] font-semibold">＋ New Variety</button>
            </div>
          </div>

          {lines.map((l, idx) => (
            <div key={l.id} className={`rounded-xl border-2 p-3 space-y-2.5 ${idx === 0 ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-end gap-2">
                <Select wrapperClassName="flex-1" label={`Variety ${lines.length > 1 ? idx + 1 : ''}`} value={l.varietyId}
                  onChange={e => updLine(l.id, { varietyId: e.target.value, size: sizeForVariety(db, e.target.value) })}
                  options={[{ value: '', label: '— Select variety —' }, ...activeOpts(l)]} />
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines(ls => ls.filter(x => x.id !== l.id))}
                    className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 text-red-600 font-bold mb-0.5">✕</button>
                )}
              </div>
              <div className="text-[10px] font-bold tracking-wide text-amber-700">🌾 PADDY SIZE — SELECT ONE</div>
              <SizeToggle value={l.size} onChange={v => updLine(l.id, { size: v })} />
              <div className="grid grid-cols-[64px_1fr_84px] gap-2 items-start">
                <Input label="Bags" type="number" inputMode="numeric" value={l.bags} onChange={e => updLine(l.id, { bags: e.target.value })} placeholder="opt." />
                <QtyInput label="Qty (Qtl + Kg) *" valueKg={l.qtyKg} onChange={kg => updLine(l.id, { qtyKg: kg })} />
                <Input label="Rate/Qtl *" type="number" inputMode="decimal" value={l.rate} onChange={e => updLine(l.id, { rate: e.target.value })} />
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-gray-500">{l.qtyKg > 0 ? `${fmtNumber(l.qtyKg / 100, 3)} Qtl · ${fmtNumber(l.qtyKg, 2)} kg` : ''}</span>
                <span className="font-bold text-forest-700 text-sm">{fmtINR(lineAmt(l))}</span>
              </div>
            </div>
          ))}

          {totalKg > 0 && (
            <div className="bg-forest-700 text-white rounded-xl px-3 py-2.5 text-xs space-y-0.5">
              {lines.filter(l => l.qtyKg > 0).map(l => (
                <div key={l.id} className="flex justify-between"><span>{varietyName(db, l.varietyId)} · {sizeLabel(l.size)}</span><b>{fmtQtlKg(l.qtyKg)}</b></div>
              ))}
              <div className="flex justify-between border-t border-white/20 pt-1 mt-1 text-sm font-bold">
                <span>Total: {fmtQtlKg(totalKg)}</span><span>= {fmtINR(paddyValue)}</span>
              </div>
            </div>
          )}

          {/* Weighbridge (optional) */}
          <Collapsible title="⚖ Weighbridge calculator (optional)" tone="gray" defaultOpen={!!initial && (initial.grossKg || 0) > 0}>
            <div className="grid grid-cols-3 gap-2 pt-1.5">
              <Input label="Gross (kg)" type="number" inputMode="decimal" value={wb.gross} onChange={e => setWb({ ...wb, gross: e.target.value })} />
              <Input label="Tare / vehicle" type="number" inputMode="decimal" value={wb.tare} onChange={e => setWb({ ...wb, tare: e.target.value })} />
              <Input label="Bag weight" type="number" inputMode="decimal" value={wb.bagW} onChange={e => setWb({ ...wb, bagW: e.target.value })} />
              <Input label="Moisture ded." type="number" inputMode="decimal" value={wb.moist} onChange={e => setWb({ ...wb, moist: e.target.value })} />
              <Input label="Other ded." type="number" inputMode="decimal" value={wb.other} onChange={e => setWb({ ...wb, other: e.target.value })} />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">Net (kg)</label>
                <div className="rounded-lg border border-forest-200 bg-forest-50 px-3 py-2 text-sm font-bold text-forest-800">{fmtNumber(wbNet, 2)}</div>
              </div>
            </div>
            {(Number(wb.gross) || 0) - (Number(wb.tare) || 0) - (Number(wb.bagW) || 0) - (Number(wb.moist) || 0) - (Number(wb.other) || 0) < 0 && (
              <div className="text-[11px] text-red-600">Net weight cannot be negative — check the deductions.</div>
            )}
            <div className="flex gap-2 items-center">
              {lines.length > 1 && (
                <Select wrapperClassName="flex-1" value={String(wbLine)} onChange={e => setWbLine(Number(e.target.value))}
                  options={lines.map((l, i) => ({ value: String(i), label: `Line ${i + 1}: ${varietyName(db, l.varietyId) || '—'}` }))} />
              )}
              <Button type="button" size="sm" variant="secondary" disabled={wbNet <= 0}
                onClick={() => { const l = lines[Math.min(wbLine, lines.length - 1)]; if (l) updLine(l.id, { qtyKg: round2(wbNet) }); toast('Net weight applied to the quantity'); }}>
                Use net as quantity
              </Button>
            </div>
          </Collapsible>

          <GSTPanel mode={gstMode} rate={gstRate} onModeChange={setGstMode} onRateChange={setGstRate}
            summary={<TaxSummary base={paddyValue} mode={gstMode} rate={Number(gstRate) || 0} />} defaultOpen={gstMode !== 'none'} />

          {/* Total */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-gray-700">Total Amount Payable</span>
              <div className="flex gap-1.5">
                <Button type="button" size="sm" variant="gold" onClick={rt.round}>↓ Round Total Down</Button>
                {(rt.manual || rt.adj !== 0) && <Button type="button" size="sm" variant="secondary" onClick={recalcAll}>Recalculate</Button>}
              </div>
            </div>
            <div className="text-[11px] text-gray-500 space-y-0.5">
              <div className="flex justify-between"><span>Paddy value</span><span>{fmtINR(paddyValue)}</span></div>
              {g.totalTax > 0 && <div className="flex justify-between"><span>GST ({gstMode})</span><span>{gstMode === 'exclusive' ? '+' : 'incl.'} {fmtINR(g.totalTax)}</span></div>}
              {bagCharge > 0 && <div className="flex justify-between text-red-600"><span>Less: new bag charge</span><span>− {fmtINR(bagCharge)}</span></div>}
            </div>
            <CalcField label="Net payable (₹)" value={rt.final as any} manual={rt.manual} onChange={v => rt.setManual(String(v))} onRecalc={rt.recalc} />
            {rt.adj !== 0 && <div className="text-[11px] text-amber-700 font-medium">Original {fmtINR(rt.original)} → rounded {fmtINR(rt.adj)} = {fmtINR(rt.final)}</div>}
          </div>

          {/* Payment, bags & photo */}
          <Collapsible title="💳 Payment, Bags & Photo" tone="forest" defaultOpen>
            <div className="space-y-4 pt-2">
              <PayBox total={rt.final} existing={existing} onRemoveExisting={i => setExisting(ex => ex.filter((_, k) => k !== i))}
                amount={payAmt} onAmount={setPayAmt} mode={payMode} onMode={setPayMode} date={payDate} onDate={setPayDate} modes={modeOptions} />

              {/* Bags — bags typed once on the lines; everything else is automatic */}
              <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-gray-800">🛍 Bags</div>
                  {effNew > 0 && <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${effNew > newAvail ? 'bg-red-50 text-red-600' : 'bg-forest-100 text-forest-700'}`}>{newAvail} new bags in stock</span>}
                </div>

                <div className="flex justify-between items-center bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-600">Bags (brought with paddy)</span>
                  <b className="text-base">{totalBags}</b>
                </div>

                <div>
                  <div className="text-xs font-bold text-gray-800 mb-1.5">Bags sent back to customer</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([['none', 'None'], ['old', '🧺 Old'], ['new', '🆕 New'], ['mixed', '🔀 Mixed']] as [BagGivenType, string][]).map(([v, label]) => (
                      <button key={v} type="button" onClick={() => chooseBagType(v)}
                        className={`py-2 rounded-lg border-2 text-sm font-bold ${bagType === v ? 'border-forest-700 bg-forest-700 text-white' : 'border-gray-200 bg-white text-gray-600'}`}>{label}</button>
                    ))}
                  </div>
                </div>

                {bagType === 'mixed' && (
                  <label className="flex items-center gap-2 text-xs text-gray-700 bg-forest-50 border border-forest-100 rounded-lg px-2.5 py-2">
                    <input type="checkbox" checked={balance} onChange={e => setBalance(e.target.checked)} />
                    <span>🔗 Auto-total: New + Old = {totalBags} bags (type one, the other fills itself)</span>
                  </label>
                )}

                {(bagType === 'new' || bagType === 'mixed') && (
                  <Input label="🆕 New bags sent back" type="number" inputMode="numeric" value={newGiven} onChange={e => onNewGiven(e.target.value)} />
                )}
                {(bagType === 'old' || bagType === 'mixed') && (
                  <Input label="🧺 Old bags sent back" type="number" inputMode="numeric" value={oldGiven} onChange={e => onOldGiven(e.target.value)} />
                )}
                {(bagType === 'new' || bagType === 'old' || bagType === 'mixed') && (
                  <div className="text-[11px] text-gray-500">
                    {totalBags > 0
                      ? <>Sending back <b>{givenTotal}</b> of <b>{totalBags}</b> bags → pending <b>{Math.max(0, totalBags - givenTotal)}</b></>
                      : <>Type the bags on the variety lines above — sent-back counts update automatically.</>}
                  </div>
                )}

                {effNew > 0 && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className={`rounded-lg border p-1.5 ${effNew > newAvail ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="text-[9px] text-gray-500 uppercase">New stock</div>
                        <div className={`text-sm font-bold ${effNew > newAvail ? 'text-red-600' : ''}`}>{newAvail}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 border border-gray-200 p-1.5">
                        <div className="text-[9px] text-gray-500 uppercase">Cost / bag (₹)</div>
                        <input type="number" inputMode="decimal" value={unitCost} onChange={e => setUnitCost(e.target.value)} className="w-full text-center text-sm font-bold bg-transparent outline-none" />
                      </div>
                      <div className={`rounded-lg border p-1.5 ${chargeBags ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                        <div className="text-[9px] uppercase text-gray-500">{chargeBags ? 'Bag charge' : 'Bag loss (free)'}</div>
                        <div className={`text-sm font-bold ${chargeBags ? 'text-green-700' : 'text-red-600'}`}>{fmtINR(chargeBags ? bagCharge : bagLoss)}</div>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" checked={chargeBags} onChange={e => setChargeBags(e.target.checked)} />
                      Charge customer for new bags (deducted from amount payable)
                    </label>
                    {effNew > newAvail
                      ? <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">⚠ Only {newAvail} new bags in stock — saving will make new-bag stock negative.</div>
                      : <div className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">✓ {effNew} new bags in stock — deducted from bag stock on save.</div>}
                  </div>
                )}

                {totalBags > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                    <div className="text-xs font-bold text-amber-800">📋 Bag Tracking <span className="font-medium text-amber-600">(auto — nothing to enter)</span></div>
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className="bg-white border border-gray-200 rounded-lg px-1 py-1.5">
                        <div className="text-[9px] uppercase text-gray-500">🆕 New given</div>
                        <div className="text-base font-bold">{effNew}</div>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-lg px-1 py-1.5">
                        <div className="text-[9px] uppercase text-gray-500">🧺 Old given</div>
                        <div className="text-base font-bold">{effOld}</div>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-lg px-1 py-1.5">
                        <div className="text-[9px] uppercase text-gray-500">Total sent back</div>
                        <div className="text-base font-bold">{givenTotal}</div>
                      </div>
                    </div>
                    <div className={`rounded-lg border px-3 py-2 ${pendingBags > 0 ? 'bg-yellow-50 border-yellow-300' : 'bg-green-50 border-green-200'}`}>
                      <div className="flex justify-between items-center"><span className="text-xs font-semibold">⏳ Pending Bags</span><b className="text-lg">{pendingBags}</b></div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{totalBags} bags in − {givenTotal} sent back {Number(adjQty) ? `+ ${Number(adjQty)} adjustment` : ''}</div>
                    </div>
                    <Collapsible title="Authorised adjustment (needs a reason)" tone="gray">
                      <div className="grid grid-cols-[90px_1fr] gap-2 pt-1.5">
                        <Input label="Bags ±" type="number" inputMode="numeric" value={adjQty} onChange={e => setAdjQty(e.target.value)} />
                        <Input label="Reason" value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="Why is this adjusted?" />
                      </div>
                    </Collapsible>
                  </div>
                )}
              </div>

              <PhotoAttach value={photo} onChange={setPhoto} />
            </div>
          </Collapsible>

          <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
        </div>
      </Modal>
      <NewVarietyModal open={showNewVar} onClose={() => setShowNewVar(false)} />
    </>
  );
}

// ============================================================
// SUBSEQUENT BAG RETURN / ADJUSTMENT (history kept, nothing double counted)
// ============================================================
function BagReturnModal({ entry, onClose, onSave }: {
  entry: PurchaseEntry; onClose: () => void; onSave: (bm: Omit<BagMovement, 'id' | 'createdAt'>) => void;
}) {
  const [date, setDate] = useState(today());
  const [newRet, setNewRet] = useState('0');
  const [oldRet, setOldRet] = useState('0');
  const [adj, setAdj] = useState('0');
  const [reason, setReason] = useState('');
  const sum = bagSummary(entry.bagMovements);

  const submit = () => {
    const n = Number(newRet) || 0, o = Number(oldRet) || 0, a = Number(adj) || 0;
    if (n === 0 && o === 0 && a === 0) { toast('Enter bags to send back or an adjustment', 'error'); return; }
    if (n < 0 || o < 0) { toast('Bag counts cannot be negative', 'error'); return; }
    if (a !== 0 && !reason.trim()) { toast('Reason is required for a manual adjustment', 'error'); return; }
    onSave({ date, newBagsReturned: n, oldBagsReturned: o, manualAdjustment: a, manualAdjustmentReason: reason.trim() || undefined, notes: a === 0 ? 'Pending bags sent back' : undefined });
  };

  return (
    <Modal open onClose={onClose} title={`Return Pending Bags — ${entry.voucherNumber}`} maxWidth="max-w-sm" footer={
      <><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={submit}>Save</Button></>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="bg-gray-50 rounded-lg p-2"><div className="text-[9px] uppercase text-gray-500">Bags in</div><div className="font-bold">{sum.received}</div></div>
          <div className="bg-gray-50 rounded-lg p-2"><div className="text-[9px] uppercase text-gray-500">Sent back</div><div className="font-bold">{sum.issued + sum.returned}</div></div>
          <div className={`rounded-lg p-2 ${sum.pending > 0 ? 'bg-yellow-50' : 'bg-green-50'}`}><div className="text-[9px] uppercase text-gray-500">Pending</div><div className="font-bold">{sum.pending}</div></div>
        </div>
        <p className="text-[11px] text-gray-500">Send the remaining bags back to the customer. Pending becomes 0 once everything is sent back.</p>
        <Input type="date" label="Date" value={date} onChange={e => setDate(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="🆕 New bags sent back" type="number" inputMode="numeric" value={newRet} onChange={e => setNewRet(e.target.value)} />
          <Input label="🧺 Old bags sent back" type="number" inputMode="numeric" value={oldRet} onChange={e => setOldRet(e.target.value)} />
        </div>
        <div className="grid grid-cols-[90px_1fr] gap-2">
          <Input label="Adjust ±" type="number" inputMode="numeric" value={adj} onChange={e => setAdj(e.target.value)} />
          <Input label="Reason (for adjustment)" value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <p className="text-[10px] text-gray-500">New bags sent back are deducted from new-bag stock; old bags from old-bag stock.</p>
        <div>
          <div className="text-xs font-bold text-gray-700 mb-1">History</div>
          <div className="space-y-1">
            {entry.bagMovements.map((m, i) => (
              <div key={m.id || i} className="text-[11px] bg-gray-50 rounded-lg px-2 py-1.5 flex justify-between gap-2">
                <span>{fmtDate(m.date)} · {i === 0 ? 'At purchase' : (m.manualAdjustmentReason || m.notes || 'Bag record')}</span>
                <span className="text-gray-700 text-right">
                  {i === 0 ? `back ${m.newBagsIssued || 0} new + ${m.oldBagsIssued || 0} old` : ''}
                  {(m.newBagsReturned || 0) + (m.oldBagsReturned || 0) > 0 ? ` back ${(m.newBagsReturned || 0) + (m.oldBagsReturned || 0)}` : ''}
                  {m.manualAdjustment ? ` adj ${m.manualAdjustment}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
