import React, { useMemo, useRef, useState } from 'react';
import { useDB } from '../context';
import {
  calcGST, fmtDate, fmtINR, fmtQtlKg, inRange, paymentStatus,
  round2, sumPayments, today, uid, withDraftPayment,
} from '../db';
import type { Payment, SaleEntry, SaleLine } from '../types';
import type { DateFilterValue } from './ui';
import {
  Badge, Button, Card, Confirm, DateFilter, EmptyState, GSTPanel, Input, MiniBtn, Modal,
  PayBox, PhotoAttach, QtyInput, SearchBar, Select, toast,
} from './ui';
import { PartyInput, TaxSummary, useEnsureParty, usePaymentModes, partyName, statusBadge, AddPaymentModal } from './pages';
import { printHtml, shareText, VOUCHER_CSS, esc } from '../utils/print';

type RateUnit = 'qtl' | 'kg';
type PaddySizeSel = 'small' | 'big' | '';
type PaddyLineState = { id: string; varietyId: string; size: PaddySizeSel; qtyKg: number; rate: string };
type RiceLineState = { id: string; varietyId: string; bags25: string; bags10: string; looseKg: string; rate: string; rateUnit: RateUnit };
type SaleSave = Omit<SaleEntry, 'id' | 'createdAt' | 'updatedAt' | 'invoiceNumber'>;

const CORE = ['pr_paddy', 'pr_rice', 'pr_bran', 'pr_husk'];
const PRODUCT_STYLE: Record<string, { icon: string; title: string; sub: string; active: string; banner: string; soft: string }> = {
  pr_paddy: { icon: '🌾', title: 'Paddy', sub: 'Selling raw paddy from stock', active: 'bg-[#d89a54] text-white border-[#d89a54]', banner: 'from-[#cb831f] to-[#dda565]', soft: 'bg-amber-50 border-amber-200' },
  pr_rice: { icon: '🍚', title: 'Rice', sub: 'Selling milled rice — variety-wise', active: 'bg-[#08795d] text-white border-[#08795d]', banner: 'from-[#004b36] to-[#08795d]', soft: 'bg-emerald-50 border-emerald-200' },
  pr_bran: { icon: '🌿', title: 'Bran', sub: 'Selling rice bran by weight', active: 'bg-[#a8652f] text-white border-[#a8652f]', banner: 'from-[#914806] to-[#b8753c]', soft: 'bg-orange-50 border-orange-200' },
  pr_husk: { icon: '🌱', title: 'Husk', sub: 'Selling paddy husk by weight', active: 'bg-[#607b33] text-white border-[#607b33]', banner: 'from-[#406315] to-[#6c8341]', soft: 'bg-lime-50 border-lime-200' },
  pr_broken: { icon: '🍚', title: 'Broken Rice', sub: 'Selling broken rice by weight', active: 'bg-[#526b7a] text-white border-[#526b7a]', banner: 'from-slate-700 to-slate-500', soft: 'bg-slate-50 border-slate-200' },
  other: { icon: '📦', title: 'Other', sub: 'Selling another configured stock item', active: 'bg-slate-700 text-white border-slate-700', banner: 'from-slate-700 to-slate-500', soft: 'bg-slate-50 border-slate-200' },
};

const amountFor = (kg: number, rate: number, unit: RateUnit) => round2(unit === 'kg' ? kg * rate : (kg / 100) * rate);

export function SalesPage() {
  const { db, stock, addSale, updateSale, deleteSale, addSalePayment } = useDB();
  const modes = usePaymentModes();
  const [product, setProduct] = useState('all');
  const [search, setSearch] = useState('');
  const [dateF, setDateF] = useState<DateFilterValue>({ preset: 'all' });
  const [sort, setSort] = useState('date-desc');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SaleEntry | null>(null);
  const [view, setView] = useState<SaleEntry | null>(null);
  const [pay, setPay] = useState<SaleEntry | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const products = db.categories.filter(c => c.type === 'product' && c.active);

  const entries = useMemo(() => {
    let xs = [...db.sales];
    if (product !== 'all') xs = xs.filter(x => x.productId === product);
    if (search.trim()) {
      const q = search.toLowerCase();
      xs = xs.filter(x => x.invoiceNumber.toLowerCase().includes(q) || partyName(db, x.partyId).toLowerCase().includes(q) || (x.itemName || '').toLowerCase().includes(q) || x.lines?.some(l => (l.itemName || '').toLowerCase().includes(q) || (db.varieties.find(v => v.id === l.varietyId)?.name || '').toLowerCase().includes(q)));
    }
    xs = xs.filter(x => inRange(x.date, dateF));
    xs.sort((a, b) => sort === 'date-asc' ? a.date.localeCompare(b.date) : sort === 'qty-asc' ? a.quantityKg - b.quantityKg : sort === 'qty-desc' ? b.quantityKg - a.quantityKg : sort === 'amt-asc' ? a.finalTotal - b.finalTotal : sort === 'amt-desc' ? b.finalTotal - a.finalTotal : b.date.localeCompare(a.date));
    return xs;
  }, [db, product, search, dateF, sort]);

  const total = entries.reduce((s, x) => s + x.finalTotal, 0);
  const qty = entries.reduce((s, x) => s + x.quantityKg, 0);
  const stockRibbon = [
    { id: 'pr_paddy', name: 'Paddy', kg: Object.values(stock.paddyByVariety).reduce((a, b) => a + b, 0), color: '#d89a54' },
    { id: 'pr_rice', name: 'Rice', kg: Object.values(stock.riceByVariety).reduce((a, b) => a + b, 0), color: '#08795d' },
    { id: 'pr_bran', name: 'Bran', kg: stock.branKg, color: '#a8652f' },
    { id: 'pr_husk', name: 'Husk', kg: stock.huskKg, color: '#607b33' },
  ];

  return <div className="p-3 pb-8 space-y-3">
    <div className="overflow-x-auto -mx-3 px-3"><div className="flex gap-2 min-w-max pb-1">
      {stockRibbon.map(x => <button key={x.id} onClick={() => setProduct(x.id)} className="px-3 py-2 rounded-full border border-gray-200 bg-white text-xs font-bold shadow-sm"><span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ background: x.color }} />{x.name}: {fmtQtlKg(x.kg)}</button>)}
    </div></div>
    <div className="overflow-x-auto -mx-3 px-3"><div className="flex gap-2 min-w-max pb-1">
      <button onClick={() => setProduct('all')} className={`px-3 py-2 rounded-xl border text-xs font-bold ${product === 'all' ? 'bg-forest-800 text-white' : 'bg-white border-gray-200'}`}>All Sales</button>
      {products.map(p => { const st = PRODUCT_STYLE[p.id] || PRODUCT_STYLE.other; return <button key={p.id} onClick={() => setProduct(p.id)} className={`px-3 py-2 rounded-xl border text-xs font-bold ${product === p.id ? st.active : 'bg-white border-gray-200 text-gray-600'}`}>{st.icon} {p.name}</button>; })}
    </div></div>
    <Button className="w-full" onClick={() => { setEditing(null); setShowForm(true); }}>＋ New Sale</Button>
    <SearchBar value={search} onChange={setSearch} placeholder="Customer, invoice, item, variety…" />
    <DateFilter value={dateF} onChange={setDateF} />
    <Select value={sort} onChange={e => setSort(e.target.value)} options={[{ value: 'date-desc', label: 'Newest first' }, { value: 'date-asc', label: 'Oldest first' }, { value: 'qty-asc', label: 'Qty: small → large' }, { value: 'qty-desc', label: 'Qty: large → small' }, { value: 'amt-asc', label: 'Amount: low → high' }, { value: 'amt-desc', label: 'Amount: high → low' }]} />
    {entries.length > 0 && <div className="grid grid-cols-3 gap-2 text-center text-xs bg-white border border-gray-100 rounded-xl p-2 shadow-sm"><div><span className="text-gray-400">Records</span><b className="block">{entries.length}</b></div><div><span className="text-gray-400">Qty</span><b className="block">{fmtQtlKg(qty)}</b></div><div><span className="text-gray-400">Amount</span><b className="block text-forest-700">{fmtINR(total)}</b></div></div>}
    <Card>
      {entries.length === 0 ? <EmptyState title={`No ${product === 'all' ? '' : products.find(p => p.id === product)?.name || ''} sales yet`} subtitle="Tap New Sale to create the first invoice." /> : entries.map(s => {
        const st = PRODUCT_STYLE[s.productId] || PRODUCT_STYLE.other; const paid = sumPayments(s.payments); const ps = paymentStatus(s.finalTotal, paid); const pName = db.categories.find(c => c.id === s.productId)?.name || s.itemName || 'Sale';
        return <div key={s.id} className="p-3 border-b border-gray-100 last:border-0">
          <div className="flex gap-2 items-start cursor-pointer" onClick={() => setView(s)}><span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl border ${st.soft}`}>{st.icon}</span><div className="flex-1 min-w-0"><div className="flex gap-1.5 items-center flex-wrap"><Badge tone="green">{s.invoiceNumber}</Badge><b className="text-sm truncate">{partyName(db, s.partyId)}</b></div><div className="text-[11px] text-gray-500">{fmtDate(s.date)} · {pName} · {fmtQtlKg(s.quantityKg)}</div>{s.lines && s.lines.length > 1 && <div className="text-[10px] text-gray-500 mt-1">{s.lines.map(l => `${db.varieties.find(v => v.id === l.varietyId)?.name || l.itemName || pName}: ${fmtQtlKg(l.quantityKg)}`).join(' · ')}</div>}</div><div className="text-right"><b className="text-sm">{fmtINR(s.finalTotal)}</b><div>{statusBadge(ps)}</div></div></div>
          <div className="flex gap-1.5 mt-2"><MiniBtn tone="blue" onClick={() => { setEditing(s); setShowForm(true); }}>✎ Edit</MiniBtn><MiniBtn onClick={() => setView(s)}>🧾 Invoice</MiniBtn>{ps !== 'paid' && <MiniBtn tone="green" onClick={() => setPay(s)}>＋ Pay</MiniBtn>}<MiniBtn tone="danger" onClick={() => setDel(s.id)}>🗑</MiniBtn></div>
        </div>;
      })}
    </Card>
    <SaleForm open={showForm} initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSave={data => { editing ? updateSale(editing.id, data) : addSale(data); toast(editing ? 'Sale updated' : 'Sale saved'); setShowForm(false); setEditing(null); }} />
    {view && <SaleInvoice db={db} sale={db.sales.find(s => s.id === view.id) || view} onClose={() => setView(null)} />}
    {pay && <AddPaymentModal open total={pay.finalTotal} paid={sumPayments(pay.payments)} modes={modes} onClose={() => setPay(null)} onSave={(p: Omit<Payment, 'id' | 'createdAt'>) => { addSalePayment(pay.id, p); setPay(null); toast('Payment added'); }} />}
    <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={() => { if (del) deleteSale(del); toast('Sale deleted — stock and accounts reversed'); }} message="Delete this sale? Stock, cashbook and party ledger effects are reversed." />
  </div>;
}

function SaleForm({ open, initial, onClose, onSave }: { open: boolean; initial: SaleEntry | null; onClose: () => void; onSave: (d: SaleSave) => void }) {
  const { db, stock } = useDB();
  const modes = usePaymentModes();
  const ensureParty = useEnsureParty();
  const saving = useRef(false);
  const products = db.categories.filter(c => c.type === 'product' && c.active);
  const firstProduct = products.find(p => CORE.includes(p.id))?.id || products[0]?.id || 'pr_paddy';

  const paddyVarsAll = db.varieties.filter(v => v.active && (v.usage || ['paddy', 'rice']).includes('paddy'));
  const riceVars = db.varieties.filter(v => v.active && (v.usage || ['paddy', 'rice']).includes('rice'));

  const blankPaddy = (): PaddyLineState => ({ id: uid(), varietyId: '', size: '', qtyKg: 0, rate: '' });
  const blankRice = (): RiceLineState => ({ id: uid(), varietyId: riceVars[0]?.id || '', bags25: '0', bags10: '0', looseKg: '0', rate: '', rateUnit: 'kg' });

  const [productId, setProductId] = useState(firstProduct);
  const [date, setDate] = useState(today());
  const [itemName, setItemName] = useState('');
  const [customer, setCustomer] = useState('');
  const [paddyLines, setPaddyLines] = useState<PaddyLineState[]>([blankPaddy()]);
  const [riceLines, setRiceLines] = useState<RiceLineState[]>([blankRice()]);
  const [qtyKg, setQtyKg] = useState(0);
  const [rate, setRate] = useState('');
  const [rateUnit, setRateUnit] = useState<RateUnit>('qtl');
  const [gstMode, setGstMode] = useState<'none' | 'exclusive' | 'inclusive'>('none');
  const [gstRate, setGstRate] = useState('0');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payAmt, setPayAmt] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [payDate, setPayDate] = useState(today());
  const [photo, setPhoto] = useState<string | undefined>();
  const [notes, setNotes] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [forceConfirm, setForceConfirm] = useState(false);

  const theme = PRODUCT_STYLE[productId] || PRODUCT_STYLE.other;
  const productName = db.categories.find(c => c.id === productId)?.name || theme.title;
  const isPaddy = productId === 'pr_paddy';
  const isRice = productId === 'pr_rice';

  const paddyCalc = paddyLines.map(l => ({ ...l, amount: amountFor(l.qtyKg, Number(l.rate) || 0, 'qtl') }));
  const riceCalc = riceLines.map(l => {
    const kg = round2((Number(l.bags25) || 0) * 25 + (Number(l.bags10) || 0) * 10 + (Number(l.looseKg) || 0));
    return { ...l, kg, amount: amountFor(kg, Number(l.rate) || 0, l.rateUnit) };
  });

  const totalKg = isRice ? round2(riceCalc.reduce((s, l) => s + l.kg, 0))
    : isPaddy ? round2(paddyCalc.reduce((s, l) => s + l.qtyKg, 0)) : qtyKg;
  const base = isRice ? round2(riceCalc.reduce((s, l) => s + l.amount, 0))
    : isPaddy ? round2(paddyCalc.reduce((s, l) => s + l.amount, 0)) : amountFor(qtyKg, Number(rate) || 0, rateUnit);
  const gst = calcGST(base, gstMode, Number(gstRate) || 0);
  const finalTotal = gst.total;

  // stock already consumed by THIS entry is added back while editing
  const editBack = useMemo(() => {
    const m: Record<string, number> = {}; let b25 = 0, b10 = 0;
    if (initial && (initial.productId === productId)) {
      for (const l of initial.lines || []) {
        if (l.varietyId) m[l.varietyId] = (m[l.varietyId] || 0) + l.quantityKg;
        b25 += l.bags25 || 0; b10 += l.bags10 || 0;
      }
      if (!initial.lines?.length && initial.varietyId) m[initial.varietyId] = initial.quantityKg;
    }
    return { byVariety: m, bulk: initial && initial.productId === productId ? initial.quantityKg : 0, b25, b10 };
  }, [initial, productId]);

  const availVariety = (vid: string) => (isPaddy ? (stock.paddyByVariety[vid] || 0) : (stock.riceByVariety[vid] || 0)) + (editBack.byVariety[vid] || 0);
  const availBulk = (pid: string) => (pid === 'pr_bran' ? stock.branKg : pid === 'pr_husk' ? stock.huskKg : pid === 'pr_broken' ? stock.brokenKg : stock.otherByProductKg) + editBack.bulk;
  const avail25 = stock.riceBags25 + editBack.b25;
  const avail10 = stock.riceBags10 + editBack.b10;
  const need25 = riceCalc.reduce((s, l) => s + (Number(l.bags25) || 0), 0);
  const need10 = riceCalc.reduce((s, l) => s + (Number(l.bags10) || 0), 0);

  const warnings = useMemo(() => {
    const out: string[] = [];
    const grouped: Record<string, number> = {};
    if (isPaddy || isRice) {
      for (const l of (isPaddy ? paddyCalc.map(x => ({ varietyId: x.varietyId, kg: x.qtyKg })) : riceCalc.map(x => ({ varietyId: x.varietyId, kg: x.kg })))) {
        if (l.varietyId && l.kg > 0) grouped[l.varietyId] = (grouped[l.varietyId] || 0) + l.kg;
      }
      for (const [vid, kg] of Object.entries(grouped)) {
        const have = availVariety(vid);
        if (kg > have + 0.001) out.push(`${db.varieties.find(v => v.id === vid)?.name || 'Item'}: need ${fmtQtlKg(kg)}, stock ${fmtQtlKg(have)}`);
      }
      if (isRice) {
        if (need25 > avail25) out.push(`25 kg packing bags: need ${need25}, stock ${avail25}`);
        if (need10 > avail10) out.push(`10 kg packing bags: need ${need10}, stock ${avail10}`);
      }
    } else if (totalKg > availBulk(productId) + 0.001) {
      out.push(`Need ${fmtQtlKg(totalKg)}, stock ${fmtQtlKg(availBulk(productId))}`);
    }
    return out;
  }, [paddyLines, riceLines, qtyKg, productId, stock, editBack]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!open) return;
    saving.current = false;
    const s = initial;
    const pid = s?.productId || firstProduct;
    setProductId(pid);
    setDate(s?.date || today());
    setItemName(s?.itemName || db.categories.find(c => c.id === pid)?.name || (PRODUCT_STYLE[pid] || PRODUCT_STYLE.other).title);
    setCustomer(s ? partyName(db, s.partyId) : '');
    setPaddyLines(pid === 'pr_paddy' && s?.lines?.length
      ? s.lines.map(l => ({ id: l.id, varietyId: l.varietyId || '', size: (db.varieties.find(v => v.id === l.varietyId)?.category === 'big' ? 'big' : 'small') as PaddySizeSel, qtyKg: l.quantityKg, rate: String(l.rate) }))
      : [blankPaddy()]);
    setRiceLines(pid === 'pr_rice' && s?.lines?.length
      ? s.lines.map(l => ({ id: l.id, varietyId: l.varietyId || '', bags25: String(l.bags25 || 0), bags10: String(l.bags10 || 0), looseKg: String(l.looseKg ?? l.quantityKg), rate: String(l.rate), rateUnit: l.rateUnit }))
      : [blankRice()]);
    setQtyKg(pid === 'pr_paddy' || pid === 'pr_rice' ? 0 : (s?.quantityKg || 0));
    setRate(s?.lines?.[0] ? String(s.lines[0].rate) : String(s?.ratePerQtl || ''));
    setRateUnit(s?.lines?.[0]?.rateUnit || 'qtl');
    setGstMode(s?.gstMode || 'none');
    setGstRate(String(s?.gstRate ?? db.settings.defaultGstRate ?? 0));
    setPayments(s?.payments || []);
    setPayAmt(''); setPayMode(modes[0] || 'Cash'); setPayDate(today());
    setPhoto(s?.billPhoto); setNotes(s?.notes || ''); setVehicle(s?.vehicleNumber || '');
  }, [open, initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseProduct = (id: string) => {
    setProductId(id);
    setItemName(db.categories.find(c => c.id === id)?.name || (PRODUCT_STYLE[id] || PRODUCT_STYLE.other).title);
    setQtyKg(0); setRate(''); setRateUnit('qtl');
    setPaddyLines([blankPaddy()]); setRiceLines([blankRice()]);
  };

  const build = (): SaleSave | null => {
    if (!customer.trim()) { toast('Enter customer / party name', 'error'); return null; }
    if (totalKg <= 0) { toast('Enter quantity', 'error'); return null; }
    if (base <= 0) { toast('Enter a valid rate', 'error'); return null; }
    if (isPaddy) {
      const used = paddyCalc.filter(l => l.qtyKg > 0);
      if (!used.length) { toast('Enter quantity for at least one variety', 'error'); return null; }
      if (used.some(l => !l.varietyId)) { toast('Choose a variety for every paddy line', 'error'); return null; }
      if (used.some(l => !(Number(l.rate) > 0))) { toast('Enter rate for every paddy line', 'error'); return null; }
    }
    if (isRice && riceCalc.some(l => l.kg > 0 && !l.varietyId)) { toast('Choose a variety for every rice line', 'error'); return null; }
    const ps = withDraftPayment(payments, payAmt, payMode, payDate);
    if (sumPayments(ps) > finalTotal + .01) { toast('Amount received is more than total', 'error'); return null; }

    const lines: SaleLine[] = isRice
      ? riceCalc.filter(l => l.kg > 0).map(l => ({ id: l.id, varietyId: l.varietyId, quantityKg: l.kg, bags25: Number(l.bags25) || 0, bags10: Number(l.bags10) || 0, looseKg: Number(l.looseKg) || 0, rate: Number(l.rate) || 0, rateUnit: l.rateUnit, amount: l.amount }))
      : isPaddy
        ? paddyCalc.filter(l => l.qtyKg > 0).map(l => ({ id: l.id, varietyId: l.varietyId, quantityKg: l.qtyKg, rate: Number(l.rate) || 0, rateUnit: 'qtl' as RateUnit, amount: l.amount }))
        : [{ id: uid(), itemName, quantityKg: qtyKg, rate: Number(rate) || 0, rateUnit, amount: base }];

    return {
      date, partyId: initial?.partyId || '', productId, itemName: itemName.trim() || productName,
      varietyId: isPaddy || isRice ? lines[0]?.varietyId : undefined, lines,
      quantityKg: totalKg, ratePerQtl: totalKg ? round2(base / (totalKg / 100)) : 0,
      gstMode, gstRate: Number(gstRate) || 0, baseAmount: base, taxableAmount: gst.taxable,
      cgst: gst.cgst, sgst: gst.sgst, totalTax: gst.totalTax, roundOriginal: finalTotal, roundAdjustment: 0, finalTotal,
      vehicleNumber: vehicle || undefined, manualOverrides: {}, notes: notes || undefined, billPhoto: photo, payments: ps,
    };
  };

  const save = (force = false) => {
    if (saving.current) return;
    const data = build(); if (!data) return;
    if (warnings.length && !force) { setForceConfirm(true); return; }
    data.partyId = ensureParty(customer, 'customer');
    saving.current = true;
    onSave(data);
  };

  return <>
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.invoiceNumber}` : 'New Sale'} maxWidth="max-w-xl" footer={
      <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button className="flex-1" onClick={() => save(false)}>🏷 {initial ? 'Update Sale' : 'Save Sale'}</Button></>
    }>
      <div className="space-y-3">
        <div className="overflow-x-auto -mx-4 px-4"><div className="flex gap-2 min-w-max pb-1">
          {products.map(p => { const st = PRODUCT_STYLE[p.id] || PRODUCT_STYLE.other; return <button key={p.id} onClick={() => chooseProduct(p.id)} className={`px-4 py-2.5 rounded-2xl border text-sm font-bold transition-colors ${productId === p.id ? st.active : 'bg-gray-100 border-gray-100 text-gray-600'}`}>{st.icon} {p.name}</button>; })}
        </div></div>
        <Select label="Sale item" value={productId} onChange={e => chooseProduct(e.target.value)} options={products.map(p => ({ value: p.id, label: `${(PRODUCT_STYLE[p.id] || PRODUCT_STYLE.other).icon} ${p.name}` }))} />
        {warnings.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"><b>⚠ Low / negative stock warning</b>{warnings.map(w => <div key={w}>{w}</div>)}</div>}

        <div className={`rounded-2xl overflow-hidden border-2 ${theme.soft}`}>
          <div className={`bg-gradient-to-r ${theme.banner} text-white p-4 flex gap-3 items-center`}>
            <span className="text-4xl">{theme.icon}</span>
            <div><div className="text-lg font-extrabold">{itemName || productName} Sale Entry</div><div className="text-xs opacity-80">{theme.sub}</div></div>
          </div>
          <div className="p-3 space-y-3 bg-white">
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" label="Date *" value={date} onChange={e => setDate(e.target.value)} />
              <Input label="Item Name (editable)" value={itemName} onChange={e => setItemName(e.target.value)} />
            </div>
            <PartyInput label="Customer / Party" required value={customer} onChange={setCustomer} />
            <Input label="Vehicle / delivery (optional)" value={vehicle} onChange={e => setVehicle(e.target.value.toUpperCase())} />
            {isPaddy && <PaddyLines lines={paddyLines} setLines={setPaddyLines} varieties={paddyVarsAll} avail={availVariety} blank={blankPaddy} />}
            {isRice && <RiceLines lines={riceLines} setLines={setRiceLines} varieties={riceVars} avail={availVariety} blank={blankRice} avail25={avail25} avail10={avail10} need25={need25} need10={need10} />}
          </div>
        </div>

        {!isPaddy && !isRice && <div className="grid grid-cols-2 gap-2">
          <QtyInput label="Quantity (Qtl + Kg) *" valueKg={qtyKg} onChange={setQtyKg} />
          <div><Input label={`Rate / ${rateUnit === 'kg' ? 'Kg' : 'Qtl'} *`} type="number" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} /><RateToggle value={rateUnit} onChange={setRateUnit} /></div>
        </div>}

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex justify-between items-center">
          <span className="font-semibold text-gray-600">Total Amount{totalKg > 0 ? ` · ${fmtQtlKg(totalKg)}` : ''}</span>
          <b className="text-2xl text-forest-900">{fmtINR(base)}</b>
        </div>
        <GSTPanel mode={gstMode} rate={gstRate} onModeChange={setGstMode} onRateChange={setGstRate} summary={<TaxSummary base={base} mode={gstMode} rate={Number(gstRate) || 0} />} />
        <div className="rounded-xl border border-forest-100 p-3"><PayBox total={finalTotal} existing={payments} onRemoveExisting={i => setPayments(p => p.filter((_, x) => x !== i))} amount={payAmt} onAmount={setPayAmt} mode={payMode} onMode={setPayMode} date={payDate} onDate={setPayDate} modes={modes} /></div>
        <PhotoAttach value={photo} onChange={setPhoto} />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </Modal>
    <Confirm open={forceConfirm} onClose={() => setForceConfirm(false)} onConfirm={() => { setForceConfirm(false); save(true); }} title="Stock will go negative" message={`${warnings.join('. ')}. Save anyway?`} confirmText="Save anyway" />
  </>;
}

function RateToggle({ value, onChange }: { value: RateUnit; onChange: (v: RateUnit) => void }) {
  return <div className="flex gap-1 mt-1">
    <button onClick={() => onChange('qtl')} className={`px-2 py-1 rounded-full text-[10px] font-bold ${value === 'qtl' ? 'bg-forest-800 text-white' : 'bg-gray-100'}`}>/Qtl</button>
    <button onClick={() => onChange('kg')} className={`px-2 py-1 rounded-full text-[10px] font-bold ${value === 'kg' ? 'bg-forest-800 text-white' : 'bg-gray-100'}`}>/Kg</button>
  </div>;
}

function PaddyLines({ lines, setLines, varieties, avail, blank }: {
  lines: PaddyLineState[]; setLines: React.Dispatch<React.SetStateAction<PaddyLineState[]>>;
  varieties: { id: string; name: string; category: string }[]; avail: (id: string) => number; blank: () => PaddyLineState;
}) {
  const update = (id: string, patch: Partial<PaddyLineState>) => setLines(xs => xs.map(x => x.id === id ? { ...x, ...patch } : x));
  return <div className="space-y-2">
    <div className="flex justify-between items-center"><b className="text-sm">Paddy Varieties & Quantity</b>
      <Button size="sm" variant="secondary" onClick={() => setLines(xs => [...xs, blank()])}>＋ Add Variety</Button></div>
    {lines.map((l, idx) => {
      const opts = varieties.filter(v => !l.size || v.category === l.size);
      const amount = amountFor(l.qtyKg, Number(l.rate) || 0, 'qtl');
      const have = l.varietyId ? avail(l.varietyId) : 0;
      return <div key={l.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[11px] font-bold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">Variety {idx + 1}</span>
          {lines.length > 1 && <button onClick={() => setLines(xs => xs.filter(x => x.id !== l.id))} className="w-8 h-8 rounded-lg bg-red-50 border border-red-200 text-red-600">✕</button>}
        </div>
        <div><div className="text-xs font-medium text-gray-700 mb-1">Paddy Size</div>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => update(l.id, { size: 'small', varietyId: '' })} className={`py-2 rounded-lg border-2 text-sm font-bold ${l.size === 'small' ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-gray-200 bg-white'}`}>🌾 Small</button>
            <button onClick={() => update(l.id, { size: 'big', varietyId: '' })} className={`py-2 rounded-lg border-2 text-sm font-bold ${l.size === 'big' ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-gray-200 bg-white'}`}>🌾 Big</button>
            <button onClick={() => update(l.id, { size: '', varietyId: '' })} className="py-2 rounded-lg border border-gray-200 bg-white text-sm">Clear</button>
          </div></div>
        <Select label="Paddy Variety" value={l.varietyId} onChange={e => update(l.id, { varietyId: e.target.value })} options={[{ value: '', label: '— Select Variety —' }, ...opts.map(v => ({ value: v.id, label: v.name }))]} />
        <div className="grid grid-cols-2 gap-2">
          <QtyInput label="Quantity (Qtl + Kg) *" valueKg={l.qtyKg} onChange={kg => update(l.id, { qtyKg: kg })} />
          <Input label="Rate / Qtl *" type="number" inputMode="decimal" value={l.rate} onChange={e => update(l.id, { rate: e.target.value })} />
        </div>
        <div className={`flex justify-between text-xs font-bold ${l.varietyId && l.qtyKg > have ? 'text-red-600' : 'text-forest-700'}`}>
          <span>{fmtQtlKg(l.qtyKg)}{l.varietyId ? ` · stock ${fmtQtlKg(have)}` : ''}</span><span>{fmtINR(amount)}</span>
        </div>
      </div>;
    })}
  </div>;
}

function RiceLines({ lines, setLines, varieties, avail, blank, avail25, avail10, need25, need10 }: {
  lines: RiceLineState[]; setLines: React.Dispatch<React.SetStateAction<RiceLineState[]>>;
  varieties: { id: string; name: string }[]; avail: (id: string) => number; blank: () => RiceLineState;
  avail25: number; avail10: number; need25: number; need10: number;
}) {
  const update = (id: string, patch: Partial<RiceLineState>) => setLines(xs => xs.map(x => x.id === id ? { ...x, ...patch } : x));
  const bump = (id: string, key: 'bags25' | 'bags10', n: number) => setLines(xs => xs.map(x => x.id !== id ? x : { ...x, [key]: String(Math.max(0, (Number(x[key]) || 0) + n)) }));
  return <div className="space-y-2">
    <div className="flex justify-between items-center"><b className="text-sm">Rice Varieties & Bags</b>
      <Button size="sm" variant="secondary" onClick={() => setLines(xs => [...xs, blank()])}>＋ Add Variety</Button></div>
    <div className="grid grid-cols-2 gap-2 text-center text-[11px]">
      <div className={`rounded-lg border p-1.5 ${need25 > avail25 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200'}`}>
        <div className="uppercase text-[9px] text-gray-500">25 kg bags in stock</div><b>{avail25 - need25} left</b> <span className="text-gray-400">of {avail25}</span>
      </div>
      <div className={`rounded-lg border p-1.5 ${need10 > avail10 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200'}`}>
        <div className="uppercase text-[9px] text-gray-500">10 kg bags in stock</div><b>{avail10 - need10} left</b> <span className="text-gray-400">of {avail10}</span>
      </div>
    </div>
    {lines.map((l, idx) => {
      const kg = (Number(l.bags25) || 0) * 25 + (Number(l.bags10) || 0) * 10 + (Number(l.looseKg) || 0);
      const amount = amountFor(kg, Number(l.rate) || 0, l.rateUnit);
      const have = l.varietyId ? avail(l.varietyId) : 0;
      return <div key={l.id} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
        <div className="flex gap-2 items-end">
          <Select wrapperClassName="flex-1" label={`Rice variety ${idx + 1}`} value={l.varietyId} onChange={e => update(l.id, { varietyId: e.target.value })} options={[{ value: '', label: '— Variety —' }, ...varieties.map(v => ({ value: v.id, label: v.name }))]} />
          {lines.length > 1 && <button onClick={() => setLines(xs => xs.filter(x => x.id !== l.id))} className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 text-red-600">✕</button>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Counter label="25 kg bags" value={Number(l.bags25) || 0} minus={() => bump(l.id, 'bags25', -1)} plus={() => bump(l.id, 'bags25', 1)} />
          <Counter label="10 kg bags" value={Number(l.bags10) || 0} minus={() => bump(l.id, 'bags10', -1)} plus={() => bump(l.id, 'bags10', 1)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Loose (kg)" type="number" inputMode="decimal" value={l.looseKg} onChange={e => update(l.id, { looseKg: e.target.value })} />
          <div><Input label={`Rate / ${l.rateUnit === 'kg' ? 'Kg' : 'Qtl'}`} type="number" inputMode="decimal" value={l.rate} onChange={e => update(l.id, { rate: e.target.value })} /><RateToggle value={l.rateUnit} onChange={v => update(l.id, { rateUnit: v })} /></div>
        </div>
        <div className={`flex justify-between text-xs font-bold ${l.varietyId && kg > have ? 'text-red-600' : 'text-forest-700'}`}>
          <span>{fmtQtlKg(kg)}{l.varietyId ? ` · stock ${fmtQtlKg(have)}` : ''}</span><span>{fmtINR(amount)}</span>
        </div>
      </div>;
    })}
  </div>;
}

function Counter({ label, value, minus, plus }: { label: string; value: number; minus: () => void; plus: () => void }) {
  return <div><div className="text-xs font-medium text-gray-700 mb-1">{label}</div>
    <div className="grid grid-cols-3 border border-gray-200 rounded-lg overflow-hidden bg-white">
      <button onClick={minus} className="py-2 text-red-600 font-bold">−</button>
      <div className="py-2 text-center font-bold border-x border-gray-200">{value}</div>
      <button onClick={plus} className="py-2 text-forest-700 font-bold">＋</button>
    </div></div>;
}

function SaleInvoice({ db, sale, onClose }: { db: ReturnType<typeof useDB>['db']; sale: SaleEntry; onClose: () => void }) {
  const product = db.categories.find(c => c.id === sale.productId)?.name || sale.itemName || 'Sale'; const paid = sumPayments(sale.payments); const lines = sale.lines || [];
  const html = `<div class="vch"><style>${VOUCHER_CSS}</style><div class="c"><h1>${esc(db.settings.millName)}</h1><div class="muted">${esc(db.settings.address)}</div></div><div class="row"><div><b>SALE INVOICE ${esc(sale.invoiceNumber)}</b><div>${fmtDate(sale.date)}</div></div><div class="r"><b>${esc(partyName(db, sale.partyId))}</b><div>${esc(product)}</div></div></div><table><tr><th>Item / variety</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>${lines.map(l => `<tr><td>${esc(db.varieties.find(v => v.id === l.varietyId)?.name || l.itemName || product)}</td><td class="r">${fmtQtlKg(l.quantityKg)}</td><td class="r">${fmtINR(l.rate)}/${l.rateUnit === 'kg' ? 'kg' : 'Qtl'}</td><td class="r">${fmtINR(l.amount)}</td></tr>`).join('')}<tr class="tot"><td colspan="3">TOTAL</td><td class="r">${fmtINR(sale.finalTotal)}</td></tr><tr><td colspan="3">Paid</td><td class="r g">${fmtINR(paid)}</td></tr><tr><td colspan="3">Pending</td><td class="r red">${fmtINR(Math.max(0, sale.finalTotal - paid))}</td></tr></table>${sale.totalTax ? `<div class="muted">Taxable ${fmtINR(sale.taxableAmount)} · CGST ${fmtINR(sale.cgst)} · SGST ${fmtINR(sale.sgst)}</div>` : ''}<div class="sig"><div>Authorised signatory</div><div>Customer signature</div></div></div>`;
  return <Modal open onClose={onClose} title={`Invoice ${sale.invoiceNumber}`} maxWidth="max-w-xl" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="secondary" onClick={async () => { const r = await shareText(`Sale ${sale.invoiceNumber}`, `${db.settings.millName}\n${product} sale ${sale.invoiceNumber}\n${partyName(db, sale.partyId)}\nQty ${fmtQtlKg(sale.quantityKg)} · Total ${fmtINR(sale.finalTotal)} · Due ${fmtINR(Math.max(0, sale.finalTotal - paid))}`); if (r === 'copied') toast('Copied — paste in WhatsApp'); }}>Share</Button><Button variant="gold" onClick={() => printHtml(`Sale ${sale.invoiceNumber}`, html)}>Print / Save PDF</Button></>}><div className="border border-gray-200 rounded-lg p-3" dangerouslySetInnerHTML={{ __html: html }} /></Modal>;
}