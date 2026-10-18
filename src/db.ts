import type {
  Database, Settings, Payment, AuditLog, Variety, Category, BagMovement, PaddySize, TradingItem
} from './types';

// ============ UTILITIES ============
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today's date in the device's local timezone (YYYY-MM-DD) */
export const today = () => localISO(new Date());

export const now = () => new Date().toISOString();

export const fmtINR = (n: number, opts?: { decimals?: number; symbol?: boolean }): string => {
  const { decimals = 2, symbol = true } = opts || {};
  if (isNaN(n) || n === null || n === undefined) n = 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
  return symbol ? `₹${formatted}` : formatted;
};

export const fmtNumber = (n: number, decimals: number = 2): string => {
  if (isNaN(n)) n = 0;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};

export const fmtQty = (kg: number, showUnit: boolean = true): string => {
  if (isNaN(kg)) kg = 0;
  if (Math.abs(kg) >= 100) {
    const qtl = kg / 100;
    const rounded = Math.round(qtl * 100) / 100;
    return showUnit ? `${fmtNumber(rounded, 2)} Qtl` : fmtNumber(rounded, 2);
  }
  return showUnit ? `${fmtNumber(kg, 1)} kg` : fmtNumber(kg, 1);
};

/** "154 Qtl 17 Kg" style formatting (1 Qtl = 100 kg) */
export const fmtQtlKg = (kg: number): string => {
  if (!isFinite(kg)) kg = 0;
  const neg = kg < 0;
  const a = Math.abs(Math.round(kg * 100) / 100);
  const q = Math.floor(a / 100 + 1e-9);
  const r = Math.round((a - q * 100) * 100) / 100;
  const rs = Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const s = q > 0 ? (r > 0 ? `${fmtNumber(q, 0)} Qtl ${rs} Kg` : `${fmtNumber(q, 0)} Qtl`) : `${rs} Kg`;
  return (neg ? '-' : '') + s;
};

export const fmtDate = (d: string) => {
  if (!d) return '';
  try {
    const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return d; }
};

export const kgToQtl = (kg: number): number => Math.round((kg / 100) * 1000) / 1000;
export const qtlToKg = (qtl: number): number => Math.round(qtl * 100 * 10) / 10;

// ============ CALCULATION HELPERS ============
export interface GstResult {
  base: number;
  taxable: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  total: number;
}
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcGST(baseAmount: number, mode: 'none' | 'exclusive' | 'inclusive', rate: number): GstResult {
  baseAmount = round2(baseAmount);
  if (mode === 'none' || !rate) {
    return { base: baseAmount, taxable: baseAmount, cgst: 0, sgst: 0, totalTax: 0, total: baseAmount };
  }
  if (mode === 'exclusive') {
    const taxable = baseAmount;
    const cgst = round2(taxable * rate / 200);
    const sgst = cgst;
    const totalTax = round2(cgst + sgst);
    const total = round2(taxable + totalTax);
    return { base: baseAmount, taxable, cgst, sgst, totalTax, total };
  }
  // inclusive: base already includes tax
  const taxable = round2(baseAmount / (1 + rate / 100));
  const totalTax = round2(baseAmount - taxable);
  const cgst = round2(totalTax / 2);
  const sgst = round2(totalTax - cgst);
  return { base: baseAmount, taxable, cgst, sgst, totalTax, total: baseAmount };
}

export const roundUp = (n: number): number => Math.ceil(n);
export const roundDown = (n: number): number => Math.floor(n);

export function sumPayments(payments: Payment[]): number {
  return round2((payments || []).reduce((s, p) => s + Number(p.amount || 0), 0));
}

export function paymentStatus(finalTotal: number, paid: number, dueDate?: string): 'paid' | 'partial' | 'unpaid' | 'overdue' {
  if (paid >= finalTotal - 0.01) return 'paid';
  if (paid > 0) return 'partial';
  if (dueDate && dueDate < today()) return 'overdue';
  return 'unpaid';
}

/** Appends the amount typed in the "Amount Paid" box as a real payment record (only if > 0) */
export function withDraftPayment(existing: Payment[], amount: string, mode: string, date: string): Payment[] {
  const a = round2(Number(amount) || 0);
  if (a <= 0) return existing;
  return [...existing, { id: uid(), date, amount: a, mode, createdAt: now() }];
}

// ============ BAGS ============
export interface BagSummary {
  received: number;
  newIssued: number;
  oldIssued: number;
  issued: number;
  newReturned: number;
  oldReturned: number;
  returned: number;
  adjustment: number;
  pendingNew: number;
  pendingOld: number;
  pending: number;
  charge: number;
  loss: number;
}

/**
 * The customer brings paddy in bags. The mill sends bags back (new / old / mixed).
 *   pending = bags brought in − bags sent back (at purchase and later) + authorised adjustment
 * Fully returned → pending 0. Only when fewer bags are sent back does a pending amount show.
 */
export function bagSummary(movs: BagMovement[] | undefined): BagSummary {
  const s: BagSummary = {
    received: 0, newIssued: 0, oldIssued: 0, issued: 0, newReturned: 0, oldReturned: 0, returned: 0,
    adjustment: 0, pendingNew: 0, pendingOld: 0, pending: 0, charge: 0, loss: 0,
  };
  for (const m of movs || []) {
    s.received += m.bagsReceived || 0;
    s.newIssued += m.newBagsIssued || 0;
    s.oldIssued += m.oldBagsIssued || 0;
    s.newReturned += m.newBagsReturned || 0;
    s.oldReturned += m.oldBagsReturned || 0;
    s.adjustment += m.manualAdjustment || 0;
    s.charge += m.newBagCharge || 0;
    s.loss += m.newBagLoss || 0;
  }
  s.issued = s.newIssued + s.oldIssued;
  s.returned = s.newReturned + s.oldReturned;
  s.pending = s.received - s.issued - s.returned + s.adjustment;
  return s;
}

export function calcPendingBags(bag: BagMovement): number {
  return bagSummary([bag]).pending;
}

// ============ TRADING GOODS ============
export const TRADE_UNITS = ['Bag', 'Piece', 'Kg', 'Qtl', 'Litre', 'Gram', 'Bundle', 'Box', 'Bottle', 'Packet', 'Metre'];

/** "274 Bag" / "73 Kg" style — trims decimals, Indian grouping */
export const fmtTradeQty = (qty: number, unit: string): string => {
  if (!isFinite(qty)) qty = 0;
  const r = Math.round(qty * 100) / 100;
  const s = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(r);
  return unit ? `${s} ${unit}` : s;
};

/** entered quantity -> base units (pack or Qtl/Kg conversion handled) */
export function tradeQtyToBase(qty: number, qtyUnit: string, item: Pick<TradingItem, 'baseUnit' | 'packUnit' | 'packSize'>): number {
  if (!qty) return 0;
  if (qtyUnit === item.baseUnit) return round2(qty);
  if (item.packUnit && qtyUnit === item.packUnit && item.packSize) return round2(qty * item.packSize);
  if (item.baseUnit === 'Kg' && qtyUnit === 'Qtl') return round2(qty * 100);
  if (item.baseUnit === 'Qtl' && qtyUnit === 'Kg') return round2(qty / 100);
  return round2(qty);
}

/** line total for a quantity entered in qtyUnit at a rate quoted per rateUnit */
export function tradingLineTotal(qtyEntered: number, qtyUnit: string, rate: number, rateUnit: string, item: Pick<TradingItem, 'baseUnit' | 'packUnit' | 'packSize'>): number {
  const base = tradeQtyToBase(qtyEntered, qtyUnit, item);
  if (!base || !rate) return 0;
  if (rateUnit === item.baseUnit) return round2(base * rate);
  if (item.packUnit && rateUnit === item.packUnit && item.packSize) return round2((base / item.packSize) * rate);
  if (item.baseUnit === 'Kg' && rateUnit === 'Qtl') return round2((base / 100) * rate);
  if (item.baseUnit === 'Qtl' && rateUnit === 'Kg') return round2(base * 100 * rate);
  return round2(base * rate);
}

/** current stock per trading item = opening + buys − sells (base units) */
export function computeTradingStock(db: Database, upto?: string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const it of db.tradingItems || []) m[it.id] = it.openingStock || 0;
  for (const t of db.trading || []) {
    if (upto && t.date > upto) continue;
    m[t.itemId] = (m[t.itemId] ?? 0) + (t.kind === 'buy' ? t.qty : -t.qty);
  }
  for (const k of Object.keys(m)) m[k] = Math.round(m[k] * 100) / 100;
  return m;
}

/** weighted-average purchase cost per base unit (opening + buys up to a date) */
export function tradingAvgCost(db: Database, itemId: string, upto?: string): number {
  const it = db.tradingItems.find(x => x.id === itemId);
  let q = it?.openingStock || 0;
  let v = q * (it?.openingRate || 0);
  for (const t of db.trading || []) {
    if (t.itemId !== itemId || t.kind !== 'buy') continue;
    if (upto && t.date > upto) continue;
    q += t.qty; v += t.total;
  }
  return q > 0 ? v / q : 0;
}

export interface TradingPLRow {
  itemId: string; name: string; unit: string;
  boughtQty: number; boughtCost: number; soldQty: number; revenue: number;
  avgCost: number; cogs: number; profit: number; margin: number;
  closingQty: number; closingValue: number;
}

/** profit / loss per trading item for a date range (accrual: revenue − average-cost COGS) */
export function tradingPL(db: Database, from: string, to: string): {
  rows: TradingPLRow[]; boughtCost: number; revenue: number; cogs: number; profit: number;
} {
  const stock = computeTradingStock(db, to);
  const rows: TradingPLRow[] = [];
  for (const it of db.tradingItems || []) {
    let boughtQty = 0, boughtCost = 0, soldQty = 0, revenue = 0;
    for (const t of db.trading || []) {
      if (t.itemId !== it.id || t.date < from || t.date > to) continue;
      if (t.kind === 'buy') { boughtQty += t.qty; boughtCost += t.total; }
      else { soldQty += t.qty; revenue += t.total; }
    }
    boughtQty = round2(boughtQty); boughtCost = round2(boughtCost);
    soldQty = round2(soldQty); revenue = round2(revenue);
    if (!boughtQty && !soldQty) continue;
    const avgCost = tradingAvgCost(db, it.id, to);
    const cogs = round2(soldQty * avgCost);
    const profit = round2(revenue - cogs);
    const closingQty = stock[it.id] ?? (it.openingStock || 0);
    rows.push({
      itemId: it.id, name: it.name, unit: it.baseUnit,
      boughtQty, boughtCost, soldQty, revenue,
      avgCost: round2(avgCost), cogs, profit,
      margin: revenue > 0 ? round2((profit / revenue) * 100) : 0,
      closingQty, closingValue: round2(closingQty * avgCost),
    });
  }
  rows.sort((a, b) => b.profit - a.profit);
  const sum = (f: (r: TradingPLRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
  return { rows, boughtCost: sum(r => r.boughtCost), revenue: sum(r => r.revenue), cogs: sum(r => r.cogs), profit: sum(r => r.profit) };
}

/** Amount the buyer owes for a dispatch (paddy dispatches settle at revenue minus expenses). */
export function dispatchDue(d: { finalTotal: number; paddy?: { payable: number }; husk?: { netReceivable: number } }): number {
  return d.paddy ? d.paddy.payable : d.husk ? d.husk.netReceivable : d.finalTotal;
}

/** Next running trip number (TRIP-0001, TRIP-0002 …) across all dispatches. */
export function nextTripNo(dispatches: { tripNumber?: string }[]): string {
  let max = 0;
  for (const x of dispatches) { const m = /(\d+)\s*$/.exec(x.tripNumber || ''); if (m) max = Math.max(max, Number(m[1])); }
  return `TRIP-${String(max + 1).padStart(4, '0')}`;
}

// ============ PADDY LOTS (FIFO) ============
export interface PaddyLot {
  key: string; // purchaseId:lineIdx  or  adj:adjustmentId
  source: 'purchase' | 'adjustment';
  purchaseId?: string;
  lineIdx?: number;
  date: string;
  party?: string;
  ratePerQtl?: number;
  qtyInitialKg: number;
  qtyLeftKg: number;
}
export interface PaddyLotsResult { byVariety: Record<string, PaddyLot[]> }

/**
 * Replays all paddy movements in date order and returns the remaining quantity
 * per purchase lot per variety (FIFO: oldest lots are consumed first).
 * Production inputs with recorded lot allocations consume their exact lots;
 * every other outflow is consumed FIFO from the oldest remaining lot.
 */
export function computePaddyLots(db: Database, opts?: { excludeBatchId?: string; excludeDispatchId?: string }): PaddyLotsResult {
  const lots: Record<string, PaddyLot[]> = {};
  type Evt = { date: string; kind: 'in' | 'out'; seq: number; run: () => void };
  const evts: Evt[] = [];
  let seq = 0;
  const nameOf = (id?: string) => db.parties.find(p => p.id === id)?.name;

  for (const p of db.purchases) {
    const lines = p.lines && p.lines.length ? p.lines : [{ varietyId: p.varietyId, qtyKg: p.netKg, ratePerQtl: p.ratePerQtl }];
    lines.forEach((l, li) => {
      if (!(l.qtyKg > 0)) return;
      const purchaseId = p.id, idx = li, key = `${p.id}:${li}`;
      evts.push({ date: p.date, kind: 'in', seq: seq++, run: () => {
        (lots[l.varietyId] ||= []).push({
          key, source: 'purchase', purchaseId, lineIdx: idx, date: p.date,
          party: nameOf(p.partyId), ratePerQtl: l.ratePerQtl,
          qtyInitialKg: l.qtyKg, qtyLeftKg: l.qtyKg,
        });
      }});
    });
  }
  for (const a of db.stockAdjustments) {
    if (a.itemType !== 'paddy' || !a.varietyId) continue;
    const kg = a.quantityKg || 0;
    if (kg > 0) {
      const vid = a.varietyId, key = `adj:${a.id}`;
      evts.push({ date: a.date, kind: 'in', seq: seq++, run: () => {
        (lots[vid] ||= []).push({ key, source: 'adjustment', date: a.date, qtyInitialKg: kg, qtyLeftKg: kg });
      }});
    }
  }

  const fifo = (vid: string, qty: number) => {
    let left = qty;
    for (const lot of lots[vid] || []) {
      if (left <= 0) break;
      const take = Math.min(lot.qtyLeftKg, left);
      lot.qtyLeftKg = round2(Math.max(0, lot.qtyLeftKg - take));
      left = round2(left - take);
    }
  };
  const exact = (vid: string, key: string, qty: number) => {
    const lot = (lots[vid] || []).find(x => x.key === key);
    if (!lot) { fifo(vid, qty); return; }
    lot.qtyLeftKg = round2(Math.max(0, lot.qtyLeftKg - qty));
  };

  const out = (date: string, run: () => void) => evts.push({ date, kind: 'out', seq: seq++, run });
  for (const b of db.production) {
    if (opts?.excludeBatchId === b.id) continue;
    const inputs = b.inputs && b.inputs.length ? b.inputs : [{ varietyId: b.paddyVarietyId, qtyKg: b.paddyInputKg }];
    out(b.date, () => {
      for (const i of inputs) {
        if (!(i.qtyKg > 0)) continue;
        if (i.lots && i.lots.length) for (const l of i.lots) exact(i.varietyId, l.key, l.qtyKg);
        else fifo(i.varietyId, i.qtyKg);
      }
    });
  }
  for (const s of db.sales) {
    if (s.productId !== 'pr_paddy') continue;
    const lines = s.lines && s.lines.length ? s.lines : [{ varietyId: s.varietyId, quantityKg: s.quantityKg }];
    out(s.date, () => { for (const l of lines) if (l.varietyId && l.quantityKg > 0) fifo(l.varietyId, l.quantityKg); });
  }
  for (const d of db.dispatches) {
    if (opts?.excludeDispatchId === d.id) continue;
    if (d.paddy?.allocations?.length) {
      const allocs = d.paddy.allocations;
      out(d.date, () => { for (const a of allocs) if (a.qtyKg > 0) exact(a.varietyId, a.key, a.qtyKg); });
      continue;
    }
    if (d.productId !== 'pr_paddy' || !d.varietyId) continue;
    out(d.date, () => fifo(d.varietyId!, d.netKg));
  }
  for (const a of db.stockAdjustments) {
    if (a.itemType !== 'paddy' || !a.varietyId || (a.quantityKg || 0) >= 0) continue;
    out(a.date, () => fifo(a.varietyId!, Math.abs(a.quantityKg!)));
  }

  evts.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.seq - b.seq : a.kind === 'in' ? -1 : 1) || a.seq - b.seq);
  evts.forEach(e => e.run());
  for (const v of Object.keys(lots)) {
    for (const l of lots[v]) l.qtyLeftKg = round2(Math.max(0, l.qtyLeftKg));
    lots[v].sort((a, b) => a.date.localeCompare(b.date));
  }
  return { byVariety: lots };
}

/** Allocate qtyKg from oldest remaining lots first (does not mutate the given array). */
export function allocateFifoLots(lots: PaddyLot[], qtyKg: number): { key: string; qtyKg: number }[] {
  const out: { key: string; qtyKg: number }[] = [];
  let left = qtyKg;
  for (const lot of lots) {
    if (left <= 0) break;
    if (lot.qtyLeftKg <= 0) continue;
    const take = Math.min(lot.qtyLeftKg, left);
    out.push({ key: lot.key, qtyKg: round2(take) });
    left = round2(left - take);
  }
  return out;
}

const DEFAULT_SETTINGS: Settings = {
  millName: 'Shri Parshwanatha Rice Mill',
  address: 'Bellow Sullalli, Sagara Taluk, Shivamogga District, Karnataka',
  phone: '',
  gstin: '',
  receiptFooter: 'Thank you for your business!',
  defaultHullingRate: 150,
  defaultBagCost: 0,
  defaultGstRate: 0,
  taxMode: 'none',
  currency: 'INR',
  minStockQtl: { paddy: 0, rice: 0, bran: 0, husk: 0 },
  invoicePrefixes: { hulling: 'HUL', purchase: 'PUR', dispatch: 'DSP', sale: 'SAL', batch: 'PROD' },
  nextNumbers: { hulling: 1, purchase: 1, dispatch: 1, sale: 1, batch: 1 },
};

const DEFAULT_VARIETIES: Variety[] = [
  { id: 'var_kempakki', name: 'Kempakki (Malnad Red)', category: 'small', usage: ['paddy', 'rice'], active: true },
  { id: 'var_jaya', name: 'Jaya', category: 'big', usage: ['paddy', 'rice'], active: true },
  { id: 'var_sona', name: 'Sona Masuri', category: 'small', usage: ['paddy', 'rice'], active: true },
  { id: 'var_other', name: 'Other', category: 'other', usage: ['paddy', 'rice'], active: true },
];

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'pm_cash', name: 'Cash', type: 'payment_mode', active: true },
  { id: 'pm_upi', name: 'UPI', type: 'payment_mode', active: true },
  { id: 'pm_bank', name: 'Bank Transfer', type: 'payment_mode', active: true },
  { id: 'pm_cheque', name: 'Cheque', type: 'payment_mode', active: true },
  { id: 'pm_other', name: 'Other', type: 'payment_mode', active: true },
  { id: 'exp_repairs', name: 'Repairs & Machinery', type: 'expense', active: true },
  { id: 'exp_electrical', name: 'Electrical', type: 'expense', active: true },
  { id: 'exp_transport', name: 'Transport', type: 'expense', active: true },
  { id: 'exp_loading', name: 'Loading/Unloading', type: 'expense', active: true },
  { id: 'exp_fuel', name: 'Fuel', type: 'expense', active: true },
  { id: 'exp_office', name: 'Office', type: 'expense', active: true },
  { id: 'exp_maint', name: 'Maintenance', type: 'expense', active: true },
  { id: 'exp_wages', name: 'Wages', type: 'expense', active: true },
  { id: 'exp_other', name: 'Other', type: 'expense', active: true },
  { id: 'pr_paddy', name: 'Paddy', type: 'product', active: true },
  { id: 'pr_rice', name: 'Rice', type: 'product', active: true },
  { id: 'pr_broken', name: 'Broken Rice', type: 'product', active: true },
  { id: 'pr_bran', name: 'Bran', type: 'product', active: true },
  { id: 'pr_husk', name: 'Husk', type: 'product', active: true },
  { id: 'pr_other', name: 'Other', type: 'product', active: true },
  { id: 'wt_hulling', name: 'Hulling', type: 'work_type', active: true },
  { id: 'wt_loading', name: 'Loading', type: 'work_type', active: true },
  { id: 'wt_unloading', name: 'Unloading', type: 'work_type', active: true },
  { id: 'wt_cleaning', name: 'Cleaning', type: 'work_type', active: true },
  { id: 'wt_other', name: 'Other', type: 'work_type', active: true },
];

const DEFAULT_TRADING_ITEMS: Omit<TradingItem, 'createdAt' | 'updatedAt'>[] = [
  { id: 'td_salt', name: 'Salt', baseUnit: 'Bag', rateUnits: ['Bag'], active: true },
  { id: 'td_diesel', name: 'Diesel', baseUnit: 'Litre', rateUnits: ['Litre'], active: true },
  { id: 'td_apple5', name: 'Apple Rice 5kg', baseUnit: 'Kg', rateUnits: ['Kg', 'Bag'], packUnit: 'Bag', packSize: 5, active: true },
  { id: 'td_apple10', name: 'Apple Rice 10kg', baseUnit: 'Kg', rateUnits: ['Kg', 'Bag'], packUnit: 'Bag', packSize: 10, active: true },
  { id: 'td_bag50', name: 'Empty Bag 50kg', baseUnit: 'Bag', rateUnits: ['Bag'], active: true },
  { id: 'td_bag25', name: 'Empty Bag 25kg', baseUnit: 'Bag', rateUnits: ['Bag'], active: true },
  { id: 'td_bag10', name: 'Empty Bag 10kg', baseUnit: 'Bag', rateUnits: ['Bag'], active: true },
  { id: 'td_bran', name: 'Bran', baseUnit: 'Kg', rateUnits: ['Kg', 'Qtl'], active: true },
];

const STORAGE_KEY = 'sprm_ricemill_db_v1';

export function newDB(): Database {
  return {
    version: 3,
    parties: [], hulling: [], purchases: [], production: [], dispatches: [], sales: [],
    expenses: [], labour: [], electricity: [], cashbook: [], stockAdjustments: [], auditLog: [],
    varieties: DEFAULT_VARIETIES.map(v => ({ ...v })),
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    tradingItems: DEFAULT_TRADING_ITEMS.map(t => ({ ...t, rateUnits: [...t.rateUnits], createdAt: now(), updatedAt: now() })),
    trading: [],
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  };
}

export function sizeForVariety(db: Database, varietyId: string): PaddySize {
  const v = db.varieties.find(x => x.id === varietyId);
  return v?.category === 'big' ? 'big' : 'small';
}

/** Upgrades data saved by older versions so nothing the owner already entered is lost. */
export function migrateDB(raw: any): Database {
  const base = newDB();
  const db: Database = { ...base, ...raw };
  const rs = raw?.settings || {};
  db.settings = {
    ...base.settings, ...rs,
    minStockQtl: { ...base.settings.minStockQtl, ...(rs.minStockQtl || {}) },
    invoicePrefixes: { ...base.settings.invoicePrefixes, ...(rs.invoicePrefixes || {}) },
    nextNumbers: { ...base.settings.nextNumbers, ...(rs.nextNumbers || {}) },
  };
  const arr = (k: keyof Database) => { if (!Array.isArray((db as any)[k])) (db as any)[k] = []; };
  (['parties', 'hulling', 'purchases', 'production', 'dispatches', 'sales', 'expenses', 'labour', 'electricity', 'cashbook', 'stockAdjustments', 'auditLog'] as (keyof Database)[]).forEach(arr);
  if (!db.varieties?.length) db.varieties = base.varieties;
  // give older dispatches a running trip number (oldest first) so the Vehicle section can list them
  {
    const missing = db.dispatches.filter(x => !x.tripNumber).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
    for (const x of missing) x.tripNumber = nextTripNo(db.dispatches);
  }
  db.varieties = db.varieties.map(v => ({ ...v, usage: v.usage?.length ? v.usage : ['paddy', 'rice'] }));
  if (!db.categories?.length) db.categories = base.categories;
  if (!('tradingItems' in (raw || {})) || !Array.isArray((db as any).tradingItems)) {
    db.tradingItems = base.tradingItems.map(t => ({ ...t, rateUnits: [...t.rateUnits] }));
  } else {
    db.tradingItems = db.tradingItems.map((t: any) => ({
      ...t,
      rateUnits: Array.isArray(t.rateUnits) && t.rateUnits.length ? [...new Set([t.baseUnit || 'Piece', ...t.rateUnits])] : [t.baseUnit || 'Piece'],
      active: t.active ?? true,
    }));
  }
  if (!Array.isArray((db as any).trading)) (db as any).trading = [];
  db.purchases = db.purchases.map((p: any) => {
    const q = { ...p };
    q.bagMovements = Array.isArray(q.bagMovements) ? q.bagMovements : [];
    q.payments = Array.isArray(q.payments) ? q.payments : [];
    if (!Array.isArray(q.lines) || q.lines.length === 0) {
      q.lines = [{
        id: uid(), varietyId: q.varietyId, size: sizeForVariety(db, q.varietyId),
        bags: q.bagMovements[0]?.bagsReceived || 0, qtyKg: q.netKg || 0,
        ratePerQtl: q.ratePerQtl || 0, amount: q.baseAmount || 0,
      }];
    }
    return q;
  });
  if (rs.invoicePrefixes?.batch === 'BAT') db.settings.invoicePrefixes.batch = 'PROD';
  db.production = db.production.map((b: any) => ({
    ...b,
    paddyType: b.paddyType || sizeForVariety(db, b.paddyVarietyId) || 'small',
    mode: b.mode || 'fifo',
    inputs: Array.isArray(b.inputs) && b.inputs.length ? b.inputs : b.paddyVarietyId ? [{ varietyId: b.paddyVarietyId, qtyKg: b.paddyInputKg || 0 }] : [],
    outputs: {
      ...b.outputs,
      branKg: b.outputs?.branKg || 0, brokenRiceKg: b.outputs?.brokenRiceKg || 0,
      huskKg: b.outputs?.huskKg || 0, otherKg: b.outputs?.otherKg || 0,
    },
  }));
  db.sales = db.sales.map((s: any) => ({
    ...s,
    lines: Array.isArray(s.lines) && s.lines.length ? s.lines : [{
      id: uid(), varietyId: s.varietyId, itemName: s.itemName,
      quantityKg: s.quantityKg || 0, rate: s.ratePerQtl || 0, rateUnit: 'qtl', amount: s.baseAmount || 0,
    }],
  }));
  db.version = 3;
  return db;
}

export function loadDB(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return newDB();
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.version) return newDB();
    return migrateDB(parsed);
  } catch {
    return newDB();
  }
}

/** Returns false when the browser storage is full / unavailable so the UI can warn the owner */
export function saveDB(db: Database): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

// ============ STOCK LEDGER COMPUTATION ============
export interface SizeBuckets { small: number; big: number; other: number }
export interface StockLedger {
  paddyByVariety: Record<string, number>; // kg
  paddyBySize: SizeBuckets;
  paddyDispatchedBySize: SizeBuckets;
  paddySpent: number;
  paddyPurchasedKg: number;
  riceByVariety: Record<string, number>;
  brokenKg: number;
  branKg: number;
  huskKg: number;
  newBags: number;
  oldBags: number;
  /** empty rice packing bags held in stock */
  riceBags25: number;
  riceBags10: number;
  otherByProductKg: number;
  avgBagCost: number;
}

export function computeStock(db: Database): StockLedger {
  const stock: StockLedger = {
    paddyByVariety: {},
    paddyBySize: { small: 0, big: 0, other: 0 },
    paddyDispatchedBySize: { small: 0, big: 0, other: 0 },
    paddySpent: 0,
    paddyPurchasedKg: 0,
    riceByVariety: {},
    brokenKg: 0, branKg: 0, huskKg: 0,
    newBags: 0, oldBags: 0, riceBags25: 0, riceBags10: 0, otherByProductKg: 0,
    avgBagCost: 0,
  };
  const catOf = (vId?: string): keyof SizeBuckets => {
    const c = db.varieties.find(v => v.id === vId)?.category;
    return c === 'small' || c === 'big' ? c : 'other';
  };
  const addPaddy = (vId: string | undefined, kg: number) => {
    if (!vId) return;
    stock.paddyByVariety[vId] = (stock.paddyByVariety[vId] || 0) + kg;
  };
  const addRice = (vId: string | undefined, kg: number) => {
    if (!vId) return;
    stock.riceByVariety[vId] = (stock.riceByVariety[vId] || 0) + kg;
  };

  // Purchases: paddy in, bags out/in
  for (const p of db.purchases) {
    const lines = p.lines && p.lines.length ? p.lines : [{ varietyId: p.varietyId, size: 'small' as PaddySize, qtyKg: p.netKg }];
    for (const l of lines) {
      addPaddy(l.varietyId, l.qtyKg);
      stock.paddyBySize[l.size === 'big' ? 'big' : 'small'] += l.qtyKg;
      stock.paddyPurchasedKg += l.qtyKg;
    }
    stock.paddySpent += p.finalTotal;
    for (const bm of p.bagMovements || []) {
      // customer's bags come in (old/reusable stock), mill's new + old bags go back out
      stock.newBags -= (bm.newBagsIssued || 0) + (bm.newBagsReturned || 0);
      stock.oldBags += (bm.bagsReceived || 0) + (bm.bagsReturned || 0) - (bm.oldBagsIssued || 0) - (bm.oldBagsReturned || 0);
    }
  }

  // Production: paddy consumed, outputs produced
  for (const prod of db.production) {
    const prodInputs = prod.inputs && prod.inputs.length ? prod.inputs : [{ varietyId: prod.paddyVarietyId, qtyKg: prod.paddyInputKg }];
    for (const i of prodInputs) {
      addPaddy(i.varietyId, -i.qtyKg);
      stock.paddyBySize[catOf(i.varietyId)] -= i.qtyKg;
    }
    addRice(prod.outputs.riceVarietyId, prod.outputs.riceKg);
    stock.brokenKg += prod.outputs.brokenRiceKg;
    stock.branKg += prod.outputs.branKg;
    stock.huskKg += prod.outputs.huskKg;
    stock.otherByProductKg += prod.outputs.otherKg;
  }

  const out = (productId: string, varietyId: string | undefined, kg: number) => {
    if (productId === 'pr_rice') addRice(varietyId, -kg);
    else if (productId === 'pr_paddy') {
      addPaddy(varietyId, -kg);
      stock.paddyBySize[catOf(varietyId)] -= kg;
      stock.paddyDispatchedBySize[catOf(varietyId)] += kg;
    }
    else if (productId === 'pr_broken') stock.brokenKg -= kg;
    else if (productId === 'pr_bran') stock.branKg -= kg;
    else if (productId === 'pr_husk') stock.huskKg -= kg;
    else stock.otherByProductKg -= kg; // pr_other and owner-configured future sale items
  };
  for (const d of db.dispatches) {
    if (d.paddy?.allocations?.length) { for (const a of d.paddy.allocations) out('pr_paddy', a.varietyId, a.qtyKg); }
    else out(d.productId, d.varietyId, d.netKg);
  }
  for (const s of db.sales) {
    if ((s.productId === 'pr_rice' || s.productId === 'pr_paddy') && s.lines?.length) {
      for (const line of s.lines) out(s.productId, line.varietyId || s.varietyId, line.quantityKg);
    } else out(s.productId, s.varietyId, s.quantityKg);
    // rice sold in 25kg / 10kg packs consumes those empty packing bags
    if (s.productId === 'pr_rice') {
      for (const line of s.lines || []) {
        stock.riceBags25 -= line.bags25 || 0;
        stock.riceBags10 -= line.bags10 || 0;
      }
    }
  }

  // Stock adjustments (signed) + average cost of new bags
  let bagQty = 0, bagVal = 0;
  for (const sa of db.stockAdjustments) {
    const kg = sa.quantityKg || 0;
    if (sa.itemType === 'paddy') { addPaddy(sa.varietyId, kg); stock.paddyBySize[catOf(sa.varietyId)] += kg; }
    else if (sa.itemType === 'rice') addRice(sa.varietyId, kg);
    else if (sa.itemType === 'broken') stock.brokenKg += kg;
    else if (sa.itemType === 'bran') stock.branKg += kg;
    else if (sa.itemType === 'husk') stock.huskKg += kg;
    else if (sa.itemType === 'new-bags') {
      const q = sa.quantityBags || 0;
      stock.newBags += q;
      if (q > 0 && (sa.unitCost || 0) > 0) { bagQty += q; bagVal += q * (sa.unitCost || 0); }
    }
    else if (sa.itemType === 'old-bags') stock.oldBags += sa.quantityBags || 0;
    else if (sa.itemType === 'rice-bag-25') stock.riceBags25 += sa.quantityBags || 0;
    else if (sa.itemType === 'rice-bag-10') stock.riceBags10 += sa.quantityBags || 0;
    else if (sa.itemType === 'other') stock.otherByProductKg += kg;
  }
  stock.avgBagCost = bagQty > 0 ? round2(bagVal / bagQty) : (db.settings.defaultBagCost || 0);
  return stock;
}

// ============ LEDGER COMPUTATION ============
export interface PartyLedgerEntry {
  date: string;
  module: string;
  description: string;
  debit: number; // party owes us more
  credit: number; // we owe party more / payment received
  balance: number;
  refId?: string;
}

export function computePartyLedger(db: Database, partyId: string): { entries: PartyLedgerEntry[]; balance: number; bagBalance: number } {
  const entries: PartyLedgerEntry[] = [];
  const party = db.parties.find(p => p.id === partyId);
  const opening = party?.openingBalance || 0;
  let bagBal = 0;

  const add = (date: string, module: string, desc: string, debit: number, credit: number, refId?: string) => {
    entries.push({ date, module, description: desc, debit, credit, balance: 0, refId });
  };

  for (const h of db.hulling.filter(x => x.partyId === partyId)) {
    add(h.date, 'Hulling', `Hulling #${h.receiptNumber} - ${fmtQtlKg(h.quantityKg)}`, h.finalTotal, 0, h.id);
    for (const p of h.payments) add(p.date, 'Payment', `Payment received (${p.mode})`, 0, p.amount, h.id);
  }
  for (const pu of db.purchases.filter(x => x.partyId === partyId)) {
    add(pu.date, 'Purchase', `Purchase #${pu.voucherNumber} - ${fmtQtlKg(pu.netKg)}`, 0, pu.finalTotal, pu.id);
    for (const p of pu.payments) add(p.date, 'Payment', `Payment made (${p.mode})`, p.amount, 0, pu.id);
    bagBal += bagSummary(pu.bagMovements).pending;
  }
  for (const d of db.dispatches.filter(x => x.partyId === partyId)) {
    add(d.date, 'Dispatch', `Dispatch #${d.dispatchNumber} - ${fmtQtlKg(d.netKg)}`, dispatchDue(d), 0, d.id);
    for (const p of d.payments) add(p.date, 'Payment', `Payment received (${p.mode})`, 0, p.amount, d.id);
  }
  for (const s of db.sales.filter(x => x.partyId === partyId)) {
    add(s.date, 'Sale', `Sale #${s.invoiceNumber} - ${fmtQtlKg(s.quantityKg)}`, s.finalTotal, 0, s.id);
    for (const p of s.payments) add(p.date, 'Payment', `Payment received (${p.mode})`, 0, p.amount, s.id);
  }
  for (const e of db.expenses.filter(x => x.partyId === partyId)) {
    const cat = db.categories.find(c => c.id === e.categoryId);
    add(e.date, 'Expense', `Expense: ${cat?.name || e.categoryId}`, 0, e.amount, e.id);
    for (const p of e.payments) add(p.date, 'Payment', `Payment made (${p.mode})`, p.amount, 0, e.id);
  }
  for (const l of db.labour.filter(x => x.workerPartyId === partyId)) {
    add(l.date, 'Labour', `Labour (${l.workType})`, 0, l.totalAmount, l.id);
    for (const p of l.payments) add(p.date, 'Payment', `Wage paid (${p.mode})`, p.amount, 0, l.id);
  }
  // Only MANUAL cashbook entries - payments linked to bills are already counted above (no double counting)
  for (const c of db.cashbook.filter(x => x.partyId === partyId && !x.linkedEntryId)) {
    if (c.type === 'receipt') add(c.date, 'Cash Receipt', c.description || 'Receipt', 0, c.amount);
    else if (c.type === 'payment') add(c.date, 'Cash Payment', c.description || 'Payment', c.amount, 0);
  }

  entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let run = opening;
  for (const e of entries) {
    run = round2(run + e.debit - e.credit);
    e.balance = run;
  }
  if (opening) {
    entries.unshift({
      date: '', module: 'Opening', description: 'Opening balance',
      debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, balance: opening,
    });
  }
  return { entries, balance: round2(run), bagBalance: bagBal };
}

export function allPartyBalances(db: Database): Record<string, number> {
  const map: Record<string, number> = {};
  for (const p of db.parties) map[p.id] = computePartyLedger(db, p.id).balance;
  return map;
}

// ============ NEXT NUMBER ============
export function nextReceipt(db: Database, type: keyof Settings['nextNumbers'], prefix: string) {
  const n = db.settings.nextNumbers[type];
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

export function incrementNext(db: Database, type: keyof Settings['nextNumbers']) {
  db.settings.nextNumbers[type] += 1;
}

// ============ AUDIT ============
export function log(db: Database, action: AuditLog['action'], module: string, description: string, entryId?: string, details?: any) {
  db.auditLog.unshift({ id: uid(), timestamp: now(), action, module, description, entryId, details });
  if (db.auditLog.length > 2000) db.auditLog.length = 2000;
}

// ============ DATE FILTERS ============
export interface DateRange {
  start?: string;
  end?: string;
  preset?: 'today' | 'yesterday' | 'week' | 'month' | 'custom' | 'all';
}
export function inRange(date: string, range: DateRange): boolean {
  const p = range.preset;
  if (!p || p === 'all') return true;
  const t = today();
  if (p === 'today') return date === t;
  if (p === 'yesterday') {
    const y = new Date(); y.setDate(y.getDate() - 1);
    return date === localISO(y);
  }
  if (p === 'week') {
    const n = new Date();
    const s = new Date(n); s.setDate(n.getDate() - ((n.getDay() + 6) % 7)); // Monday
    const e = new Date(s); e.setDate(s.getDate() + 6);
    return date >= localISO(s) && date <= localISO(e);
  }
  if (p === 'month') return date.slice(0, 7) === t.slice(0, 7);
  if (p === 'custom') {
    if (range.start && date < range.start) return false;
    if (range.end && date > range.end) return false;
    return true;
  }
  return true;
}
