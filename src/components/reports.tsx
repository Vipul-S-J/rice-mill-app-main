import React, { useMemo, useState } from 'react';
import { cn } from '../utils/cn';
import { useDB } from '../context';
import { fmtINR, fmtNumber, fmtDate, fmtTradeQty, today, inRange } from '../db';
import { Card, KPICard, Input, Select, Tabs } from './ui';
import { ReportsOverview, partyName } from './pages';
import { tripOf } from './vehicle';

// ============ date range ============
type Range = { start: string; end: string };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PRESETS: { id: string; label: string; get: () => Range }[] = [
  { id: 'today', label: 'Today', get: () => ({ start: today(), end: today() }) },
  { id: '7d', label: '7 Days', get: () => { const d = new Date(); d.setDate(d.getDate() - 6); return { start: iso(d), end: today() }; } },
  { id: 'month', label: 'This Month', get: () => { const n = new Date(); return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: today() }; } },
  { id: 'lastmonth', label: 'Last Month', get: () => { const n = new Date(); return { start: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), end: iso(new Date(n.getFullYear(), n.getMonth(), 0)) }; } },
  { id: 'fy', label: 'This FY', get: () => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return { start: `${y}-04-01`, end: today() }; } },
  { id: 'all', label: 'All', get: () => ({ start: '', end: '' }) },
];

const makeInR = (r: Range) => (d: string) => inRange(d, { preset: 'custom', start: r.start, end: r.end });
const qtl = (kg: number) => `${fmtNumber(kg / 100, 2)} Qtl`;
const rs0 = (n: number) => fmtINR(n, { decimals: 0 });

// ============ time series ============
type Point = { key: string; label: string; value: number };
function buildSeries(items: { date: string; value: number }[], r: Range): Point[] {
  if (!items.length) return [];
  const dates = items.map(i => i.date).sort();
  const s = r.start || dates[0];
  const e = r.end || dates[dates.length - 1];
  if (s > e) return [];
  const spanDays = Math.round((parse(e).getTime() - parse(s).getTime()) / 86400000);
  const sums = new Map<string, number>();
  const out: Point[] = [];
  if (spanDays <= 62) {
    items.forEach(i => sums.set(i.date, (sums.get(i.date) || 0) + i.value));
    for (let d = parse(s); iso(d) <= e; d.setDate(d.getDate() + 1)) {
      const k = iso(d);
      out.push({ key: k, label: `${d.getDate()} ${MON[d.getMonth()]}`, value: sums.get(k) || 0 });
    }
  } else {
    items.forEach(i => { const k = i.date.slice(0, 7); sums.set(k, (sums.get(k) || 0) + i.value); });
    const ed = parse(e);
    for (let d = new Date(parse(s).getFullYear(), parse(s).getMonth(), 1); d <= ed; d.setMonth(d.getMonth() + 1)) {
      const k = iso(d).slice(0, 7);
      out.push({ key: k, label: `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, value: sums.get(k) || 0 });
    }
  }
  return out;
}

// ============ chart + list building blocks ============
function BarChart({ title, data, format, color = 'bg-forest-500' }: {
  title: string; data: Point[]; format: (n: number) => string; color?: string;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
  const shown = sel !== null ? data[sel] : undefined;
  return (
    <Card className="p-3">
      <div className="flex justify-between items-baseline gap-2 mb-2">
        <h3 className="font-semibold text-forest-800 text-sm">{title}</h3>
        <span className="text-[11px] text-gray-500 text-right">{shown ? `${shown.label}: ${format(shown.value)}` : data.length ? 'Tap a bar for details' : ''}</span>
      </div>
      {data.length === 0 ? <div className="text-xs text-gray-500 text-center py-6">No data in this period</div> : (
        <>
          <div className="flex items-end justify-center gap-[3px] h-32 border-b border-gray-200">
            {data.map((d, i) => (
              <button key={d.key} onClick={() => setSel(sel === i ? null : i)} aria-label={`${d.label}: ${format(d.value)}`}
                className="flex-1 max-w-[36px] h-full flex items-end">
                <div className={cn('w-full rounded-t', d.value < 0 ? 'bg-red-500' : color, sel !== null && sel !== i && 'opacity-40')}
                  style={{ height: `${d.value === 0 ? 0 : Math.max(3, Math.abs(d.value) / max * 100)}%` }} />
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 mt-1">
            <span>{data[0].label}</span><span>{data.length > 1 ? data[data.length - 1].label : ''}</span>
          </div>
        </>
      )}
    </Card>
  );
}

function ShareBars({ title, rows, format, color = 'bg-forest-500' }: {
  title: string; rows: { label: string; value: number }[]; format: (n: number) => string; color?: string;
}) {
  const list = rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((s, r) => s + r.value, 0);
  return (
    <Card className="p-3">
      <h3 className="font-semibold text-forest-800 text-sm mb-2">{title}</h3>
      {list.length === 0 ? <div className="text-xs text-gray-500 text-center py-3">No data in this period</div> : (
        <div className="space-y-2">
          {list.map(r => (
            <div key={r.label}>
              <div className="flex justify-between text-xs gap-2">
                <span className="truncate">{r.label}</span>
                <strong className="shrink-0">{format(r.value)} <span className="font-normal text-gray-500">({Math.round(r.value / total * 100)}%)</span></strong>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full', color)} style={{ width: `${r.value / total * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

type PartyRow = { name: string; count: number; qty: number; amount: number; sub?: string };
function groupRows<T>(items: T[], keyOf: (t: T) => string, qtyOf: (t: T) => number, amtOf: (t: T) => number): PartyRow[] {
  const m = new Map<string, PartyRow>();
  for (const it of items) {
    const k = keyOf(it);
    const r = m.get(k) || { name: k, count: 0, qty: 0, amount: 0 };
    r.count += 1; r.qty += qtyOf(it); r.amount += amtOf(it);
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

function PartyList({ title, rows, qtyFmt }: { title: string; rows: PartyRow[]; qtyFmt: (n: number) => string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <Card className="p-3">
      <h3 className="font-semibold text-forest-800 text-sm mb-2">{title} ({rows.length})</h3>
      {rows.length === 0 ? <div className="text-xs text-gray-500 text-center py-3">No records in this period</div> : (
        <div className="divide-y divide-gray-100">
          {shown.map(r => (
            <div key={r.name} className="py-1.5 flex justify-between gap-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium truncate">{r.name}</div>
                <div className="text-[10px] text-gray-500">{r.count} entr{r.count === 1 ? 'y' : 'ies'}{r.qty ? ` · ${qtyFmt(r.qty)}` : ''}{r.sub ? ` · ${r.sub}` : ''}</div>
              </div>
              <strong className="shrink-0">{fmtINR(r.amount)}</strong>
            </div>
          ))}
        </div>
      )}
      {rows.length > 8 && (
        <button onClick={() => setAll(!all)} className="mt-2 w-full text-[11px] font-semibold text-forest-700">{all ? 'Show less' : `Show all ${rows.length}`}</button>
      )}
    </Card>
  );
}

const Grid: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="grid grid-cols-2 gap-2">{children}</div>;
const Empty = () => <Card className="p-6 text-center text-xs text-gray-500">No records in the selected dates.</Card>;

// ============ HULLING ============
function HullingReport({ range }: { range: Range }) {
  const { db } = useDB();
  const d = useMemo(() => {
    const inR = makeInR(range);
    const rows = db.hulling.filter(h => inR(h.date));
    const kg = rows.reduce((s, h) => s + h.quantityKg, 0);
    const income = rows.reduce((s, h) => s + h.finalTotal, 0);
    return {
      rows, kg, income,
      customers: new Set(rows.map(h => h.partyId)).size,
      qtySeries: buildSeries(rows.map(h => ({ date: h.date, value: h.quantityKg / 100 })), range),
      incSeries: buildSeries(rows.map(h => ({ date: h.date, value: h.finalTotal })), range),
      list: groupRows(rows, h => partyName(db, h.partyId), h => h.quantityKg, h => h.finalTotal),
    };
  }, [db, range.start, range.end]);
  return (
    <div className="space-y-3">
      <Grid>
        <KPICard label="Total Hulling" value={qtl(d.kg)} sub={`${d.rows.length} entries`} tone="green" />
        <KPICard label="Total Income" value={fmtINR(d.income)} sub={d.kg ? `Avg ${fmtINR(d.income / (d.kg / 100))}/Qtl` : undefined} tone="gold" />
        <KPICard label="Customers" value={String(d.customers)} tone="blue" />
        <KPICard label="Entries" value={String(d.rows.length)} />
      </Grid>
      {d.rows.length === 0 ? <Empty /> : <>
        <BarChart title="Hulling Quintals" data={d.qtySeries} format={n => `${fmtNumber(n, 2)} Qtl`} />
        <BarChart title="Hulling Income (₹)" data={d.incSeries} format={rs0} color="bg-amber-500" />
        <PartyList title="Hulling Customers" rows={d.list} qtyFmt={qtl} />
      </>}
    </div>
  );
}

// ============ PADDY PURCHASE ============
function PaddyReport({ range }: { range: Range }) {
  const { db } = useDB();
  const d = useMemo(() => {
    const inR = makeInR(range);
    const rows = db.purchases.filter(p => inR(p.date));
    const linesOf = (p: typeof rows[number]) => p.lines?.length ? p.lines : [{ id: p.id, varietyId: p.varietyId, size: undefined as any, qtyKg: p.netKg, amount: p.baseAmount, ratePerQtl: p.ratePerQtl }];
    const size = { small: { kg: 0, amt: 0 }, big: { kg: 0, amt: 0 }, other: { kg: 0, amt: 0 } };
    const byVariety = new Map<string, number>();
    const partySize = new Map<string, { small: number; big: number }>();
    for (const p of rows) {
      const pn = partyName(db, p.partyId);
      const ps = partySize.get(pn) || { small: 0, big: 0 };
      for (const l of linesOf(p)) {
        const b = l.size === 'small' ? size.small : l.size === 'big' ? size.big : size.other;
        b.kg += l.qtyKg; b.amt += l.amount;
        if (l.size === 'small') ps.small += l.qtyKg; else if (l.size === 'big') ps.big += l.qtyKg;
        const vn = db.varieties.find(v => v.id === l.varietyId)?.name || 'Unspecified';
        byVariety.set(vn, (byVariety.get(vn) || 0) + l.qtyKg);
      }
      partySize.set(pn, ps);
    }
    const kg = rows.reduce((s, p) => s + p.netKg, 0);
    const amount = rows.reduce((s, p) => s + p.finalTotal, 0);
    const list = groupRows(rows, p => partyName(db, p.partyId), p => p.netKg, p => p.finalTotal)
      .map(r => { const s = partySize.get(r.name); return { ...r, sub: s ? `Small ${qtl(s.small)} · Big ${qtl(s.big)}` : undefined }; });
    return {
      rows, kg, amount, size, list,
      suppliers: new Set(rows.map(p => p.partyId)).size,
      varieties: [...byVariety.entries()].map(([label, value]) => ({ label, value })),
      qtySeries: buildSeries(rows.map(p => ({ date: p.date, value: p.netKg / 100 })), range),
      amtSeries: buildSeries(rows.map(p => ({ date: p.date, value: p.finalTotal })), range),
    };
  }, [db, range.start, range.end]);
  return (
    <div className="space-y-3">
      <Grid>
        <KPICard label="Paddy Brought" value={qtl(d.kg)} sub={`${d.rows.length} vouchers`} tone="green" />
        <KPICard label="Total Amount" value={fmtINR(d.amount)} sub={d.kg ? `Avg ${fmtINR(d.amount / (d.kg / 100))}/Qtl` : undefined} tone="gold" />
        <KPICard label="Small Paddy" value={qtl(d.size.small.kg)} sub={fmtINR(d.size.small.amt)} tone="blue" />
        <KPICard label="Big Paddy" value={qtl(d.size.big.kg)} sub={fmtINR(d.size.big.amt)} tone="blue" />
      </Grid>
      {d.size.other.kg > 0 && <div className="text-[11px] text-gray-500 px-1">Older vouchers without size: {qtl(d.size.other.kg)}</div>}
      <KPICard label="Suppliers" value={String(d.suppliers)} />
      {d.rows.length === 0 ? <Empty /> : <>
        <BarChart title="Paddy Brought (Qtl)" data={d.qtySeries} format={n => `${fmtNumber(n, 2)} Qtl`} />
        <BarChart title="Paddy Amount (₹)" data={d.amtSeries} format={rs0} color="bg-amber-500" />
        <ShareBars title="Small vs Big Paddy" rows={[{ label: 'Small', value: d.size.small.kg }, { label: 'Big', value: d.size.big.kg }, { label: 'Unspecified', value: d.size.other.kg }]} format={qtl} color="bg-sky-500" />
        <ShareBars title="By Paddy Variety" rows={d.varieties} format={qtl} />
        <PartyList title="Paddy Supplier List" rows={d.list} qtyFmt={qtl} />
      </>}
    </div>
  );
}

// ============ RICE (and other product) SALES ============
function SalesReport({ range }: { range: Range }) {
  const { db } = useDB();
  const [product, setProduct] = useState('pr_rice');
  const products = db.categories.filter(c => c.type === 'product' && c.active);
  const d = useMemo(() => {
    const inR = makeInR(range);
    const rows = db.sales.filter(s => inR(s.date) && (product === 'all' || s.productId === product));
    const kg = rows.reduce((s, x) => s + x.quantityKg, 0);
    const amount = rows.reduce((s, x) => s + x.finalTotal, 0);
    const byVariety = new Map<string, number>();
    for (const s of rows) {
      const fallback = s.itemName || db.categories.find(c => c.id === s.productId)?.name || 'Other';
      const parts = s.lines?.length ? s.lines.map(l => ({ id: l.varietyId || s.varietyId, kg: l.quantityKg, name: l.itemName })) : [{ id: s.varietyId, kg: s.quantityKg, name: undefined }];
      for (const p of parts) {
        const n = db.varieties.find(v => v.id === p.id)?.name || p.name || fallback;
        byVariety.set(n, (byVariety.get(n) || 0) + p.kg);
      }
    }
    return {
      rows, kg, amount,
      customers: new Set(rows.map(s => s.partyId)).size,
      varieties: [...byVariety.entries()].map(([label, value]) => ({ label, value })),
      qtySeries: buildSeries(rows.map(s => ({ date: s.date, value: s.quantityKg / 100 })), range),
      amtSeries: buildSeries(rows.map(s => ({ date: s.date, value: s.finalTotal })), range),
      list: groupRows(rows, s => partyName(db, s.partyId), s => s.quantityKg, s => s.finalTotal),
    };
  }, [db, range.start, range.end, product]);
  return (
    <div className="space-y-3">
      <Select label="Product" value={product} onChange={e => setProduct(e.target.value)}
        options={[...products.map(c => ({ value: c.id, label: c.name })), { value: 'all', label: 'All sale products' }]} />
      <Grid>
        <KPICard label="Quantity Sold" value={qtl(d.kg)} sub={`${d.rows.length} invoices`} tone="green" />
        <KPICard label="Total Sales" value={fmtINR(d.amount)} sub={d.kg ? `Avg ${fmtINR(d.amount / (d.kg / 100))}/Qtl` : undefined} tone="gold" />
        <KPICard label="Customers" value={String(d.customers)} tone="blue" />
        <KPICard label="Invoices" value={String(d.rows.length)} />
      </Grid>
      {d.rows.length === 0 ? <Empty /> : <>
        <BarChart title="Quantity Sold (Qtl)" data={d.qtySeries} format={n => `${fmtNumber(n, 2)} Qtl`} />
        <BarChart title="Sales Amount (₹)" data={d.amtSeries} format={rs0} color="bg-amber-500" />
        <ShareBars title="By Variety" rows={d.varieties} format={qtl} />
        <PartyList title="Customer List" rows={d.list} qtyFmt={qtl} />
      </>}
    </div>
  );
}

// ============ TRADING ============
function TradingReport({ range }: { range: Range }) {
  const { db } = useDB();
  const d = useMemo(() => {
    const inR = makeInR(range);
    const rows = db.trading.filter(t => inR(t.date));
    const buys = rows.filter(t => t.kind === 'buy');
    const sells = rows.filter(t => t.kind === 'sell');
    const buyTotal = buys.reduce((s, t) => s + t.total, 0);
    const sellTotal = sells.reduce((s, t) => s + t.total, 0);
    const items = new Map<string, { name: string; unit: string; bQty: number; bAmt: number; sQty: number; sAmt: number }>();
    for (const t of rows) {
      const it = items.get(t.itemId) || { name: t.itemName, unit: t.unit, bQty: 0, bAmt: 0, sQty: 0, sAmt: 0 };
      if (t.kind === 'buy') { it.bQty += t.qty; it.bAmt += t.total; } else { it.sQty += t.qty; it.sAmt += t.total; }
      items.set(t.itemId, it);
    }
    const pname = (t: typeof rows[number]) => t.party?.trim() || '(No name)';
    return {
      rows, buys, sells, buyTotal, sellTotal,
      items: [...items.values()].sort((a, b) => (b.sAmt + b.bAmt) - (a.sAmt + a.bAmt)),
      sellSeries: buildSeries(sells.map(t => ({ date: t.date, value: t.total })), range),
      buySeries: buildSeries(buys.map(t => ({ date: t.date, value: t.total })), range),
      customers: groupRows(sells, pname, () => 0, t => t.total),
      suppliers: groupRows(buys, pname, () => 0, t => t.total),
    };
  }, [db, range.start, range.end]);
  const diff = d.sellTotal - d.buyTotal;
  return (
    <div className="space-y-3">
      <Grid>
        <KPICard label="Total Sales" value={fmtINR(d.sellTotal)} sub={`${d.sells.length} sales`} tone="green" />
        <KPICard label="Total Purchases" value={fmtINR(d.buyTotal)} sub={`${d.buys.length} purchases`} tone="red" />
        <KPICard label="Sales − Purchases" value={fmtINR(diff)} sub="Cash difference, not true profit" tone={diff >= 0 ? 'gold' : 'red'} />
        <KPICard label="Items Traded" value={String(d.items.length)} tone="blue" />
      </Grid>
      {d.rows.length === 0 ? <Empty /> : <>
        <BarChart title="Trading Sales (₹)" data={d.sellSeries} format={rs0} />
        <BarChart title="Trading Purchases (₹)" data={d.buySeries} format={rs0} color="bg-amber-500" />
        <ShareBars title="Sales by Item" rows={d.items.map(i => ({ label: i.name, value: i.sAmt }))} format={rs0} />
        <Card className="p-3">
          <h3 className="font-semibold text-forest-800 text-sm mb-2">Item Summary</h3>
          <div className="divide-y divide-gray-100">
            {d.items.map(i => (
              <div key={i.name + i.unit} className="py-1.5 text-xs">
                <div className="font-medium">{i.name}</div>
                <div className="flex justify-between text-[11px] text-gray-600">
                  <span>Bought {fmtTradeQty(i.bQty, i.unit)} · {fmtINR(i.bAmt)}</span>
                  <span>Sold {fmtTradeQty(i.sQty, i.unit)} · {fmtINR(i.sAmt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <PartyList title="Customers (Sales)" rows={d.customers} qtyFmt={n => String(n)} />
        <PartyList title="Suppliers (Purchases)" rows={d.suppliers} qtyFmt={n => String(n)} />
      </>}
    </div>
  );
}

// ============ VEHICLE ============
function VehicleReport({ range }: { range: Range }) {
  const { db } = useDB();
  const d = useMemo(() => {
    const inR = makeInR(range);
    const trips = db.dispatches.filter(x => inR(x.date)).map(tripOf);
    const loadKg = trips.reduce((s, t) => s + t.loadKg, 0);
    const cost = trips.reduce((s, t) => s + t.vehicleCost, 0);
    const other = trips.reduce((s, t) => s + t.otherCost, 0);
    const byVeh = new Map<string, { trips: number; loadKg: number; cost: number; drivers: Set<string> }>();
    for (const t of trips) {
      const k = t.d.vehicleNumber?.trim() || '(No number)';
      const v = byVeh.get(k) || { trips: 0, loadKg: 0, cost: 0, drivers: new Set<string>() };
      v.trips += 1; v.loadKg += t.loadKg; v.cost += t.vehicleCost;
      if (t.driver) v.drivers.add(t.driver);
      byVeh.set(k, v);
    }
    const vehicles = [...byVeh.entries()].map(([name, v]) => ({ name, ...v, drivers: [...v.drivers] })).sort((a, b) => b.cost - a.cost);
    return {
      trips, loadKg, cost, other, vehicles,
      paddy: trips.filter(t => t.type === 'paddy').length,
      husk: trips.filter(t => t.type === 'husk').length,
      tripSeries: buildSeries(trips.map(t => ({ date: t.d.date, value: 1 })), range),
      costSeries: buildSeries(trips.map(t => ({ date: t.d.date, value: t.vehicleCost })), range),
    };
  }, [db, range.start, range.end]);
  return (
    <div className="space-y-3">
      <Grid>
        <KPICard label="Total Trips" value={String(d.trips.length)} sub={`Paddy ${d.paddy} · Husk ${d.husk}`} tone="green" />
        <KPICard label="Load Carried" value={qtl(d.loadKg)} tone="blue" />
        <KPICard label="Vehicle Cost" value={fmtINR(d.cost)} sub="Freight + vehicle charges" tone="red" />
        <KPICard label="Other Trip Costs" value={fmtINR(d.other)} sub="Loading, labour, etc." tone="gold" />
      </Grid>
      {d.trips.length === 0 ? <Empty /> : <>
        <BarChart title="Trips" data={d.tripSeries} format={n => `${n} trip${n === 1 ? '' : 's'}`} />
        <BarChart title="Vehicle Cost (₹)" data={d.costSeries} format={rs0} color="bg-amber-500" />
        <ShareBars title="Vehicle Cost by Vehicle" rows={d.vehicles.map(v => ({ label: v.name, value: v.cost }))} format={rs0} color="bg-red-400" />
        <Card className="p-3">
          <h3 className="font-semibold text-forest-800 text-sm mb-2">Vehicles ({d.vehicles.length})</h3>
          <div className="divide-y divide-gray-100">
            {d.vehicles.map(v => (
              <div key={v.name} className="py-1.5 flex justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="font-medium truncate">{v.name}</div>
                  <div className="text-[10px] text-gray-500">{v.trips} trip{v.trips === 1 ? '' : 's'} · {qtl(v.loadKg)}{v.drivers.length ? ` · ${v.drivers.join(', ')}` : ''}</div>
                </div>
                <strong className="shrink-0">{fmtINR(v.cost)}</strong>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-3">
          <h3 className="font-semibold text-forest-800 text-sm mb-2">Trip Details</h3>
          <div className="divide-y divide-gray-100">
            {[...d.trips].sort((a, b) => b.d.date.localeCompare(a.d.date)).slice(0, 30).map(t => (
              <div key={t.d.id} className="py-1.5 flex justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.trip} · {t.d.vehicleNumber || '—'}</div>
                  <div className="text-[10px] text-gray-500">{fmtDate(t.d.date)} · {t.kind} · {partyName(db, t.d.partyId)} · {qtl(t.loadKg)}</div>
                </div>
                <strong className="shrink-0">{fmtINR(t.vehicleCost)}</strong>
              </div>
            ))}
          </div>
          {d.trips.length > 30 && <div className="text-[10px] text-gray-500 mt-1">Showing latest 30 of {d.trips.length} trips.</div>}
        </Card>
      </>}
    </div>
  );
}

// ============ PADDY DISPATCH ============
function PaddyDispatchReport({ range }: { range: Range }) {
  const { db } = useDB();
  const d = useMemo(() => {
    const inR = makeInR(range);
    const rows = db.dispatches.filter(x => x.paddy && inR(x.date));
    const kgOf = (x: typeof rows[number]) => x.paddy!.netSaleKg || x.netKg;
    const sum = (f: (x: typeof rows[number]) => number) => rows.reduce((s, x) => s + f(x), 0);
    const bySize = { small: 0, big: 0, both: 0 };
    rows.forEach(x => { bySize[x.paddy!.size] += kgOf(x); });
    return {
      rows, kg: sum(kgOf), revenue: sum(x => x.paddy!.revenue), buyCost: sum(x => x.paddy!.buyCost),
      expenses: sum(x => x.paddy!.expenses), profit: sum(x => x.paddy!.profit), bySize,
      customers: new Set(rows.map(x => x.partyId)).size,
      qtySeries: buildSeries(rows.map(x => ({ date: x.date, value: kgOf(x) / 100 })), range),
      revSeries: buildSeries(rows.map(x => ({ date: x.date, value: x.paddy!.revenue })), range),
      profitSeries: buildSeries(rows.map(x => ({ date: x.date, value: x.paddy!.profit })), range),
      list: groupRows(rows, x => partyName(db, x.partyId), kgOf, x => x.paddy!.revenue),
    };
  }, [db, range.start, range.end]);
  return (
    <div className="space-y-3">
      <Grid>
        <KPICard label="Paddy Dispatched" value={qtl(d.kg)} sub={`${d.rows.length} dispatches`} tone="green" />
        <KPICard label="Sale Amount" value={fmtINR(d.revenue)} tone="gold" />
        <KPICard label="Paddy Cost" value={fmtINR(d.buyCost)} sub={`Expenses ${fmtINR(d.expenses)}`} tone="red" />
        <KPICard label="Profit" value={fmtINR(d.profit)} tone={d.profit >= 0 ? 'green' : 'red'} />
      </Grid>
      <KPICard label="Buyers" value={String(d.customers)} tone="blue" />
      {d.rows.length === 0 ? <Empty /> : <>
        <BarChart title="Paddy Dispatched (Qtl)" data={d.qtySeries} format={n => `${fmtNumber(n, 2)} Qtl`} />
        <BarChart title="Sale Amount (₹)" data={d.revSeries} format={rs0} color="bg-amber-500" />
        <BarChart title="Profit (₹)" data={d.profitSeries} format={rs0} color="bg-emerald-600" />
        <ShareBars title="Small vs Big Paddy" rows={[{ label: 'Small', value: d.bySize.small }, { label: 'Big', value: d.bySize.big }, { label: 'Small + Big', value: d.bySize.both }]} format={qtl} color="bg-sky-500" />
        <PartyList title="Paddy Buyers" rows={d.list} qtyFmt={qtl} />
      </>}
    </div>
  );
}

// ============ HUSK DISPATCH ============
function HuskDispatchReport({ range }: { range: Range }) {
  const { db } = useDB();
  const d = useMemo(() => {
    const inR = makeInR(range);
    const rows = db.dispatches.filter(x => x.husk && inR(x.date));
    const bagsOf = (x: typeof rows[number]) => { const h = x.husk!; return h.measureBy === 'bags' ? h.lots.reduce((s, l) => s + l.qty, 0) : h.approxBags || 0; };
    const kgOf = (x: typeof rows[number]) => { const h = x.husk!; return h.measureBy === 'weight' ? h.lots.reduce((s, l) => s + l.qty, 0) : h.approxKg || 0; };
    const sum = (f: (x: typeof rows[number]) => number) => rows.reduce((s, x) => s + f(x), 0);
    return {
      rows, bags: sum(bagsOf), kg: sum(kgOf), total: sum(x => x.husk!.totalAmount),
      coolie: sum(x => x.husk!.coolie), transport: sum(x => x.husk!.transport), net: sum(x => x.husk!.netReceivable),
      customers: new Set(rows.map(x => x.partyId)).size,
      amtSeries: buildSeries(rows.map(x => ({ date: x.date, value: x.husk!.netReceivable })), range),
      bagSeries: buildSeries(rows.map(x => ({ date: x.date, value: bagsOf(x) })), range),
      list: groupRows(rows, x => partyName(db, x.partyId), bagsOf, x => x.husk!.netReceivable),
    };
  }, [db, range.start, range.end]);
  return (
    <div className="space-y-3">
      <Grid>
        <KPICard label="Husk Dispatched" value={`${fmtNumber(d.bags, 0)} bags`} sub={d.kg ? qtl(d.kg) : `${d.rows.length} dispatches`} tone="green" />
        <KPICard label="Total Amount" value={fmtINR(d.total)} tone="gold" />
        <KPICard label="Coolie + Transport" value={fmtINR(d.coolie + d.transport)} tone="red" />
        <KPICard label="Net Receivable" value={fmtINR(d.net)} sub={`${d.customers} buyers`} tone="blue" />
      </Grid>
      {d.rows.length === 0 ? <Empty /> : <>
        <BarChart title="Net Husk Amount (₹)" data={d.amtSeries} format={rs0} color="bg-amber-500" />
        {d.bags > 0 && <BarChart title="Husk Bags" data={d.bagSeries} format={n => `${fmtNumber(n, 0)} bags`} />}
        <PartyList title="Husk Buyers" rows={d.list} qtyFmt={n => `${fmtNumber(n, 0)} bags`} />
      </>}
    </div>
  );
}

// ============ PAGE ============
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'hulling', label: 'Hulling' },
  { id: 'paddy', label: 'Paddy' },
  { id: 'sales', label: 'Sales' },
  { id: 'trading', label: 'Trading' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'paddyDisp', label: 'Paddy Dispatch' },
  { id: 'huskDisp', label: 'Husk Dispatch' },
];

export function ReportsPage() {
  const [tab, setTab] = useState('overview');
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState<Range>(PRESETS[2].get());
  const pick = (id: string) => { setPreset(id); setRange(PRESETS.find(p => p.id === id)!.get()); };
  const edit = (patch: Partial<Range>) => { setPreset('custom'); setRange(r => ({ ...r, ...patch })); };
  const invalid = !!range.start && !!range.end && range.start > range.end;

  return (
    <div className="p-3 space-y-3 pb-6">
      <Card className="p-3 space-y-2">
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => pick(p.id)}
              className={cn('shrink-0 px-2.5 py-1 text-[11px] rounded-full font-medium whitespace-nowrap transition-colors',
                preset === p.id ? 'bg-forest-700 text-white' : 'bg-white border border-gray-200 text-gray-600')}>{p.label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="From" type="date" value={range.start} max={range.end || undefined} onChange={e => edit({ start: e.target.value })} />
          <Input label="To" type="date" value={range.end} min={range.start || undefined} onChange={e => edit({ end: e.target.value })} />
        </div>
        <div className={cn('text-[11px]', invalid ? 'text-red-600' : 'text-gray-500')}>
          {invalid ? 'From date is after To date.' : range.start || range.end
            ? `${range.start ? fmtDate(range.start) : 'Beginning'} – ${range.end ? fmtDate(range.end) : 'Latest'}` : 'All dates'}
        </div>
      </Card>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {invalid ? null : (
        <>
          {tab === 'overview' && <ReportsOverview range={range} />}
          {tab === 'hulling' && <HullingReport range={range} />}
          {tab === 'paddy' && <PaddyReport range={range} />}
          {tab === 'sales' && <SalesReport range={range} />}
          {tab === 'trading' && <TradingReport range={range} />}
          {tab === 'vehicle' && <VehicleReport range={range} />}
          {tab === 'paddyDisp' && <PaddyDispatchReport range={range} />}
          {tab === 'huskDisp' && <HuskDispatchReport range={range} />}
        </>
      )}
    </div>
  );
}
