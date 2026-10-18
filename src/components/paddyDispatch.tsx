import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDB } from '../context';
import {
  allocateFifoLots, computePaddyLots, dispatchDue, fmtDate, fmtINR, inRange, paymentStatus, round2, sumPayments, today, uid,
} from '../db';
import type { PaddyLot } from '../db';
import type {
  DispatchEntry, PaddyDispatchAlloc, PaddyDispatchDetail, PaddyDispatchRow, Payment,
} from '../types';
import { Badge, Button, Card, Confirm, DateRangePresets, EmptyState, Input, Select, toast } from './ui';
import {
  AddPaymentModal, DispatchForm, PartyInput, ReceiptModal, partyName, statusBadge, useEnsureParty, usePaymentModes,
} from './pages';

// ---------------------------------------------------------------- helpers
type Size = 'small' | 'big';
type Mode = 'fifo' | 'manual';
type View = 'paddy' | 'customer';
type Sell = 'single' | 'multiple';
type PayStatus = 'paid' | 'partial' | 'unpaid';
type Split = { qty: string; rate: string };
type RowState = { qty: string; rate: string; splits: Split[] };
type LotX = PaddyLot & { varietyId: string; varietyName: string };
type RowDef = { id: string; label: string; lots: LotX[]; availKg: number; avgRate: number; size?: Size };

const EPS = 0.004;
const num = (s: string | number | undefined) => Number(s) || 0;
const kgOf = (qtl: string | number | undefined) => round2(num(qtl) * 100);
const fmt2 = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(round2(n));
const qtlTxt = (kg: number) => `${fmt2(kg / 100)} Qtl`;
const emptyRow = (): RowState => ({ qty: '', rate: '', splits: [{ qty: '', rate: '' }] });
const strQtl = (kg: number) => (kg > 0 ? String(round2(kg / 100)) : '');

const seg = (active: boolean) =>
  `flex-1 min-w-0 px-2 py-2.5 rounded-xl text-[13px] font-bold border transition-colors flex items-center justify-center gap-1.5 ${
    active ? 'bg-[#0b3d2c] text-white border-[#0b3d2c] shadow-sm' : 'bg-white text-gray-600 border-gray-200'}`;

const L = ({ children }: { children: React.ReactNode }) => <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">{children}</div>;

function Step({ n, title, children, tone = 'bg-white' }: { n: number; title: string; children: React.ReactNode; tone?: string }) {
  return (
    <section className={`rounded-2xl border border-gray-200 ${tone} p-3 space-y-3`}>
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-[#0b3d2c] text-white text-[12px] font-extrabold flex items-center justify-center">{n}</span>
        <h3 className="text-[12px] font-extrabold tracking-wide text-gray-700 uppercase">{title}</h3>
      </div>
      {children}
    </section>
  );
}

const Hint = ({ children, tone = 'green' }: { children: React.ReactNode; tone?: 'green' | 'amber' | 'red' }) => (
  <div className={`text-[11px] rounded-lg px-2.5 py-2 border ${
    tone === 'green' ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
      : tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{children}</div>
);

function SummaryBar({ gross, selected, remaining, className = '' }: { gross: number; selected: number; remaining: number; className?: string }) {
  const full = gross > 0 && Math.abs(remaining) < EPS * 100 + 0.5;
  const over = remaining < -0.5;
  const status = gross <= 0 ? { t: '—', c: 'text-white/70' } : full ? { t: '✓ Full', c: 'text-emerald-300' } : over ? { t: '▲ Over', c: 'text-red-300' } : { t: '◔ Pending', c: 'text-amber-300' };
  const Cell = ({ l, v, c = 'text-white' }: { l: string; v: string; c?: string }) => (
    <div className="flex-1 text-center px-1">
      <div className="text-[9px] font-bold tracking-wider text-white/60 uppercase">{l}</div>
      <div className={`text-[15px] font-extrabold leading-tight ${c}`}>{v}</div>
    </div>
  );
  return (
    <div className={`flex items-center divide-x divide-white/15 bg-[#0b3d2c] text-white rounded-2xl py-2 shadow-lg ${className}`}>
      <Cell l="Gross" v={fmt2(gross / 100)} />
      <Cell l="Selected" v={fmt2(selected / 100)} />
      <Cell l="Remaining" v={fmt2(remaining / 100)} c={over ? 'text-red-300' : 'text-white'} />
      <Cell l="Status" v={status.t} c={status.c} />
    </div>
  );
}

function MoneyBar({ revenue, buy, expenses, profit, children, className = '' }: {
  revenue: number; buy: number; expenses: number; profit: number; children?: React.ReactNode; className?: string;
}) {
  const Cell = ({ l, v, c = 'text-gray-900' }: { l: string; v: string; c?: string }) => (
    <div className="flex-1 text-center min-w-0">
      <div className="text-[9px] font-bold tracking-wider text-gray-400 uppercase">{l}</div>
      <div className={`text-[12px] font-extrabold truncate ${c}`}>{v}</div>
    </div>
  );
  return (
    <div className={`bg-white border border-gray-200 rounded-2xl shadow-lg p-2 space-y-2 ${className}`}>
      <div className="flex divide-x divide-gray-100">
        <Cell l="Revenue" v={fmtINR(revenue)} c="text-emerald-700" />
        <Cell l="Buy cost" v={fmtINR(buy)} c="text-red-600" />
        <Cell l="Expenses" v={fmtINR(expenses)} c="text-red-600" />
        <Cell l="P&L" v={`${profit >= 0 ? '+' : '−'}${fmtINR(Math.abs(profit))}`} c={profit >= 0 ? 'text-emerald-700' : 'text-red-600'} />
      </div>
      {children}
    </div>
  );
}

// =========================================================== PAGE
export function PaddyDispatchPage() {
  const { db, addDispatch, updateDispatch, deleteDispatch, addDispatchPayment } = useDB();
  const modes = usePaymentModes();
  const ensureParty = useEnsureParty();

  // ---------- form state ----------
  const [editing, setEditing] = useState<DispatchEntry | null>(null);
  const [sizes, setSizes] = useState<{ small: boolean; big: boolean }>({ small: true, big: false });
  const [buyBasis, setBuyBasis] = useState<'actual' | 'average'>('actual');
  const [moistDed, setMoistDed] = useState('');
  const [mode, setMode] = useState<Mode>('fifo');
  const [view, setView] = useState<View>('paddy');
  const [sell, setSell] = useState<Sell>('single');
  const [grossQtl, setGrossQtl] = useState('');
  const [bags, setBags] = useState('');
  const [date, setDate] = useState(today());
  const [vendor, setVendor] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [owner, setOwner] = useState('');
  const [mobile, setMobile] = useState('');
  const [rs, setRs] = useState<Record<string, RowState>>({});
  const [lotQty, setLotQty] = useState<Record<string, string>>({});
  const [loadOverride, setLoadOverride] = useState<string | null>(null);
  const [emptyQtl, setEmptyQtl] = useState('');
  const [netOverride, setNetOverride] = useState<string | null>(null);
  const [bagDed, setBagDed] = useState('');
  const [otherDed, setOtherDed] = useState('');
  const [tRate, setTRate] = useState('120');
  const [vehCharge, setVehCharge] = useState('');
  const [loadCharge, setLoadCharge] = useState('');
  const [labCharge, setLabCharge] = useState('');
  const [dedRs, setDedRs] = useState('');
  const [miscRs, setMiscRs] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [payStatus, setPayStatus] = useState<PayStatus>('paid');
  const [partialAmt, setPartialAmt] = useState('');
  const [payTouched, setPayTouched] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  // ---------- list state ----------
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewEntry, setViewEntry] = useState<DispatchEntry | null>(null);
  const [payEntry, setPayEntry] = useState<DispatchEntry | null>(null);
  const [delEntry, setDelEntry] = useState<DispatchEntry | null>(null);
  const [legacy, setLegacy] = useState<DispatchEntry | null>(null);
  const [legacyNew, setLegacyNew] = useState(false);

  // ---------- sticky bars (page is not an internal scroller, so use fixed bars) ----------
  const formRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLDivElement>(null);
  const [formVis, setFormVis] = useState(true);
  const [topVis, setTopVis] = useState(true);
  const [saveVis, setSaveVis] = useState(false);
  const [offs, setOffs] = useState({ top: 52, bottom: 56 });
  useEffect(() => {
    const mk = (el: Element | null, set: (b: boolean) => void) => {
      if (!el) return () => {};
      const o = new IntersectionObserver(([e]) => set(e.isIntersecting), { threshold: 0 });
      o.observe(el);
      return () => o.disconnect();
    };
    const a = mk(formRef.current, setFormVis), b = mk(topRef.current, setTopVis), c = mk(saveRef.current, setSaveVis);
    const measure = () => setOffs({
      top: document.querySelector('header')?.getBoundingClientRect().height || 52,
      bottom: document.querySelector('nav')?.getBoundingClientRect().height || 56,
    });
    measure();
    window.addEventListener('resize', measure);
    return () => { a(); b(); c(); window.removeEventListener('resize', measure); };
  }, []);

  // ---------- stock lots for the chosen size ----------
  const lotsRes = useMemo(() => computePaddyLots(db, { excludeDispatchId: editing?.id }), [db, editing?.id]);
  const rowDefs: RowDef[] = useMemo(() => {
    const lots: LotX[] = [];
    for (const v of db.varieties.filter(x => x.active && (x.category === 'small' || x.category === 'big') && sizes[x.category as Size])) {
      for (const l of lotsRes.byVariety[v.id] || []) {
        if (l.qtyLeftKg > EPS) lots.push({ ...l, varietyId: v.id, varietyName: v.name });
      }
    }
    lots.sort((a, b) => a.date.localeCompare(b.date));
    const avg = (ls: LotX[]) => {
      const kg = ls.reduce((s, l) => s + l.qtyLeftKg, 0);
      const cost = ls.reduce((s, l) => s + (l.qtyLeftKg / 100) * (l.ratePerQtl || 0), 0);
      return { kg: round2(kg), avg: kg > 0 ? round2(cost / (kg / 100)) : 0 };
    };
    const groups = new Map<string, { label: string; lots: LotX[]; size?: Size }>();
    const catOf = (vid: string) => (db.varieties.find(x => x.id === vid)?.category === 'big' ? 'big' : 'small') as Size;
    for (const l of lots) {
      const id = view === 'paddy' ? `v:${l.varietyId}` : `p:${l.party || 'adj'}`;
      const label = view === 'paddy' ? l.varietyName : (l.party || 'Stock adjustment');
      if (!groups.has(id)) groups.set(id, { label, lots: [], size: view === 'paddy' ? catOf(l.varietyId) : undefined });
      groups.get(id)!.lots.push(l);
    }
    return [...groups.entries()]
      .map(([id, g]) => { const a = avg(g.lots); return { id, label: g.label, lots: g.lots, availKg: a.kg, avgRate: a.avg, size: g.size } as RowDef; })
      .sort((a, b) => (a.size === b.size ? 0 : a.size === 'small' ? -1 : 1) || a.label.localeCompare(b.label));
  }, [db.varieties, lotsRes, sizes, view]);

  // ---------- weights: amount is billed on the FINAL weight after every deduction ----------
  const grossKg = kgOf(grossQtl);
  const loadKg = loadOverride !== null ? kgOf(loadOverride) : grossKg;
  const emptyKg = kgOf(emptyQtl);
  const netWtKg = netOverride !== null ? kgOf(netOverride) : Math.max(0, round2(loadKg - emptyKg));
  const bagDedKg = kgOf(bagDed), moistDedKg = kgOf(moistDed), otherDedKg = kgOf(otherDed);
  const netSaleKg = Math.max(0, round2(netWtKg - bagDedKg - moistDedKg - otherDedKg));
  const billFactor = loadKg > 0 ? netSaleKg / loadKg : 1;

  // ---------- per-row computation ----------
  const getRs = (id: string): RowState => rs[id] || emptyRow();
  const calc = useMemo(() => {
    return rowDefs.map(def => {
      const st = rs[def.id] || emptyRow();
      const splits = st.splits.filter(s => num(s.qty) > 0 || num(s.rate) > 0);
      const splitKg = round2(splits.reduce((s, x) => s + kgOf(x.qty), 0));
      let qtyKg = 0;
      if (mode === 'manual') qtyKg = round2(def.lots.reduce((s, l) => s + kgOf(lotQty[l.key]), 0));
      else qtyKg = sell === 'single' ? kgOf(st.qty) : splitKg;

      let allocs: PaddyDispatchAlloc[] = [];
      if (qtyKg > 0) {
        if (mode === 'manual') {
          allocs = def.lots.filter(l => kgOf(lotQty[l.key]) > 0).map(l => ({
            key: l.key, varietyId: l.varietyId, qtyKg: kgOf(lotQty[l.key]), ratePerQtl: l.ratePerQtl, party: l.party, date: l.date,
          }));
        } else {
          allocs = allocateFifoLots(def.lots, Math.min(qtyKg, def.availKg)).map(a => {
            const l = def.lots.find(x => x.key === a.key)!;
            return { key: a.key, varietyId: l.varietyId, qtyKg: a.qtyKg, ratePerQtl: l.ratePerQtl, party: l.party, date: l.date };
          });
        }
      }
      const buyCost = buyBasis === 'average'
        ? round2((qtyKg / 100) * def.avgRate)
        : round2(allocs.reduce((s, a) => s + (a.qtyKg / 100) * (a.ratePerQtl || 0), 0));
      const rateRows = qtyKg > 0
        ? (sell === 'single' ? [{ qtyKg, ratePerQtl: num(st.rate) }] : splits.map(x => ({ qtyKg: kgOf(x.qty), ratePerQtl: num(x.rate) })))
        : [];
      const revenue = round2(rateRows.reduce((s, r) => s + (r.qtyKg / 100) * r.ratePerQtl, 0) * billFactor);
      let err = '';
      if (qtyKg > def.availKg + EPS * 100) err = `${def.label}: only ${qtlTxt(def.availKg)} available`;
      else if (qtyKg > 0 && rateRows.some(r => !(r.ratePerQtl > 0))) err = `${def.label}: enter the sell rate`;
      else if (qtyKg > 0 && sell === 'multiple' && Math.abs(splitKg - qtyKg) > 0.5) err = `${def.label}: split total ${qtlTxt(splitKg)} must equal selected ${qtlTxt(qtyKg)}`;
      return { def, qtyKg, splitKg, allocs, buyCost, rateRows, revenue, err };
    });
  }, [rowDefs, rs, lotQty, mode, sell, buyBasis, billFactor]);

  const selectedKg = round2(calc.reduce((s, c) => s + c.qtyKg, 0));
  const remainingKg = round2(grossKg - selectedKg);
  const revenue = round2(calc.reduce((s, c) => s + c.revenue, 0));
  const buyCost = round2(calc.reduce((s, c) => s + c.buyCost, 0));


  // charges
  const transportAmt = round2((grossKg / 100) * num(tRate)); // gross load x rate, NOT net qty
  const expenses = round2(transportAmt + num(vehCharge) + num(loadCharge) + num(labCharge) + num(dedRs) + num(miscRs));
  const profit = round2(revenue - buyCost - expenses);
  const payable = revenue; // buyer pays the full selling amount; vehicle rent is our own cost

  // ---------- actions ----------
  const resetAll = () => {
    setEditing(null); setSizes({ small: true, big: false }); setBuyBasis('actual'); setMoistDed(''); setMode('fifo'); setView('paddy'); setSell('single');
    setGrossQtl(''); setBags(''); setDate(today()); setVendor(''); setVehicle(''); setDriver(''); setOwner(''); setMobile('');
    setRs({}); setLotQty({}); setLoadOverride(null); setEmptyQtl(''); setNetOverride(null); setBagDed(''); setOtherDed('');
    setTRate('120'); setVehCharge(''); setLoadCharge(''); setLabCharge(''); setDedRs(''); setMiscRs('');
    setPayMode(modes[0] || 'Cash'); setPayStatus('paid'); setPartialAmt(''); setPayTouched(false); setRemarks(''); setError('');
  };
  const clearSelection = () => { setRs({}); setLotQty({}); setError(''); };
  const toggleSize = (s: Size) => {
    const next = { ...sizes, [s]: !sizes[s] };
    if (!next.small && !next.big) { toast('Keep at least one paddy type selected', 'info'); return; }
    setSizes(next); clearSelection();
  };
  const sizeKey: 'small' | 'big' | 'both' = sizes.small && sizes.big ? 'both' : sizes.big ? 'big' : 'small';
  const changeMode = (m: Mode) => { if (m !== mode) { setMode(m); clearSelection(); } };
  const changeView = (v: View) => { if (v !== view) { setView(v); clearSelection(); } };
  const changeSell = (s: Sell) => {
    if (s === sell) return;
    setRs(prev => {
      const next: Record<string, RowState> = {};
      for (const [id, st] of Object.entries(prev) as [string, RowState][]) {
        if (s === 'multiple') next[id] = { ...st, splits: [{ qty: st.qty, rate: st.rate }] };
        else {
          const tot = st.splits.reduce((a, x) => a + num(x.qty), 0);
          next[id] = { ...st, qty: tot > 0 ? String(round2(tot)) : '', rate: st.splits.find(x => num(x.rate) > 0)?.rate || st.rate };
        }
      }
      return next;
    });
    setSell(s);
    setError('');
  };

  const patchRow = (id: string, p: Partial<RowState>) => setRs(prev => ({ ...prev, [id]: { ...(prev[id] || emptyRow()), ...p } }));
  const patchSplit = (id: string, i: number, p: Partial<Split>) => {
    const cur = getRs(id);
    patchRow(id, { splits: cur.splits.map((s, x) => (x === i ? { ...s, ...p } : s)) });
  };

  const clearRow = (def: RowDef) => {
    setRs(prev => { const n = { ...prev }; delete n[def.id]; return n; });
    setLotQty(prev => { const n = { ...prev }; def.lots.forEach(l => delete n[l.key]); return n; });
  };
  const fillRow = (def: RowDef) => {
    const rem = grossKg > 0 ? remainingKg : def.availKg;
    const take = round2(Math.min(def.availKg, rem));
    if (take <= 0) { toast('Gross load is already fully allocated', 'info'); return; }
    if (mode === 'manual') {
      let left = take;
      const next: Record<string, string> = {};
      for (const l of def.lots) {
        if (left <= 0) break;
        const t = round2(Math.min(l.qtyLeftKg, left));
        next[l.key] = strQtl(t); left = round2(left - t);
      }
      setLotQty(prev => ({ ...prev, ...next }));
    } else if (sell === 'single') patchRow(def.id, { qty: strQtl(take) });
    else patchRow(def.id, { splits: [{ qty: strQtl(take), rate: getRs(def.id).splits[0]?.rate || '' }] });
  };

  // ---------- load a saved dispatch for editing ----------
  const startEdit = (d: DispatchEntry) => {
    if (!d.paddy) { setLegacy(d); return; }
    const p = d.paddy;
    setEditing(d); setSizes({ small: p.size !== 'big', big: p.size !== 'small' }); setBuyBasis(p.buyBasis || 'actual'); setMoistDed(strQtl(p.moistureDedKg || 0)); setMode(p.mode); setView(p.viewMode); setSell(p.sellMode);
    setGrossQtl(strQtl(p.grossLoadKg)); setBags(p.totalBags ? String(p.totalBags) : '');
    setDate(d.date); setVendor(partyName(db, d.partyId)); setVehicle(d.vehicleNumber || '');
    setDriver(p.driverName || ''); setOwner(p.vehicleOwner || ''); setMobile(p.vendorMobile || '');
    const st: Record<string, RowState> = {};
    for (const r of p.rows) {
      st[r.id] = p.sellMode === 'single'
        ? { qty: strQtl(r.qtyKg), rate: String(r.rateRows[0]?.ratePerQtl || ''), splits: [{ qty: '', rate: '' }] }
        : { qty: '', rate: '', splits: r.rateRows.length ? r.rateRows.map(x => ({ qty: strQtl(x.qtyKg), rate: String(x.ratePerQtl) })) : [{ qty: '', rate: '' }] };
    }
    setRs(st);
    const lq: Record<string, string> = {};
    if (p.mode === 'manual') for (const a of p.allocations) lq[a.key] = strQtl(a.qtyKg);
    setLotQty(lq);
    setLoadOverride(null); setEmptyQtl(strQtl(p.emptyWeightKg));
    setNetOverride(Math.abs(p.netWeightKg - Math.max(0, p.grossLoadKg - p.emptyWeightKg)) > 0.5 ? strQtl(p.netWeightKg) : null);
    setBagDed(strQtl(p.bagWeightDedKg)); setOtherDed(strQtl(p.otherWeightDedKg));
    setTRate(String(p.transportRate)); setVehCharge(p.vehicleCharges ? String(p.vehicleCharges) : '');
    setLoadCharge(p.loadingCharges ? String(p.loadingCharges) : ''); setLabCharge(p.labourCharges ? String(p.labourCharges) : '');
    setDedRs(p.deductionsRs ? String(p.deductionsRs) : ''); setMiscRs(p.miscCharges ? String(p.miscCharges) : '');
    setPayMode(p.paymentMode || 'Cash');
    const paid = sumPayments(d.payments);
    setPayStatus(paid >= p.payable - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
    setPartialAmt(paid > 0 && paid < p.payable - 0.01 ? String(paid) : '');
    setPayTouched(false); setRemarks(d.notes || ''); setError('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---------- save ----------
  const save = () => {
    setError('');
    const fail = (m: string) => { setError(m); toast(m, 'error'); };
    if (!(grossKg > 0)) return fail('Enter the gross load (Qtl).');
    if (!vendor.trim()) return fail('Enter the vendor / buyer name.');
    if (!(selectedKg > 0)) return fail('Select paddy to dispatch.');
    if (selectedKg > grossKg + 0.5) return fail(`Selected ${qtlTxt(selectedKg)} is more than gross load ${qtlTxt(grossKg)}.`);
    const bad = calc.find(c => c.err);
    if (bad) return fail(bad.err);
    const pid = ensureParty(vendor, 'customer');
    if (!pid) return fail('Enter the vendor / buyer name.');

    const allocations = calc.flatMap(c => c.allocs);
    const rows: PaddyDispatchRow[] = calc.filter(c => c.qtyKg > 0).map(c => ({
      id: c.def.id, label: c.def.label, qtyKg: c.qtyKg, rateRows: c.rateRows, revenue: c.revenue, buyCost: c.buyCost,
    }));
    const detail: PaddyDispatchDetail = {
      size: sizeKey, mode, viewMode: view, sellMode: sell, grossLoadKg: grossKg, totalBags: Math.round(num(bags)),
      driverName: driver.trim() || undefined, vehicleOwner: owner.trim() || undefined, vendorMobile: mobile.trim() || undefined,
      emptyWeightKg: emptyKg, netWeightKg: netWtKg, bagWeightDedKg: bagDedKg, moistureDedKg: moistDedKg, otherWeightDedKg: otherDedKg, netSaleKg, billFactor, buyBasis,
      transportRate: num(tRate), vehicleCharges: num(vehCharge), loadingCharges: num(loadCharge), labourCharges: num(labCharge),
      deductionsRs: num(dedRs), miscCharges: num(miscRs),
      allocations, rows, selectedKg, revenue, buyCost, expenses, profit, payable,
      paymentMode: payMode, paymentStatus: payStatus,
    };

    let payments: Payment[];
    if (editing && !payTouched) payments = editing.payments;
    else {
      const amt = payStatus === 'paid' ? payable : payStatus === 'partial' ? Math.min(num(partialAmt), Math.max(0, payable)) : 0;
      if (payStatus === 'partial' && !(amt > 0)) return fail('Enter the amount received for a partial payment.');
      payments = amt > 0 ? [{ id: uid(), date, amount: round2(amt), mode: payMode, createdAt: new Date().toISOString() }] : [];
    }

    const avgRate = netSaleKg > 0 ? round2(revenue / (netSaleKg / 100)) : 0;
    const data: Omit<DispatchEntry, 'id' | 'createdAt' | 'updatedAt' | 'dispatchNumber'> = {
      date, partyId: pid, vehicleNumber: vehicle.trim() || undefined, productId: 'pr_paddy', varietyId: allocations[0]?.varietyId,
      grossKg: loadKg, tareKg: emptyKg, bagWeightKg: bagDedKg, otherDeductionsKg: round2(moistDedKg + otherDedKg),
      netKg: selectedKg, billableQtl: round2(netSaleKg / 100), ratePerQtl: avgRate, baseAmount: revenue,
      transportCost: transportAmt, loadingCost: num(loadCharge), unloadingCost: 0, driverBata: 0, snacksCost: 0,
      otherCosts: round2(num(vehCharge) + num(labCharge) + num(dedRs) + num(miscRs)), totalCosts: expenses,
      gstMode: 'none', gstRate: 0, taxableAmount: revenue, cgst: 0, sgst: 0, totalTax: 0,
      roundOriginal: revenue, roundAdjustment: 0, finalTotal: revenue, manualOverrides: {},
      notes: remarks.trim() || undefined, payments, paddy: detail,
    };
    if (editing) { updateDispatch(editing.id, data); toast(`Updated ${editing.dispatchNumber}`); }
    else { addDispatch(data); toast('Dispatch saved — paddy stock updated'); }
    resetAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ---------- records ----------
  const records = useMemo(() => {
    const s = search.trim().toLowerCase();
    return db.dispatches
      .filter(d => !d.husk)
      .filter(d => inRange(d.date, { preset: range as any }))
      .filter(d => typeFilter === 'all' ? true
        : typeFilter === 'other' ? !d.paddy
          : (d.paddy?.size === typeFilter || d.paddy?.size === 'both'))
      .filter(d => !s || d.dispatchNumber.toLowerCase().includes(s) || partyName(db, d.partyId).toLowerCase().includes(s) || (d.vehicleNumber || '').toLowerCase().includes(s) || (d.paddy?.driverName || '').toLowerCase().includes(s))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [db, search, range, typeFilter]);
  const totals = useMemo(() => {
    const pad = records.filter(d => d.paddy);
    return {
      qty: pad.reduce((s, d) => s + d.netKg, 0),
      rev: pad.reduce((s, d) => s + d.paddy!.revenue, 0),
      buy: pad.reduce((s, d) => s + d.paddy!.buyCost, 0),
      exp: pad.reduce((s, d) => s + d.paddy!.expenses, 0),
      pl: pad.reduce((s, d) => s + d.paddy!.profit, 0),
    };
  }, [records]);

  const nextNo = `${db.settings.invoicePrefixes.dispatch}-${String(db.settings.nextNumbers.dispatch || 1).padStart(4, '0')}`;
  const showTopFixed = formVis && !topVis;
  const showBotFixed = formVis && !saveVis;

  // =========================================================== RENDER
  return (
    <div className="p-3 pb-28 space-y-4">
      {/* fixed copies of the bars, shown while the form is on screen but the in-flow bars are not */}
      {showTopFixed && (
        <div className="fixed left-1/2 -translate-x-1/2 w-full max-w-md z-20 px-3 pointer-events-none" style={{ top: offs.top + 6 }}>
          <SummaryBar gross={grossKg} selected={selectedKg} remaining={remainingKg} className="pointer-events-auto" />
        </div>
      )}
      {showBotFixed && (
        <div className="fixed left-1/2 -translate-x-1/2 w-full max-w-md z-20 px-3 pointer-events-none" style={{ bottom: offs.bottom + 6 }}>
          <MoneyBar revenue={revenue} buy={buyCost} expenses={expenses} profit={profit} className="pointer-events-auto">
            <Button className="w-full" onClick={save}>{editing ? 'Update Dispatch' : 'Save Dispatch'}</Button>
          </MoneyBar>
        </div>
      )}

      <div ref={formRef} className="space-y-3">
        {/* title */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold text-[#0b3d2c] leading-tight">{editing ? `Edit ${editing.dispatchNumber}` : 'New Paddy Dispatch'}</h2>
            <div className="text-[11px] font-bold text-amber-700">{editing ? 'Editing saved dispatch' : `Next: ${nextNo}`}</div>
          </div>
          {editing && <button onClick={resetAll} className="text-xs font-bold text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5">Cancel edit</button>}
        </div>

        <div ref={topRef}><SummaryBar gross={grossKg} selected={selectedKg} remaining={remainingKg} /></div>

        {/* 1 category */}
        <Step n={1} title="Paddy type — select one or both">
          <div className="grid grid-cols-2 gap-2">
            {([['small', '🌾', 'Small Paddy', 'Fine / regular grain'], ['big', '🌱', 'Big Paddy', 'Long / premium grain']] as const).map(([k, ic, t, s]) => (
              <button key={k} onClick={() => toggleSize(k)}
                className={`relative rounded-2xl border-2 py-3 px-2 text-center transition-all ${sizes[k] ? 'border-amber-500 bg-amber-50 shadow' : 'border-gray-200 bg-white opacity-70'}`}>
                {sizes[k] && <span className="absolute top-1.5 right-2 text-emerald-700 text-sm font-extrabold">✓</span>}
                <div className="text-2xl">{ic}</div>
                <div className="text-sm font-extrabold text-gray-900">{t}</div>
                <div className="text-[10px] text-gray-500">{s}</div>
              </button>
            ))}
          </div>
          <div className="text-[11px] text-gray-500">Usually only one type is sold. Tap both if one vehicle carries small and big paddy.</div>
        </Step>

        {/* 2 load details */}
        <Step n={2} title="Load details">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Input label="Gross Load (Qtl) *" type="number" inputMode="decimal" step="0.01" placeholder="e.g. 200" value={grossQtl} onChange={e => setGrossQtl(e.target.value)} />
              <div className="text-[10px] text-emerald-700 mt-0.5">Total paddy loaded on vehicle</div>
            </div>
            <Input label="Total Bags" type="number" inputMode="numeric" placeholder="0" value={bags} onChange={e => setBags(e.target.value)} />
            <Input label="Date *" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <PartyInput label="Vendor / Buyer *" value={vendor} onChange={setVendor} types={['customer']} placeholder="Mill / vendor name" />
            <Input label="Vehicle Number" placeholder="KA 01 AH 1234" value={vehicle} onChange={e => setVehicle(e.target.value.toUpperCase())} />
            <Input label="Driver Name" placeholder="Optional" value={driver} onChange={e => setDriver(e.target.value)} />
            <Input label="Vehicle Owner" placeholder="Optional" value={owner} onChange={e => setOwner(e.target.value)} />
            <Input label="Vendor Mobile" type="tel" inputMode="tel" placeholder="Optional" value={mobile} onChange={e => setMobile(e.target.value)} />
          </div>
        </Step>

        {/* 3 dispatch mode */}
        <Step n={3} title="Dispatch mode">
          <div className="flex gap-2">
            <button className={seg(mode === 'fifo')} onClick={() => changeMode('fifo')}>⇣ FIFO – Oldest First</button>
            <button className={seg(mode === 'manual')} onClick={() => changeMode('manual')}>☰ Manual Select</button>
          </div>
          <Hint>{mode === 'fifo'
            ? 'FIFO: oldest purchase lots are used first. Enter the quantity and stock is deducted in age order.'
            : 'Manual: type the exact quantity you take from each purchase lot.'}</Hint>
        </Step>

        {/* 4 view */}
        <Step n={4} title="Sort / view mode">
          <div className="flex gap-2">
            <button className={seg(view === 'paddy')} onClick={() => changeView('paddy')}>🌾 Paddy Wise</button>
            <button className={seg(view === 'customer')} onClick={() => changeView('customer')}>👤 Customer Wise</button>
          </div>
          <Hint>{view === 'paddy'
            ? 'Paddy Wise: all stock of the same variety is combined into one row.'
            : 'Customer Wise: stock is grouped by the supplier it was bought from.'}</Hint>
        </Step>

        {/* 5 selling mode */}
        <Step n={5} title="Selling mode">
          <div className="flex gap-2">
            <button className={seg(sell === 'single')} onClick={() => changeSell('single')}>₹ Single Rate</button>
            <button className={seg(sell === 'multiple')} onClick={() => changeSell('multiple')}>≣ Multiple Rates</button>
          </div>
          <div className="text-[11px] text-gray-500">{sell === 'single'
            ? 'One sell rate per row.'
            : mode === 'fifo'
              ? 'Each row has its own split sell rows. The row quantity is the total of its split rows.'
              : 'Each row has its own split sell rows. Split total must equal the selected quantity.'}</div>
        </Step>

        {/* 6 stock rows */}
        <Step n={6} title={`Pick paddy from stock — ${rowDefs.length} ${view === 'paddy' ? 'varieties' : 'suppliers'}`} tone="bg-[#fffaf0]">
          {rowDefs.length === 0 && <EmptyState title="No paddy in stock for the selected type" subtitle="Record a purchase first." />}
          <div className="space-y-2.5">
            {calc.map(c => {
              const { def } = c;
              const st = getRs(def.id);
              const on = c.qtyKg > 0 || (mode === 'fifo' && sell === 'multiple' && st.splits.some(x => num(x.qty) > 0 || num(x.rate) > 0));
              const prev = calc[calc.indexOf(c) - 1]?.def;
              const header = sizes.small && sizes.big && view === 'paddy' && def.size && prev?.size !== def.size;
              return (
                <React.Fragment key={def.id}>
                {header && <div className="text-[11px] font-extrabold tracking-wide uppercase text-[#8a5a1e] pt-1">{def.size === 'big' ? '🌱 Big paddy' : '🌾 Small paddy'}</div>}
                <div className={`rounded-2xl border bg-white p-2.5 space-y-2 ${on ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-gray-200'}`}>
                  <div className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1 w-5 h-5 accent-emerald-700" checked={c.qtyKg > 0}
                      onChange={() => (c.qtyKg > 0 ? clearRow(def) : fillRow(def))} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-extrabold text-[#8a5a1e] uppercase truncate">{def.label}</div>
                      <div className="text-[11px] text-gray-500">Buy avg <b className="text-gray-800">{fmtINR(def.avgRate)}</b>/Qtl</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[9px] font-bold text-gray-400 uppercase">Available</div>
                      <div className="text-sm font-extrabold text-emerald-700">{qtlTxt(def.availKg)}</div>
                    </div>
                  </div>

                  {/* lots */}
                  <div className="flex flex-wrap gap-1.5">
                    {def.lots.map(l => {
                      const used = kgOf(lotQty[l.key]);
                      const text = view === 'paddy'
                        ? `${l.party || 'Opening stock'} · ${fmtDate(l.date)}`
                        : `${l.varietyName} · ${fmtDate(l.date)}`;
                      return mode === 'manual' ? (
                        <div key={l.key} className={`rounded-lg border px-2 py-1.5 w-full flex items-center gap-2 ${used > 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-gray-50 border-gray-200'}`}>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-bold text-gray-800 truncate">{text}</div>
                            <div className="text-[10px] text-gray-500">{qtlTxt(l.qtyLeftKg)} left @ {fmtINR(l.ratePerQtl || 0)}</div>
                          </div>
                          <input type="number" inputMode="decimal" step="0.01" placeholder="Qtl" value={lotQty[l.key] || ''}
                            onChange={e => setLotQty(p => ({ ...p, [l.key]: e.target.value }))}
                            className={`w-20 rounded-md border px-2 py-1 text-sm text-right outline-none focus:border-forest-500 ${used > l.qtyLeftKg + 0.5 ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'}`} />
                        </div>
                      ) : (
                        <span key={l.key} className="text-[10px] leading-tight rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-900 px-2 py-1">
                          <b>{text}</b><br />{fmt2(l.qtyLeftKg / 100)} Qtl @ {fmtINR(l.ratePerQtl || 0)}
                        </span>
                      );
                    })}
                  </div>

                  {/* qty / sell */}
                  {sell === 'single' ? (
                    <div className="grid grid-cols-2 gap-2">
                      {mode === 'fifo' ? (
                        <Input label="Qty (Qtl)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={st.qty} onChange={e => patchRow(def.id, { qty: e.target.value })} />
                      ) : (
                        <div><L>Selected</L><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold">{qtlTxt(c.qtyKg)}</div></div>
                      )}
                      <Input label="Sell rate (₹/Qtl)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={st.rate} onChange={e => patchRow(def.id, { rate: e.target.value })} />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <L>Sell rows</L>
                      {st.splits.map((sp, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-400 w-4">#{i + 1}</span>
                          <input type="number" inputMode="decimal" step="0.01" placeholder="Qtl" value={sp.qty} onChange={e => patchSplit(def.id, i, { qty: e.target.value })}
                            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2 py-2 text-sm text-right outline-none focus:border-forest-500" />
                          <input type="number" inputMode="decimal" step="0.01" placeholder="₹/Qtl" value={sp.rate} onChange={e => patchSplit(def.id, i, { rate: e.target.value })}
                            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2 py-2 text-sm text-right outline-none focus:border-forest-500" />
                          {st.splits.length > 1 && (
                            <button onClick={() => patchRow(def.id, { splits: st.splits.filter((_, x) => x !== i) })} className="text-red-500 text-lg px-1" aria-label="Remove row">×</button>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center justify-between">
                        <button onClick={() => patchRow(def.id, { splits: [...st.splits, { qty: '', rate: '' }] })}
                          className="text-[11px] font-bold text-forest-700 border border-dashed border-forest-400 rounded-lg px-3 py-1">+ Row</button>
                        <span className={`text-[11px] font-bold rounded-lg px-2 py-1 ${
                          mode === 'manual' && c.qtyKg > 0 && Math.abs(c.splitKg - c.qtyKg) > 0.5 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                          {fmt2(c.splitKg / 100)} Qtl {mode === 'manual' ? `of ${fmt2(c.qtyKg / 100)} selected` : `of ${fmt2(def.availKg / 100)}`}
                        </span>
                      </div>
                    </div>
                  )}

                  {c.qtyKg > 0 && (
                    <div className="flex justify-between text-[11px] bg-gray-50 rounded-lg px-2.5 py-1.5">
                      <span>Qty <b>{qtlTxt(c.qtyKg)}</b></span>
                      <span>Amount <b className="text-emerald-700">{fmtINR(c.revenue)}</b></span>
                      <span>Buy <b className="text-red-600">{fmtINR(c.buyCost)}</b></span>
                    </div>
                  )}
                  {c.err && <div className="text-[11px] font-semibold text-red-600">⚠ {c.err}</div>}
                </div>
                </React.Fragment>
              );
            })}
          </div>
          <div className="flex justify-between text-xs px-1">
            <span>Total selected: <b>{qtlTxt(selectedKg)}</b></span>
            <span>Total revenue: <b className="text-emerald-700">{fmtINR(revenue)}</b></span>
          </div>
          {grossKg > 0 && remainingKg > 0.5 && <Hint tone="amber">{qtlTxt(remainingKg)} of the gross load is not allocated to any stock yet.</Hint>}
          {remainingKg < -0.5 && <Hint tone="red">Selected quantity is {qtlTxt(-remainingKg)} more than the gross load.</Hint>}
        </Step>

        {/* 7 weights */}
        <Step n={7} title="Weight deductions" tone="bg-[#f7f5ef]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Input label="Load Weight (Qtl)" type="number" inputMode="decimal" step="0.01" placeholder="0.00"
                value={loadOverride !== null ? loadOverride : (grossQtl || '')} onChange={e => setLoadOverride(e.target.value)} />
              <div className="text-[10px] text-emerald-700 mt-0.5">Auto-filled from Gross Load</div>
            </div>
            <div>
              <Input label="Empty Weight (Qtl)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={emptyQtl} onChange={e => setEmptyQtl(e.target.value)} />
              <div className="text-[10px] text-gray-500 mt-0.5">Weight of empty vehicle</div>
            </div>
            <div>
              <Input label="Net Weight (Qtl)" type="number" inputMode="decimal" step="0.01"
                value={netOverride !== null ? netOverride : String(round2(netWtKg / 100))} onChange={e => setNetOverride(e.target.value)} />
              <div className="text-[10px] text-gray-500 mt-0.5">Load − Empty (editable)
                {netOverride !== null && <button className="ml-1 text-forest-700 font-bold" onClick={() => setNetOverride(null)}>Recalc</button>}</div>
            </div>
            <div>
              <Input label="Total Bags" type="number" inputMode="numeric" placeholder="0" value={bags} onChange={e => setBags(e.target.value)} />
              <div className="text-[10px] text-gray-500 mt-0.5">Auto-filled from Load Details</div>
            </div>
            <Input label="Moisture Ded (Qtl)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={moistDed} onChange={e => setMoistDed(e.target.value)} />
            <Input label="Bag Weight Ded (Qtl)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={bagDed} onChange={e => setBagDed(e.target.value)} />
            <Input label="Other Weight Ded (Qtl)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={otherDed} onChange={e => setOtherDed(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center bg-white rounded-xl border border-gray-200 py-2">
            <div><div className="text-[9px] font-bold text-gray-400 uppercase">Gross</div><div className="text-sm font-extrabold">{qtlTxt(loadKg)}</div></div>
            <div><div className="text-[9px] font-bold text-gray-400 uppercase">Deductions</div><div className="text-sm font-extrabold text-amber-700">−{qtlTxt(Math.max(0, loadKg - netSaleKg))}</div></div>
            <div><div className="text-[9px] font-bold text-gray-400 uppercase">Final weight</div><div className="text-sm font-extrabold text-emerald-700">{qtlTxt(netSaleKg)}</div></div>
          </div>
          <Hint>The amount is calculated on the final weight after all deductions. The deduction is shared across the selected paddy in proportion to quantity; stock still reduces by the full quantity loaded.</Hint>
        </Step>

        {/* 8 transport */}
        <Step n={8} title="Transport & charges" tone="bg-[#f7f5ef]">
          <Hint tone="amber">ⓘ Transport ₹ = Gross Load × Rate/Qtl (not net qty)</Hint>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Transport Rate (₹/Qtl)" type="number" inputMode="decimal" step="0.01" value={tRate} onChange={e => setTRate(e.target.value)} />
            <Input label="Vehicle Charges (₹)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={vehCharge} onChange={e => setVehCharge(e.target.value)} />
            <Input label="Loading (₹)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={loadCharge} onChange={e => setLoadCharge(e.target.value)} />
            <Input label="Labour (₹)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={labCharge} onChange={e => setLabCharge(e.target.value)} />
            <Input label="Deductions (₹)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={dedRs} onChange={e => setDedRs(e.target.value)} />
            <Input label="Misc (₹)" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={miscRs} onChange={e => setMiscRs(e.target.value)} />
          </div>
          <div className="flex justify-between text-sm px-1">
            <span className="text-gray-600">Transport {fmtINR(transportAmt)} · Total expenses</span>
            <b className="text-red-600">{fmtINR(expenses)}</b>
          </div>
        </Step>

        {/* 9 P&L */}
        <Step n={9} title="Profit / loss summary">
          <div>
            <L>Buying price basis</L>
            <div className="flex gap-2">
              <button className={seg(buyBasis === 'actual')} onClick={() => setBuyBasis('actual')}>Actual lot price</button>
              <button className={seg(buyBasis === 'average')} onClick={() => setBuyBasis('average')}>Average price</button>
            </div>
            <div className="text-[11px] text-gray-500 mt-1">{buyBasis === 'actual' ? 'Each lot you take is costed at the rate you paid for that lot.' : 'Each row is costed at the average buying rate of its remaining stock.'}</div>
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Gross Load / taken from stock</span><b>{qtlTxt(grossKg)} / {qtlTxt(selectedKg)}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">Final weight billed (after deductions)</span><b>{qtlTxt(netSaleKg)}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">Selling amount</span><b className="text-emerald-700">{fmtINR(revenue)}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">Buying cost <span className="text-[10px] text-amber-700">({buyBasis === 'actual' ? 'actual lots' : 'average rate'})</span></span><b className="text-red-600">{fmtINR(buyCost)}</b></div>
            <div className="flex justify-between"><span className="text-gray-600">Your expenses (vehicle rent + others)</span><b className="text-red-600">{fmtINR(expenses)}</b></div>
          </div>
          <div className="flex justify-between items-center border-t border-gray-200 pt-2">
            <b className="text-sm">Net Profit / Loss</b>
            <b className={`text-xl ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{profit >= 0 ? '+' : '−'}{fmtINR(Math.abs(profit))}</b>
          </div>
          <div className="rounded-xl bg-[#f0f7f3] border border-[#cfe9da] px-3 py-2 flex justify-between items-center">
            <div><div className="text-sm font-extrabold text-[#0b3d2c]">Amount buyer pays</div><div className="text-[10px] text-gray-500">Full selling amount. Vehicle rent &amp; other expenses are paid by you.</div></div>
            <b className="text-lg text-[#0b3d2c]">{fmtINR(payable)}</b>
          </div>
        </Step>

        {/* 10 payment */}
        <Step n={10} title="Payment & remarks">
          <div className="grid grid-cols-2 gap-2">
            <Select label="Payment Mode" value={payMode} onChange={e => { setPayMode(e.target.value); setPayTouched(true); }}
              options={(modes.length ? modes : ['Cash']).map(m => ({ value: m, label: m }))} />
            <Select label="Payment Status" value={payStatus} onChange={e => { setPayStatus(e.target.value as PayStatus); setPayTouched(true); }}
              options={[{ value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' }, { value: 'unpaid', label: 'Unpaid' }]} />
          </div>
          {payStatus === 'partial' && (
            <Input label="Amount received (₹)" type="number" inputMode="decimal" step="0.01" value={partialAmt} onChange={e => { setPartialAmt(e.target.value); setPayTouched(true); }} />
          )}
          <Input label="Remarks" placeholder="e.g. moisture noted, 2nd quality batch" value={remarks} onChange={e => setRemarks(e.target.value)} />
        </Step>

        {error && <Hint tone="red">⚠ {error}</Hint>}

        <div ref={saveRef} className="grid grid-cols-[1fr_auto] gap-2">
          <Button className="w-full py-3" onClick={save}>🚚 {editing ? 'Update Dispatch' : 'Save Dispatch'}</Button>
          <Button variant="secondary" onClick={resetAll}>↺ Reset</Button>
        </div>
        <button onClick={() => setLegacyNew(true)} className="w-full text-[11px] font-bold text-gray-500 underline">
          Dispatch rice / bran / other product instead
        </button>
      </div>

      {/* ============ RECORDS ============ */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-[#0b3d2c]">Dispatch Records</h3>
          <Badge tone="gray">{records.length} found</Badge>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Vendor, vehicle, driver, number…"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-forest-500" />
        <div className="flex gap-2 flex-wrap items-center">
          <DateRangePresets value={range} onChange={p => setRange(p)} />
          <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} wrapperClassName="w-auto"
            options={[{ value: 'all', label: 'All Types' }, { value: 'small', label: 'Small Paddy' }, { value: 'big', label: 'Big Paddy' }, { value: 'other', label: 'Rice / bran / other' }]} />
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[11px] bg-gray-50 rounded-xl p-2">
          <div>Qty <b>{qtlTxt(totals.qty)}</b></div>
          <div>Revenue <b className="text-emerald-700">{fmtINR(totals.rev)}</b></div>
          <div>Buy <b className="text-red-600">{fmtINR(totals.buy)}</b></div>
          <div>Expenses <b className="text-red-600">{fmtINR(totals.exp)}</b></div>
          <div className="col-span-2">P&L <b className={totals.pl >= 0 ? 'text-emerald-700' : 'text-red-600'}>{totals.pl >= 0 ? '+' : '−'}{fmtINR(Math.abs(totals.pl))}</b></div>
        </div>

        {records.length === 0 && <EmptyState title="No dispatches found" />}
        <div className="space-y-2">
          {records.map(d => {
            const due = dispatchDue(d);
            const paid = sumPayments(d.payments);
            const st = paymentStatus(due, paid);
            const p = d.paddy;
            return (
              <div key={d.id} className="rounded-xl border border-gray-200 p-2.5 space-y-1.5">
                <div className="flex justify-between gap-2" onClick={() => setViewEntry(d)}>
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-gray-900 truncate">{d.dispatchNumber} · {partyName(db, d.partyId)}</div>
                    <div className="text-[11px] text-gray-500">{fmtDate(d.date)}{d.vehicleNumber ? ` · ${d.vehicleNumber}` : ''}{p?.driverName ? ` · ${p.driverName}` : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-extrabold">{fmtINR(due)}</div>
                    <div className="text-[10px] text-gray-500">{qtlTxt(d.netKg)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {p ? <Badge tone={p.size === 'small' ? 'gold' : 'green'}>{p.size === 'both' ? 'Small + Big' : p.size === 'big' ? 'Big' : 'Small'} paddy</Badge> : <Badge tone="gray">Other product</Badge>}
                  {p && <Badge tone="blue">{p.mode === 'fifo' ? 'FIFO' : 'Manual'}</Badge>}
                  {statusBadge(st)}
                  {p && <Badge tone={p.profit >= 0 ? 'green' : 'red'}>P/L {p.profit >= 0 ? '+' : '−'}{fmtINR(Math.abs(p.profit))}</Badge>}
                </div>
                {p && (
                  <div className="text-[10px] text-gray-500 truncate">
                    {p.rows.map(r => `${r.label} ${fmt2(r.qtyKg / 100)}`).join(' · ')}
                  </div>
                )}
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
      <Confirm open={!!delEntry} onClose={() => setDelEntry(null)} title="Delete dispatch?"
        message={`Delete ${delEntry?.dispatchNumber}? The paddy goes back into stock and its payments are removed from the cashbook.`} confirmText="Delete"
        onConfirm={() => { if (delEntry) { deleteDispatch(delEntry.id); if (editing?.id === delEntry.id) resetAll(); toast('Deleted — stock restored'); setDelEntry(null); } }} />
      {(legacy || legacyNew) && (
        <DispatchForm open initial={legacy} onClose={() => { setLegacy(null); setLegacyNew(false); }}
          onSave={data => {
            if (legacy) { updateDispatch(legacy.id, data); toast('Updated'); } else { addDispatch(data); toast('Saved'); }
            setLegacy(null); setLegacyNew(false);
          }} />
      )}
    </div>
  );
}
