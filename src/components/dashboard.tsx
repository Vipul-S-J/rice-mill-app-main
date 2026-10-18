import React, { useMemo, useRef, useState } from 'react';
import { useDB } from '../context';
import {
  fmtINR, fmtQtlKg, fmtNumber, fmtDate, today, localISO, computePartyLedger, bagSummary,
} from '../db';
import type { Database, StockAdjustment } from '../types';
import type { StockLedger } from '../db';
import { Button, Input, Select, Modal, Chips, QtyInput, toast } from './ui';
import { WheatIcon } from './Welcome';
import { varietyName } from './pages';

type Mode = 'day' | 'week' | 'month' | 'year' | 'custom';

const parseD = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

function periodRange(mode: Mode, anchor: string, from: string, to: string) {
  const a = parseD(anchor || today());
  if (mode === 'day') return { start: anchor, end: anchor, label: fmtDate(anchor) };
  if (mode === 'week') {
    const s = new Date(a); s.setDate(a.getDate() - ((a.getDay() + 6) % 7));
    const e = new Date(s); e.setDate(s.getDate() + 6);
    return { start: localISO(s), end: localISO(e), label: `${fmtDate(localISO(s))} – ${fmtDate(localISO(e))}` };
  }
  if (mode === 'month') {
    const s = new Date(a.getFullYear(), a.getMonth(), 1), e = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { start: localISO(s), end: localISO(e), label: a.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
  }
  if (mode === 'year') {
    return { start: `${a.getFullYear()}-01-01`, end: `${a.getFullYear()}-12-31`, label: String(a.getFullYear()) };
  }
  const s = from <= to ? from : to, e = from <= to ? to : from;
  return { start: s, end: e, label: `${fmtDate(s)} – ${fmtDate(e)}` };
}

// ---------------------------------------------------------------- small UI bits
function SectionTitle({ icon, title, right }: { icon?: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2 px-0.5">
      <h2 className="text-[15px] font-extrabold text-forest-900">{icon && <span className="mr-1">{icon}</span>}{title}</h2>
      {right}
    </div>
  );
}
function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase truncate">{label}</div>
      <div className={`text-[17px] font-extrabold truncate ${tone || 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
}
function StockCard({ icon, label, value, unit, tag, pct, tagTone, barColor, onClick }: {
  icon: string; label: string; value: string; unit: string; tag: string; pct: number; tagTone: string; barColor: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="bg-white rounded-2xl shadow-md border border-gray-100 p-3 text-left active:scale-[0.98] transition-transform min-w-0">
      <div className="flex items-start justify-between gap-1">
        <div className="w-9 h-9 rounded-xl bg-forest-50 flex items-center justify-center text-lg shrink-0">{icon}</div>
        <span className={`text-[9px] font-bold rounded-full px-2 py-0.5 truncate max-w-[100px] ${tagTone}`}>{tag}</span>
      </div>
      <div className="text-[11px] text-gray-500 mt-2">{label}</div>
      <div className="text-[19px] font-extrabold text-gray-900 leading-tight truncate">{value}</div>
      <div className="text-[10px] text-gray-400">{unit}</div>
      <div className="h-1.5 rounded-full bg-gray-100 mt-2 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: barColor }} />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------- Dashboard
export function Dashboard({ onNav }: { onNav: (id: string) => void }) {
  const { db, stock } = useDB();
  const [mode, setMode] = useState<Mode>('day');
  const [anchor, setAnchor] = useState(today());
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [showAdjust, setShowAdjust] = useState(false);
  const [showRecon, setShowRecon] = useState(false);
  const [paddyOpen, setPaddyOpen] = useState(false);
  const [riceFilter, setRiceFilter] = useState('all');
  const [calMonth, setCalMonth] = useState(today().slice(0, 7));
  const [selDate, setSelDate] = useState(today());

  const range = periodRange(mode, anchor, from, to);
  const inP = (d: string) => d >= range.start && d <= range.end;

  const S = useMemo(() => {
    const hull = db.hulling.filter(h => inP(h.date));
    const hullQty = hull.reduce((s, h) => s + h.quantityKg, 0);
    const hullAmt = hull.reduce((s, h) => s + h.finalTotal, 0);

    const pur = db.purchases.filter(p => inP(p.date));
    const purKg = pur.reduce((s, p) => s + p.netKg, 0);
    const purAmt = pur.reduce((s, p) => s + p.finalTotal, 0);
    const purBase = pur.reduce((s, p) => s + p.baseAmount, 0);

    const sellRows = [
      ...db.sales.map(s => ({ date: s.date, product: s.productId, kg: s.quantityKg, amt: s.finalTotal })),
      ...db.dispatches.map(d => ({ date: d.date, product: d.productId, kg: d.netKg, amt: d.finalTotal })),
    ].filter(r => inP(r.date));
    const prod = (pid: string) => {
      const rs = sellRows.filter(r => r.product === pid);
      const kg = rs.reduce((s, r) => s + r.kg, 0), amt = rs.reduce((s, r) => s + r.amt, 0);
      return { count: rs.length, kg, amt, avgKg: rs.length ? kg / rs.length : 0, avgRate: kg > 0 ? amt / (kg / 100) : 0 };
    };
    const totalSales = sellRows.reduce((s, r) => s + r.amt, 0);

    const expenses =
      db.expenses.filter(e => !e.isPersonal && inP(e.date)).reduce((s, e) => s + e.amount, 0) +
      db.labour.filter(l => inP(l.date)).reduce((s, l) => s + l.totalAmount, 0) +
      db.electricity.filter(e => inP(e.billDate)).reduce((s, e) => s + e.amount, 0);

    // dispatch P&L (recorded revenue & costs; buy cost is an estimate at average purchase cost)
    const avgCostKg = (vid?: string) => {
      let kg = 0, amt = 0;
      db.purchases.forEach(p => p.lines.forEach(l => { if (l.varietyId === vid) { kg += l.qtyKg; amt += l.amount; } }));
      return kg > 0 ? amt / kg : 0;
    };
    const disp = db.dispatches.filter(d => inP(d.date));
    const dispRev = disp.reduce((s, d) => s + d.finalTotal, 0);
    const dispCosts = disp.reduce((s, d) => s + d.totalCosts, 0);
    const dispBuy = disp.filter(d => d.productId === 'pr_paddy').reduce((s, d) => s + (d.paddy ? d.paddy.buyCost : d.netKg * avgCostKg(d.varietyId)), 0);
    const dispQty = disp.reduce((s, d) => s + d.netKg, 0);

    // outstanding
    let receivable = 0, payable = 0;
    for (const p of db.parties) {
      const { balance } = computePartyLedger(db, p.id);
      if (balance > 0.009) receivable += balance; else if (balance < -0.009) payable += -balance;
    }

    // bags
    let bagEntries = 0, bagsDue = 0, bagsDone = 0;
    for (const p of db.purchases) {
      const b = bagSummary(p.bagMovements);
      if (b.pending > 0) { bagEntries++; bagsDue += b.pending; } else if (b.received > 0) bagsDone++;
    }

    // overdue bills
    const t = today();
    const overdue = [
      ...db.expenses.filter(e => !e.isPersonal && e.dueDate && e.dueDate < t).map(e => e.amount - e.payments.reduce((s, p) => s + p.amount, 0)),
      ...db.electricity.filter(e => e.dueDate && e.dueDate < t).map(e => e.amount - e.payments.reduce((s, p) => s + p.amount, 0)),
    ].filter(x => x > 0.009);

    return {
      hullQty, hullAmt, hullCount: hull.length,
      purKg, purAmt, purBase, purCount: pur.length,
      rice: prod('pr_rice'), bran: prod('pr_bran'), totalSales, expenses,
      net: hullAmt + totalSales - purAmt - expenses,
      dispRev, dispCosts, dispBuy, dispQty, dispCount: disp.length,
      receivable, payable, bagEntries, bagsDue, bagsDone,
      overdueCount: overdue.length, overdueAmt: overdue.reduce((s, x) => s + x, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, range.start, range.end]);

  const totalPaddy = Object.values(stock.paddyByVariety).reduce((s, n) => s + n, 0);
  const totalRice = Object.values(stock.riceByVariety).reduce((s, n) => s + n, 0);
  const producedRice = db.production.reduce((s, b) => s + b.outputs.riceKg, 0);
  const producedBran = db.production.reduce((s, b) => s + b.outputs.branKg, 0);
  const producedHusk = db.production.reduce((s, b) => s + b.outputs.huskKg, 0);
  const pct = (cur: number, total: number) => (total > 0 ? (cur / total) * 100 : 0);

  const mins = db.settings.minStockQtl;
  const lowStock = [
    { label: 'Paddy', cur: totalPaddy, min: mins.paddy },
    { label: 'Rice', cur: totalRice, min: mins.rice },
    { label: 'Bran', cur: stock.branKg, min: mins.bran },
    { label: 'Husk', cur: stock.huskKg, min: mins.husk },
  ].filter(i => i.min > 0 && i.cur < i.min * 100);

  const alertCount = (S.receivable > 0 ? 1 : 0) + (S.payable > 0 ? 1 : 0) + lowStock.length + (S.bagsDue > 0 ? 1 : 0) + (S.overdueCount > 0 ? 1 : 0);

  const riceRows = Object.entries(stock.riceByVariety)
    .filter(([id, kg]) => kg > 0.01 && (riceFilter === 'all' || riceFilter === id))
    .sort((a, b) => b[1] - a[1]);
  const riceMax = Math.max(1, ...riceRows.map(r => r[1]));

  // usage breakdown for paddy
  const paddyAdj = db.stockAdjustments.filter(a => a.itemType === 'paddy').reduce((s, a) => s + (a.quantityKg || 0), 0);
  const paddyUsed = db.production.reduce((s, b) => s + b.paddyInputKg, 0);
  const paddyDisp = db.dispatches.filter(d => d.productId === 'pr_paddy').reduce((s, d) => s + d.netKg, 0);
  const paddySold = db.sales.filter(d => d.productId === 'pr_paddy').reduce((s, d) => s + d.quantityKg, 0);

  // calendar
  const cal = useMemo(() => {
    const map: Record<string, { purchase: number; hulling: number; sale: number; dispatch: number; labour: number }> = {};
    const bump = (d: string, k: 'purchase' | 'hulling' | 'sale' | 'dispatch' | 'labour') => {
      if (!d.startsWith(calMonth)) return;
      (map[d] = map[d] || { purchase: 0, hulling: 0, sale: 0, dispatch: 0, labour: 0 })[k]++;
    };
    db.purchases.forEach(p => bump(p.date, 'purchase'));
    db.hulling.forEach(h => bump(h.date, 'hulling'));
    db.sales.forEach(s => bump(s.date, 'sale'));
    db.dispatches.forEach(s => bump(s.date, 'dispatch'));
    db.labour.forEach(l => bump(l.date, 'labour'));
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(y, m, 0).getDate();
    return { map, lead, days, y, m, labourDays: Object.values(map).filter(v => v.labour > 0).length };
  }, [db, calMonth]);
  const shiftMonth = (n: number) => {
    const [y, m] = calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const dayInfo = useMemo(() => ({
    hulling: db.hulling.filter(h => h.date === selDate),
    purchases: db.purchases.filter(p => p.date === selDate),
    sales: db.sales.filter(s => s.date === selDate),
    dispatches: db.dispatches.filter(s => s.date === selDate),
    labour: db.labour.filter(l => l.date === selDate),
  }), [db, selDate]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const dispNet = S.dispRev - S.dispCosts - S.dispBuy;

  const quick = [
    { id: 'purchase', label: 'Paddy Purchase', icon: '🛒', bg: 'bg-forest-700' },
    { id: 'hulling', label: 'Hulling Entry', icon: '🌾', bg: 'bg-amber-700' },
    { id: 'sales', label: 'Sales', icon: '🚚', bg: 'bg-blue-600' },
    { id: 'dispatch', label: 'Paddy Dispatch', icon: '📦', bg: 'bg-purple-700' },
    { id: 'reports', label: 'Reports', icon: '📊', bg: 'bg-red-600' },
    { id: 'trading', label: 'Trading', icon: '🏪', bg: 'bg-orange-700' },
  ];

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="bg-gradient-to-b from-forest-700 to-forest-800 text-white px-4 pt-5 pb-16 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
            {db.settings.logo ? <img src={db.settings.logo} alt="" className="w-full h-full object-cover" /> : <WheatIcon className="w-8 h-8" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[15px] truncate">{db.settings.millName}</div>
            <div className="text-[11px] text-forest-200">Rice Mill Management</div>
          </div>
          <span className="text-[10px] font-semibold bg-white/10 border border-white/15 rounded-full px-2.5 py-1 shrink-0">● Offline-ready</span>
          <button onClick={() => onNav('settings')} aria-label="Settings" className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 text-sm shrink-0">✎</button>
        </div>
        <div className="mt-5 text-[26px] font-extrabold leading-none">{greeting}! 👋</div>
        <div className="text-xs text-forest-200 mt-1.5">Welcome back — let's grow your business.</div>
      </div>

      <div className="-mt-12 px-3 space-y-5">
        {/* Stock cards */}
        <div className="grid grid-cols-2 gap-2.5">
          <StockCard icon="🌾" label="Paddy in Stock" value={fmtQtlKg(totalPaddy)} unit="Quintal" tag={`Spent: ${fmtINR(stock.paddySpent)}`}
            tagTone="bg-amber-50 text-amber-800" pct={pct(totalPaddy, stock.paddyPurchasedKg)} barColor="#d4a043" onClick={() => onNav('stock')} />
          <StockCard icon="🍚" label="Rice in Stock" value={fmtQtlKg(totalRice)} unit="Quintal" tag="In Mill"
            tagTone="bg-green-50 text-green-700" pct={pct(totalRice, producedRice)} barColor="#3a8a64" onClick={() => onNav('stock')} />
          <StockCard icon="🟤" label="Bran Stock" value={fmtQtlKg(stock.branKg)} unit="Quintal" tag="Bran"
            tagTone="bg-orange-50 text-orange-700" pct={pct(stock.branKg, producedBran)} barColor="#c2733a" onClick={() => onNav('stock')} />
          <StockCard icon="🏭" label="Husk Stock" value={fmtQtlKg(stock.huskKg)} unit="Quintal" tag="Husk"
            tagTone="bg-stone-100 text-stone-700" pct={pct(stock.huskKg, producedHusk)} barColor="#8d8573" onClick={() => onNav('stock')} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setShowAdjust(true)} className="bg-white border border-forest-200 rounded-xl py-2.5 text-xs font-bold text-forest-800 active:scale-95 shadow-sm">⚙ Adjust</button>
          <button onClick={() => setShowRecon(true)} className="bg-white border border-forest-200 rounded-xl py-2.5 text-xs font-bold text-forest-800 active:scale-95 shadow-sm">⟳ Reconcile</button>
          <button onClick={() => onNav('production')} className="bg-white border border-forest-200 rounded-xl py-2.5 text-xs font-bold text-forest-800 active:scale-95 shadow-sm">🏭 Prod</button>
        </div>

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-forest-700 to-forest-500 text-white p-4">
          <div className="text-lg font-extrabold leading-tight">Manage Smarter,<br />Grow Better</div>
          <div className="text-[11px] text-forest-100 mt-1.5 max-w-[210px]">Track every grain, every bag, every transaction with ease.</div>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-white/10 flex items-center justify-center"><WheatIcon className="w-10 h-10" /></div>
        </div>

        {/* Quick actions */}
        <div>
          <SectionTitle title="Quick Actions" />
          <div className="grid grid-cols-6 gap-1.5">
            {quick.map(q => (
              <button key={q.id} onClick={() => onNav(q.id)} className="flex flex-col items-center gap-1 active:scale-95 transition-transform">
                <span className={`w-12 h-12 rounded-2xl ${q.bg} text-white text-xl flex items-center justify-center shadow-sm`}>{q.icon}</span>
                <span className="text-[9px] font-semibold text-gray-700 text-center leading-tight">{q.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Performance */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold text-forest-900">📊 Performance</h2>
            <span className="text-[10px] font-semibold bg-forest-50 text-forest-700 rounded-full px-2 py-0.5">{fmtDate(range.start)}{range.end !== range.start ? '…' : ''}</span>
          </div>
          <div className="grid grid-cols-5 gap-1 bg-gray-100 rounded-xl p-1">
            {(['day', 'week', 'month', 'year', 'custom'] as Mode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`py-1.5 rounded-lg text-[11px] font-semibold capitalize ${mode === m ? 'bg-white text-forest-800 shadow-sm' : 'text-gray-500'}`}>{m}</button>
            ))}
          </div>
          {mode === 'custom' ? (
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" label="From" value={from} onChange={e => setFrom(e.target.value)} />
              <Input type="date" label="To" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          ) : (
            <Input type="date" value={anchor} onChange={e => setAnchor(e.target.value || today())} />
          )}
          <div className="text-[11px] text-gray-500 -mt-1">Showing: <b className="text-gray-700">{range.label}</b></div>
          <div className="grid grid-cols-2 divide-x divide-gray-100 border border-gray-100 rounded-xl">
            <button className="p-3 text-left" onClick={() => onNav('hulling')}><Metric label="Hulling Income" value={fmtINR(S.hullAmt)} sub={`Vol: ${fmtQtlKg(S.hullQty)}`} tone="text-forest-700" /></button>
            <button className="p-3 text-left" onClick={() => onNav('sales')}><Metric label="Total Sales" value={fmtINR(S.totalSales)} sub="Revenue" /></button>
          </div>
          <div className="grid grid-cols-2 divide-x divide-gray-100 border border-gray-100 rounded-xl">
            <button className="p-3 text-left" onClick={() => onNav('expenses')}><Metric label="Expenses" value={fmtINR(S.expenses)} sub="Expenses + wages + power" tone="text-red-600" /></button>
            <div className="p-3"><Metric label="Net (est.)" value={fmtINR(S.net)} sub="Income − purchases − expenses" tone={S.net >= 0 ? 'text-forest-700' : 'text-red-600'} /></div>
          </div>
        </div>

        {/* Module breakdown cards */}
        <div className="space-y-2.5">
          <button onClick={() => onNav('hulling')} className="w-full text-left rounded-2xl border border-rose-100 bg-rose-50/60 p-3">
            <div className="text-xs font-extrabold text-rose-900 mb-2">🏭 HULLING</div>
            <div className="grid grid-cols-4 gap-2">
              <Metric label="Total Qty" value={fmtQtlKg(S.hullQty)} />
              <Metric label="Total Amt" value={fmtINR(S.hullAmt)} tone="text-forest-700" />
              <Metric label="Avg Qty" value={S.hullCount ? fmtQtlKg(S.hullQty / S.hullCount) : '0'} />
              <Metric label="Avg Amt" value={S.hullCount ? fmtINR(S.hullAmt / S.hullCount, { decimals: 0 }) : '₹0'} />
            </div>
          </button>
          <button onClick={() => onNav('purchase')} className="w-full text-left rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
            <div className="text-xs font-extrabold text-amber-900 mb-2">🌾 PADDY PURCHASE</div>
            <div className="grid grid-cols-4 gap-2">
              <Metric label="Total Qty" value={fmtQtlKg(S.purKg)} />
              <Metric label="Total Amt" value={fmtINR(S.purAmt)} tone="text-forest-700" />
              <Metric label="Avg Qty" value={S.purCount ? fmtQtlKg(S.purKg / S.purCount) : '0'} />
              <Metric label="Avg Rate" value={S.purKg > 0 ? `${fmtINR(S.purBase / (S.purKg / 100))}/Qtl` : '₹0/Qtl'} />
            </div>
          </button>
          <button onClick={() => onNav('sales')} className="w-full text-left rounded-2xl border border-sky-100 bg-sky-50/60 p-3">
            <div className="text-xs font-extrabold text-sky-900 mb-2">🍚 RICE SALES</div>
            <div className="grid grid-cols-4 gap-2">
              <Metric label="Sold Qty" value={fmtQtlKg(S.rice.kg)} />
              <Metric label="Total Amt" value={fmtINR(S.rice.amt)} tone="text-forest-700" />
              <Metric label="Avg Qty" value={S.rice.count ? fmtQtlKg(S.rice.avgKg) : '0'} />
              <Metric label="Avg Rate" value={`${fmtINR(S.rice.avgRate)}/Qtl`} />
            </div>
          </button>
          <button onClick={() => onNav('sales')} className="w-full text-left rounded-2xl border border-orange-100 bg-orange-50/60 p-3">
            <div className="text-xs font-extrabold text-orange-900 mb-2">🟫 BRAN SALES</div>
            <div className="grid grid-cols-4 gap-2">
              <Metric label="Sold Qty" value={fmtQtlKg(S.bran.kg)} />
              <Metric label="Total Amt" value={fmtINR(S.bran.amt)} tone="text-forest-700" />
              <Metric label="Avg Qty" value={S.bran.count ? fmtQtlKg(S.bran.avgKg) : '0'} />
              <Metric label="Avg Rate" value={`${fmtINR(S.bran.avgRate)}/Qtl`} />
            </div>
          </button>
        </div>

        {/* Pending actions */}
        <div>
          <SectionTitle title="Pending Actions" right={alertCount > 0 ? <span className="text-[10px] font-bold bg-red-50 text-red-600 rounded-full px-2.5 py-1">{alertCount} Alert{alertCount > 1 ? 's' : ''}</span> : <span className="text-[10px] font-bold bg-green-50 text-green-700 rounded-full px-2.5 py-1">All clear</span>} />
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
            <button onClick={() => onNav('outstanding')} className="w-full flex items-center gap-3 p-3 text-left">
              <span className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-lg">🙋</span>
              <div className="flex-1 min-w-0"><div className="text-sm font-bold">Party Dues Receivable</div><div className="text-[11px] text-gray-500">Pending dues from customers</div></div>
              <b className="text-rose-600 text-sm">{fmtINR(S.receivable)}</b>
            </button>
            <button onClick={() => onNav('outstanding')} className="w-full flex items-center gap-3 p-3 text-left">
              <span className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center text-lg">🚜</span>
              <div className="flex-1 min-w-0"><div className="text-sm font-bold">Payments Payable</div><div className="text-[11px] text-gray-500">Pending payouts to parties</div></div>
              <b className="text-gray-800 text-sm">{fmtINR(S.payable)}</b>
            </button>
            {lowStock.map(i => (
              <button key={i.label} onClick={() => onNav('stock')} className="w-full flex items-center gap-3 p-3 text-left">
                <span className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-lg">📉</span>
                <div className="flex-1 min-w-0"><div className="text-sm font-bold">Low Stock: {i.label}</div><div className="text-[11px] text-gray-500">Current: {fmtQtlKg(i.cur)} | Min: {i.min} Qtl</div></div>
                <b className="text-red-600 text-xs">Below Min</b>
              </button>
            ))}
            {S.bagsDue > 0 && (
              <button onClick={() => onNav('bags')} className="w-full flex items-center gap-3 p-3 text-left">
                <span className="w-10 h-10 rounded-xl bg-yellow-50 flex items-center justify-center text-lg">👜</span>
                <div className="flex-1 min-w-0"><div className="text-sm font-bold">Bags pending return</div><div className="text-[11px] text-gray-500">{S.bagEntries} purchase(s) waiting</div></div>
                <b className="text-yellow-700 text-sm">{fmtNumber(S.bagsDue, 0)} bags</b>
              </button>
            )}
            {S.overdueCount > 0 && (
              <button onClick={() => onNav('expenses')} className="w-full flex items-center gap-3 p-3 text-left">
                <span className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-lg">⏰</span>
                <div className="flex-1 min-w-0"><div className="text-sm font-bold">Overdue bills</div><div className="text-[11px] text-gray-500">{S.overdueCount} expense / electricity bill(s)</div></div>
                <b className="text-red-600 text-sm">{fmtINR(S.overdueAmt)}</b>
              </button>
            )}
          </div>
        </div>

        {/* Paddy stock */}
        <div>
          <SectionTitle icon="🌾" title="Paddy Stock" right={<button onClick={() => onNav('dispatch')} className="text-xs font-bold text-forest-700">Dispatch →</button>} />
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button onClick={() => setPaddyOpen(o => !o)} className="w-full flex items-center gap-3 p-3 text-left">
              <span className="w-10 h-10 rounded-xl bg-forest-50 flex items-center justify-center text-lg">🌱</span>
              <div className="flex-1"><div className="text-sm font-bold">Paddy Stock Summary</div><div className="text-[11px] text-gray-500">Tap to see usage breakdown</div></div>
              <span className={`text-gray-400 transition-transform ${paddyOpen ? 'rotate-180' : ''}`}>⌄</span>
            </button>
            <div className="grid grid-cols-3 gap-2 px-3 pb-3 border-t border-gray-100 pt-3">
              <Metric label="Total" value={fmtQtlKg(totalPaddy)} sub={`Spent: ${fmtINR(stock.paddySpent)}`} />
              <Metric label="🌾 Small" value={fmtQtlKg(stock.paddyBySize.small)} sub={`Dispatched: ${fmtQtlKg(stock.paddyDispatchedBySize.small)}`} />
              <Metric label="🌱 Big" value={fmtQtlKg(stock.paddyBySize.big)} sub={`Dispatched: ${fmtQtlKg(stock.paddyDispatchedBySize.big)}`} />
            </div>
            {paddyOpen && (
              <div className="border-t border-gray-100 px-3 py-3 text-xs space-y-1 bg-gray-50/60">
                <div className="flex justify-between"><span>Purchased (all lines)</span><b>{fmtQtlKg(stock.paddyPurchasedKg)}</b></div>
                <div className="flex justify-between"><span>Adjustments</span><b>{fmtQtlKg(paddyAdj)}</b></div>
                <div className="flex justify-between"><span>Used in production</span><b className="text-red-600">− {fmtQtlKg(paddyUsed)}</b></div>
                <div className="flex justify-between"><span>Dispatched as paddy</span><b className="text-red-600">− {fmtQtlKg(paddyDisp)}</b></div>
                <div className="flex justify-between"><span>Sold as paddy</span><b className="text-red-600">− {fmtQtlKg(paddySold)}</b></div>
                <div className="flex justify-between border-t border-gray-200 pt-1 mt-1"><span className="font-bold">Closing stock</span><b className="text-forest-700">{fmtQtlKg(totalPaddy)}</b></div>
                {stock.paddyBySize.other !== 0 && <div className="flex justify-between text-gray-500"><span>Other / unmapped size</span><span>{fmtQtlKg(stock.paddyBySize.other)}</span></div>}
              </div>
            )}
          </div>
        </div>

        {/* Bag returns */}
        <div>
          <SectionTitle icon="👜" title="Bag Returns" />
          <button onClick={() => onNav('bags')} className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 p-3 bg-amber-50/60">
              <span className="w-9 h-9 rounded-lg bg-white border border-amber-100 flex items-center justify-center">🗂</span>
              <b className="flex-1 text-sm text-amber-900">Pending Bag Returns</b><span className="text-gray-400">›</span>
            </div>
            <div className="grid grid-cols-3 gap-2 p-3">
              <Metric label="Entries" value={String(S.bagEntries)} sub="pending bags" />
              <Metric label="Bags Due" value={fmtNumber(S.bagsDue, 0)} sub="not returned" tone={S.bagsDue > 0 ? 'text-amber-700' : undefined} />
              <Metric label="Done" value={String(S.bagsDone)} sub="fully returned" tone="text-green-700" />
            </div>
          </button>
        </div>

        {/* Dispatch P&L */}
        <div>
          <SectionTitle icon="🚛" title="Dispatch P&L" right={<span className="text-[10px] font-bold bg-gray-100 text-gray-600 rounded-full px-2.5 py-1">{S.dispCount} dispatch{S.dispCount === 1 ? '' : 'es'}</span>} />
          <button onClick={() => onNav('dispatch')} className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="grid grid-cols-2 divide-x divide-gray-100 p-3">
              <Metric label="Total Revenue" value={fmtINR(S.dispRev)} sub={`Costs recorded: ${fmtINR(S.dispCosts)}`} />
              <div className="pl-3"><Metric label="Net Profit / Loss (est.)" value={`${dispNet >= 0 ? '+' : ''}${fmtINR(dispNet)}`} tone={dispNet >= 0 ? 'text-forest-700' : 'text-red-600'}
                sub={`Buy cost (est.): ${fmtINR(S.dispBuy)}`} /></div>
            </div>
            <div className="px-3 pb-3 text-[10px] text-gray-400">Qty: {fmtQtlKg(S.dispQty)} · Buy cost is estimated at your average paddy purchase cost and only for paddy dispatches.</div>
          </button>
        </div>

        {/* Rice by variety */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-extrabold text-forest-900">🍚 Rice by Variety</h2>
            <div className="w-32">
              <Select value={riceFilter} onChange={e => setRiceFilter(e.target.value)}
                options={[{ value: 'all', label: 'All' }, ...db.varieties.filter(v => v.active).map(v => ({ value: v.id, label: v.name }))]} />
            </div>
          </div>
          {riceRows.length === 0 ? <div className="text-xs text-gray-400 text-center py-4">No rice stock yet — record a production batch.</div> : riceRows.map(([id, kg]) => (
            <div key={id} className="flex items-center gap-2">
              <div className="w-16 text-[11px] font-extrabold text-gray-700 truncate uppercase">{varietyName(db, id)}</div>
              <div className="flex-1 h-5 bg-gray-100 rounded-md overflow-hidden">
                <div className="h-full rounded-md bg-amber-700 text-white text-[10px] font-semibold flex items-center px-1.5 whitespace-nowrap" style={{ width: `${Math.max(18, (kg / riceMax) * 100)}%` }}>{fmtQtlKg(kg)}</div>
              </div>
              <div className="w-20 text-right text-[11px] font-bold text-gray-800">{fmtQtlKg(kg)}</div>
            </div>
          ))}
        </div>

        {/* Calendar */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold text-forest-900">📅 Activity Calendar</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => shiftMonth(-1)} className="w-7 h-7 rounded-lg border border-gray-200 text-gray-600">‹</button>
              <span className="text-xs font-bold w-28 text-center">{new Date(cal.y, cal.m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span>
              <button onClick={() => shiftMonth(1)} className="w-7 h-7 rounded-lg border border-gray-200 text-gray-600">›</button>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap text-[10px] text-gray-600">
            <span><i className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />Purchase</span>
            <span><i className="inline-block w-2 h-2 rounded-full bg-green-600 mr-1" />Sale</span>
            <span><i className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />Dispatch</span>
            <span><i className="inline-block w-2 h-2 rounded-full bg-amber-900 mr-1" />Hulling</span>
            <span><i className="inline-block w-2 h-2 rounded-full bg-violet-600 mr-1" />Labour</span>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <div key={d} className="text-[10px] font-bold text-gray-400 py-1">{d}</div>)}
            {Array.from({ length: cal.lead }).map((_, i) => <div key={'b' + i} />)}
            {Array.from({ length: cal.days }).map((_, i) => {
              const day = i + 1;
              const ds = `${calMonth}-${String(day).padStart(2, '0')}`;
              const info = cal.map[ds];
              const isToday = ds === today();
              const isSel = ds === selDate;
              return (
                <button key={ds} onClick={() => setSelDate(ds)} className="flex flex-col items-center py-1">
                  <span className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-semibold ${isSel ? 'bg-forest-800 text-white' : isToday ? 'bg-forest-100 text-forest-800 ring-1 ring-forest-300' : 'text-gray-700'}`}>{day}</span>
                  <span className="flex gap-0.5 h-1.5 mt-0.5">
                    {info?.purchase ? <i className="w-1.5 h-1.5 rounded-full bg-amber-500" /> : null}
                    {info?.sale ? <i className="w-1.5 h-1.5 rounded-full bg-green-600" /> : null}
                    {info?.dispatch ? <i className="w-1.5 h-1.5 rounded-full bg-sky-500" /> : null}
                    {info?.hulling ? <i className="w-1.5 h-1.5 rounded-full bg-amber-900" /> : null}
                    {info?.labour ? <i className="w-1.5 h-1.5 rounded-full bg-violet-600" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-1.5 text-xs">
            <div className="font-bold text-gray-800">{fmtDate(selDate)}</div>
            {dayInfo.hulling.length + dayInfo.purchases.length + dayInfo.sales.length + dayInfo.dispatches.length + dayInfo.labour.length === 0 && <div className="text-gray-400">No activity recorded on this day.</div>}
            {dayInfo.hulling.length > 0 && <button onClick={() => onNav('hulling')} className="w-full flex justify-between text-left"><span>🏭 Hulling × {dayInfo.hulling.length}</span><b>{fmtQtlKg(dayInfo.hulling.reduce((s, h) => s + h.quantityKg, 0))} · {fmtINR(dayInfo.hulling.reduce((s, h) => s + h.finalTotal, 0))}</b></button>}
            {dayInfo.purchases.length > 0 && <button onClick={() => onNav('purchase')} className="w-full flex justify-between text-left"><span>🌾 Purchase × {dayInfo.purchases.length}</span><b>{fmtQtlKg(dayInfo.purchases.reduce((s, p) => s + p.netKg, 0))} · {fmtINR(dayInfo.purchases.reduce((s, p) => s + p.finalTotal, 0))}</b></button>}
            {dayInfo.sales.length > 0 && <button onClick={() => onNav('sales')} className="w-full flex justify-between text-left"><span><i className="inline-block w-2 h-2 rounded-full bg-green-600 mr-1" />💰 Sales × {dayInfo.sales.length}</span><b>{fmtINR(dayInfo.sales.reduce((s, x) => s + x.finalTotal, 0))}</b></button>}
            {dayInfo.dispatches.length > 0 && <button onClick={() => onNav('dispatch')} className="w-full flex justify-between text-left"><span><i className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />🚚 Dispatch × {dayInfo.dispatches.length}</span><b>{fmtINR(dayInfo.dispatches.reduce((s, x) => s + x.finalTotal, 0))}</b></button>}
            {dayInfo.labour.length > 0 && <button onClick={() => onNav('labour')} className="w-full flex justify-between text-left"><span>👷 Labour × {dayInfo.labour.length}</span><b>{fmtINR(dayInfo.labour.reduce((s, l) => s + l.totalAmount, 0))}</b></button>}
          </div>
          <div className="text-[11px] text-gray-500 font-semibold">Labour: {cal.labourDays}d this month</div>
        </div>

        {/* Recent activity */}
        <div>
          <SectionTitle title="Recent Activity" />
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
            {db.auditLog.length === 0 ? (
              <div className="p-5 text-center text-xs text-gray-400">No activity yet. Start with a Paddy Purchase or Hulling entry.</div>
            ) : db.auditLog.slice(0, 6).map(l => (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-8 h-8 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center text-xs font-bold">{l.module[0]}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-gray-800 truncate">{l.description}</div>
                  <div className="text-[10px] text-gray-400">{l.module} · {new Date(l.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer banner */}
        <div className="rounded-2xl bg-gradient-to-r from-forest-800 to-forest-600 text-white p-4 relative overflow-hidden">
          <div className="text-[9px] font-bold tracking-[0.25em] text-forest-200">QUALITY IS OUR PROMISE</div>
          <div className="text-lg font-extrabold mt-1">{db.settings.millName}</div>
          <div className="text-[11px] text-forest-100">Pure Rice · Healthy Life</div>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-30"><WheatIcon className="w-14 h-14" /></div>
        </div>
      </div>

      <AdjustModal open={showAdjust} onClose={() => setShowAdjust(false)} />
      <ReconcileModal open={showRecon} onClose={() => setShowRecon(false)} db={db} stock={stock} />
    </div>
  );
}

// ---------------------------------------------------------------- Stock adjustment
type AdjType = StockAdjustment['itemType'];
const ADJ_ITEMS: { value: AdjType; label: string }[] = [
  { value: 'paddy', label: 'Paddy' }, { value: 'rice', label: 'Rice' }, { value: 'broken', label: 'Broken rice' },
  { value: 'bran', label: 'Bran' }, { value: 'husk', label: 'Husk' }, { value: 'new-bags', label: 'New bags' },
  { value: 'old-bags', label: 'Old / reusable bags' },
  { value: 'rice-bag-25', label: 'Rice packing bags — 25 kg' }, { value: 'rice-bag-10', label: 'Rice packing bags — 10 kg' },
  { value: 'other', label: 'Other by-product' },
];

function AdjustModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, stock, addStockAdjustment } = useDB();
  const saving = useRef(false);
  const [type, setType] = useState<AdjType>('paddy');
  const [varietyId, setVarietyId] = useState('');
  const [dir, setDir] = useState<'add' | 'remove'>('add');
  const [kg, setKg] = useState(0);
  const [bags, setBags] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today());
  const isBag = type === 'new-bags' || type === 'old-bags' || type === 'rice-bag-25' || type === 'rice-bag-10';
  const needsVariety = type === 'paddy' || type === 'rice';

  React.useEffect(() => {
    if (!open) return;
    saving.current = false;
    setType('paddy'); setVarietyId(db.varieties.find(v => v.active)?.id || ''); setDir('add');
    setKg(0); setBags(''); setCost(''); setReason(''); setDate(today());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const current =
    type === 'paddy' ? (stock.paddyByVariety[varietyId] || 0) : type === 'rice' ? (stock.riceByVariety[varietyId] || 0)
    : type === 'broken' ? stock.brokenKg : type === 'bran' ? stock.branKg : type === 'husk' ? stock.huskKg
    : type === 'new-bags' ? stock.newBags : type === 'old-bags' ? stock.oldBags
    : type === 'rice-bag-25' ? stock.riceBags25 : type === 'rice-bag-10' ? stock.riceBags10 : stock.otherByProductKg;
  const sign = dir === 'add' ? 1 : -1;
  const delta = isBag ? sign * (Number(bags) || 0) : sign * kg;
  const after = current + delta;
  const fmtCur = (v: number) => (isBag ? `${fmtNumber(v, 0)} bags` : fmtQtlKg(v));

  const save = () => {
    if (saving.current) return;
    if (needsVariety && !varietyId) { toast('Choose a variety', 'error'); return; }
    if (delta === 0) { toast('Enter a quantity to adjust', 'error'); return; }
    if (!reason.trim()) { toast('A reason is required for every adjustment', 'error'); return; }
    saving.current = true;
    addStockAdjustment({
      date, itemType: type, varietyId: needsVariety ? varietyId : undefined,
      quantityKg: isBag ? undefined : delta, quantityBags: isBag ? delta : undefined,
      unitCost: type === 'new-bags' && dir === 'add' && Number(cost) > 0 ? Number(cost) : undefined,
      reason: reason.trim(),
    });
    toast('Stock adjusted'); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="⚙ Stock Adjustment" maxWidth="max-w-sm" footer={
      <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Adjustment</Button></>
    }>
      <div className="space-y-3">
        <Select label="Item" value={type} onChange={e => setType(e.target.value as AdjType)} options={ADJ_ITEMS} />
        {needsVariety && (
          <Select label="Variety" value={varietyId} onChange={e => setVarietyId(e.target.value)}
            options={db.varieties.filter(v => v.active).map(v => ({ value: v.id, label: v.name }))} />
        )}
        <Chips value={dir} onChange={v => setDir(v as any)} options={[{ value: 'add', label: '＋ Add stock' }, { value: 'remove', label: '− Remove stock' }]} />
        {isBag
          ? <Input label="Number of bags" type="number" inputMode="numeric" value={bags} onChange={e => setBags(e.target.value)} />
          : <QtyInput label="Quantity (Qtl + Kg)" valueKg={kg} onChange={setKg} />}
        {type === 'new-bags' && dir === 'add' && (
          <Input label="Cost per bag (₹) — used for average bag cost" type="number" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} />
        )}
        <Input label="Reason *" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Opening stock, new bags purchased, spoilage" />
        <Input type="date" label="Date" value={date} onChange={e => setDate(e.target.value)} />
        <div className={`rounded-lg p-2.5 text-xs border ${after < 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-forest-50 border-forest-100 text-forest-800'}`}>
          Current <b>{fmtCur(current)}</b> → after <b>{fmtCur(after)}</b>
          {after < 0 && <div className="font-semibold mt-0.5">⚠ This will make stock negative.</div>}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Reconcile
function ReconcileModal({ open, onClose, db, stock }: { open: boolean; onClose: () => void; db: Database; stock: StockLedger }) {
  const adj = (t: AdjType) => db.stockAdjustments.filter(a => a.itemType === t);
  const adjKg = (t: AdjType) => adj(t).reduce((s, a) => s + (a.quantityKg || 0), 0);
  const adjBags = (t: AdjType) => adj(t).reduce((s, a) => s + (a.quantityBags || 0), 0);
  const sold = (pid: string) =>
    db.dispatches.filter(d => d.productId === pid).reduce((s, d) => s + d.netKg, 0) +
    db.sales.filter(d => d.productId === pid).reduce((s, d) => s + d.quantityKg, 0);
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const bm = db.purchases.flatMap(p => p.bagMovements);

  const rows: { name: string; inn: number; adj: number; out: number; live: number; bag?: boolean }[] = [
    { name: 'Paddy', inn: stock.paddyPurchasedKg, adj: adjKg('paddy'), out: sum(db.production.map(b => b.paddyInputKg)) + sold('pr_paddy'), live: sum(Object.values(stock.paddyByVariety)) },
    { name: 'Rice', inn: sum(db.production.map(b => b.outputs.riceKg)), adj: adjKg('rice'), out: sold('pr_rice'), live: sum(Object.values(stock.riceByVariety)) },
    { name: 'Broken rice', inn: sum(db.production.map(b => b.outputs.brokenRiceKg)), adj: adjKg('broken'), out: sold('pr_broken'), live: stock.brokenKg },
    { name: 'Bran', inn: sum(db.production.map(b => b.outputs.branKg)), adj: adjKg('bran'), out: sold('pr_bran'), live: stock.branKg },
    { name: 'Husk', inn: sum(db.production.map(b => b.outputs.huskKg)), adj: adjKg('husk'), out: sold('pr_husk'), live: stock.huskKg },
    { name: 'New bags', bag: true, inn: 0, adj: adjBags('new-bags'), out: sum(bm.map(m => (m.newBagsIssued || 0) + (m.newBagsReturned || 0))), live: stock.newBags },
    { name: 'Old bags', bag: true, inn: sum(bm.map(m => (m.bagsReceived || 0) + (m.bagsReturned || 0))), adj: adjBags('old-bags'), out: sum(bm.map(m => (m.oldBagsIssued || 0) + (m.oldBagsReturned || 0))), live: stock.oldBags },
    { name: 'Rice bags 25 kg', bag: true, inn: 0, adj: adjBags('rice-bag-25'), out: sum(db.sales.flatMap(s => (s.lines || []).map(l => l.bags25 || 0))), live: stock.riceBags25 },
    { name: 'Rice bags 10 kg', bag: true, inn: 0, adj: adjBags('rice-bag-10'), out: sum(db.sales.flatMap(s => (s.lines || []).map(l => l.bags10 || 0))), live: stock.riceBags10 },
  ];
  const f = (v: number, bag?: boolean) => (bag ? fmtNumber(v, 0) : fmtQtlKg(v));

  return (
    <Modal open={open} onClose={onClose} title="⟳ Stock Reconciliation" maxWidth="max-w-xl" footer={<Button onClick={onClose}>Close</Button>}>
      <p className="text-xs text-gray-600 mb-3">Stock is always calculated live from your purchases, production, sales, dispatches and adjustments. This table shows exactly how each closing balance is made up.</p>
      <div className="space-y-2">
        {rows.map(r => {
          const calc = r.inn + r.adj - r.out;
          const ok = Math.abs(calc - r.live) < 0.01;
          return (
            <div key={r.name} className={`rounded-xl border p-3 text-xs ${r.live < -0.01 ? 'border-red-300 bg-red-50/40' : 'border-gray-200 bg-white'}`}>
              <div className="flex justify-between items-center mb-1">
                <b className="text-sm">{r.name}</b>
                <b className={r.live < -0.01 ? 'text-red-600' : 'text-forest-700'}>{f(r.live, r.bag)}</b>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[11px] text-gray-600">
                <div>{r.bag ? 'Returned in' : 'Received / produced'}<div className="font-bold text-gray-800">{f(r.inn, r.bag)}</div></div>
                <div>Adjustments<div className="font-bold text-gray-800">{f(r.adj, r.bag)}</div></div>
                <div>{r.bag ? 'Issued out' : 'Used / sold'}<div className="font-bold text-gray-800">{f(r.out, r.bag)}</div></div>
              </div>
              <div className={`mt-1 text-[10px] font-semibold ${ok ? 'text-green-700' : 'text-red-600'}`}>{ok ? '✓ Matches live stock' : `⚠ Difference ${f(calc - r.live, r.bag)}`}</div>
              {r.live < -0.01 && <div className="text-[10px] text-red-600 font-semibold">Negative stock — check entries or add an adjustment with a reason.</div>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
