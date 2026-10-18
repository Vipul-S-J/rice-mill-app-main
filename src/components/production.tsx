import React, { useMemo, useState } from 'react';
import { useDB } from '../context';
import {
  allocateFifoLots, computePaddyLots, fmtDate, fmtINR, round2, today,
} from '../db';
import type { PaddyLot } from '../db';
import type { ProductionBatch, ProductionInput, ProductionInputLot } from '../types';
import { Button, Card, Confirm, Input, toast } from './ui';

type ProdType = 'small' | 'big';
type ProdMode = 'fifo' | 'manual';

const fmt2 = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(round2(n));
const q = (n: number) => `${fmt2(n)} Qtl`;

// ============================== PAGE ==============================
export function ProductionPage() {
  const { db, stock, deleteProduction } = useDB();
  const [editing, setEditing] = useState<ProductionBatch | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [del, setDel] = useState<ProductionBatch | null>(null);
  const [sumFrom, setSumFrom] = useState('');
  const [sumTo, setSumTo] = useState('');
  const [histFrom, setHistFrom] = useState('');
  const [histTo, setHistTo] = useState('');

  const inRangeOf = (d: string, f: string, t: string) => (!f || d >= f) && (!t || d <= t);
  const sinceDate = db.production.length ? [...db.production].sort((a, b) => a.date.localeCompare(b.date))[0].date : '';
  const totalPaddy = Object.values(stock.paddyByVariety).reduce((a, b) => a + b, 0);
  const totalRice = Object.values(stock.riceByVariety).reduce((a, b) => a + b, 0);

  // ---------- summary ----------
  const summary = useMemo(() => {
    const list = db.production.filter(b => inRangeOf(b.date, sumFrom, sumTo));
    const used = list.reduce((s, b) => s + (b.inputs?.length ? b.inputs.reduce((x, i) => x + i.qtyKg, 0) : b.paddyInputKg), 0);
    const rice = list.reduce((s, b) => s + b.outputs.riceKg, 0);
    const bran = list.reduce((s, b) => s + b.outputs.branKg, 0);
    const byVar: Record<string, number> = {};
    for (const b of list) {
      const inputs = b.inputs?.length ? b.inputs : [{ varietyId: b.paddyVarietyId, qtyKg: b.paddyInputKg }];
      for (const i of inputs) byVar[i.varietyId] = round2((byVar[i.varietyId] || 0) + i.qtyKg);
    }
    return { used: round2(used), rice: round2(rice), bran: round2(bran), byVar };
  }, [db.production, sumFrom, sumTo]);

  // ---------- history ----------
  const history = useMemo(() =>
    db.production
      .filter(b => inRangeOf(b.date, histFrom, histTo))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''))
  , [db.production, histFrom, histTo]);

  // ---------- tracking status ----------
  const tracking = useMemo(() => {
    const riceProd = db.production.reduce((s, b) => s + b.outputs.riceKg, 0);
    const branProd = db.production.reduce((s, b) => s + b.outputs.branKg, 0);
    const soldOf = (pid: string) => round2(
      db.sales.filter(x => x.productId === pid).reduce((s, x) =>
        s + (x.lines?.length ? x.lines.reduce((y, l) => y + (l.quantityKg || 0), 0) : x.quantityKg), 0) +
      db.dispatches.filter(x => x.productId === pid).reduce((s, x) => s + x.netKg, 0));
    const adjIn = db.stockAdjustments.filter(a => a.itemType === 'bran' && (a.quantityKg || 0) > 0)
      .reduce((s, a) => s + (a.quantityKg || 0), 0);
    return {
      riceProd: round2(riceProd), riceSold: soldOf('pr_rice'),
      branProd: round2(branProd), branSold: soldOf('pr_bran'), branOtherIn: round2(adjIn),
    };
  }, [db]);

  const clearSummary = () => { setSumFrom(''); setSumTo(''); };
  const clearHistory = () => { setHistFrom(''); setHistTo(''); };
  const branNet = round2(stock.branKg);
  const riceNet = round2(totalRice);

  return (
    <div className="p-3 pb-8 space-y-4">

      {/* tracking banner */}
      <div className="rounded-2xl bg-[#e8f6ef] border border-[#bfe6d1] px-4 py-3 flex gap-3 items-start">
        <span className="text-lg">ⓘ</span>
        <div className="text-[13px] text-[#0b5c40]">
          {sinceDate
            ? <><b>Tracking active since {fmtDate(sinceDate)}.</b><br />Paddy → Rice &amp; Bran conversions tracked from this date.</>
            : <><b>No production yet.</b><br />Tap “New Entry” to record your first paddy → rice conversion.</>}
        </div>
      </div>

      {/* current stock */}
      <Card className="p-3">
        <button className="w-full text-left" onClick={() => setShowStock(s => !s)}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-extrabold text-forest-900">🗃 Current Stock</div>
            <span className="text-gray-400">{showStock ? '⌃' : '⌄'}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-lg bg-amber-50 border border-amber-100 py-2">
              <b className="block text-amber-800 text-sm">{q(totalPaddy / 100)}</b>Paddy
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 py-2">
              <b className="block text-emerald-800 text-sm">{q(totalRice / 100)}</b>Rice
            </div>
            <div className="rounded-lg bg-orange-50 border border-orange-100 py-2">
              <b className="block text-orange-800 text-sm">{q(branNet / 100)}</b>Bran
            </div>
          </div>
        </button>
        {showStock && (
          <div className="mt-3 space-y-1 border-t border-gray-100 pt-3 max-h-56 overflow-y-auto">
            {db.varieties.filter(v => v.active && (stock.paddyByVariety[v.id] || 0) > 0.004).map(v => (
              <div key={v.id} className="flex justify-between text-xs">
                <span><span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${v.category === 'big' ? 'bg-green-600' : 'bg-amber-500'}`} />{v.name}
                  <span className="text-gray-400"> · {v.category === 'big' ? 'Big' : 'Small'} paddy</span></span>
                <b>{q((stock.paddyByVariety[v.id] || 0) / 100)}</b>
              </div>
            ))}
            {!db.varieties.some(v => (stock.paddyByVariety[v.id] || 0) > 0.004) && <div className="text-xs text-gray-400 text-center py-2">No paddy stock — record a Purchase first.</div>}
          </div>
        )}
      </Card>

      {/* top action buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => toast(`Stock verified from ${db.purchases.length} purchases · ${db.production.length} production runs`)}
          className="bg-white border border-forest-200 rounded-xl py-2.5 text-[11px] font-bold text-forest-800 active:scale-95">⟲ Recalculate All Stock</button>
        <button onClick={() => setShowReport(true)}
          className="bg-white border border-forest-200 rounded-xl py-2.5 text-[11px] font-bold text-forest-800 active:scale-95">▣ Stock Report</button>
        <button onClick={() => { setEditing(null); setShowForm(s => !s); }}
          className="bg-[#0b5c40] text-white rounded-xl py-2.5 text-[11px] font-bold active:scale-95 shadow">
          {showForm && !editing ? '✕ Close Entry' : '＋ New Entry'}
        </button>
      </div>

      {(showForm || editing) && (
        <ProductionForm
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {/* production summary */}
      <Card className="p-3 space-y-3">
        <div className="text-sm font-extrabold text-forest-900">🧾 Production Summary</div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">From</div>
            <Input type="date" value={sumFrom} onChange={e => setSumFrom(e.target.value)} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-500 uppercase">To</div>
            <Input type="date" value={sumTo} onChange={e => setSumTo(e.target.value)} />
          </div>
          <button onClick={clearSummary} className="h-[38px] px-3 rounded-lg border border-gray-200 text-xs font-bold text-gray-600">All Time</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <SumTile label="Paddy Used" value={q(summary.used / 100)} />
          <SumTile label="Rice Out" value={q(summary.rice / 100)} />
          <SumTile label="Bran Out" value={q(summary.bran / 100)} />
        </div>
        {(() => {
          const rows = Object.entries(summary.byVar)
            .map(([id, kg]) => ({ id, name: db.varieties.find(v => v.id === id)?.name || id, kg }))
            .filter(r => r.kg > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
          if (!rows.length) return null;
          const max = Math.max(...rows.map(r => r.kg));
          return (
            <div>
              <div className="text-[10px] font-bold tracking-wide text-gray-500 mb-2">PADDY BY VARIETY</div>
              <div className="space-y-1.5">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="w-20 text-[11px] font-extrabold text-gray-800 uppercase truncate">{r.name}</div>
                    <div className="flex-1 h-4 bg-gray-100 rounded-md overflow-hidden">
                      <div className="h-full rounded-md bg-gradient-to-r from-[#c98f3f] to-[#e3b871]" style={{ width: `${Math.max(4, (r.kg / max) * 100)}%` }} />
                    </div>
                    <div className="w-16 text-right text-[11px] font-bold text-[#8a5a1e]">{q(r.kg / 100)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </Card>

      {/* production history */}
      <div className="space-y-3">
        <div className="text-sm font-extrabold text-forest-900">🗒 Production History</div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <Input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)} />
          <Input type="date" value={histTo} onChange={e => setHistTo(e.target.value)} />
          <button onClick={clearHistory} className="h-[38px] px-3 rounded-lg border border-gray-200 text-xs font-bold text-gray-600">All</button>
        </div>
        <span className="text-[11px] font-bold text-gray-500 bg-gray-100 rounded-full px-3 py-1 inline-block">{history.length} {history.length === 1 ? 'entry' : 'entries'}</span>

        {history.length === 0 && (
          <Card className="p-8 text-center text-sm text-gray-400">No production runs in this period.</Card>
        )}

        {history.map(b => {
          const inputs = b.inputs?.length ? b.inputs : [{ varietyId: b.paddyVarietyId, qtyKg: b.paddyInputKg }];
          const used = inputs.reduce((s, i) => s + i.qtyKg, 0);
          const yieldPct = used > 0 ? Math.round((b.outputs.riceKg / used) * 100) : 0;
          return (
            <Card key={b.id} className="p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <b className="text-sm">{fmtDate(b.date)}</b>
                <span className="text-[11px] font-bold text-gray-500">{b.batchNumber}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {b.paddyType === 'big' ? 'Big Paddy' : 'Small Paddy'}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                  {b.mode === 'manual' ? 'Manual mode' : 'FIFO mode'}
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-100">Paddy −{q(used / 100)}</span>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-100">Rice +{q(b.outputs.riceKg / 100)}</span>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">Bran +{q(b.outputs.branKg / 100)}</span>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-100">Yield {yieldPct}%</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {inputs.map((i, x) => (
                  <span key={x} className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                    {(db.varieties.find(v => v.id === i.varietyId)?.name || 'Paddy').toUpperCase()}: {q(i.qtyKg / 100)}
                  </span>
                ))}
              </div>
              {b.notes && <div className="text-[11px] italic text-gray-500">{b.notes}</div>}
              <div className="flex gap-2">
                <button onClick={() => { setEditing(b); setShowForm(true); }}
                  className="flex-1 py-2 rounded-xl border border-forest-300 text-forest-800 text-xs font-bold">✎ Edit</button>
                <button onClick={() => setDel(b)}
                  className="flex-1 py-2 rounded-xl border border-red-200 text-red-600 text-xs font-bold">🗑 Delete</button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* rice & bran tracking status */}
      <Card className="p-3 space-y-3 bg-[#f2fbf6] border-[#cfe9da]">
        <div className="flex items-center justify-between">
          <b className="text-sm text-forest-900">▦ Rice &amp; Bran Stock Tracking Status</b>
          {sinceDate && <span className="text-[10px] font-bold text-forest-600 bg-white/70 rounded-full px-2 py-0.5">Since {fmtDate(sinceDate)}</span>}
        </div>

        <div className="rounded-xl bg-white/80 border border-[#cfe9da] p-3 space-y-2">
          <div className="text-[11px] font-extrabold text-forest-800 flex items-center gap-1.5">↻ Rice Stock Status</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <StatBox label="Produced" value={q(tracking.riceProd / 100)} tone="emerald" />
            <StatBox label="Sold" value={q(tracking.riceSold / 100)} tone="amber" />
            <StatBox label="Net in Stock" value={q(riceNet / 100)} tone="emerald" bold />
          </div>
          <div className="text-[11px] text-forest-700 bg-[#e8f6ef] rounded-lg px-2.5 py-2">✔&nbsp; {q(riceNet / 100)} available in stock after all sales.</div>
        </div>

        <div className="rounded-xl bg-white/80 border border-[#e6d6b8] p-3 space-y-2">
          <div className="text-[11px] font-extrabold text-[#8a5a1e] flex items-center gap-1.5">≈ Bran Stock Status</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <StatBox label="Produced" value={q(tracking.branProd / 100)} tone="amber" />
            <StatBox label="Other In" value={q(tracking.branOtherIn / 100)} tone="amber" />
            <StatBox label="Sold" value={q(tracking.branSold / 100)} tone="amber" />
          </div>
          <div className="rounded-lg bg-[#e8f6ef] py-2.5 text-center">
            <b className="text-xl text-forest-800">{q(branNet / 100)}</b>
            <div className="text-[11px] text-forest-700">Net in Stock</div>
          </div>
          <div className="text-[11px] text-forest-700 bg-[#e8f6ef] rounded-lg px-2.5 py-2">✔&nbsp; {q(branNet / 100)} available in stock after all sales.</div>
        </div>

        {/* paddy consumed by variety */}
        {(() => {
          const byVar: Record<string, number> = {};
          for (const b of db.production) {
            const inputs = b.inputs?.length ? b.inputs : [{ varietyId: b.paddyVarietyId, qtyKg: b.paddyInputKg }];
            for (const i of inputs) byVar[i.varietyId] = round2((byVar[i.varietyId] || 0) + i.qtyKg);
          }
          const rows = Object.entries(byVar)
            .map(([id, kg]) => ({ id, name: db.varieties.find(v => v.id === id)?.name || id, kg }))
            .filter(r => r.kg > 0).sort((a, b) => a.name.localeCompare(b.name));
          if (!rows.length) return null;
          const max = Math.max(...rows.map(r => r.kg));
          return (
            <div className="rounded-xl bg-white/80 border border-[#e6d6b8] p-3">
              <div className="text-[11px] font-extrabold text-[#8a5a1e] mb-2">🌾 Paddy Consumed by Variety (since tracking started)</div>
              <div className="space-y-1.5">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="w-20 text-[10px] font-extrabold text-gray-800 uppercase truncate">{r.name}</div>
                    <div className="flex-1 h-3.5 bg-gray-100 rounded overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#c98f3f] to-[#e3b871]" style={{ width: `${Math.max(4, (r.kg / max) * 100)}%` }} />
                    </div>
                    <div className="w-14 text-right text-[10px] font-bold text-[#8a5a1e]">{q(r.kg / 100)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </Card>

      <Confirm open={!!del} onClose={() => setDel(null)}
        onConfirm={() => { if (del) { deleteProduction(del.id); toast(`Deleted ${del.batchNumber} — stock reversed`); setDel(null); } }}
        title="Delete production run?"
        message={`Delete ${del?.batchNumber}? Paddy is restored to stock and the rice/bran output is removed.`}
        confirmText="Delete" />

      <StockReportModal open={showReport} onClose={() => setShowReport(false)} />
    </div>
  );
}

// ============================== FORM ==============================
const FOOT = 'Add your lot selection below — FIFO takes oldest lots automatically; Manual lets you choose each lot.';

function seg(active: boolean, extra = '') {
  return `px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${active ? 'bg-[#0b3d2c] text-white border-[#0b3d2c]' : 'bg-white text-gray-600 border-gray-200'} ${extra}`;
}

function ProductionForm({ editing, onClose, onSaved }: { editing: ProductionBatch | null; onClose: () => void; onSaved: () => void }) {
  const { db, addProduction, updateProduction } = useDB();
  const [date, setDate] = useState(today());
  const [type, setType] = useState<ProdType>('small');
  const [mode, setMode] = useState<ProdMode>('fifo');
  const [qty, setQty] = useState<Record<string, string>>({});       // fifo: varietyId -> Qtl
  const [lotQty, setLotQty] = useState<Record<string, string>>({}); // manual: lotKey -> Qtl
  const [riceVarietyId, setRiceVarietyId] = useState('');
  const [riceQtl, setRiceQtl] = useState('');
  const [branQtl, setBranQtl] = useState('');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState('');

  const lotsRes = useMemo(() => computePaddyLots(db, { excludeBatchId: editing?.id }), [db, editing?.id]);
  const varieties = useMemo(() => {
    const out: { id: string; name: string; avail: number; avg: number; lots: PaddyLot[] }[] = [];
    for (const v of db.varieties.filter(x => x.active && x.category === type)) {
      const lots = (lotsRes.byVariety[v.id] || []).filter(l => l.qtyLeftKg > 0.004);
      const avail = round2(lots.reduce((s, l) => s + l.qtyLeftKg, 0));
      const cost = round2(lots.reduce((s, l) => s + l.qtyLeftKg * (l.ratePerQtl || 0), 0));
      out.push({ id: v.id, name: v.name, avail, avg: avail > 0 ? round2(cost / avail) : 0, lots });
    }
    return out;
  }, [db.varieties, lotsRes, type]);

  // ------- prefill when editing -------
  React.useEffect(() => {
    if (!editing) {
      setDate(today()); setType('small'); setMode('fifo'); setQty({}); setLotQty({});
      setRiceVarietyId(''); setRiceQtl(''); setBranQtl(''); setNotes(''); setShowNotes(false); setError('');
      return;
    }
    const inputs = editing.inputs?.length ? editing.inputs : [{ varietyId: editing.paddyVarietyId, qtyKg: editing.paddyInputKg, lots: undefined as ProductionInputLot[] | undefined }];
    setDate(editing.date);
    setType((editing.paddyType as ProdType) || 'small');
    setMode((editing.mode as ProdMode) || 'fifo');
    setQty(Object.fromEntries(inputs.map(i => [i.varietyId, String(i.qtyKg / 100)])));
    const lm: Record<string, string> = {};
    for (const i of inputs) for (const l of i.lots || []) lm[l.key] = String(l.qtyKg / 100);
    setLotQty(lm);
    setRiceVarietyId(editing.outputs.riceVarietyId || '');
    setRiceQtl(String(editing.outputs.riceKg / 100));
    setBranQtl(editing.outputs.branKg ? String(editing.outputs.branKg / 100) : '');
    setNotes(editing.notes || ''); setShowNotes(!!editing.notes); setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const previewId = editing?.batchNumber || `PROD-${String(db.settings.nextNumbers.batch || 1).padStart(4, '0')}`;
  const riceVars = db.varieties.filter(v => v.active && (v.usage || ['rice']).includes('rice'));

  // ------- totals -------
  const fifoKg = (v: { id: string }) => Math.max(0, (Number(qty[v.id]) || 0) * 100);
  const lotKgOf = (key: string) => Math.max(0, (Number(lotQty[key]) || 0) * 100);
  const varLotTotal = (v: string) => varieties.find(x => x.id === v)?.lots.reduce((s, l) => s + lotKgOf(l.key), 0) || 0;
  const totalKg = mode === 'fifo' ? varieties.reduce((s, v) => s + fifoKg(v), 0) : varieties.reduce((s, v) => s + varLotTotal(v.id), 0);
  const totalQtl = round2(totalKg / 100);
  const riceKg = Math.max(0, (Number(riceQtl) || 0) * 100);
  const branKg = Math.max(0, (Number(branQtl) || 0) * 100);

  const estCost = mode === 'fifo'
    ? varieties.reduce((s, v) => s + fifoKg(v) / 100 * v.avg, 0)
    : varieties.reduce((s, v) => s + v.lots.reduce((x, l) => x + lotKgOf(l.key) / 100 * (l.ratePerQtl || 0), 0), 0);

  const overFifo = mode === 'fifo' ? varieties.find(v => fifoKg(v) > v.avail + 0.004) : undefined;
  const overLot = mode === 'manual' ? varieties.flatMap(v => v.lots).find(l => lotKgOf(l.key) > l.qtyLeftKg + 0.004) : undefined;

  const handleSave = () => {
    setError('');
    const inputs: ProductionInput[] = [];
    if (mode === 'fifo') {
      for (const v of varieties) {
        const kg = fifoKg(v);
        if (kg <= 0.004) continue;
        if (kg > v.avail + 0.004) { setError(`${v.name}: only ${q(v.avail / 100)} available`); return; }
        const alloc = allocateFifoLots(v.lots, kg).map(a => {
          const src = v.lots.find(l => l.key === a.key)!;
          return { key: a.key, purchaseId: src.purchaseId, qtyKg: a.qtyKg, date: src.date, party: src.party, ratePerQtl: src.ratePerQtl };
        });
        inputs.push({ varietyId: v.id, qtyKg: round2(kg), lots: alloc });
      }
    } else {
      for (const v of varieties) {
        const used = v.lots.filter(l => lotKgOf(l.key) > 0.004);
        if (!used.length) continue;
        for (const l of used) if (lotKgOf(l.key) > l.qtyLeftKg + 0.004) { setError(`${v.name}: lot has only ${q(l.qtyLeftKg / 100)} left`); return; }
        const kg = used.reduce((s, l) => s + lotKgOf(l.key), 0);
        inputs.push({
          varietyId: v.id, qtyKg: round2(kg),
          lots: used.map(l => ({ key: l.key, purchaseId: l.purchaseId, qtyKg: lotKgOf(l.key), date: l.date, party: l.party, ratePerQtl: l.ratePerQtl })),
        });
      }
    }
    if (!inputs.length) { setError('Enter paddy quantity for at least one variety.'); return; }
    if (!(riceKg > 0)) { setError('Rice output quantity is required.'); return; }
    if (riceKg > totalKg * 1.02) { setError(`Rice out (${q(riceKg / 100)}) cannot exceed paddy in (${q(totalKg / 100)}).`); return; }
    const rVar = riceVarietyId || inputs[0].varietyId;

    const payload = {
      date, paddyType: type, mode, inputs,
      paddyVarietyId: inputs[0].varietyId, paddyInputKg: round2(totalKg),
      outputs: { riceVarietyId: rVar, riceKg: round2(riceKg), brokenRiceKg: 0, branKg: round2(branKg), huskKg: 0, otherKg: 0 },
      notes: notes.trim() || undefined,
    };
    if (editing) updateProduction(editing.id, payload);
    else addProduction(payload);
    toast(`${editing ? 'Updated' : 'Saved'} ${editing ? '' : previewId} — rice & bran stock updated`);
    onSaved();
  };

  return (
    <Card className="p-3 space-y-4 border-2 border-forest-300">
      <div className="flex items-center justify-between">
        <div className="text-base font-extrabold text-forest-900 flex items-center gap-1.5">
          <span className="w-6 h-6 rounded-full bg-forest-700 text-white text-sm flex items-center justify-center">＋</span>
          {editing ? `Edit ${editing.batchNumber}` : 'New Production Entry'}
        </div>
        <button onClick={onClose} className="text-gray-400 text-xl px-2">✕</button>
      </div>

      {/* 1 entry details */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#0b3d2c] text-white text-[11px] font-bold flex items-center justify-center">1</span>
          <b className="text-sm text-gray-800">Entry Details</b>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">Production ID</div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-extrabold text-forest-800">{previewId} <span className="font-normal text-gray-400 text-[11px]">(auto)</span></div>
          </div>
          <Input type="date" label="Production Date *" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      {/* 2 paddy selection */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#0b3d2c] text-white text-[11px] font-bold flex items-center justify-center">2</span>
          <b className="text-sm text-gray-800">Paddy Selection</b>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">Paddy Type</div>
            <div className="flex gap-1.5">
              <button className={seg(type === 'small')} onClick={() => { setType('small'); setError(''); }}>Small Paddy</button>
              <button className={seg(type === 'big')} onClick={() => { setType('big'); setError(''); }}>Big Paddy</button>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">Production Mode</div>
            <div className="flex gap-1.5">
              <button className={seg(mode === 'fifo')} onClick={() => { setMode('fifo'); setError(''); }}>FIFO Auto</button>
              <button className={seg(mode === 'manual')} onClick={() => { setMode('manual'); setError(''); }}>Manual</button>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-gray-500">{FOOT}</p>

        <div className="flex justify-end sticky top-1 z-10 -mt-1 pointer-events-none">
          <div className="pointer-events-auto rounded-full bg-[#0b3d2c] text-white text-[11px] font-bold px-3.5 py-1.5 shadow">
            ✿ Total: <span className="text-amber-300">{q(totalQtl)}</span>
          </div>
        </div>

        {varieties.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
            No {type} paddy available. Record a Purchase first, or mark this variety as {type} in Inventory.
          </div>
        )}

        {varieties.map(v => {
          const kg = mode === 'fifo' ? fifoKg(v) : varLotTotal(v.id);
          const usedCost = mode === 'fifo' ? kg / 100 * v.avg : v.lots.reduce((s, l) => s + lotKgOf(l.key) / 100 * (l.ratePerQtl || 0), 0);
          const over = mode === 'fifo' ? kg > v.avail + 0.004 : false;
          return (
            <div key={v.id} className={`rounded-xl border ${over ? 'border-red-300 bg-red-50/40' : 'border-gray-200 bg-[#fbfaf7]'} p-3 space-y-2`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <b className="text-sm text-gray-800 flex items-center gap-1.5">❀ {v.name.toUpperCase()}</b>
                <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2 py-0.5">
                  Available: {q(v.avail / 100)}
                </span>
                <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100 rounded-full px-2 py-0.5">
                  Avg: {fmtINR(v.avg)}/Qtl
                </span>
              </div>

              {mode === 'fifo' ? (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <div className="text-[10px] font-bold text-gray-500 uppercase">QTY (QTL):</div>
                    <input type="number" inputMode="decimal" value={qty[v.id] || ''} placeholder="0.00"
                      onChange={e => { setQty(m => ({ ...m, [v.id]: e.target.value })); setError(''); }}
                      className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-forest-100 ${over ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'} focus:border-forest-500`} />
                  </div>
                  {kg > 0 && <div className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-2 whitespace-nowrap">≈ {fmtINR(kg / 100 * v.avg)}</div>}
                </div>
              ) : (
                <div className="space-y-2">
                  {v.lots.map(l => {
                    const lq = lotQty[l.key] || '';
                    const lOver = lotKgOf(l.key) > l.qtyLeftKg + 0.004;
                    const leftAfter = round2(l.qtyLeftKg - lotKgOf(l.key));
                    return (
                      <div key={l.key} className={`rounded-lg border ${lOver ? 'border-red-300 bg-red-50/60' : 'border-gray-200 bg-white'} p-2.5`}>
                        <div className="flex justify-between text-[11px] font-bold text-gray-700">
                          <span>{l.source === 'purchase' ? '📄 ' + fmtDate(l.date) + (l.party ? ' · ' + l.party : '') : '⚙ Adjustment · ' + fmtDate(l.date)}</span>
                          <span className="text-emerald-700">Available: {q(l.qtyLeftKg / 100)}{l.ratePerQtl ? ` @ ${fmtINR(l.ratePerQtl)}` : ''}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <input type="number" inputMode="decimal" value={lq} placeholder="0.00"
                            onChange={e => { setLotQty(m => ({ ...m, [l.key]: e.target.value })); setError(''); }}
                            className={`flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-forest-100 ${lOver ? 'border-red-400 bg-red-50' : 'border-gray-300'} focus:border-forest-500`} />
                          {(Number(lq) || 0) > 0 && <span className="text-[10px] font-bold text-gray-500 whitespace-nowrap">left {q(Math.max(0, leftAfter) / 100)}</span>}
                        </div>
                      </div>
                    );
                  })}
                  <div className="text-[11px] font-bold text-gray-600">Manual total: <b className="text-forest-800">{q(round2(varLotTotal(v.id)) / 100)}</b></div>
                </div>
              )}

              {kg > 0.004 && (
                <div className="text-[11px] text-gray-500">
                  Using {q(kg / 100)} · est. cost {fmtINR(usedCost)}
                  {over && <b className="text-red-600"> — exceeds available stock!</b>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 3 output */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#0b3d2c] text-white text-[11px] font-bold flex items-center justify-center">3</span>
          <b className="text-sm text-gray-800">Output</b>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Rice Output Qty (Qtl) *" type="number" inputMode="decimal" value={riceQtl} onChange={e => setRiceQtl(e.target.value)} placeholder="0.00" />
          <Input label="Bran Output Qty (Qtl)" type="number" inputMode="decimal" value={branQtl} onChange={e => setBranQtl(e.target.value)} placeholder="0.00" />
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500 -mt-1">
          <span>Added to Rice stock</span>
          <span className="text-amber-700">Added to Bran stock</span>
        </div>
        <div>
          <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">Rice Variety (stock bucket)</div>
          <select value={riceVarietyId} onChange={e => setRiceVarietyId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-forest-500">
            <option value="">Same as paddy used</option>
            {riceVars.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>

        <button onClick={() => setShowNotes(s => !s)} className="text-[11px] font-bold text-forest-700">▸ NOTES (OPTIONAL)</button>
        {showNotes && <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. 25kg bags received" />}

        {/* live summary */}
        <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 text-sm">
          <div className="flex justify-between px-3 py-2.5 text-red-700 font-bold"><span>PADDY IN</span><span>{totalKg > 0 ? '−' + q(totalQtl) : '—'}</span></div>
          <div className="flex justify-between px-3 py-2.5 text-emerald-700 font-bold"><span>RICE OUT</span><span>{riceKg > 0 ? '+' + q(riceKg / 100) : '—'}</span></div>
          <div className="flex justify-between px-3 py-2.5 text-amber-700 font-bold"><span>BRAN OUT</span><span>{branKg > 0 ? '+' + q(branKg / 100) : '—'}</span></div>
          <div className="flex justify-between px-3 py-2.5 text-gray-800 bg-gray-50">
            <span>RECOVERY / EST. COST</span>
            <span className="font-bold">
              {totalKg > 0 ? Math.round((riceKg / totalKg) * 100) + '%' : '—'}
              {estCost > 0 ? ` · ≈ ${fmtINR(estCost)}` : ''}
            </span>
          </div>
        </div>

        {error && <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠ {error}</div>}
        {(overFifo || overLot) && !error && <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠ A quantity exceeds available stock.</div>}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button className="bg-[#0b3d2c] hover:bg-[#082c20]" onClick={handleSave}>
            💾 {editing ? 'Update Production' : 'Save Production'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ============================== SMALL PARTS ==============================
function SumTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-[#fbfaf7] py-3 text-center">
      <b className="block text-base text-gray-900">{value}</b>
      <div className="text-[10px] text-gray-500 font-semibold">{label}</div>
    </div>
  );
}
function StatBox({ label, value, tone, bold }: { label: string; value: string; tone: 'emerald' | 'amber'; bold?: boolean }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-amber-50 border-amber-100 text-amber-800';
  return (
    <div className={`rounded-xl border py-2.5 text-center ${cls}`}>
      <b className={`block ${bold ? 'text-lg' : 'text-sm'}`}>{value}</b>
      <div className="text-[10px] font-semibold opacity-75">{label}</div>
    </div>
  );
}

function StockReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, stock } = useDB();
  if (!open) return null;
  const rows = (m: Record<string, number>) =>
    db.varieties.filter(v => (m[v.id] || 0) > 0.004).map(v => ({ name: v.name, cat: v.category, kg: m[v.id] || 0 }));
  const paddy = rows(stock.paddyByVariety);
  const rice = rows(stock.riceByVariety);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <b className="text-base text-forest-900">▣ Stock Report</b><button onClick={onClose} className="text-gray-400 text-xl">✕</button>
        </div>
        {([['Paddy', paddy], ['Rice', rice]] as const).map(([title, list]) => (
          <div key={title}>
            <b className="text-xs text-gray-600 uppercase tracking-wide">{title} by Variety</b>
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 mt-1">
              {list.length === 0 && <div className="text-xs text-gray-400 p-3">No stock</div>}
              {list.map(r => (
                <div key={r.name} className="flex justify-between px-3 py-2 text-sm">
                  <span>{r.name} <span className="text-gray-400 text-[10px]">({r.cat})</span></span>
                  <b>{q(r.kg / 100)}</b>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="rounded-xl border border-gray-200 px-3 py-2 text-sm flex justify-between">
          <span>Bran</span><b>{q(stock.branKg / 100)}</b>
        </div>
        <Button variant="secondary" className="w-full" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
