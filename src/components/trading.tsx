import React, { useMemo, useRef, useState } from 'react';
import { useDB } from '../context';
import {
  computeTradingStock, fmtDate, fmtINR, fmtQtlKg, fmtTradeQty, inRange,
  round2, today, tradeQtyToBase, tradingLineTotal, tradingPL,
} from '../db';
import type { TradingEntry, TradingItem } from '../types';
import type { DateFilterValue } from './ui';
import {
  Button, Card, Confirm, DateFilter, EmptyState, Input, Modal,
  SearchBar, Select, toast,
} from './ui';
import { partyName } from './pages';

type Tab = 'buy' | 'sell' | 'pl';

const BUY = { bar: 'from-[#7c4a1e] to-[#a06a2c]', btn: 'bg-[#7c4a1e] hover:bg-[#5f3a16]', ring: 'border-[#e6c98f]', soft: 'bg-[#fdf6e9]' };
const SELL = { bar: 'from-[#0b3d2c] to-[#146845]', btn: 'bg-[#0b5c40] hover:bg-[#08452f]', ring: 'border-[#bfe3cf]', soft: 'bg-[#f0faf4]' };

export function TradingPage() {
  const [tab, setTab] = useState<Tab>('buy');
  const [showImport, setShowImport] = useState(false);
  return (
    <div className="p-3 pb-8 space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setTab('buy')}
          className={`shrink-0 px-4 py-2.5 rounded-full text-sm font-bold border transition-colors ${tab === 'buy' ? 'bg-[#7c4a1e] text-white border-[#7c4a1e]' : 'bg-white text-gray-600 border-gray-200'}`}>
          📥 Buy (Purchase)
        </button>
        <button onClick={() => setTab('sell')}
          className={`shrink-0 px-4 py-2.5 rounded-full text-sm font-bold border transition-colors ${tab === 'sell' ? 'bg-[#0b5c40] text-white border-[#0b5c40]' : 'bg-white text-gray-600 border-gray-200'}`}>
          📤 Sell
        </button>
        <button onClick={() => setTab('pl')}
          className={`shrink-0 px-4 py-2.5 rounded-full text-sm font-bold border transition-colors ${tab === 'pl' ? 'bg-forest-800 text-white border-forest-800' : 'bg-white text-gray-600 border-gray-200'}`}>
          📊 P&amp;L Report
        </button>
      </div>

      <button onClick={() => setShowImport(true)}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-forest-600 text-forest-700 text-sm font-semibold bg-white active:scale-95">
        ⬇ Import from Misc Sales
      </button>

      {tab !== 'pl' ? <TradeTab key={tab} kind={tab} /> : <TradingPL />}
      <ImportMiscModal open={showImport} onClose={() => setShowImport(false)} />
    </div>
  );
}

// ================= BUY / SELL TAB =================
function TradeTab({ kind }: { kind: 'buy' | 'sell' }) {
  const { db, deleteTrading } = useDB();
  const [search, setSearch] = useState('');
  const [dateF, setDateF] = useState<DateFilterValue>({ preset: 'all' });
  const [sort, setSort] = useState('date-desc');
  const [editing, setEditing] = useState<TradingEntry | null>(null);
  const [del, setDel] = useState<TradingEntry | null>(null);

  const entries = useMemo(() => {
    let xs = db.trading.filter(t => t.kind === kind);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      xs = xs.filter(t => t.itemName.toLowerCase().includes(q) || (t.party || '').toLowerCase().includes(q));
    }
    xs = xs.filter(t => inRange(t.date, dateF));
    xs.sort((a, b) => sort === 'date-asc' ? a.date.localeCompare(b.date)
      : sort === 'amt-asc' ? a.total - b.total : sort === 'amt-desc' ? b.total - a.total
      : sort === 'qty-asc' ? a.qty - b.qty : sort === 'qty-desc' ? b.qty - a.qty
      : b.date.localeCompare(a.date));
    return xs;
  }, [db.trading, kind, search, dateF, sort]);

  const total = round2(entries.reduce((s, t) => s + t.total, 0));

  return (
    <div className="space-y-3">
      <TradeForm kind={kind} editing={editing} onDone={() => setEditing(null)} />

      <div className="flex gap-2">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} placeholder={kind === 'buy' ? 'Search item…' : 'Search item or customer…'} /></div>
      </div>
      <DateFilter value={dateF} onChange={setDateF} />
      <div className="flex gap-2">
        <Select wrapperClassName="flex-1" value={sort} onChange={e => setSort(e.target.value)} options={[
          { value: 'date-desc', label: 'Sort: Date ↓' }, { value: 'date-asc', label: 'Sort: Date ↑' },
          { value: 'amt-desc', label: 'Sort: Amount ↓' }, { value: 'amt-asc', label: 'Sort: Amount ↑' },
          { value: 'qty-desc', label: 'Sort: Qty ↓' }, { value: 'qty-asc', label: 'Sort: Qty ↑' },
        ]} />
      </div>

      <Card>
        {entries.length === 0 ? (
          <EmptyState title={kind === 'buy' ? 'No purchase records for this date' : 'No sale records for this date'}
            subtitle="Adjust the search or date filter, or save a new entry above." />
        ) : entries.map(t => (
          <div key={t.id} className="px-3 py-2.5 border-b border-gray-100 last:border-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">{t.itemName}</div>
                <div className="text-[11px] text-gray-500">{fmtDate(t.date)}{t.party ? ` · ${t.party}` : ''}</div>
                <div className="text-[11px] text-gray-600 mt-0.5">{fmtTradeQty(t.qty, t.unit)} @ {fmtINR(t.rate)} / {t.rateUnit}</div>
              </div>
              <div className={`text-sm font-extrabold shrink-0 ${kind === 'buy' ? 'text-[#7c4a1e]' : 'text-[#0b5c40]'}`}>{fmtINR(t.total)}</div>
            </div>
            <div className="flex gap-1.5 mt-1.5">
              <button onClick={() => setEditing(t)} className="text-xs font-semibold text-blue-700">Edit</button>
              <button onClick={() => setDel(t)} className="text-xs font-semibold text-red-600">Delete</button>
            </div>
          </div>
        ))}
      </Card>
      {entries.length > 0 && (
        <div className="text-xs text-gray-600 bg-white border border-gray-100 rounded-xl px-3 py-2 flex justify-between">
          <span>{entries.length} record{entries.length > 1 ? 's' : ''}</span>
          <b>{kind === 'buy' ? 'Total cost: ' : 'Total revenue: '}{fmtINR(total)}</b>
        </div>
      )}
      <Confirm open={!!del} onClose={() => setDel(null)}
        onConfirm={() => { if (del) { deleteTrading(del.id); toast('Trading record deleted — stock reversed'); } setDel(null); }}
        title="Delete record?" message={`Delete this ${kind === 'buy' ? 'purchase' : 'sale'} of ${del?.itemName}? Stock is reversed.`} confirmText="Delete" />
    </div>
  );
}

// ================= ENTRY FORM =================
function TradeForm({ kind, editing, onDone }: { kind: 'buy' | 'sell'; editing: TradingEntry | null; onDone: () => void }) {
  const { db, upsertTradingItem, addTrading, updateTrading } = useDB();
  const saving = useRef(false);
  const th = kind === 'buy' ? BUY : SELL;
  const items = useMemo(() => db.tradingItems.filter(t => t.active), [db.tradingItems]);
  const stockMap = useMemo(() => computeTradingStock(db), [db]);

  const [date, setDate] = useState(today());
  const [itemId, setItemId] = useState('');
  const [customName, setCustomName] = useState('');
  const [qtyUnit, setQtyUnit] = useState('');
  const [qty, setQty] = useState('');
  const [rateUnit, setRateUnit] = useState('');
  const [rate, setRate] = useState('');
  const [party, setParty] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmNeg, setConfirmNeg] = useState(false);

  const isOther = itemId === '__other';
  const item: TradingItem | undefined = !isOther ? db.tradingItems.find(t => t.id === itemId) : undefined;
  // pseudo-item while "Other" has no master yet — qty unit doubles as its base unit
  const eff: Pick<TradingItem, 'baseUnit' | 'packUnit' | 'packSize'> = item || { baseUnit: qtyUnit || 'Piece' };
  const qtyUnits = item ? [...new Set([item.baseUnit, ...(item.packUnit ? [item.packUnit] : [])])] : [qtyUnit || 'Piece'];
  const rateUnits = item && item.rateUnits.length ? item.rateUnits : [qtyUnit || 'Piece'];

  const qtyN = Number(qty) || 0;
  const rateN = Number(rate) || 0;
  const qtyBase = item ? tradeQtyToBase(qtyN, qtyUnit || item.baseUnit, item) : qtyN;
  const total = item ? tradingLineTotal(qtyN, qtyUnit || item.baseUnit, rateN, rateUnit || item.baseUnit, item) : round2(qtyN * rateN);
  const stockNow = item ? (stockMap[item.id] ?? 0) : 0;

  // prefill when edit target changes / form opened for edit
  React.useEffect(() => {
    saving.current = false;
    if (!editing) return;
    const it = db.tradingItems.find(t => t.id === editing.itemId);
    setDate(editing.date);
    if (it) {
      setItemId(it.id); setCustomName('');
      setQtyUnit(editing.qty > 0 && it.packUnit && editing.qty % (it.packSize || 1) !== 0 ? it.baseUnit : it.baseUnit);
    } else { setItemId('__other'); setCustomName(editing.itemName); setQtyUnit(editing.unit); }
    setQty(editing.qty ? String(editing.qty) : '');
    setRateUnit(editing.rateUnit);
    setRate(editing.rate ? String(editing.rate) : '');
    setParty(editing.party || ''); setNotes(editing.notes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  // keep unit selections valid when item changes
  React.useEffect(() => {
    if (!item) return;
    if (!qtyUnits.includes(qtyUnit)) setQtyUnit(item.baseUnit);
    if (!rateUnits.includes(rateUnit)) setRateUnit(item.baseUnit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const reset = (keepItem = false) => {
    setDate(today());
    if (!keepItem) { setItemId(''); setCustomName(''); }
    setQty(''); setRate(''); setParty(''); setNotes('');
    if (item) { setQtyUnit(item.baseUnit); setRateUnit(item.baseUnit); }
  };

  const doSave = (force = false) => {
    if (saving.current) return;
    if (!date) { toast('Enter the date', 'error'); return; }
    let id = itemId;
    let it = item;
    if (isOther || !it) {
      const nm = customName.trim();
      if (!nm) { toast('Enter the item name', 'error'); return; }
      id = upsertTradingItem({ name: nm, baseUnit: qtyUnit || 'Piece', rateUnits: [qtyUnit || 'Piece'] });
      it = db.tradingItems.find(t => t.id === id) || { id, name: nm, baseUnit: qtyUnit || 'Piece', rateUnits: [qtyUnit || 'Piece'], active: true } as TradingItem;
    }
    if (!it) { toast('Select an item', 'error'); return; }
    if (!(qtyN > 0)) { toast('Enter quantity', 'error'); return; }
    if (!(rateN > 0)) { toast(`Enter ${kind === 'buy' ? 'cost' : 'sell'} price per unit`, 'error'); return; }
    if (kind === 'sell' && qtyBase > ((stockMap[id] ?? 0) + (editing && editing.itemId === id ? editing.qty : 0)) + 0.0001 && !force) {
      setConfirmNeg(true); return;
    }
    saving.current = true;
    const payload = {
      kind, date, itemId: id, itemName: it.name,
      qty: qtyBase, unit: it.baseUnit, rate: rateN, rateUnit: rateUnit || it.baseUnit,
      packSize: it.packSize, total,
      party: party.trim() || undefined, notes: notes.trim() || undefined,
    };
    if (editing) { updateTrading(editing.id, payload); toast(`${kind === 'buy' ? 'Purchase' : 'Sale'} updated`); }
    else { addTrading(payload); toast(`${kind === 'buy' ? 'Purchase' : 'Sale'} saved`); }
    onDone(); reset();
  };

  return (
    <div className={`rounded-2xl border-2 ${th.ring} overflow-hidden bg-white shadow-sm`}>
      <div className={`bg-gradient-to-r ${th.bar} text-white px-4 py-3.5 flex items-center gap-3`}>
        <span className="text-3xl">{kind === 'buy' ? '📥' : '📤'}</span>
        <div className="flex-1">
          <div className="text-lg font-extrabold leading-tight">{kind === 'buy' ? 'BUY — Purchase Entry' : 'SELL — Sale Entry'}</div>
          <div className="text-[11px] opacity-85">{kind === 'buy' ? 'Record incoming goods & cost price' : 'Record outgoing goods & selling price'}</div>
        </div>
        {editing && <span className="text-[11px] font-bold bg-white/20 rounded-full px-2.5 py-1">Editing</span>}
      </div>

      <div className={`${th.soft} px-3 py-3`}>
        <div className="text-[11px] font-extrabold tracking-wide text-gray-600 mb-2">📦 {kind === 'buy' ? 'CURRENT STOCK AVAILABLE' : 'STOCK AVAILABLE TO SELL'}</div>
        {items.length === 0 ? (
          <div className="text-xs text-gray-500 bg-white rounded-xl p-3 text-center">No trading items yet — add them in More → Inventory → Trading Goods.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map(t => {
              const q = stockMap[t.id] ?? 0;
              const low = (t.lowStock || 0) > 0 && q <= (t.lowStock || 0);
              return (
                <button key={t.id} type="button" onClick={() => setItemId(t.id)}
                  className={`rounded-xl border bg-white px-1.5 py-2.5 text-center transition-colors ${itemId === t.id ? 'border-forest-600 ring-2 ring-forest-100' : 'border-gray-200'}`}>
                  <div className="text-[10px] font-bold text-gray-700 leading-tight truncate">{t.name}</div>
                  <div className={`text-lg font-extrabold leading-tight ${low ? 'text-red-600' : kind === 'buy' ? 'text-[#8a5a1e]' : 'text-[#0b6b47]'}`}>{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(q)}</div>
                  <div className="text-[10px] text-gray-400">{t.baseUnit}</div>
                  {low && <div className="text-[10px] font-bold text-red-600">⚠ Low</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Date *" value={date} onChange={e => setDate(e.target.value)} />
          <Select label="Item *" value={itemId} onChange={e => setItemId(e.target.value)}
            options={[{ value: '', label: '— Select Item —' }, ...items.map(t => ({ value: t.id, label: t.name })), { value: '__other', label: 'Other (specify below)' }]} />
        </div>
        {isOther && <Input label="Custom item name *" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Item name for one-time entry" />}

        <div className="grid grid-cols-2 gap-2">
          <Input label="Quantity *" type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
          <Select label="Unit" value={qtyUnit || eff.baseUnit} onChange={e => setQtyUnit(e.target.value)} options={qtyUnits} />
        </div>
        {item?.packUnit && qtyUnit === item.packUnit && (
          <div className="text-[11px] text-gray-500 -mt-1">= {fmtTradeQty(qtyBase, item.baseUnit)} ({item.packSize} {item.baseUnit} per {item.packUnit})</div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Input label={`${kind === 'buy' ? 'Cost' : 'Sell'} Price / Unit (₹) *`} type="number" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} placeholder="0.00" />
            {rateUnits.length > 1 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {rateUnits.map(u => (
                  <button key={u} type="button" onClick={() => setRateUnit(u)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${rateUnit === u ? 'bg-forest-800 text-white border-forest-800' : 'bg-gray-100 text-gray-600 border-gray-100'}`}>
                    /{u}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">{kind === 'buy' ? 'Total Cost' : 'Total Revenue'}</label>
            <div className="rounded-lg border border-gray-200 bg-emerald-50/50 px-3 py-2 text-lg font-extrabold text-forest-900">{fmtINR(total)}</div>
          </div>
        </div>
        {item?.packUnit && rateUnit === item.packUnit && (
          <div className="text-[11px] text-gray-500 -mt-1">Rate {fmtINR(rateN)} per {item.packUnit} ({item.packSize} {item.baseUnit})</div>
        )}

        {kind === 'buy' ? (
          <Input label="Supplier / Notes" value={party} onChange={e => setParty(e.target.value)} placeholder="Supplier name or notes" />
        ) : (
          <>
            <Input label="Given To (Customer Name)" value={party} onChange={e => setParty(e.target.value)} placeholder="Farmer / customer name" />
            <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
          </>
        )}

        <div className="flex gap-2">
          <Button className={`flex-1 ${th.btn}`} onClick={() => doSave(false)}>💾 {editing ? 'Update' : kind === 'buy' ? 'Save Purchase' : 'Save Sale'}</Button>
          <Button variant="secondary" onClick={() => { editing ? onDone() : reset(); }}>Clear</Button>
        </div>
      </div>

      <Confirm open={confirmNeg} onClose={() => setConfirmNeg(false)} onConfirm={() => { setConfirmNeg(false); doSave(true); }}
        title="Stock will go negative"
        message={`Only ${fmtTradeQty(stockNow, eff.baseUnit)} available, but you are selling ${fmtTradeQty(qtyBase, eff.baseUnit)}. Save anyway?`}
        confirmText="Save anyway" />
    </div>
  );
}

// ================= P&L REPORT =================
function TradingPL() {
  const { db } = useDB();
  const monthStart = today().slice(0, 7) + '-01';
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today());
  const [applied, setApplied] = useState({ from: monthStart, to: today() });
  const pl = useMemo(() => tradingPL(db, applied.from, applied.to), [db, applied]);

  const exportCSV = () => {
    const rows = [
      ['Item', 'Unit', 'Bought Qty', 'Purchase Cost', 'Sold Qty', 'Revenue', 'Avg Cost', 'COGS', 'Profit', 'Closing Stock', 'Closing Value'],
      ...pl.rows.map(r => [r.name, r.unit, String(r.boughtQty), String(r.boughtCost), String(r.soldQty), String(r.revenue), String(r.avgCost), String(r.cogs), String(r.profit), String(r.closingQty), String(r.closingValue)]),
      [], ['TOTAL', '', '', String(pl.boughtCost), '', String(pl.revenue), '', String(pl.cogs), String(pl.profit), '', ''],
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `trading-pl-${applied.from}-to-${applied.to}.csv`; a.click();
    URL.revokeObjectURL(url); toast('P&L exported as CSV');
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <span className="text-sm text-gray-500 pb-2">to</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <Button className="w-full" onClick={() => { if (from > to) { toast('From date is after To date', 'error'); return; } setApplied({ from, to }); }}>📊 Show</Button>
      </Card>

      {pl.rows.length === 0 ? (
        <div className="text-center text-gray-500 py-10">No trading data in this period</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white border border-gray-100 rounded-xl p-2.5 text-center shadow-sm">
              <div className="text-[10px] font-bold text-gray-500 uppercase">Cost</div>
              <div className="text-sm font-extrabold text-[#7c4a1e]">{fmtINR(pl.boughtCost)}</div>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-2.5 text-center shadow-sm">
              <div className="text-[10px] font-bold text-gray-500 uppercase">Revenue</div>
              <div className="text-sm font-extrabold text-[#0b6b47]">{fmtINR(pl.revenue)}</div>
            </div>
            <div className={`border rounded-xl p-2.5 text-center shadow-sm ${pl.profit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Profit / Loss</div>
              <div className={`text-sm font-extrabold ${pl.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{pl.profit >= 0 ? '+' : ''}{fmtINR(pl.profit)}</div>
            </div>
          </div>

          <Card>
            {pl.rows.map(r => (
              <div key={r.itemId} className="px-3 py-2.5 border-b border-gray-100 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{r.name}</div>
                    <div className="text-[11px] text-gray-500">
                      Bought {fmtTradeQty(r.boughtQty, r.unit)} (₹{fmtINR(r.boughtCost, { symbol: false })}) ·
                      Sold {fmtTradeQty(r.soldQty, r.unit)} (₹{fmtINR(r.revenue, { symbol: false })})
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Avg cost {fmtINR(r.avgCost)}/{r.unit} · COGS {fmtINR(r.cogs)} · Stock {fmtTradeQty(r.closingQty, r.unit)} ({fmtINR(r.closingValue)})
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-extrabold ${r.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{r.profit >= 0 ? '+' : ''}{fmtINR(r.profit)}</div>
                    <div className="text-[10px] text-gray-400">{r.margin}% margin</div>
                  </div>
                </div>
              </div>
            ))}
          </Card>
          <div className="text-[10px] text-gray-400 px-1">Accrual basis: revenue minus cost of goods sold at weighted-average purchase cost. Buy/sell payments are not tracked as cash here.</div>
          <Button variant="secondary" className="w-full" onClick={exportCSV}>Export P&amp;L as CSV</Button>
        </>
      )}
    </div>
  );
}

// ================= IMPORT FROM MISC (OTHER) SALES =================
function ImportMiscModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, addTrading } = useDB();
  const [target, setTarget] = useState('');
  const items = useMemo(() => db.tradingItems.filter(t => t.active), [db.tradingItems]);

  const candidates = useMemo(() => db.sales.filter(s =>
    s.productId === 'pr_other' && !db.trading.some(t => t.sourceSaleId === s.id)
  ), [db.sales, db.trading]);

  React.useEffect(() => {
    if (open && !target && items.length) setTarget(items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doImport = (saleId: string) => {
    const s = db.sales.find(x => x.id === saleId);
    const it = db.tradingItems.find(x => x.id === target);
    if (!s || !it) return;
    // sale quantities are Kg; only Kg/Qtl-based items convert exactly
    let qtyBase = 0;
    if (it.baseUnit === 'Kg') qtyBase = s.quantityKg;
    else if (it.baseUnit === 'Qtl') qtyBase = round2(s.quantityKg / 100);
    else { toast('That item is not weighed in Kg — add it manually instead', 'error'); return; }
    if (!(qtyBase > 0)) { toast('Sale has no quantity to import', 'error'); return; }
    const rate = round2(s.finalTotal / qtyBase);
    addTrading({
      kind: 'sell', date: s.date, itemId: it.id, itemName: it.name,
      qty: qtyBase, unit: it.baseUnit, rate, rateUnit: it.baseUnit,
      packSize: it.packSize, total: s.finalTotal,
      party: partyName(db, s.partyId) || undefined,
      notes: `Imported from Misc Sale ${s.invoiceNumber}`, sourceSaleId: s.id,
    });
    toast(`Imported ${s.invoiceNumber} → ${it.name}`);
  };

  return (
    <Modal open={open} onClose={onClose} title="Import from Misc Sales" maxWidth="max-w-md" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <p className="text-xs text-gray-600 mb-3">
        Sales saved under the “Other” product in the Sales module can be brought in as Trading sells.
        Quantities convert exactly for Kg / Qtl items; other units need a manual entry.
      </p>
      <Select label="Import into trading item" value={target} onChange={e => setTarget(e.target.value)}
        options={items.map(t => ({ value: t.id, label: `${t.name} (${t.baseUnit})` }))} />
      <div className="space-y-2 mt-3">
        {candidates.length === 0 && <div className="text-center text-sm text-gray-400 py-6">No unimported Misc (Other) sales found.</div>}
        {candidates.map(s => (
          <div key={s.id} className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate">{s.invoiceNumber} · {partyName(db, s.partyId)}</div>
              <div className="text-[11px] text-gray-500">{fmtDate(s.date)} · {fmtQtlKg(s.quantityKg)} · {fmtINR(s.finalTotal)}</div>
            </div>
            <Button size="sm" onClick={() => doImport(s.id)}>Import</Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
