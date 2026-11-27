/** Pure report calculations (no UI). Each report is a table so the screen and the CSV export always agree. */
import type { Database } from './types';
import { staffWagesIn } from './staff';
import { computeStock, computePartyLedger, dispatchDue, fmtDate, round2, sumPayments, tradingPL, fmtTradeQty } from './db';

export type Range = { start: string; end: string };
export type Kind = 'text' | 'date' | 'inr' | 'qtl' | 'num';
export interface Col { label: string; kind?: Kind }
export interface TableData { columns: Col[]; rows: (string | number)[][]; totals?: (string | number)[]; kpis?: { label: string; value: number; kind: Kind }[] }

const inR = (r: Range) => (d: string) => (!r.start || d >= r.start) && (!r.end || d <= r.end);
const pname = (db: Database, id?: string) => db.parties.find(p => p.id === id)?.name || '(Unknown)';
const vname = (db: Database, id?: string) => db.varieties.find(v => v.id === id)?.name || 'Unspecified';
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

// ---------------- report catalogue (drives the tiles) ----------------
export type ReportId =
  | 'daily' | 'ledger' | 'labour' | 'stockLedger' | 'profit'
  | 'hulling' | 'paddy' | 'sales' | 'riceVariety' | 'paddyVariety' | 'riceCustomers' | 'hullingCustomers' | 'paddySuppliers' | 'paddySaleParties'
  | 'tradingSales' | 'tradingPL'
  | 'dispatch' | 'paddyDispatch' | 'huskDispatch' | 'paddyLedger' | 'vehicle' | 'missing';
export const GROUPS: { id: string; label: string; icon: string; tiles: { id: ReportId; icon: string; title: string; sub: string }[] }[] = [
  { id: 'fin', label: 'Financial', icon: '💰', tiles: [
    { id: 'daily', icon: '📊', title: 'Daily Closing', sub: 'Income & expense summary' },
    { id: 'profit', icon: '📈', title: 'Profit Overview', sub: 'Revenue, costs & estimate' },
    { id: 'ledger', icon: '👤', title: 'Customer Ledger', sub: 'Party-wise account' },
    { id: 'labour', icon: '👷', title: 'Labour Wages', sub: 'Worker payment records' },
    { id: 'stockLedger', icon: '📦', title: 'Stock Ledger', sub: 'Inventory movement log' },
  ] },
  { id: 'prod', label: 'Sales & Production', icon: '🍚', tiles: [
    { id: 'hulling', icon: '🔵', title: 'Hulling Summary', sub: 'Milling job records' },
    { id: 'paddy', icon: '🌾', title: 'Paddy Purchase', sub: 'Paddy buy summary' },
    { id: 'sales', icon: '🧾', title: 'Sales Summary', sub: 'Rice, bran & other sales' },
    { id: 'riceVariety', icon: '🍚', title: 'Rice by Variety', sub: 'Variety-wise rice sales' },
    { id: 'paddyVariety', icon: '🟤', title: 'Paddy by Variety', sub: 'Variety-wise paddy' },
    { id: 'riceCustomers', icon: '🧑‍🤝‍🧑', title: 'Rice Customers', sub: 'Rice sale parties' },
    { id: 'hullingCustomers', icon: '🏭', title: 'Hulling Customers', sub: 'Hulling party-wise' },
    { id: 'paddySuppliers', icon: '🚜', title: 'Paddy Suppliers', sub: 'Supplier purchase log' },
    { id: 'paddySaleParties', icon: '💵', title: 'Paddy Sale Parties', sub: 'Paddy sale customers' },
  ] },
  { id: 'trade', label: 'Trading Goods', icon: '🏪', tiles: [
    { id: 'tradingSales', icon: '🛒', title: 'Trading Sales', sub: 'Sales & purchase summary' },
    { id: 'tradingPL', icon: '💹', title: 'Trading P&L', sub: 'Profit & loss statement' },
  ] },
  { id: 'ops', label: 'Operations', icon: '🚛', tiles: [
    { id: 'dispatch', icon: '🚚', title: 'Dispatch Report', sub: 'Vehicle dispatch log' },
    { id: 'paddyDispatch', icon: '📦', title: 'Paddy Dispatch', sub: 'Paddy sold & profit' },
    { id: 'huskDispatch', icon: '🟫', title: 'Husk Dispatch', sub: 'Husk bags & amount' },
    { id: 'paddyLedger', icon: '📒', title: 'Paddy Ledger', sub: 'Full paddy history' },
    { id: 'vehicle', icon: '🚛', title: 'Vehicle Report', sub: 'Vehicle-wise summary' },
    { id: 'missing', icon: '⚠️', title: 'Missing Data', sub: 'Incomplete records' },
  ] },
];
export const TITLE_OF = Object.fromEntries(GROUPS.flatMap(g => g.tiles.map(t => [t.id, t.title]))) as Record<ReportId, string>;

// ---------------- daily closing ----------------
export interface DailyClosing {
  income: { label: string; value: number }[]; totalIncome: number;
  expenses: { label: string; value: number }[]; totalExpenses: number; net: number;
  stockMoves: { label: string; kg: number; tone: 'in' | 'out' }[];
  current: { label: string; kg: number }[];
}
export function dailyClosing(db: Database, r: Range): DailyClosing {
  const ok = inR(r);
  const sales = db.sales.filter(s => ok(s.date)), disp = db.dispatches.filter(d => ok(d.date));
  const by = (pid: string) => sum([...sales.filter(s => s.productId === pid).map(s => s.finalTotal), ...disp.filter(d => d.productId === pid).map(d => d.finalTotal)]);
  const qty = (pid: string) => sum([...sales.filter(s => s.productId === pid).map(s => s.quantityKg), ...disp.filter(d => d.productId === pid).map(d => d.netKg)]);
  const known = ['pr_paddy', 'pr_rice', 'pr_bran', 'pr_husk'];
  const misc = sum([...sales.filter(s => !known.includes(s.productId)).map(s => s.finalTotal), ...disp.filter(d => !known.includes(d.productId)).map(d => d.finalTotal)]);
  const trading = sum(db.trading.filter(t => t.kind === 'sell' && !t.sourceSaleId && ok(t.date)).map(t => t.total));
  const income = [
    { label: 'Hulling Income', value: sum(db.hulling.filter(h => ok(h.date)).map(h => h.finalTotal)) },
    { label: 'Paddy Sales', value: by('pr_paddy') }, { label: 'Rice Sales', value: by('pr_rice') },
    { label: 'Bran Sales', value: by('pr_bran') }, { label: 'Husk Sales', value: by('pr_husk') },
    { label: 'Misc Sales', value: misc }, { label: 'Trading Sales', value: trading },
  ];
  const expenses = [
    { label: 'Labour Wages', value: round2(sum(db.labour.filter(l => ok(l.date)).map(l => l.totalAmount)) + staffWagesIn(db, r.start, r.end)) },
    { label: 'Electricity', value: sum(db.electricity.filter(e => ok(e.billDate)).map(e => e.amount)) },
    { label: 'Other Expenses', value: sum(db.expenses.filter(e => !e.isPersonal && ok(e.date)).map(e => e.amount)) },
  ];
  const totalIncome = sum(income.map(i => i.value)), totalExpenses = sum(expenses.map(i => i.value));
  const st = computeStock(db);
  const prod = db.production.filter(p => ok(p.date));
  return {
    income, totalIncome, expenses, totalExpenses, net: round2(totalIncome - totalExpenses),
    stockMoves: [
      { label: 'Paddy In', kg: sum(db.purchases.filter(p => ok(p.date)).map(p => p.netKg)), tone: 'in' },
      { label: 'Bran In', kg: sum(prod.map(p => p.outputs.branKg)), tone: 'in' },
      { label: 'Paddy Sold', kg: qty('pr_paddy'), tone: 'out' },
      { label: 'Rice Sold', kg: qty('pr_rice'), tone: 'out' },
      { label: 'Bran Sold', kg: qty('pr_bran'), tone: 'out' },
    ],
    current: [
      { label: 'Current Paddy', kg: sum(Object.values(st.paddyByVariety)) },
      { label: 'Current Rice', kg: sum(Object.values(st.riceByVariety)) },
      { label: 'Current Bran', kg: st.branKg }, { label: 'Current Husk', kg: st.huskKg },
    ],
  };
}

// ---------------- stock movements (mirror computeStock) ----------------
interface Move { date: string; item: string; kg: number; label: string; ref: string }
const ITEM_OF: Record<string, string> = { pr_rice: 'Rice', pr_paddy: 'Paddy', pr_broken: 'Broken Rice', pr_bran: 'Bran', pr_husk: 'Husk' };
export function stockMoves(db: Database): Move[] {
  const m: Move[] = [];
  const add = (date: string, item: string, kg: number, label: string, ref: string) => { if (kg) m.push({ date, item, kg, label, ref }); };
  for (const p of db.purchases) add(p.date, 'Paddy', p.netKg, `Purchase from ${pname(db, p.partyId)}`, p.voucherNumber);
  for (const b of db.production) {
    const ins = b.inputs && b.inputs.length ? b.inputs : [{ varietyId: b.paddyVarietyId, qtyKg: b.paddyInputKg }];
    add(b.date, 'Paddy', -sum(ins.map(i => i.qtyKg)), 'Used in production', b.batchNumber);
    add(b.date, 'Rice', b.outputs.riceKg, 'Produced', b.batchNumber);
    add(b.date, 'Broken Rice', b.outputs.brokenRiceKg, 'Produced', b.batchNumber);
    add(b.date, 'Bran', b.outputs.branKg, 'Produced', b.batchNumber);
    add(b.date, 'Husk', b.outputs.huskKg, 'Produced', b.batchNumber);
    add(b.date, 'Other', b.outputs.otherKg, 'Produced', b.batchNumber);
  }
  for (const d of db.dispatches) {
    if (d.paddy?.allocations?.length) add(d.date, 'Paddy', -sum(d.paddy.allocations.map(a => a.qtyKg)), `Dispatch to ${pname(db, d.partyId)}`, d.dispatchNumber);
    else add(d.date, ITEM_OF[d.productId] || 'Other', -d.netKg, `Dispatch to ${pname(db, d.partyId)}`, d.dispatchNumber);
  }
  for (const s of db.sales) {
    const q = (s.productId === 'pr_rice' || s.productId === 'pr_paddy') && s.lines?.length ? sum(s.lines.map(l => l.quantityKg)) : s.quantityKg;
    add(s.date, ITEM_OF[s.productId] || 'Other', -q, `Sale to ${pname(db, s.partyId)}`, s.invoiceNumber);
  }
  const AI: Record<string, string> = { paddy: 'Paddy', rice: 'Rice', broken: 'Broken Rice', bran: 'Bran', husk: 'Husk', other: 'Other' };
  for (const a of db.stockAdjustments) if (AI[a.itemType]) add(a.date, AI[a.itemType], a.quantityKg || 0, `Adjustment: ${a.reason || ''}`, 'Adjust');
  return m.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------- generic table reports ----------------
const grouped = <T,>(items: T[], key: (t: T) => string, qty: (t: T) => number, amt: (t: T) => number) => {
  const m = new Map<string, { n: number; q: number; a: number }>();
  for (const it of items) { const k = key(it); const r = m.get(k) || { n: 0, q: 0, a: 0 }; r.n++; r.q += qty(it); r.a += amt(it); m.set(k, r); }
  return [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.a - a.a);
};
const partyTable = (rows: ReturnType<typeof grouped>, who: string): TableData => ({
  columns: [{ label: who }, { label: 'Entries', kind: 'num' }, { label: 'Quantity', kind: 'qtl' }, { label: 'Amount', kind: 'inr' }],
  rows: rows.map(r => [r.k, r.n, r.q, round2(r.a)]),
  totals: ['Total', sum(rows.map(r => r.n)), sum(rows.map(r => r.q)), sum(rows.map(r => r.a))],
});

export function buildTable(id: ReportId, db: Database, r: Range): TableData {
  const ok = inR(r);
  switch (id) {
    case 'daily': case 'profit': {
      const d = dailyClosing(db, r);
      return { columns: [{ label: 'Item' }, { label: 'Amount', kind: 'inr' }], rows: [...d.income.map(i => [i.label, i.value]), ['TOTAL INCOME', d.totalIncome], ...d.expenses.map(i => [i.label, i.value]), ['TOTAL EXPENSES', d.totalExpenses], ['NET PROFIT', d.net]] };
    }
    case 'ledger': {
      const rows = db.parties.map(p => {
        const l = computePartyLedger(db, p.id);
        const inRange = l.entries.filter(e => e.date && ok(e.date));
        const billed = sum(inRange.map(e => e.debit)), received = sum(inRange.map(e => e.credit));
        return { p, billed, received, bal: l.balance, active: inRange.length > 0 || Math.abs(l.balance) > 0.009 };
      }).filter(x => x.active).sort((a, b) => Math.abs(b.bal) - Math.abs(a.bal));
      return {
        columns: [{ label: 'Party' }, { label: 'Debit (Dr)', kind: 'inr' }, { label: 'Credit (Cr)', kind: 'inr' }, { label: 'Balance (Dr + / Cr -)', kind: 'inr' }],
        rows: rows.map(x => [x.p.name, x.billed, x.received, x.bal]),
        totals: ['Total', sum(rows.map(x => x.billed)), sum(rows.map(x => x.received)), sum(rows.map(x => x.bal))],
      };
    }
    case 'labour': {
      const xs = db.labour.filter(l => ok(l.date));
      return {
        columns: [{ label: 'Date', kind: 'date' }, { label: 'Worker' }, { label: 'Work' }, { label: 'Wage', kind: 'inr' }, { label: 'Paid', kind: 'inr' }, { label: 'Due', kind: 'inr' }],
        rows: xs.sort((a, b) => b.date.localeCompare(a.date)).map(l => [l.date, pname(db, l.workerPartyId), l.workType, l.totalAmount, sumPayments(l.payments), round2(l.totalAmount - sumPayments(l.payments))]),
        totals: ['', 'Total', '', sum(xs.map(l => l.totalAmount)), sum(xs.map(l => sumPayments(l.payments))), sum(xs.map(l => l.totalAmount - sumPayments(l.payments)))],
      };
    }
    case 'stockLedger': {
      const ms = stockMoves(db).filter(m => ok(m.date));
      return {
        columns: [{ label: 'Date', kind: 'date' }, { label: 'Item' }, { label: 'Particulars' }, { label: 'In', kind: 'qtl' }, { label: 'Out', kind: 'qtl' }, { label: 'Ref' }],
        rows: ms.map(m => [m.date, m.item, m.label, m.kg > 0 ? m.kg : 0, m.kg < 0 ? -m.kg : 0, m.ref]),
        totals: ['', '', 'Total', sum(ms.filter(m => m.kg > 0).map(m => m.kg)), sum(ms.filter(m => m.kg < 0).map(m => -m.kg)), ''],
      };
    }
    case 'paddyLedger': {
      const all = stockMoves(db).filter(m => m.item === 'Paddy');
      let bal = sum(all.filter(m => r.start && m.date < r.start).map(m => m.kg));
      const rows: (string | number)[][] = [[r.start || '', 'Opening balance', 0, 0, bal]];
      for (const m of all.filter(m => ok(m.date))) { bal = round2(bal + m.kg); rows.push([m.date, `${m.label} (${m.ref})`, m.kg > 0 ? m.kg : 0, m.kg < 0 ? -m.kg : 0, bal]); }
      return { columns: [{ label: 'Date', kind: 'date' }, { label: 'Particulars' }, { label: 'In', kind: 'qtl' }, { label: 'Out', kind: 'qtl' }, { label: 'Balance', kind: 'qtl' }], rows };
    }
    case 'hulling': case 'hullingCustomers': {
      const xs = db.hulling.filter(h => ok(h.date));
      if (id === 'hullingCustomers') return partyTable(grouped(xs, h => pname(db, h.partyId), h => h.quantityKg, h => h.finalTotal), 'Customer');
      return {
        columns: [{ label: 'Date', kind: 'date' }, { label: 'Receipt' }, { label: 'Customer' }, { label: 'Quantity', kind: 'qtl' }, { label: 'Rate/Qtl', kind: 'inr' }, { label: 'Amount', kind: 'inr' }, { label: 'Paid', kind: 'inr' }],
        rows: xs.sort((a, b) => b.date.localeCompare(a.date)).map(h => [h.date, h.receiptNumber, pname(db, h.partyId), h.quantityKg, h.ratePerQtl, h.finalTotal, sumPayments(h.payments)]),
        totals: ['', '', 'Total', sum(xs.map(h => h.quantityKg)), '', sum(xs.map(h => h.finalTotal)), sum(xs.map(h => sumPayments(h.payments)))],
      };
    }
    case 'paddy': case 'paddySuppliers': {
      const xs = db.purchases.filter(p => ok(p.date));
      if (id === 'paddySuppliers') return partyTable(grouped(xs, p => pname(db, p.partyId), p => p.netKg, p => p.finalTotal), 'Supplier');
      return {
        columns: [{ label: 'Date', kind: 'date' }, { label: 'Voucher' }, { label: 'Supplier' }, { label: 'Variety' }, { label: 'Quantity', kind: 'qtl' }, { label: 'Amount', kind: 'inr' }, { label: 'Paid', kind: 'inr' }],
        rows: xs.sort((a, b) => b.date.localeCompare(a.date)).map(p => [p.date, p.voucherNumber, pname(db, p.partyId), [...new Set(p.lines.map(l => vname(db, l.varietyId)))].join(', '), p.netKg, p.finalTotal, sumPayments(p.payments)]),
        totals: ['', '', '', 'Total', sum(xs.map(p => p.netKg)), sum(xs.map(p => p.finalTotal)), sum(xs.map(p => sumPayments(p.payments)))],
      };
    }
    case 'paddyVariety': {
      const lines = db.purchases.filter(p => ok(p.date)).flatMap(p => p.lines);
      const g = grouped(lines, l => vname(db, l.varietyId), l => l.qtyKg, l => l.amount);
      return { columns: [{ label: 'Variety' }, { label: 'Lines', kind: 'num' }, { label: 'Quantity', kind: 'qtl' }, { label: 'Amount', kind: 'inr' }, { label: 'Avg Rate/Qtl', kind: 'inr' }],
        rows: g.map(x => [x.k, x.n, x.q, round2(x.a), x.q > 0 ? round2(x.a / (x.q / 100)) : 0]), totals: ['Total', sum(g.map(x => x.n)), sum(g.map(x => x.q)), sum(g.map(x => x.a)), ''] };
    }
    case 'riceVariety': {
      const parts = db.sales.filter(s => s.productId === 'pr_rice' && ok(s.date)).flatMap(s => s.lines?.length ? s.lines.map(l => ({ v: l.varietyId || s.varietyId, kg: l.quantityKg, amt: l.amount })) : [{ v: s.varietyId, kg: s.quantityKg, amt: s.baseAmount }]);
      const g = grouped(parts, p => vname(db, p.v), p => p.kg, p => p.amt);
      return { columns: [{ label: 'Variety' }, { label: 'Lines', kind: 'num' }, { label: 'Quantity', kind: 'qtl' }, { label: 'Amount', kind: 'inr' }, { label: 'Avg Rate/Qtl', kind: 'inr' }],
        rows: g.map(x => [x.k, x.n, x.q, round2(x.a), x.q > 0 ? round2(x.a / (x.q / 100)) : 0]), totals: ['Total', sum(g.map(x => x.n)), sum(g.map(x => x.q)), sum(g.map(x => x.a)), ''] };
    }
    case 'riceCustomers': return partyTable(grouped(db.sales.filter(s => s.productId === 'pr_rice' && ok(s.date)), s => pname(db, s.partyId), s => s.quantityKg, s => s.finalTotal), 'Customer');
    case 'paddySaleParties': {
      const items = [...db.sales.filter(s => s.productId === 'pr_paddy' && ok(s.date)).map(s => ({ p: s.partyId, kg: s.quantityKg, amt: s.finalTotal })),
        ...db.dispatches.filter(d => d.productId === 'pr_paddy' && ok(d.date)).map(d => ({ p: d.partyId, kg: d.paddy?.netSaleKg || d.netKg, amt: d.finalTotal }))];
      return partyTable(grouped(items, i => pname(db, i.p), i => i.kg, i => i.amt), 'Customer');
    }
    case 'sales': {
      const xs = db.sales.filter(s => ok(s.date));
      return {
        columns: [{ label: 'Date', kind: 'date' }, { label: 'Invoice' }, { label: 'Customer' }, { label: 'Product' }, { label: 'Quantity', kind: 'qtl' }, { label: 'Amount', kind: 'inr' }, { label: 'Paid', kind: 'inr' }],
        rows: xs.sort((a, b) => b.date.localeCompare(a.date)).map(s => [s.date, s.invoiceNumber, pname(db, s.partyId), db.categories.find(c => c.id === s.productId)?.name || s.itemName || 'Sale', s.quantityKg, s.finalTotal, sumPayments(s.payments)]),
        totals: ['', '', '', 'Total', sum(xs.map(s => s.quantityKg)), sum(xs.map(s => s.finalTotal)), sum(xs.map(s => sumPayments(s.payments)))],
      };
    }
    case 'tradingSales': {
      const xs = db.trading.filter(t => ok(t.date));
      return {
        columns: [{ label: 'Date', kind: 'date' }, { label: 'Type' }, { label: 'Item' }, { label: 'Party' }, { label: 'Quantity' }, { label: 'Amount', kind: 'inr' }],
        rows: xs.sort((a, b) => b.date.localeCompare(a.date)).map(t => [t.date, t.kind === 'sell' ? 'Sale' : 'Purchase', t.itemName, t.partyId ? pname(db, t.partyId) : t.party || '', fmtTradeQty(t.qty, t.unit), t.total]),
        totals: ['', '', '', '', 'Sales − Purchases', round2(sum(xs.filter(t => t.kind === 'sell').map(t => t.total)) - sum(xs.filter(t => t.kind === 'buy').map(t => t.total)))],
      };
    }
    case 'tradingPL': {
      const pl = tradingPL(db, r.start || '0000-01-01', r.end || '9999-12-31');
      return { columns: [{ label: 'Item' }, { label: 'Bought cost', kind: 'inr' }, { label: 'Revenue', kind: 'inr' }, { label: 'COGS', kind: 'inr' }, { label: 'Profit', kind: 'inr' }, { label: 'Margin %', kind: 'num' }],
        rows: pl.rows.map(x => [x.name, x.boughtCost, x.revenue, x.cogs, x.profit, x.margin]), totals: ['Total', pl.boughtCost, pl.revenue, pl.cogs, pl.profit, ''] };
    }
    case 'dispatch': case 'paddyDispatch': case 'huskDispatch': case 'vehicle': {
      const xs = db.dispatches.filter(d => ok(d.date) && (id === 'paddyDispatch' ? !!d.paddy : id === 'huskDispatch' ? !!d.husk : true));
      const load = (d: typeof xs[number]) => d.paddy ? d.paddy.grossLoadKg : d.netKg;
      const freight = (d: typeof xs[number]) => round2(d.transportCost + (d.paddy ? d.paddy.vehicleCharges : d.husk ? 0 : d.driverBata));
      if (id === 'vehicle') {
        const g = grouped(xs, d => d.vehicleNumber?.trim() || '(No number)', load, freight);
        return { columns: [{ label: 'Vehicle' }, { label: 'Trips', kind: 'num' }, { label: 'Load', kind: 'qtl' }, { label: 'Vehicle cost', kind: 'inr' }], rows: g.map(x => [x.k, x.n, x.q, round2(x.a)]), totals: ['Total', sum(g.map(x => x.n)), sum(g.map(x => x.q)), sum(g.map(x => x.a))] };
      }
      return {
        columns: [{ label: 'Date', kind: 'date' }, { label: 'Trip' }, { label: 'Vehicle' }, { label: 'Driver' }, { label: 'Party' }, { label: 'Type' }, { label: 'Load', kind: 'qtl' }, { label: 'Amount', kind: 'inr' }],
        rows: xs.sort((a, b) => b.date.localeCompare(a.date)).map(d => [d.date, d.tripNumber || d.dispatchNumber, d.vehicleNumber || '', d.paddy?.driverName || d.husk?.driverName || '', pname(db, d.partyId), d.paddy ? 'Paddy' : d.husk ? 'Husk' : ITEM_OF[d.productId] || 'Other', load(d), dispatchDue(d)]),
        totals: ['', '', '', '', '', 'Total', sum(xs.map(load)), sum(xs.map(d => dispatchDue(d)))],
      };
    }
    case 'missing': {
      const rows: (string | number)[][] = [];
      const need = (module: string, ref: string, date: string, party: string, what: string[]) => { if (what.length) rows.push([module, ref, date, party, what.join(', ')]); };
      for (const h of db.hulling.filter(x => ok(x.date))) need('Hulling', h.receiptNumber, h.date, pname(db, h.partyId), [!h.vehicleNumber && 'vehicle no.', !db.parties.find(p => p.id === h.partyId)?.phone && 'customer phone', !(h.ratePerQtl > 0) && 'rate'].filter(Boolean) as string[]);
      for (const p of db.purchases.filter(x => ok(x.date))) need('Purchase', p.voucherNumber, p.date, pname(db, p.partyId), [!p.vehicleNumber && 'vehicle no.', !db.parties.find(x => x.id === p.partyId)?.phone && 'supplier phone', p.lines.some(l => !l.varietyId) && 'variety'].filter(Boolean) as string[]);
      for (const d of db.dispatches.filter(x => ok(x.date))) need('Dispatch', d.dispatchNumber, d.date, pname(db, d.partyId), [!d.vehicleNumber && 'vehicle no.', !(d.paddy?.driverName || d.husk?.driverName) && 'driver name'].filter(Boolean) as string[]);
      for (const s of db.sales.filter(x => ok(x.date))) need('Sales', s.invoiceNumber, s.date, pname(db, s.partyId), [!s.partyId && 'customer'].filter(Boolean) as string[]);
      for (const t of db.trading.filter(x => ok(x.date))) need('Trading', t.itemName, t.date, t.partyId ? pname(db, t.partyId) : t.party || '', [!t.partyId && !t.party && (t.kind === 'buy' ? 'supplier' : 'customer')].filter(Boolean) as string[]);
      return { columns: [{ label: 'Module' }, { label: 'Ref' }, { label: 'Date', kind: 'date' }, { label: 'Party' }, { label: 'Missing' }], rows };
    }
    default: return { columns: [], rows: [] };
  }
}

// ---------------- display / CSV helpers ----------------
export function formatCell(v: string | number, kind: Kind = 'text'): string {
  if (v === '' || v === undefined || v === null) return '';
  if (kind === 'date') return v ? fmtDate(String(v)) : '';
  if (typeof v === 'string') return v;
  if (kind === 'inr') return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(v);
  if (kind === 'qtl') return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(round2(v / 100))} Qtl`;
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v);
}
export function toCsv(t: TableData): string {
  const q = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`;
  const head = t.columns.map(c => q(c.kind === 'qtl' ? `${c.label} (Qtl)` : c.kind === 'inr' ? `${c.label} (Rs)` : c.label));
  const cell = (v: string | number, k?: Kind) => (typeof v === 'number' && k === 'qtl' ? round2(v / 100) : v);
  const lines = [head.join(',')];
  for (const r of t.rows) lines.push(r.map((c, i) => q(cell(c, t.columns[i]?.kind))).join(','));
  if (t.totals) lines.push(t.totals.map((c, i) => q(cell(c, t.columns[i]?.kind))).join(','));
  return '\ufeff' + lines.join('\n'); // BOM so Excel reads Kannada / special characters correctly
}
