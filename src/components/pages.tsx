import React, { useState, useMemo } from 'react';
import { cn } from '../utils/cn';
import { printHtml, shareText } from '../utils/print';
import { useDB } from '../context';
import {
  fmtINR, fmtQty, fmtQtlKg, fmtNumber, fmtDate, today, kgToQtl,
  calcGST, round2, sumPayments, paymentStatus, calcPendingBags, computePartyLedger, dispatchDue,
  computeTradingStock, fmtTradeQty,
  inRange
} from '../db';
import type {
  Database, Party, PurchaseEntry, DispatchEntry, SaleEntry,
  ExpenseEntry, ElectricityBill, PartyType, Payment, BagMovement
} from '../types';
import {
  Button, Input, Select, Card, KPICard, Modal, Confirm, Badge, GSTPanel,
  EmptyState, Tabs, ListRow, SectionHeader, DateRangePresets, SearchBar,
  PaymentSummary, PaymentForm, CalcField, Textarea, toast
} from './ui';

// ============ Reusable helpers ============
export function usePaymentModes() {
  const { db } = useDB();
  return db.categories.filter(c => c.type === 'payment_mode' && c.active).map(c => c.name);
}
export function useExpenseCats() {
  const { db } = useDB();
  return db.categories.filter(c => c.type === 'expense' && c.active);
}
export function useProducts() {
  const { db } = useDB();
  return db.categories.filter(c => c.type === 'product' && c.active);
}
export function useWorkTypes() {
  const { db } = useDB();
  return db.categories.filter(c => c.type === 'work_type' && c.active);
}
export function partyName(db: any, id: string): string {
  const p = db.parties.find((x: Party) => x.id === id);
  return p?.name || '(Unknown)';
}
export function varietyName(db: any, id: string): string {
  if (!id) return '';
  const v = db.varieties.find((x: any) => x.id === id);
  return v?.name || id;
}
export function statusBadge(s: 'paid' | 'partial' | 'unpaid' | 'overdue') {
  const map = { paid: 'green', partial: 'gold', unpaid: 'red', overdue: 'red' } as const;
  return <Badge tone={map[s]}>{s.toUpperCase()}</Badge>;
}

// ============ Party free-text input with suggestions ============
export function PartyInput({ label = 'Party', value, onChange, types, placeholder, required, wrapperClassName }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  types?: PartyType[];
  placeholder?: string;
  required?: boolean;
  wrapperClassName?: string;
}) {
  const { db } = useDB();
  const [listId] = useState(() => 'pl_' + Math.random().toString(36).slice(2, 9));
  const options = useMemo(
    () => db.parties.filter(p => p.active && (!types || types.length === 0 || p.types.some(t => types.includes(t)))),
    [db.parties, types]
  );
  return (
    <div className={cn('flex flex-col gap-1', wrapperClassName)}>
      {label && <label className="text-xs font-medium text-gray-700">{label}{required ? ' *' : ''}</label>}
      <input
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Type name — new or existing'}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-forest-500 focus:ring-2 focus:ring-forest-100"
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map(p => <option key={p.id} value={p.name}>{p.phone || p.village || ''}</option>)}
      </datalist>
    </div>
  );
}

// Resolve a typed name to a party (creates if missing). Returns '' for blank / unknown placeholders.
export function useEnsureParty() {
  const { db, upsertParty } = useDB();
  return (name: string, type: PartyType): string => {
    const trimmed = (name || '').trim();
    if (!trimmed || trimmed === '(Unknown)') return '';
    const existing = db.parties.find(p => p.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      if (!existing.types.includes(type)) {
        upsertParty({ id: existing.id, name: existing.name, types: [...existing.types, type] });
      }
      return existing.id;
    }
    return upsertParty({ name: trimmed, types: [type], active: true, openingBalance: 0 });
  };
}

// Compact computed tax breakdown used inside GSTPanel summaries
export function TaxSummary({ base, mode, rate }: { base: number; mode: 'none' | 'exclusive' | 'inclusive'; rate: number }) {
  const g = calcGST(base, mode, rate);
  return (
    <div className="grid grid-cols-3 gap-1.5 text-center">
      <div className="bg-white border border-gray-200 rounded px-1 py-1">
        <div className="text-[9px] uppercase text-gray-500">Taxable</div>
        <div className="text-[11px] font-semibold text-gray-900">{fmtINR(g.taxable)}</div>
      </div>
      <div className="bg-white border border-gray-200 rounded px-1 py-1">
        <div className="text-[9px] uppercase text-gray-500">CGST {(rate / 2).toFixed(1)}%</div>
        <div className="text-[11px] font-semibold text-gray-900">{fmtINR(g.cgst)}</div>
      </div>
      <div className="bg-white border border-gray-200 rounded px-1 py-1">
        <div className="text-[9px] uppercase text-gray-500">SGST {(rate / 2).toFixed(1)}%</div>
        <div className="text-[11px] font-semibold text-gray-900">{fmtINR(g.sgst)}</div>
      </div>
    </div>
  );
}

// ============ Party visit statistics ============
export function computePartyStats(db: Database, partyId: string) {
  const dates: string[] = [];
  for (const h of db.hulling) if (h.partyId === partyId) dates.push(h.date);
  for (const p of db.purchases) if (p.partyId === partyId) dates.push(p.date);
  for (const d of db.dispatches) if (d.partyId === partyId) dates.push(d.date);
  for (const s of db.sales) if (s.partyId === partyId) dates.push(s.date);
  for (const l of db.labour) if (l.workerPartyId === partyId) dates.push(l.date);
  const nowD = new Date();
  const weekAgo = new Date(nowD); weekAgo.setDate(nowD.getDate() - 6);
  const wk = weekAgo.toISOString().slice(0, 10);
  const monthKey = nowD.toISOString().slice(0, 7);
  const yearKey = nowD.toISOString().slice(0, 4);
  const unique = [...new Set(dates)];
  return {
    total: unique.length,
    week: unique.filter(d => d >= wk).length,
    month: unique.filter(d => d.startsWith(monthKey)).length,
    year: unique.filter(d => d.startsWith(yearKey)).length,
    last: unique.sort().pop() || null,
  };
}

// ============ PARTIES ============
export function PartiesPage() {
  const { db, upsertParty, deleteParty } = useDB();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | PartyType | 'active' | 'inactive'>('all');
  const [editing, setEditing] = useState<Partial<Party> | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [viewLedger, setViewLedger] = useState<Party | null>(null);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return db.parties.filter(p => {
      if (filter === 'active' && !p.active) return false;
      if (filter === 'inactive' && p.active) return false;
      if (['customer', 'supplier', 'worker', 'vendor', 'transport'].includes(filter) && !p.types.includes(filter as PartyType)) return false;
      if (s) {
        return p.name.toLowerCase().includes(s) || (p.phone || '').includes(s) || (p.village || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [db.parties, search, filter]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="flex gap-2">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} placeholder="Name, phone, village..." /></div>
        <Button onClick={() => setEditing({ name: '', types: ['customer'], active: true, openingBalance: 0 })}>+ New</Button>
      </div>
      <Tabs
        active={filter}
        onChange={f => setFilter(f as any)}
        tabs={[
          { id: 'all', label: 'All' }, { id: 'customer', label: 'Customers' },
          { id: 'supplier', label: 'Suppliers' }, { id: 'worker', label: 'Workers' },
          { id: 'active', label: 'Active' },
        ]}
      />

      <Card>
        {filtered.length === 0 ? (
          <EmptyState title="No parties" subtitle="Add customers, suppliers, workers and vendors." />
        ) : (
          filtered.map(p => {
            const { balance, bagBalance } = computePartyLedger(db, p.id);
            const stats = computePartyStats(db, p.id);
            return (
              <ListRow
                key={p.id}
                title={p.name}
                subtitle={<>
                  {p.types.map(t => <Badge key={t} tone={t === 'customer' ? 'green' : t === 'supplier' ? 'blue' : 'gray'}>{t}</Badge>)}
                  <span className="ml-1">{p.village || ''} {p.phone ? `· ${p.phone}` : ''}</span>
                  <span className="block mt-0.5 text-[10px] text-forest-700 font-medium">
                    Visits — Week: {stats.week} · Month: {stats.month} · Year: {stats.year}{stats.last ? ` · Last: ${fmtDate(stats.last)}` : ''}
                  </span>
                </>}
                leading={<div className="w-9 h-9 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center font-bold text-sm">{p.name[0]?.toUpperCase()}</div>}
                right={<>
                  <div className={balance > 0.01 ? 'text-green-700 font-semibold text-sm' : balance < -0.01 ? 'text-red-600 font-semibold text-sm' : 'text-gray-500 text-xs'}>
                    {fmtINR(balance)}
                  </div>
                  {bagBalance !== 0 && <div className="text-[10px] text-amber-700 text-right">{fmtNumber(bagBalance, 0)} bags due</div>}
                </>}
                actions={<>
                  <button onClick={() => setViewLedger(p)} className="text-[11px] text-forest-700 font-medium">Ledger</button>
                  <button onClick={() => setEditing(p)} className="text-[11px] text-blue-700 font-medium">Edit</button>
                  <button onClick={() => setDelId(p.id)} className="text-[11px] text-red-600 font-medium">Delete</button>
                </>}
              />
            );
          })
        )}
      </Card>

      <PartyForm open={!!editing} initial={editing} onClose={() => setEditing(null)} onSave={(data) => {
        upsertParty(data);
        setEditing(null);
        toast('Party saved');
      }} />
      <Confirm open={!!delId} onClose={() => setDelId(null)} onConfirm={() => { if (delId) { deleteParty(delId); toast('Party deleted'); } }} message="Delete this party? Existing transactions will remain in ledger but party will be removed." />

      <LedgerModal open={!!viewLedger} party={viewLedger} onClose={() => setViewLedger(null)} />
    </div>
  );
}

function PartyForm({ open, initial, onClose, onSave }: { open: boolean; initial: Partial<Party> | null; onClose: () => void; onSave: (p: Partial<Party> & { name: string; types: Party['types'] }) => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [types, setTypes] = useState<PartyType[]>(initial?.types || ['customer']);
  const [phone, setPhone] = useState(initial?.phone || '');
  const [village, setVillage] = useState(initial?.village || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [openingBalance, setOpeningBalance] = useState(initial?.openingBalance?.toString() || '0');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [active, setActive] = useState(initial?.active ?? true);

  React.useEffect(() => {
    if (open) {
      setName(initial?.name || '');
      setTypes(initial?.types || ['customer']);
      setPhone(initial?.phone || '');
      setVillage(initial?.village || '');
      setAddress(initial?.address || '');
      setOpeningBalance(initial?.openingBalance?.toString() || '0');
      setNotes(initial?.notes || '');
      setActive(initial?.active ?? true);
    }
  }, [open, initial]);

  const toggleType = (t: PartyType) => {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  return (
    <Modal open={open} onClose={onClose} title={initial?.id ? 'Edit Party' : 'New Party'} maxWidth="max-w-lg" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => {
          if (!name.trim()) { toast('Name required', 'error'); return; }
          onSave({
            id: initial?.id,
            name: name.trim(),
            types: types.length ? types : ['customer'],
            phone: phone.trim(),
            village: village.trim(),
            address: address.trim(),
            openingBalance: round2(Number(openingBalance) || 0),
            notes,
            active,
          });
        }}>Save</Button>
      </>
    }>
      <div className="space-y-3">
        <Input label="Name *" value={name} onChange={e => setName(e.target.value)} placeholder="Party / Business name" />
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Type (select all that apply)</label>
          <div className="flex flex-wrap gap-1.5">
            {(['customer', 'supplier', 'worker', 'vendor', 'transport'] as PartyType[]).map(t => (
              <button key={t} type="button" onClick={() => toggleType(t)} className={
                types.includes(t) ? 'px-2.5 py-1 rounded-full text-xs font-medium bg-forest-700 text-white' : 'px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700'
              }>{t}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
          <Input label="Village" value={village} onChange={e => setVillage(e.target.value)} />
        </div>
        <Input label="Address" value={address} onChange={e => setAddress(e.target.value)} />
        <Input label="Opening Balance (₹)" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} type="number" step="0.01" placeholder="Positive = receivable, Negative = payable" />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="rounded" />
          Active
        </label>
      </div>
    </Modal>
  );
}

function LedgerModal({ open, party, onClose }: { open: boolean; party: Party | null; onClose: () => void }) {
  const { db } = useDB();
  const ledger = useMemo(() => party ? computePartyLedger(db, party.id) : null, [db, party]);
  if (!party || !ledger) return null;
  const stats = computePartyStats(db, party.id);
  return (
    <Modal open={open} onClose={onClose} title={`Ledger: ${party.name}`} maxWidth="max-w-xl">
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <div className="bg-forest-50 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[10px] text-forest-700 font-medium">This Week</div>
          <div className="text-sm font-bold text-forest-800">{stats.week}</div>
        </div>
        <div className="bg-forest-50 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[10px] text-forest-700 font-medium">This Month</div>
          <div className="text-sm font-bold text-forest-800">{stats.month}</div>
        </div>
        <div className="bg-forest-50 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[10px] text-forest-700 font-medium">This Year</div>
          <div className="text-sm font-bold text-forest-800">{stats.year}</div>
        </div>
      </div>
      <div className="mb-3 flex items-center justify-between bg-forest-50 px-3 py-2 rounded-lg">
        <div className="text-xs text-forest-700">Current Balance</div>
        <div className={ledger.balance > 0 ? 'text-green-700 font-bold' : ledger.balance < 0 ? 'text-red-600 font-bold' : 'text-gray-700 font-bold'}>{fmtINR(ledger.balance)}</div>
      </div>
      <div className="max-h-[50vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left">
              <th className="px-2 py-1">Date</th>
              <th className="px-2 py-1">Description</th>
              <th className="px-2 py-1 text-right">Debit</th>
              <th className="px-2 py-1 text-right">Credit</th>
              <th className="px-2 py-1 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {ledger.entries.map((e, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="px-2 py-1 text-gray-500">{e.date ? fmtDate(e.date) : '—'}</td>
                <td className="px-2 py-1"><span className="font-medium text-gray-900">{e.module}</span>: {e.description}</td>
                <td className="px-2 py-1 text-right text-green-700">{e.debit > 0 ? fmtINR(e.debit) : ''}</td>
                <td className="px-2 py-1 text-right text-red-600">{e.credit > 0 ? fmtINR(e.credit) : ''}</td>
                <td className="px-2 py-1 text-right font-semibold">{fmtINR(e.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function AddPaymentModal({ open, total, paid, modes, onClose, onSave }: {
  open: boolean; total: number; paid: number; existingPayments?: Payment[];
  modes: string[]; onClose: () => void; onSave: (p: Omit<Payment, 'id' | 'createdAt'>) => void;
}) {
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState<string>('');
  const [mode, setMode] = useState(modes[0] || 'Cash');
  const [reference, setReference] = useState('');

  React.useEffect(() => {
    if (open) { setDate(today()); setAmount(String(round2(total - paid))); setMode(modes[0] || 'Cash'); setReference(''); }
  }, [open, total, paid, modes]);

  return (
    <Modal open={open} onClose={onClose} title="Add Payment" maxWidth="max-w-sm" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => {
          const amt = Number(amount);
          if (!amt || amt <= 0) { toast('Invalid amount', 'error'); return; }
          onSave({ date, amount: amt, mode, reference });
        }}>Save Payment</Button>
      </>
    }>
      <div className="space-y-3">
        <PaymentSummary total={total} paid={paid} />
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Date" value={date} onChange={e => setDate(e.target.value)} />
          <Input label="Amount" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} suffix="₹" />
        </div>
        <Select label="Mode" value={mode} onChange={e => setMode(e.target.value)} options={modes} />
        <Input label="Reference" value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" />
      </div>
    </Modal>
  );
}

// ============ PDF / RECEIPT MODAL ============
export function ReceiptModal({ entry, onClose, type }: { entry: any; onClose: () => void; type: 'hulling' | 'purchase' | 'dispatch' | 'sale'; }) {
  const { db } = useDB();
  const title = type === 'hulling' ? 'Hulling Receipt' : type === 'purchase' ? 'Purchase Voucher' : type === 'dispatch' ? 'Dispatch Slip' : 'Sale Invoice';
  const numKey = type === 'hulling' ? 'receiptNumber' : type === 'purchase' ? 'voucherNumber' : type === 'dispatch' ? 'dispatchNumber' : 'invoiceNumber';

  const handleDownload = () => {
    const content = document.getElementById('print-area-' + entry.id)?.innerHTML || '';
    printHtml(`${title} ${entry[numKey]}`, `<style>
      .rcp{font-family:system-ui,sans-serif;font-size:13px;color:#1f2937}
      .rcp h1{color:#1b4332;font-size:20px;margin:0}
      .rcp table{width:100%;border-collapse:collapse;margin-top:10px}
      .rcp td,.rcp th{padding:6px;text-align:left;border-bottom:1px solid #eee}
      .rcp .right{text-align:right}.rcp .bold{font-weight:bold}
      .rcp .total{background:#f0f7f3;font-weight:bold;font-size:15px}
      .rcp .text-center{text-align:center}.rcp .text-xs{font-size:11px}.rcp .text-green-700{color:#15803d}.rcp .text-red-600{color:#dc2626}
      .rcp .grid{display:flex;gap:32px;margin-top:32px}.rcp .grid>div{flex:1;border-top:1px solid #6b7280;padding-top:3px;text-align:center;font-size:11px}
      .rcp .flex{display:flex;justify-content:space-between;margin-bottom:10px}.rcp .text-right{text-align:right}
      .rcp .border-b-2{border-bottom:2px solid #1b4332;padding-bottom:8px;margin-bottom:10px;text-align:center}
      .rcp .mt-3,.rcp .mt-4{margin-top:10px}.rcp .text-gray-600,.rcp .text-gray-500{color:#6b7280;font-size:11px}
    </style><div class="rcp">${content}</div>`);
  };
  const handleShare = async () => {
    const party = partyName(db, entry.partyId);
    const paidAmt = sumPayments(entry.payments);
    const dueAmt = type === 'dispatch' ? dispatchDue(entry) : entry.finalTotal;
    const msg = `${db.settings.millName}\n${title} ${entry[numKey]} · ${fmtDate(entry.date)}\nParty: ${party}\nQty: ${fmtQtlKg(entry.quantityKg ?? entry.netKg)}\nTotal: ${fmtINR(dueAmt)}\nPaid: ${fmtINR(paidAmt)} · Pending: ${fmtINR(Math.max(0, dueAmt - paidAmt))}`;
    const r = await shareText(`${title} ${entry[numKey]}`, msg);
    if (r === 'copied') toast('Summary copied — paste it in WhatsApp');
    else if (r === 'failed') toast('Sharing not available on this device', 'error');
  };

  const paid = sumPayments(entry.payments);
  const pd = type === 'dispatch' ? entry.paddy : undefined;
  const hd = type === 'dispatch' ? entry.husk : undefined;
  const dueTotal = type === 'dispatch' ? dispatchDue(entry) : entry.finalTotal;
  const pending = round2(dueTotal - paid);

  return (
    <Modal open={true} onClose={onClose} title={title} maxWidth="max-w-xl" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="secondary" onClick={handleShare}>Share</Button>
        <Button variant="gold" onClick={handleDownload}>Print / Save PDF</Button>
      </>
    }>
      <div id={`print-area-${entry.id}`} className="print-area bg-white p-4 text-sm">
        <div className="text-center border-b-2 border-forest-700 pb-3 mb-3">
          <h1 className="text-xl font-bold text-forest-800">{db.settings.millName}</h1>
          <div className="text-xs text-gray-600">{db.settings.address}</div>
          {db.settings.phone && <div className="text-xs text-gray-600">Ph: {db.settings.phone}</div>}
          {db.settings.gstin && <div className="text-xs text-gray-600">GSTIN: {db.settings.gstin}</div>}
        </div>
        <div className="flex justify-between mb-3">
          <div>
            <div className="font-bold text-forest-800">{title}</div>
            <div className="text-xs">No: <strong>{entry[numKey]}</strong></div>
            <div className="text-xs">Date: {fmtDate(entry.date)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs">Party:</div>
            <div className="font-bold">{partyName(db, entry.partyId)}</div>
            {entry.vehicleNumber && <div className="text-xs">Vehicle: {entry.vehicleNumber}</div>}
            {entry.varietyId && <div className="text-xs">Variety: {varietyName(db, entry.varietyId)}</div>}
          </div>
        </div>
        <table>
          <tbody>
            {pd && <tr><td>Paddy</td><td className="right">{pd.size === 'both' ? 'Small + Big' : pd.size === 'big' ? 'Big' : 'Small'} paddy · Gross load {fmtNumber(kgToQtl(pd.grossLoadKg), 2)} Qtl{pd.totalBags ? ` · ${pd.totalBags} bags` : ''}</td></tr>}
            {pd && pd.rows.map((r: any) => r.rateRows.map((rr: any, i: number) => (
              <tr key={r.id + i}><td>{r.label}</td><td className="right">{fmtNumber(kgToQtl(rr.qtyKg * (pd.billFactor ?? 1)), 2)} Qtl @ {fmtINR(rr.ratePerQtl)} = {fmtINR((rr.qtyKg / 100) * (pd.billFactor ?? 1) * rr.ratePerQtl)}</td></tr>
            )))}
            {hd && <tr><td>Husk</td><td className="right">{hd.measureBy === 'bags' ? 'Measured by bags' : 'Measured by weight'}{entry.tripNumber ? ` · ${entry.tripNumber}` : ''}</td></tr>}
            {hd && hd.lots.map((l: any, i: number) => (
              <tr key={'h' + i}><td>Lot {i + 1}</td><td className="right">{l.qty} {hd.measureBy === 'bags' ? 'bags' : 'kg'} @ {fmtINR(l.rate)} = {fmtINR(l.amount)}</td></tr>
            ))}
            {!(hd && entry.netKg <= 0) && <tr><td>Quantity</td><td className="right bold">{fmtQty(entry.quantityKg ?? entry.netKg)} ({fmtNumber(kgToQtl(entry.quantityKg ?? entry.netKg), 3)} Qtl)</td></tr>}
            {!hd && <tr><td>{pd ? 'Average rate per Qtl' : 'Rate per Qtl'}</td><td className="right">{fmtINR(entry.ratePerQtl)}</td></tr>}
            <tr><td>Base Amount</td><td className="right">{fmtINR(entry.baseAmount)}</td></tr>
            {entry.taxableAmount !== undefined && entry.gstMode !== 'none' && (
              <>
                <tr><td>Taxable Value</td><td className="right">{fmtINR(entry.taxableAmount)}</td></tr>
                <tr><td>CGST ({((entry.gstRate || 0) / 2)}%)</td><td className="right">{fmtINR(entry.cgst)}</td></tr>
                <tr><td>SGST ({((entry.gstRate || 0) / 2)}%)</td><td className="right">{fmtINR(entry.sgst)}</td></tr>
                <tr><td>Total Tax</td><td className="right">{fmtINR(entry.totalTax)}</td></tr>
              </>
            )}
            {entry.roundAdjustment !== 0 && <tr><td>Rounding Adjustment</td><td className="right">{entry.roundAdjustment > 0 ? '+' : ''}{fmtINR(entry.roundAdjustment)}</td></tr>}
            {entry.transportCost !== undefined && entry.transportCost > 0 && !pd && <tr><td>{hd ? 'Less: Transport' : 'Transport'}</td><td className="right">{fmtINR(entry.transportCost)}</td></tr>}
            {entry.loadingCost !== undefined && entry.loadingCost > 0 && !pd && <tr><td>{hd ? 'Less: Coolie / loading' : 'Loading'}</td><td className="right">{fmtINR(entry.loadingCost)}</td></tr>}
                        <tr className="total"><td>{hd ? 'NET RECEIVABLE' : 'TOTAL'}</td><td className="right">{fmtINR(dueTotal)}</td></tr>
            <tr><td>Paid</td><td className="right text-green-700">{fmtINR(paid)}</td></tr>
            <tr><td>Balance Due</td><td className="right text-red-600">{fmtINR(pending)}</td></tr>
          </tbody>
        </table>
        {entry.payments?.length > 0 && (
          <>
            <div className="font-bold mt-3 mb-1 text-xs text-gray-700">Payments:</div>
            <table>
              <thead><tr><th>Date</th><th>Mode</th><th>Ref</th><th className="right">Amount</th></tr></thead>
              <tbody>
                {entry.payments.map((p: Payment) => (
                  <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.mode}</td><td>{p.reference || '—'}</td><td className="right">{fmtINR(p.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {entry.bagMovements?.length > 0 && (
          <>
            <div className="font-bold mt-3 mb-1 text-xs text-gray-700">Bags:</div>
            <table>
              <tbody>
                {entry.bagMovements.map((bm: BagMovement, i: number) => (
                  <React.Fragment key={i}>
                    {bm.bagsReceived !== undefined && bm.bagsReceived > 0 && <tr><td>Bags received</td><td className="right">{bm.bagsReceived}</td></tr>}
                    {bm.newBagsIssued !== undefined && bm.newBagsIssued > 0 && <tr><td>New bags issued</td><td className="right">{bm.newBagsIssued}</td></tr>}
                    {bm.oldBagsIssued !== undefined && bm.oldBagsIssued > 0 && <tr><td>Old bags issued</td><td className="right">{bm.oldBagsIssued}</td></tr>}
                    {bm.bagsReturned !== undefined && bm.bagsReturned > 0 && <tr><td>Bags returned</td><td className="right">{bm.bagsReturned}</td></tr>}
                    {bm.newBagCharge !== undefined && bm.newBagCharge > 0 && <tr><td>New bag charge</td><td className="right">{fmtINR(bm.newBagCharge)}</td></tr>}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </>
        )}
        {entry.notes && <div className="mt-3 text-xs"><strong>Notes:</strong> {entry.notes}</div>}
        <div className="mt-8 grid grid-cols-2 gap-8">
          <div className="border-t border-gray-400 pt-1 text-center text-xs">Authorised Signatory</div>
          <div className="border-t border-gray-400 pt-1 text-center text-xs">Receiver Signature</div>
        </div>
        <div className="mt-4 text-center text-[10px] text-gray-500">{db.settings.receiptFooter}</div>
      </div>
    </Modal>
  );
}

// ============ Generic list + form pattern for other modules ============
// (Implemented below for Purchase, Dispatch, Sales, etc.)

// ============ PRODUCTION ============
export { ProductionPage } from './production';

// ============ STOCK PAGE ============
export function StockPage() {
  const { db, stock } = useDB();
  const groups = [
    { title: 'Paddy by Variety', data: Object.entries(stock.paddyByVariety).map(([id, kg]) => ({ name: varietyName(db, id), value: fmtQty(kg), kg })) },
    { title: 'Rice by Variety', data: Object.entries(stock.riceByVariety).map(([id, kg]) => ({ name: varietyName(db, id), value: fmtQty(kg), kg })) },
    { title: 'By-Products', data: [
      { name: 'Broken Rice', value: fmtQty(stock.brokenKg), kg: stock.brokenKg },
      { name: 'Bran', value: fmtQty(stock.branKg), kg: stock.branKg },
      { name: 'Husk', value: fmtQty(stock.huskKg), kg: stock.huskKg },
      { name: 'Other', value: fmtQty(stock.otherByProductKg), kg: stock.otherByProductKg },
    ]},
    { title: 'Trading Goods', trade: true, data: [] as { name: string; value: string; kg: number; isBag: boolean }[] },
    { title: 'Bags', data: [
      { name: 'New Bags', value: fmtNumber(stock.newBags, 0), kg: stock.newBags * 1, isBag: true },
      { name: 'Rice Packing Bags — 25 kg', value: fmtNumber(stock.riceBags25, 0), kg: stock.riceBags25, isBag: true },
      { name: 'Rice Packing Bags — 10 kg', value: fmtNumber(stock.riceBags10, 0), kg: stock.riceBags10, isBag: true },
      { name: 'Old / Reusable', value: fmtNumber(stock.oldBags, 0), kg: stock.oldBags * 1, isBag: true },
    ]},
  ];
  const tradeStock = computeTradingStock(db);
  const tradeRows = db.tradingItems.filter(t => t.active).map(t => ({ name: `${t.name} (${t.baseUnit})`, value: fmtTradeQty(tradeStock[t.id] ?? 0, ''), kg: tradeStock[t.id] ?? 0, isBag: true }));
  const allGroups = groups.map(g => ('trade' in g && (g as { trade?: boolean }).trade) ? { ...g, data: tradeRows } : g);
  return (
    <div className="p-3 space-y-4 pb-6">
      {allGroups.map(g => (
        <div key={g.title}>
          <SectionHeader title={g.title} />
          <Card>
            {g.data.filter(d => Math.abs(d.kg) > 0.01 || g.title.includes('Bags')).length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-500">No stock</div>
            ) : (
              g.data.filter(d => Math.abs(d.kg) > 0.01 || g.title.includes('Bags')).map((d, i) => (
                <ListRow key={i} title={d.name} right={
                  <span className={d.kg < 0 ? 'text-red-600 font-semibold text-sm' : 'text-gray-900 font-semibold text-sm'}>{d.value}</span>
                } />
              ))
            )}
          </Card>
        </div>
      ))}
    </div>
  );
}

// ============ DISPATCH ============
export function DispatchPage() {
  const { db, addDispatch, updateDispatch, deleteDispatch, addDispatchPayment } = useDB();
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('all');
  const [sort, setSort] = useState('date-desc');
  const [editing, setEditing] = useState<DispatchEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [viewEntry, setViewEntry] = useState<DispatchEntry | null>(null);
  const [payEntry, setPayEntry] = useState<DispatchEntry | null>(null);
  const modeOptions = usePaymentModes();
  const products = useProducts();

  const entries = useMemo(() => {
    let list = [...db.dispatches];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(d =>
        d.dispatchNumber.toLowerCase().includes(s) ||
        partyName(db, d.partyId).toLowerCase().includes(s) ||
        (d.vehicleNumber || '').toLowerCase().includes(s)
      );
    }
    list = list.filter(d => inRange(d.date, { preset: range as any }));
    list.sort((a, b) => sort === 'date-asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
    return list;
  }, [db, search, range, sort]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="flex gap-2">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} placeholder="Dispatch, party, vehicle..." /></div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}>+ New</Button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <DateRangePresets value={range} onChange={setRange} />
        <Select value={sort} onChange={e => setSort(e.target.value)} wrapperClassName="w-auto" options={[
          { value: 'date-desc', label: 'Newest' }, { value: 'date-asc', label: 'Oldest' },
        ]} />
      </div>
      <Card>
        {entries.length === 0 ? <EmptyState title="No dispatches" /> : (
          entries.map(d => {
            const paid = sumPayments(d.payments);
            const st = paymentStatus(d.finalTotal, paid);
            const prodName = products.find(p => p.id === d.productId)?.name || d.productId;
            const profit = d.finalTotal - d.totalCosts - (d.baseAmount * 0); // costs deducted from revenue
            return (
              <ListRow
                key={d.id}
                title={`${d.dispatchNumber} · ${partyName(db, d.partyId)}`}
                subtitle={<>
                  <span>{fmtDate(d.date)}</span>
                  {d.vehicleNumber && <span> · {d.vehicleNumber}</span>}
                  <span> · {prodName} {fmtQty(d.netKg)}</span>
                  <div className="mt-0.5 flex gap-1.5 items-center">{statusBadge(st)}
                    {d.totalCosts > 0 && <Badge tone={profit >= 0 ? 'green' : 'red'}>P/L: {fmtINR(d.finalTotal - d.totalCosts)}</Badge>}
                  </div>
                </>}
                leading={<div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-bold">🚛</div>}
                right={<div className="text-right">
                  <div className="font-bold text-gray-900 text-sm">{fmtINR(d.finalTotal)}</div>
                  <div className="text-[10px] text-gray-500">Costs: {fmtINR(d.totalCosts)}</div>
                </div>}
                onClick={() => setViewEntry(d)}
                actions={<>
                  <button onClick={(e) => { e.stopPropagation(); setEditing(d); setShowForm(true); }} className="text-[11px] text-blue-700 font-medium">Edit</button>
                  <button onClick={(e) => { e.stopPropagation(); setPayEntry(d); }} className="text-[11px] text-green-700 font-medium">Add Pay</button>
                  <button onClick={(e) => { e.stopPropagation(); setDelId(d.id); }} className="text-[11px] text-red-600 font-medium">Delete</button>
                </>}
              />
            );
          })
        )}
      </Card>
      <DispatchForm open={showForm} initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSave={(data) => {
        if (editing) { updateDispatch(editing.id, data); toast('Updated'); } else { addDispatch(data); toast('Saved'); }
        setShowForm(false); setEditing(null);
      }} />
      <Confirm open={!!delId} onClose={() => setDelId(null)} onConfirm={() => { if (delId) { deleteDispatch(delId); toast('Deleted'); } }} message="Delete dispatch? Stock reversed." />
      {viewEntry && <ReceiptModal entry={viewEntry} onClose={() => setViewEntry(null)} type="dispatch" />}
      {payEntry && <AddPaymentModal open={!!payEntry} total={payEntry.finalTotal} paid={sumPayments(payEntry.payments)} existingPayments={payEntry.payments} modes={modeOptions}
        onClose={() => setPayEntry(null)} onSave={(p) => { addDispatchPayment(payEntry.id, p); setPayEntry(null); toast('Payment added'); }} />}
    </div>
  );
}

export function DispatchForm({ open, initial, onClose, onSave }: {
  open: boolean; initial: DispatchEntry | null; onClose: () => void;
  onSave: (data: Omit<DispatchEntry, 'id' | 'createdAt' | 'updatedAt' | 'dispatchNumber'>) => void;
}) {
  const { db } = useDB();
  const modeOptions = usePaymentModes();
  const products = useProducts();
  const ensureParty = useEnsureParty();
  const [date, setDate] = useState(initial?.date || today());
  const [buyerName, setBuyerName] = useState(initial?.partyId ? partyName(db, initial.partyId) : '');
  const [vehicleNumber, setVehicleNumber] = useState(initial?.vehicleNumber || '');
  const [productId, setProductId] = useState(initial?.productId || 'pr_rice');
  const [varietyId, setVarietyId] = useState(initial?.varietyId || db.varieties[0]?.id || '');
  const [grossKg, setGrossKg] = useState(initial?.grossKg?.toString() || '');
  const [tareKg, setTareKg] = useState(initial?.tareKg?.toString() || '');
  const [bagWeightKg, setBagWeightKg] = useState(initial?.bagWeightKg?.toString() || '0');
  const [otherDeductionsKg, setOtherDeductionsKg] = useState(initial?.otherDeductionsKg?.toString() || '0');
  const [netKg, setNetKg] = useState(initial?.netKg?.toString() || '');
  const [ratePerQtl, setRatePerQtl] = useState(initial?.ratePerQtl?.toString() || '');
  const [transportCost, setTransportCost] = useState(initial?.transportCost?.toString() || '0');
  const [loadingCost, setLoadingCost] = useState(initial?.loadingCost?.toString() || '0');
  const [unloadingCost, setUnloadingCost] = useState(initial?.unloadingCost?.toString() || '0');
  const [driverBata, setDriverBata] = useState(initial?.driverBata?.toString() || '0');
  const [snacksCost, setSnacksCost] = useState(initial?.snacksCost?.toString() || '0');
  const [otherCosts, setOtherCosts] = useState(initial?.otherCosts?.toString() || '0');
  const [gstMode, setGstMode] = useState<'none' | 'exclusive' | 'inclusive'>(initial?.gstMode || 'none');
  const [gstRate, setGstRate] = useState(initial?.gstRate?.toString() ?? String(db.settings.defaultGstRate || 0));
  const [manual, setManual] = useState<Record<string, boolean>>(initial?.manualOverrides || {});
  const [baseAmount, setBaseAmount] = useState(initial?.baseAmount?.toString() || '');
  const [finalTotal, setFinalTotal] = useState(initial?.finalTotal?.toString() || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [payments, setPayments] = useState<any[]>(initial?.payments || []);

  // Reset when opened
  React.useEffect(() => {
    if (!open) return;
    setDate(initial?.date || today());
    setBuyerName(initial?.partyId ? partyName(db, initial.partyId) : '');
    setVehicleNumber(initial?.vehicleNumber || '');
    setProductId(initial?.productId || 'pr_rice');
    setVarietyId(initial?.varietyId || db.varieties[0]?.id || '');
    setGrossKg(initial?.grossKg?.toString() || '');
    setTareKg(initial?.tareKg?.toString() || '');
    setBagWeightKg(initial?.bagWeightKg?.toString() || '0');
    setOtherDeductionsKg(initial?.otherDeductionsKg?.toString() || '0');
    setNetKg(initial?.netKg?.toString() || '');
    setRatePerQtl(initial?.ratePerQtl?.toString() || '');
    setTransportCost(initial?.transportCost?.toString() || '0');
    setLoadingCost(initial?.loadingCost?.toString() || '0');
    setUnloadingCost(initial?.unloadingCost?.toString() || '0');
    setDriverBata(initial?.driverBata?.toString() || '0');
    setSnacksCost(initial?.snacksCost?.toString() || '0');
    setOtherCosts(initial?.otherCosts?.toString() || '0');
    setGstMode(initial?.gstMode || 'none');
    setGstRate(initial?.gstRate?.toString() ?? String(db.settings.defaultGstRate || 0));
    setManual(initial?.manualOverrides || {});
    setBaseAmount(initial?.baseAmount?.toString() || '');
    setFinalTotal(initial?.finalTotal?.toString() || '');
    setNotes(initial?.notes || '');
    setPayments(initial?.payments ? initial.payments.map(p => ({ date: p.date, amount: p.amount, mode: p.mode, reference: p.reference })) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  React.useEffect(() => {
    if (!open) return;
    const g = Number(grossKg) || 0, t = Number(tareKg) || 0, bw = Number(bagWeightKg) || 0, o = Number(otherDeductionsKg) || 0;
    const net = Math.max(0, g - t - bw - o);
    if (!manual.netKg) setNetKg(net.toFixed(2));
    const qtl = kgToQtl(net);
    const base = round2(qtl * (Number(ratePerQtl) || 0));
    if (!manual.baseAmount) setBaseAmount(base.toFixed(2));
    const gst = calcGST(base, gstMode, Number(gstRate) || 0);
    if (!manual.finalTotal) setFinalTotal(gst.total.toFixed(2));
  }, [open, grossKg, tareKg, bagWeightKg, otherDeductionsKg, ratePerQtl, gstMode, gstRate, manual]);

  const totalCosts = round2(
    (Number(transportCost) || 0) + (Number(loadingCost) || 0) + (Number(unloadingCost) || 0) +
    (Number(driverBata) || 0) + (Number(snacksCost) || 0) + (Number(otherCosts) || 0)
  );

  const handleSave = () => {
    const pid = ensureParty(buyerName, 'customer');
    if (!pid) { toast('Enter a buyer name', 'error'); return; }
    const net = Number(netKg);
    const g = calcGST(Number(baseAmount) || 0, gstMode, Number(gstRate) || 0);
    onSave({
      date, partyId: pid, vehicleNumber, productId, varietyId: productId === 'pr_rice' || productId === 'pr_paddy' ? varietyId : undefined,
      grossKg: Number(grossKg) || 0, tareKg: Number(tareKg) || 0,
      bagWeightKg: Number(bagWeightKg) || 0, otherDeductionsKg: Number(otherDeductionsKg) || 0,
      netKg: net, billableQtl: kgToQtl(net),
      ratePerQtl: Number(ratePerQtl) || 0,
      baseAmount: Number(baseAmount) || 0,
      transportCost: Number(transportCost) || 0,
      loadingCost: Number(loadingCost) || 0,
      unloadingCost: Number(unloadingCost) || 0,
      driverBata: Number(driverBata) || 0,
      snacksCost: Number(snacksCost) || 0,
      otherCosts: Number(otherCosts) || 0,
      totalCosts,
      gstMode, gstRate: Number(gstRate) || 0, taxableAmount: g.taxable, cgst: g.cgst, sgst: g.sgst, totalTax: g.totalTax,
      roundOriginal: g.total, roundAdjustment: 0,
      finalTotal: Number(finalTotal) || 0,
      manualOverrides: manual, notes, payments,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit Dispatch' : 'New Dispatch'} maxWidth="max-w-xl" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave}>Save Dispatch</Button>
      </>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Date" value={date} onChange={e => setDate(e.target.value)} />
          <PartyInput label="Buyer" required value={buyerName} onChange={setBuyerName} types={['customer']} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Vehicle" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value.toUpperCase())} />
          <Select label="Product" value={productId} onChange={e => setProductId(e.target.value)}
            options={products.map(p => ({ value: p.id, label: p.name }))} />
        </div>
        {(productId === 'pr_rice' || productId === 'pr_paddy') && (
          <Select label="Variety" value={varietyId} onChange={e => setVarietyId(e.target.value)}
            options={db.varieties.filter(v => v.active).map(v => ({ value: v.id, label: v.name }))} />
        )}
        <div className="grid grid-cols-2 gap-2">
          <Input label="Gross (kg)" type="number" step="0.01" value={grossKg} onChange={e => setGrossKg(e.target.value)} />
          <Input label="Tare (kg)" type="number" step="0.01" value={tareKg} onChange={e => setTareKg(e.target.value)} />
          <Input label="Bag Wt (kg)" type="number" step="0.01" value={bagWeightKg} onChange={e => setBagWeightKg(e.target.value)} />
          <Input label="Other ded (kg)" type="number" step="0.01" value={otherDeductionsKg} onChange={e => setOtherDeductionsKg(e.target.value)} />
        </div>
        <div className="text-[11px] text-gray-500">Net: <strong>{fmtQty(Number(netKg))}</strong> ({fmtNumber(kgToQtl(Number(netKg)), 3)} Qtl)</div>
        <Input label="Rate per Qtl" type="number" step="0.01" value={ratePerQtl} onChange={e => setRatePerQtl(e.target.value)} suffix="₹" />
        <GSTPanel
          mode={gstMode}
          rate={gstRate}
          onModeChange={setGstMode}
          onRateChange={setGstRate}
          summary={<TaxSummary base={Number(baseAmount) || 0} mode={gstMode} rate={Number(gstRate) || 0} />}
        />
        <div className="border-t pt-2">
          <div className="text-xs font-semibold text-gray-700 mb-2">Costs</div>
          <div className="grid grid-cols-3 gap-2">
            <Input label="Transport" type="number" step="0.01" value={transportCost} onChange={e => setTransportCost(e.target.value)} />
            <Input label="Loading" type="number" step="0.01" value={loadingCost} onChange={e => setLoadingCost(e.target.value)} />
            <Input label="Unloading" type="number" step="0.01" value={unloadingCost} onChange={e => setUnloadingCost(e.target.value)} />
            <Input label="Driver Bata" type="number" step="0.01" value={driverBata} onChange={e => setDriverBata(e.target.value)} />
            <Input label="Snacks" type="number" step="0.01" value={snacksCost} onChange={e => setSnacksCost(e.target.value)} />
            <Input label="Other" type="number" step="0.01" value={otherCosts} onChange={e => setOtherCosts(e.target.value)} />
          </div>
          <div className="text-xs text-right mt-1">Total Costs: <strong>{fmtINR(totalCosts)}</strong></div>
        </div>
        <CalcField label="Final Amount (revenue)" value={finalTotal as any} onChange={(v) => { setFinalTotal(String(v)); setManual(m => ({ ...m, finalTotal: true })); }} manual={!!manual.finalTotal} onRecalc={() => setManual({})} suffix="₹" />
        <PaymentForm total={Number(finalTotal) || 0} paid={payments.reduce((s: number, p: any) => s + p.amount, 0)} payments={payments} onChange={setPayments} modeOptions={modeOptions} />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

// ============ SALES (simplified) ============
export function SalesPage() {
  const { db, addSale, updateSale, deleteSale, addSalePayment } = useDB();
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('all');
  const [editing, setEditing] = useState<SaleEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [viewEntry, setViewEntry] = useState<SaleEntry | null>(null);
  const [payEntry, setPayEntry] = useState<SaleEntry | null>(null);
  const modeOptions = usePaymentModes();
  const products = useProducts();

  const entries = useMemo(() => {
    let list = [...db.sales];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(x => x.invoiceNumber.toLowerCase().includes(s) || partyName(db, x.partyId).toLowerCase().includes(s));
    }
    list = list.filter(x => inRange(x.date, { preset: range as any }));
    list.sort((a, b) => b.date.localeCompare(a.date));
    return list;
  }, [db, search, range]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="flex gap-2">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} placeholder="Invoice, buyer..." /></div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}>+ New Sale</Button>
      </div>
      <DateRangePresets value={range} onChange={setRange} />
      <Card>
        {entries.length === 0 ? <EmptyState title="No sales yet" /> : (
          entries.map(s => {
            const paid = sumPayments(s.payments);
            const st = paymentStatus(s.finalTotal, paid);
            const prodName = products.find(p => p.id === s.productId)?.name || s.productId;
            return (
              <ListRow key={s.id}
                title={`${s.invoiceNumber} · ${partyName(db, s.partyId)}`}
                subtitle={<><span>{fmtDate(s.date)}</span><span> · {prodName} {fmtQty(s.quantityKg)}</span>
                  <div className="mt-0.5">{statusBadge(st)}</div></>}
                leading={<div className="w-10 h-10 rounded-lg bg-green-100 text-green-700 flex items-center justify-center text-sm font-bold">💰</div>}
                right={<div className="font-bold text-sm">{fmtINR(s.finalTotal)}</div>}
                onClick={() => setViewEntry(s)}
                actions={<>
                  <button onClick={(e) => { e.stopPropagation(); setEditing(s); setShowForm(true); }} className="text-[11px] text-blue-700 font-medium">Edit</button>
                  <button onClick={(e) => { e.stopPropagation(); setPayEntry(s); }} className="text-[11px] text-green-700 font-medium">Add Pay</button>
                  <button onClick={(e) => { e.stopPropagation(); setDelId(s.id); }} className="text-[11px] text-red-600 font-medium">Delete</button>
                </>}
              />
            );
          })
        )}
      </Card>
      <SaleForm open={showForm} initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSave={(data) => {
        if (editing) { updateSale(editing.id, data); toast('Updated'); } else { addSale(data); toast('Saved'); }
        setShowForm(false); setEditing(null);
      }} />
      <Confirm open={!!delId} onClose={() => setDelId(null)} onConfirm={() => { if (delId) { deleteSale(delId); toast('Deleted'); } }} message="Delete sale? Stock reversed." />
      {viewEntry && <ReceiptModal entry={viewEntry} onClose={() => setViewEntry(null)} type="sale" />}
      {payEntry && <AddPaymentModal open={!!payEntry} total={payEntry.finalTotal} paid={sumPayments(payEntry.payments)} existingPayments={payEntry.payments} modes={modeOptions}
        onClose={() => setPayEntry(null)} onSave={(p) => { addSalePayment(payEntry.id, p); setPayEntry(null); toast('Payment added'); }} />}
    </div>
  );
}

function SaleForm({ open, initial, onClose, onSave }: {
  open: boolean; initial: SaleEntry | null; onClose: () => void;
  onSave: (data: Omit<SaleEntry, 'id' | 'createdAt' | 'updatedAt' | 'invoiceNumber'>) => void;
}) {
  const { db } = useDB();
  const modeOptions = usePaymentModes();
  const products = useProducts();
  const ensureParty = useEnsureParty();
  const [date, setDate] = useState(initial?.date || today());
  const [buyerName, setBuyerName] = useState(initial?.partyId ? partyName(db, initial.partyId) : '');
  const [productId, setProductId] = useState(initial?.productId || 'pr_rice');
  const [varietyId, setVarietyId] = useState(initial?.varietyId || db.varieties[0]?.id || '');
  const [quantityKg, setQuantityKg] = useState(initial?.quantityKg?.toString() || '');
  const [ratePerQtl, setRatePerQtl] = useState(initial?.ratePerQtl?.toString() || '');
  const [vehicleNumber, setVehicleNumber] = useState(initial?.vehicleNumber || '');
  const [gstMode, setGstMode] = useState<'none' | 'exclusive' | 'inclusive'>(initial?.gstMode || 'none');
  const [gstRate, setGstRate] = useState(initial?.gstRate?.toString() ?? String(db.settings.defaultGstRate || 0));
  const [baseAmount, setBaseAmount] = useState(initial?.baseAmount?.toString() || '0');
  const [finalTotal, setFinalTotal] = useState(initial?.finalTotal?.toString() || '0');
  const [manual, setManual] = useState<Record<string, boolean>>(initial?.manualOverrides || {});
  const [notes, setNotes] = useState(initial?.notes || '');
  const [payments, setPayments] = useState<any[]>(initial?.payments || []);

  // Reset when opened
  React.useEffect(() => {
    if (!open) return;
    setDate(initial?.date || today());
    setBuyerName(initial?.partyId ? partyName(db, initial.partyId) : '');
    setProductId(initial?.productId || 'pr_rice');
    setVarietyId(initial?.varietyId || db.varieties[0]?.id || '');
    setQuantityKg(initial?.quantityKg?.toString() || '');
    setRatePerQtl(initial?.ratePerQtl?.toString() || '');
    setVehicleNumber(initial?.vehicleNumber || '');
    setGstMode(initial?.gstMode || 'none');
    setGstRate(initial?.gstRate?.toString() ?? String(db.settings.defaultGstRate || 0));
    setBaseAmount(initial?.baseAmount?.toString() || '0');
    setFinalTotal(initial?.finalTotal?.toString() || '0');
    setManual(initial?.manualOverrides || {});
    setNotes(initial?.notes || '');
    setPayments(initial?.payments ? initial.payments.map(p => ({ date: p.date, amount: p.amount, mode: p.mode, reference: p.reference })) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  React.useEffect(() => {
    if (!open) return;
    const qtl = kgToQtl(Number(quantityKg) || 0);
    const base = round2(qtl * (Number(ratePerQtl) || 0));
    if (!manual.baseAmount) setBaseAmount(base.toFixed(2));
    const g = calcGST(base, gstMode, Number(gstRate) || 0);
    if (!manual.finalTotal) setFinalTotal(g.total.toFixed(2));
  }, [open, quantityKg, ratePerQtl, gstMode, gstRate, manual]);

  const handleSave = () => {
    const pid = ensureParty(buyerName, 'customer');
    if (!pid) { toast('Enter a buyer name', 'error'); return; }
    const g = calcGST(Number(baseAmount) || 0, gstMode, Number(gstRate) || 0);
    onSave({
      date, partyId: pid, productId, varietyId: productId === 'pr_rice' || productId === 'pr_paddy' ? varietyId : undefined,
      quantityKg: Number(quantityKg) || 0, ratePerQtl: Number(ratePerQtl) || 0,
      gstMode, gstRate: Number(gstRate) || 0, baseAmount: Number(baseAmount), taxableAmount: g.taxable,
      cgst: g.cgst, sgst: g.sgst, totalTax: g.totalTax, roundOriginal: g.total, roundAdjustment: 0,
      finalTotal: Number(finalTotal), vehicleNumber, manualOverrides: manual, notes, payments,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit Sale' : 'New Sale'} maxWidth="max-w-lg" footer={
      <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={handleSave}>Save Sale</Button></>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Date" value={date} onChange={e => setDate(e.target.value)} />
          <PartyInput label="Buyer" required value={buyerName} onChange={setBuyerName} types={['customer']} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select label="Product" value={productId} onChange={e => setProductId(e.target.value)}
            options={products.map(p => ({ value: p.id, label: p.name }))} />
          {(productId === 'pr_rice' || productId === 'pr_paddy') && (
            <Select label="Variety" value={varietyId} onChange={e => setVarietyId(e.target.value)}
              options={db.varieties.filter(v => v.active).map(v => ({ value: v.id, label: v.name }))} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Quantity (kg)" type="number" step="0.01" value={quantityKg} onChange={e => setQuantityKg(e.target.value)} />
          <Input label="Rate/Qtl" type="number" step="0.01" value={ratePerQtl} onChange={e => setRatePerQtl(e.target.value)} suffix="₹" />
        </div>
        <GSTPanel
          mode={gstMode}
          rate={gstRate}
          onModeChange={setGstMode}
          onRateChange={setGstRate}
          summary={<TaxSummary base={Number(baseAmount) || 0} mode={gstMode} rate={Number(gstRate) || 0} />}
        />
        <Input label="Vehicle (optional)" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value.toUpperCase())} />
        <div className="bg-gray-50 p-3 rounded-lg text-sm">
          <div className="flex justify-between"><span>Quantity:</span><strong>{fmtQty(Number(quantityKg) || 0)}</strong></div>
          <div className="flex justify-between"><span>Amount:</span><strong>{fmtINR(Number(finalTotal))}</strong></div>
          {gstMode !== 'none' && (
            <div className="flex justify-between mt-1 pt-1 border-t border-gray-200 text-xs">
              <span>Incl. GST {gstRate}% ({gstMode})</span>
              <span>Tax {fmtINR(calcGST(Number(baseAmount) || 0, gstMode, Number(gstRate) || 0).totalTax)}</span>
            </div>
          )}
        </div>
        <PaymentForm total={Number(finalTotal) || 0} paid={payments.reduce((s: number, p: any) => s + p.amount, 0)} payments={payments} onChange={setPayments} modeOptions={modeOptions} />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

// ============ EXPENSES ============
export function ExpensesPage() {
  const { db, addExpense, updateExpense, deleteExpense, addExpensePayment } = useDB();
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [editing, setEditing] = useState<ExpenseEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [payEntry, setPayEntry] = useState<ExpenseEntry | null>(null);
  const modeOptions = usePaymentModes();
  const cats = useExpenseCats();

  const entries = useMemo(() => {
    let list = [...db.expenses];
    if (search) { const s = search.toLowerCase(); list = list.filter(e => (e.payee || '').toLowerCase().includes(s) || (e.notes || '').toLowerCase().includes(s)); }
    if (catFilter !== 'all') list = list.filter(e => e.categoryId === catFilter);
    list = list.filter(e => inRange(e.date, { preset: range as any }));
    list.sort((a, b) => b.date.localeCompare(a.date));
    return list;
  }, [db, search, range, catFilter]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="flex gap-2">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} placeholder="Payee, notes..." /></div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}>+ New</Button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <DateRangePresets value={range} onChange={setRange} />
        <Select value={catFilter} onChange={e => setCatFilter(e.target.value)} wrapperClassName="w-auto"
          options={[{ value: 'all', label: 'All Categories' }, ...cats.map(c => ({ value: c.id, label: c.name }))]} />
      </div>
      <Card>
        {entries.length === 0 ? <EmptyState title="No expenses" /> : (
          entries.map(e => {
            const paid = sumPayments(e.payments);
            const st = paid >= e.amount ? 'paid' as const : paid > 0 ? 'partial' as const : 'unpaid' as const;
            const cat = cats.find(c => c.id === e.categoryId);
            return (
              <ListRow key={e.id}
                title={`${e.payee || cat?.name || 'Expense'}`}
                subtitle={<><span>{fmtDate(e.date)}</span><span> · {cat?.name || e.categoryId}</span>
                  {e.isPersonal && <Badge tone="gold">Personal</Badge>}
                  <div className="mt-0.5">{statusBadge(st)}</div></>}
                leading={<div className="w-10 h-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center text-sm font-bold">💸</div>}
                right={<div className="text-right"><div className="font-bold text-sm">{fmtINR(e.amount)}</div>{paid < e.amount && <div className="text-[10px] text-red-600">Due: {fmtINR(e.amount - paid)}</div>}</div>}
                actions={<>
                  <button onClick={() => { setEditing(e); setShowForm(true); }} className="text-[11px] text-blue-700 font-medium">Edit</button>
                  {!e.isPaid && <button onClick={() => setPayEntry(e)} className="text-[11px] text-green-700 font-medium">Pay</button>}
                  <button onClick={() => setDelId(e.id)} className="text-[11px] text-red-600 font-medium">Delete</button>
                </>}
              />
            );
          })
        )}
      </Card>
      <ExpenseForm open={showForm} initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSave={(data) => {
        if (editing) { updateExpense(editing.id, data); toast('Updated'); } else { addExpense(data); toast('Saved'); }
        setShowForm(false); setEditing(null);
      }} />
      <Confirm open={!!delId} onClose={() => setDelId(null)} onConfirm={() => { if (delId) { deleteExpense(delId); toast('Deleted'); } }} message="Delete expense?" />
      {payEntry && <AddPaymentModal open={!!payEntry} total={payEntry.amount} paid={sumPayments(payEntry.payments)} existingPayments={payEntry.payments} modes={modeOptions}
        onClose={() => setPayEntry(null)} onSave={(p) => { addExpensePayment(payEntry.id, p); setPayEntry(null); toast('Payment added'); }} />}
    </div>
  );
}

function ExpenseForm({ open, initial, onClose, onSave }: {
  open: boolean; initial: ExpenseEntry | null; onClose: () => void;
  onSave: (data: Omit<ExpenseEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
}) {
  const { db } = useDB();
  const cats = useExpenseCats();
  const modeOptions = usePaymentModes();
  const ensureParty = useEnsureParty();
  const [date, setDate] = useState(initial?.date || today());
  const [categoryId, setCategoryId] = useState(initial?.categoryId || cats[0]?.id || '');
  const [payee, setPayee] = useState(initial?.payee || '');
  const [partyLink, setPartyLink] = useState(initial?.partyId ? partyName(db, initial.partyId) : '');
  const [amount, setAmount] = useState(initial?.amount?.toString() || '');
  const [mode, setMode] = useState(initial?.mode || modeOptions[0] || 'Cash');
  const [dueDate, setDueDate] = useState(initial?.dueDate || '');
  const [isPersonal, setIsPersonal] = useState(initial?.isPersonal || false);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [payments, setPayments] = useState<any[]>(initial?.payments || []);

  React.useEffect(() => { if (open) {
    setDate(initial?.date || today());
    setCategoryId(initial?.categoryId || cats[0]?.id || '');
    setPayee(initial?.payee || '');
    setPartyLink(initial?.partyId ? partyName(db, initial.partyId) : '');
    setAmount(initial?.amount?.toString() || '');
    setMode(initial?.mode || modeOptions[0] || 'Cash');
    setDueDate(initial?.dueDate || '');
    setIsPersonal(initial?.isPersonal || false);
    setNotes(initial?.notes || '');
    setPayments(initial?.payments ? initial.payments.map(p => ({ date: p.date, amount: p.amount, mode: p.mode, reference: p.reference })) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }}, [open, initial?.id]);

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit Expense' : 'New Expense'} maxWidth="max-w-lg" footer={
      <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => {
        if (!amount || Number(amount) <= 0) { toast('Enter amount', 'error'); return; }
        const paidAmt = payments.reduce((s: number, p: any) => s + p.amount, 0);
        const resolvedPid = partyLink.trim() ? ensureParty(partyLink, 'vendor') : undefined;
        onSave({
          date, categoryId, payee, partyId: resolvedPid, amount: Number(amount), mode,
          isPaid: paidAmt >= Number(amount), dueDate: dueDate || undefined, isPersonal, notes, payments,
        });
      }}>Save</Button></>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Date" value={date} onChange={e => setDate(e.target.value)} />
          <Select label="Category" value={categoryId} onChange={e => setCategoryId(e.target.value)}
            options={cats.map(c => ({ value: c.id, label: c.name }))} />
        </div>
        <Input label="Payee" value={payee} onChange={e => setPayee(e.target.value)} />
        <PartyInput label="Party (optional — adds to ledger)" value={partyLink} onChange={setPartyLink} types={['vendor', 'supplier', 'customer']} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Amount" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} suffix="₹" />
          <Select label="Default Mode" value={mode} onChange={e => setMode(e.target.value)} options={modeOptions} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Due Date (optional)" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          <label className="flex items-center gap-2 text-sm mt-5">
            <input type="checkbox" checked={isPersonal} onChange={e => setIsPersonal(e.target.checked)} /> Personal expense
          </label>
        </div>
        <PaymentForm total={Number(amount) || 0} paid={payments.reduce((s: number, p: any) => s + p.amount, 0)} payments={payments} onChange={setPayments} modeOptions={modeOptions} />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

// ============ LABOUR ============
export { LabourPage } from './labour';

// ============ ELECTRICITY ============
export function ElectricityPage() {
  const { db, addElectricity, updateElectricity, deleteElectricity, addElectricityPayment } = useDB();
  const [editing, setEditing] = useState<ElectricityBill | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const modeOptions = usePaymentModes();

  const list = useMemo(() => [...db.electricity].sort((a, b) => b.billDate.localeCompare(a.billDate)), [db.electricity]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="flex justify-end"><Button onClick={() => { setEditing(null); setShowForm(true); }}>+ New Bill</Button></div>
      <Card>
        {list.length === 0 ? <EmptyState title="No electricity bills" /> : (
          list.map(e => {
            const paid = sumPayments(e.payments);
            return (
              <ListRow key={e.id}
                title={e.periodFrom ? `${fmtDate(e.periodFrom)} - ${fmtDate(e.periodTo || '')}` : fmtDate(e.billDate)}
                subtitle={<><span>Units: {e.units || '—'}</span>{e.dueDate && <span> · Due: {fmtDate(e.dueDate)}</span>}
                  <div className="mt-0.5">{paid < e.amount ? <Badge tone="red">Unpaid</Badge> : <Badge tone="green">PAID</Badge>}</div></>}
                leading={<div className="w-10 h-10 rounded-lg bg-yellow-100 text-yellow-700 flex items-center justify-center text-sm font-bold">⚡</div>}
                right={<div className="text-right"><div className="font-bold text-sm">{fmtINR(e.amount)}</div>{paid < e.amount && <div className="text-[10px] text-red-600">Due: {fmtINR(e.amount - paid)}</div>}</div>}
                actions={<>
                  <button onClick={() => { setEditing(e); setShowForm(true); }} className="text-[11px] text-blue-700 font-medium">Edit</button>
                  {paid < e.amount && <button onClick={() => { addElectricityPayment(e.id, { date: today(), amount: e.amount - paid, mode: modeOptions[0] || 'Cash' }); toast('Payment added'); }} className="text-[11px] text-green-700 font-medium">Mark Paid</button>}
                  <button onClick={() => setDelId(e.id)} className="text-[11px] text-red-600 font-medium">Delete</button>
                </>}
              />
            );
          })
        )}
      </Card>
      <ElectricityForm open={showForm} initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSave={(data) => {
        if (editing) { updateElectricity(editing.id, data); toast('Updated'); } else { addElectricity(data); toast('Saved'); }
        setShowForm(false); setEditing(null);
      }} />
      <Confirm open={!!delId} onClose={() => setDelId(null)} onConfirm={() => { if (delId) { deleteElectricity(delId); toast('Deleted'); } }} message="Delete electricity bill?" />
    </div>
  );
}

function ElectricityForm({ open, initial, onClose, onSave }: {
  open: boolean; initial: ElectricityBill | null; onClose: () => void;
  onSave: (data: Omit<ElectricityBill, 'id' | 'createdAt' | 'updatedAt'>) => void;
}) {
  const modeOptions = usePaymentModes();
  const [billDate, setBillDate] = useState(initial?.billDate || today());
  const [periodFrom, setPeriodFrom] = useState(initial?.periodFrom || '');
  const [periodTo, setPeriodTo] = useState(initial?.periodTo || '');
  const [units, setUnits] = useState(initial?.units?.toString() || '');
  const [amount, setAmount] = useState(initial?.amount?.toString() || '');
  const [dueDate, setDueDate] = useState(initial?.dueDate || '');
  const [mode, setMode] = useState(initial?.mode || modeOptions[0] || 'Cash');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [payments, setPayments] = useState<any[]>(initial?.payments || []);

  React.useEffect(() => { if (open) {
    setBillDate(initial?.billDate || today());
    setPeriodFrom(initial?.periodFrom || '');
    setPeriodTo(initial?.periodTo || '');
    setUnits(initial?.units?.toString() || '');
    setAmount(initial?.amount?.toString() || '');
    setDueDate(initial?.dueDate || '');
    setMode(initial?.mode || modeOptions[0]);
    setNotes(initial?.notes || '');
    setPayments(initial?.payments || []);
  }}, [open, initial]);

  return (
    <Modal open={open} onClose={onClose} title="Electricity Bill" maxWidth="max-w-lg" footer={
      <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => {
        onSave({
          billDate, periodFrom: periodFrom || undefined, periodTo: periodTo || undefined,
          units: units ? Number(units) : undefined,
          amount: Number(amount) || 0, dueDate: dueDate || undefined,
          isPaid: payments.reduce((s, p) => s + p.amount, 0) >= Number(amount),
          mode, notes, payments,
        });
      }}>Save</Button></>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Bill Date" value={billDate} onChange={e => setBillDate(e.target.value)} />
          <Input type="date" label="Due Date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          <Input type="date" label="Period From" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} />
          <Input type="date" label="Period To" value={periodTo} onChange={e => setPeriodTo(e.target.value)} />
          <Input label="Units Consumed" type="number" value={units} onChange={e => setUnits(e.target.value)} />
          <Input label="Amount" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} suffix="₹" />
        </div>
        <PaymentForm total={Number(amount) || 0} paid={payments.reduce((s, p) => s + p.amount, 0)} payments={payments} onChange={setPayments} modeOptions={modeOptions} />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

// ============ CASHBOOK ============
export function CashbookPage() {
  const { db, addCashbook } = useDB();
  const [range, setRange] = useState('month');
  const [showAdd, setShowAdd] = useState(false);

  const entries = useMemo(() => {
    return db.cashbook.filter(c => inRange(c.date, { preset: range as any })).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [db.cashbook, range]);

  const summary = useMemo(() => {
    let cashIn = 0, cashOut = 0;
    for (const c of entries) {
      if (c.type === 'receipt') cashIn += c.amount;
      else if (c.type === 'payment') cashOut += c.amount;
    }
    return { cashIn, cashOut, net: cashIn - cashOut };
  }, [entries]);

  const byMode = useMemo(() => {
    const m: Record<string, { in: number; out: number }> = {};
    for (const c of entries) {
      if (c.type === 'transfer') continue;
      if (!m[c.mode]) m[c.mode] = { in: 0, out: 0 };
      if (c.type === 'receipt') m[c.mode].in += c.amount;
      else m[c.mode].out += c.amount;
    }
    return m;
  }, [entries]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="flex justify-between items-center">
        <DateRangePresets value={range} onChange={setRange} />
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Entry</Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <KPICard label="Cash In" value={fmtINR(summary.cashIn)} tone="green" />
        <KPICard label="Cash Out" value={fmtINR(summary.cashOut)} tone="red" />
        <KPICard label="Net" value={fmtINR(summary.net)} tone={summary.net >= 0 ? 'green' : 'red'} />
      </div>
      <div>
        <SectionHeader title="By Mode" />
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(byMode).map(([mode, v]) => (
            <Card key={mode} className="p-2.5">
              <div className="text-[10px] font-medium text-gray-500 uppercase">{mode}</div>
              <div className="flex justify-between mt-1 text-xs">
                <span className="text-green-700">+{fmtINR(v.in)}</span>
                <span className="text-red-600">-{fmtINR(v.out)}</span>
              </div>
            </Card>
          ))}
          {Object.keys(byMode).length === 0 && <div className="col-span-2 text-center text-xs text-gray-500 py-4">No entries</div>}
        </div>
      </div>
      <div>
        <SectionHeader title="Transactions" />
        <Card>
          {entries.length === 0 ? <EmptyState title="No transactions in this period" /> : (
            entries.map(c => (
              <ListRow key={c.id}
                title={c.description || c.linkedModule || c.type}
                subtitle={<><span>{fmtDate(c.date)}</span><span> · {c.mode}</span>{c.linkedModule && <span className="ml-1 text-forest-700">({c.linkedModule})</span>}</>}
                leading={<div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold', c.type === 'receipt' ? 'bg-green-500' : c.type === 'payment' ? 'bg-red-500' : 'bg-blue-500')}>
                  {c.type === 'receipt' ? '↑' : c.type === 'payment' ? '↓' : '↔'}
                </div>}
                right={<div className={c.type === 'receipt' ? 'text-green-700 font-bold text-sm' : c.type === 'payment' ? 'text-red-600 font-bold text-sm' : 'text-blue-700 font-semibold text-sm'}>
                  {c.type === 'receipt' ? '+' : c.type === 'payment' ? '-' : ''}{fmtINR(c.amount)}
                </div>}
              />
            ))
          )}
        </Card>
      </div>
      <AddCashbookModal open={showAdd} onClose={() => setShowAdd(false)} onSave={(c) => { addCashbook(c); setShowAdd(false); toast('Added'); }} />
    </div>
  );
}

function AddCashbookModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (c: Omit<import('../types').CashbookEntry, 'id' | 'createdAt'>) => void }) {
  const modeOptions = usePaymentModes();
  const [date, setDate] = useState(today());
  const [type, setType] = useState<'receipt' | 'payment' | 'transfer'>('receipt');
  const [mode, setMode] = useState(modeOptions[0] || 'Cash');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Add Cash Entry" maxWidth="max-w-sm" footer={
      <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => {
        if (!amount || Number(amount) <= 0) { toast('Invalid amount', 'error'); return; }
        onSave({ date, type, mode, amount: Number(amount), description });
      }}>Save</Button></>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Date" value={date} onChange={e => setDate(e.target.value)} />
          <Select label="Type" value={type} onChange={e => setType(e.target.value as any)}
            options={[{ value: 'receipt', label: 'Receipt (In)' }, { value: 'payment', label: 'Payment (Out)' }, { value: 'transfer', label: 'Transfer' }]} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select label="Mode" value={mode} onChange={e => setMode(e.target.value)} options={modeOptions} />
          <Input label="Amount" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} suffix="₹" />
        </div>
        <Input label="Description" value={description} onChange={e => setDescription(e.target.value)} />
      </div>
    </Modal>
  );
}

// ============ OUTSTANDING ============
export function OutstandingPage() {
  const { db } = useDB();
  const [tab, setTab] = useState<'receivable' | 'payable'>('receivable');
  const rows = useMemo(() => {
    const list: { party: Party; balance: number }[] = [];
    for (const p of db.parties) {
      const { balance } = computePartyLedger(db, p.id);
      if (tab === 'receivable' && balance > 0.01) list.push({ party: p, balance });
      if (tab === 'payable' && balance < -0.01) list.push({ party: p, balance: -balance });
    }
    list.sort((a, b) => b.balance - a.balance);
    return list;
  }, [db, tab]);

  const total = rows.reduce((s, r) => s + r.balance, 0);

  return (
    <div className="p-3 space-y-3 pb-6">
      <Tabs active={tab} onChange={t => setTab(t as any)} tabs={[{ id: 'receivable', label: 'Receivables' }, { id: 'payable', label: 'Payables' }]} />
      <Card className="p-3 bg-forest-50 flex justify-between items-center">
        <div className="text-xs font-medium text-forest-700">Total {tab === 'receivable' ? 'to receive' : 'to pay'}</div>
        <div className="font-bold text-lg text-forest-800">{fmtINR(total)}</div>
      </Card>
      <Card>
        {rows.length === 0 ? <EmptyState title={`No ${tab}`} /> : (
          rows.map(r => (
            <ListRow key={r.party.id}
              title={r.party.name}
              subtitle={<>{r.party.village || ''} {r.party.phone ? `· ${r.party.phone}` : ''}</>}
              leading={<div className="w-9 h-9 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center font-bold text-sm">{r.party.name[0]}</div>}
              right={<div className={tab === 'receivable' ? 'text-green-700 font-bold' : 'text-red-600 font-bold'}>{fmtINR(r.balance)}</div>}
            />
          ))
        )}
      </Card>
    </div>
  );
}

// ============ BAGS PAGE ============
export function BagsPage() {
  const { db, stock } = useDB();
  const rows = useMemo(() => {
    const list: { purchase: PurchaseEntry; pending: number; }[] = [];
    for (const pu of db.purchases) {
      const pending = pu.bagMovements.reduce((s, b) => s + calcPendingBags(b), 0);
      if (pending !== 0) list.push({ purchase: pu, pending });
    }
    return list;
  }, [db]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="grid grid-cols-2 gap-2">
        <KPICard label="New Bags (in stock)" value={fmtNumber(stock.newBags, 0)} icon={<span>👜</span>} />
        <KPICard label="Old/Reusable Bags" value={fmtNumber(stock.oldBags, 0)} icon={<span>👜</span>} />
      </div>
      <SectionHeader title="Pending Bag Returns" />
      <Card>
        {rows.length === 0 ? <EmptyState title="No pending bags" subtitle="All bags are settled." /> : (
          rows.map(r => (
            <ListRow key={r.purchase.id}
              title={`${r.purchase.voucherNumber} · ${partyName(db, r.purchase.partyId)}`}
              subtitle={<>{fmtDate(r.purchase.date)}</>}
              leading={<div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-sm">👜</div>}
              right={<div className={r.pending > 0 ? 'text-amber-700 font-bold text-sm' : 'text-red-600 font-bold text-sm'}>
                {r.pending > 0 ? `${fmtNumber(r.pending, 0)} pending` : fmtNumber(r.pending, 0)}
              </div>}
            />
          ))
        )}
      </Card>
    </div>
  );
}

// ============ SETTINGS ============
export function SettingsPage() {
  const { db, updateSettings, upsertVariety, upsertCategory, deleteCategory, resetAll } = useDB();
  const [millName, setMillName] = useState(db.settings.millName);
  const [address, setAddress] = useState(db.settings.address);
  const [phone, setPhone] = useState(db.settings.phone);
  const [gstin, setGstin] = useState(db.settings.gstin || '');
  const [receiptFooter, setReceiptFooter] = useState(db.settings.receiptFooter);
  const [defaultHullingRate, setDefaultHullingRate] = useState(String(db.settings.defaultHullingRate));
  const [defaultBagCost, setDefaultBagCost] = useState(String(db.settings.defaultBagCost));
  const [defaultGstRate, setDefaultGstRate] = useState(String(db.settings.defaultGstRate));
  const [taxMode, setTaxMode] = useState(db.settings.taxMode);
  const [minStock, setMinStock] = useState({
    paddy: String(db.settings.minStockQtl?.paddy || 0), rice: String(db.settings.minStockQtl?.rice || 0),
    bran: String(db.settings.minStockQtl?.bran || 0), husk: String(db.settings.minStockQtl?.husk || 0),
  });
  const [newVariety, setNewVariety] = useState('');
  const [newVarietyCat, setNewVarietyCat] = useState<'small' | 'big' | 'other'>('small');
  const [newExpenseCat, setNewExpenseCat] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  return (
    <div className="p-3 space-y-4 pb-6">
      <Card className="p-3 space-y-2">
        <h3 className="font-semibold text-forest-800">Mill Identity</h3>
        <Input label="Mill Name" value={millName} onChange={e => setMillName(e.target.value)} />
        <Input label="Address" value={address} onChange={e => setAddress(e.target.value)} />
        <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
        <Input label="GSTIN (optional)" value={gstin} onChange={e => setGstin(e.target.value)} />
        <Textarea label="Receipt Footer" value={receiptFooter} onChange={e => setReceiptFooter(e.target.value)} />
      </Card>
      <Card className="p-3 space-y-2">
        <h3 className="font-semibold text-forest-800">Defaults</h3>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Default Hulling Rate/Qtl" type="number" step="0.01" value={defaultHullingRate} onChange={e => setDefaultHullingRate(e.target.value)} suffix="₹" />
          <Input label="Default Bag Cost" type="number" step="0.01" value={defaultBagCost} onChange={e => setDefaultBagCost(e.target.value)} suffix="₹" />
          <Select label="Tax Mode" value={taxMode} onChange={e => setTaxMode(e.target.value as any)}
            options={[{ value: 'none', label: 'No GST' }, { value: 'gst', label: 'GST Enabled' }]} />
          <Input label="Default GST Rate %" type="number" value={defaultGstRate} onChange={e => setDefaultGstRate(e.target.value)} suffix="%" />
        </div>
      </Card>
      <Card className="p-3 space-y-2">
        <h3 className="font-semibold text-forest-800">Low-stock alerts (Qtl)</h3>
        <p className="text-[11px] text-gray-500">Shown on the Home page when stock falls below the minimum. Leave 0 to switch an alert off.</p>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Paddy min (Qtl)" type="number" value={minStock.paddy} onChange={e => setMinStock({ ...minStock, paddy: e.target.value })} />
          <Input label="Rice min (Qtl)" type="number" value={minStock.rice} onChange={e => setMinStock({ ...minStock, rice: e.target.value })} />
          <Input label="Bran min (Qtl)" type="number" value={minStock.bran} onChange={e => setMinStock({ ...minStock, bran: e.target.value })} />
          <Input label="Husk min (Qtl)" type="number" value={minStock.husk} onChange={e => setMinStock({ ...minStock, husk: e.target.value })} />
        </div>
      </Card>
      <Card className="p-3 space-y-2">
        <h3 className="font-semibold text-forest-800">Paddy Varieties</h3>
        <div className="space-y-1">
          {db.varieties.map(v => (
            <div key={v.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${v.active ? 'bg-gray-50' : 'bg-gray-100 opacity-60'}`}>
              <span className="flex-1 min-w-0 truncate">{v.name}</span>
              <select value={v.category} onChange={e => { upsertVariety({ id: v.id, name: v.name, category: e.target.value as any }); toast('Size mapping saved'); }}
                className="text-xs border border-gray-200 rounded px-1 py-1 bg-white">
                <option value="small">Small paddy</option><option value="big">Big paddy</option><option value="other">Other</option>
              </select>
              <button onClick={() => { upsertVariety({ id: v.id, name: v.name, active: !v.active }); toast(v.active ? 'Variety deactivated' : 'Variety reactivated'); }}
                className={`${v.active ? 'text-red-600' : 'text-green-700'} text-xs`}>{v.active ? 'Hide' : 'Show'}</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={newVariety} onChange={e => setNewVariety(e.target.value)} placeholder="Add new variety" wrapperClassName="flex-1" />
          <Select value={newVarietyCat} onChange={e => setNewVarietyCat(e.target.value as any)} wrapperClassName="w-28" options={[
            { value: 'small', label: 'Small' }, { value: 'big', label: 'Big' }, { value: 'other', label: 'Other' }
          ]} />
          <Button size="sm" onClick={() => { if (newVariety.trim()) { upsertVariety({ name: newVariety.trim(), category: newVarietyCat }); setNewVariety(''); toast('Added'); } }}>Add</Button>
        </div>
      </Card>
      <Card className="p-3 space-y-2">
        <h3 className="font-semibold text-forest-800">Expense Categories</h3>
        <div className="space-y-1">
          {db.categories.filter(c => c.type === 'expense').map(c => (
            <div key={c.id} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1.5 text-sm">
              <span>{c.name}</span>
              <button onClick={() => { deleteCategory(c.id); toast('Removed'); }} className="text-red-600 text-xs">Delete</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={newExpenseCat} onChange={e => setNewExpenseCat(e.target.value)} placeholder="Add category" wrapperClassName="flex-1" />
          <Button size="sm" onClick={() => { if (newExpenseCat.trim()) { upsertCategory({ name: newExpenseCat.trim(), type: 'expense' }); setNewExpenseCat(''); toast('Added'); } }}>Add</Button>
        </div>
      </Card>
      <Button variant="primary" className="w-full" onClick={() => {
        updateSettings({
          millName, address, phone, gstin: gstin || undefined, receiptFooter,
          defaultHullingRate: Number(defaultHullingRate) || 0,
          defaultBagCost: Number(defaultBagCost) || 0,
          defaultGstRate: Number(defaultGstRate) || 0,
          taxMode: taxMode as any,
          minStockQtl: { paddy: Number(minStock.paddy) || 0, rice: Number(minStock.rice) || 0, bran: Number(minStock.bran) || 0, husk: Number(minStock.husk) || 0 },
        });
        toast('Settings saved');
      }}>Save Settings</Button>
      <Button variant="danger" className="w-full" onClick={() => setShowResetConfirm(true)}>Reset All Data</Button>
      <Confirm open={showResetConfirm} onClose={() => setShowResetConfirm(false)} onConfirm={() => { resetAll(); setShowResetConfirm(false); toast('All data reset'); }} message="Are you sure? This will delete ALL data and cannot be undone. You should export a backup first." confirmText="Reset Everything" variant="danger" />
    </div>
  );
}

// ============ BACKUP / REPORTS ============
export function BackupPage() {
  const { db, backup, restore } = useDB();
  const [data, setData] = useState<any>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const doBackup = () => {
    const json = backup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sprm-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  };

  const handleFile = async (f: File) => {
    const text = await f.text();
    try {
      const parsed = JSON.parse(text);
      setData(parsed);
    } catch { toast('Invalid JSON file', 'error'); }
  };

  const doRestore = (mode: 'merge' | 'replace') => {
    if (!data) return;
    try {
      const r = restore(JSON.stringify(data), mode);
      toast(`Restored ${r.count} records (${mode})`);
      setData(null);
    } catch (e: any) {
      toast(e.message || 'Restore failed', 'error');
    }
  };

  const exportCSV = () => {
    const rows = [
      ['Module', 'Type', 'ID', 'Date', 'Party', 'Details', 'Amount'],
      ...db.hulling.map(h => ['Hulling', 'Receipt', h.receiptNumber, h.date, partyName(db, h.partyId), `${fmtQty(h.quantityKg)} @ ${fmtINR(h.ratePerQtl)}/Qtl`, String(h.finalTotal)]),
      ...db.purchases.map(p => ['Purchase', 'Voucher', p.voucherNumber, p.date, partyName(db, p.partyId), `${fmtQty(p.netKg)} ${varietyName(db, p.varietyId)}`, String(p.finalTotal)]),
      ...db.sales.map(s => ['Sale', 'Invoice', s.invoiceNumber, s.date, partyName(db, s.partyId), fmtQty(s.quantityKg), String(s.finalTotal)]),
      ...db.dispatches.map(d => ['Dispatch', 'Slip', d.dispatchNumber, d.date, partyName(db, d.partyId), fmtQty(d.netKg), String(d.finalTotal)]),
      ...db.expenses.map(e => ['Expense', 'Expense', e.id, e.date, e.payee || '', '', String(e.amount)]),
      ...db.trading.map(t => [t.kind === 'buy' ? 'Trading Buy' : 'Trading Sell', 'Entry', t.id, t.date, t.party || '', `${t.itemName}: ${fmtTradeQty(t.qty, t.unit)} @ ${fmtINR(t.rate)}/${t.rateUnit}`, String(t.total)]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sprm-export-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported');
  };

  return (
    <div className="p-3 space-y-3 pb-6">
      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-forest-800">Backup Data</h3>
        <p className="text-xs text-gray-600">Export all your data as a JSON file. Keep this safe — you can restore from it later.</p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={doBackup} className="flex-1">Download JSON Backup</Button>
          <Button variant="secondary" onClick={exportCSV}>Export CSV</Button>
        </div>
      </Card>
      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-forest-800">Restore Data</h3>
        <p className="text-xs text-gray-600">Select a previously exported JSON backup file.</p>
        <input ref={fileRef} type="file" accept=".json" onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }} className="hidden" />
        <Button variant="secondary" className="w-full" onClick={() => fileRef.current?.click()}>Choose Backup File...</Button>
        {data && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <div className="text-xs text-amber-800">File loaded. Choose how to restore:</div>
            <div className="text-[11px] text-amber-700">• Merge: adds records not already present<br/>• Replace: OVERWRITES all current data</div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => doRestore('merge')} className="flex-1">Merge</Button>
              <Button variant="danger" size="sm" onClick={() => doRestore('replace')} className="flex-1">Replace All</Button>
            </div>
          </div>
        )}
      </Card>
      <Card className="p-3 text-xs text-gray-600 space-y-1">
        <div className="font-semibold text-forest-800">Statistics</div>
        <div>Parties: {db.parties.length}</div>
        <div>Hulling entries: {db.hulling.length}</div>
        <div>Purchases: {db.purchases.length}</div>
        <div>Sales: {db.sales.length}</div>
        <div>Dispatches: {db.dispatches.length}</div>
        <div>Expenses: {db.expenses.length}</div>
        <div>Production batches: {db.production.length}</div>
      </Card>
    </div>
  );
}

// ============ REPORTS ============
export function ReportsPage() {
  const { db } = useDB();
  const [range, setRange] = useState('month');

  const data = useMemo(() => {
    const hulling = db.hulling.filter(h => inRange(h.date, { preset: range as any }));
    const purchases = db.purchases.filter(p => inRange(p.date, { preset: range as any }));
    const sales = [...db.sales, ...db.dispatches].filter(s => inRange(s.date, { preset: range as any }));
    const expenses = db.expenses.filter(e => inRange(e.date, { preset: range as any }) && !e.isPersonal);

    return {
      hullingQty: hulling.reduce((s, h) => s + h.quantityKg, 0),
      hullingRev: hulling.reduce((s, h) => s + h.finalTotal, 0),
      purchQty: purchases.reduce((s, p) => s + p.netKg, 0),
      purchAmt: purchases.reduce((s, p) => s + p.finalTotal, 0),
      salesAmt: sales.reduce((s, x) => s + x.finalTotal, 0),
      expAmt: expenses.reduce((s, e) => s + e.amount, 0),
      byExpense: expenses.reduce<Record<string, number>>((acc, e) => {
        const cat = db.categories.find(c => c.id === e.categoryId)?.name || 'Other';
        acc[cat] = (acc[cat] || 0) + e.amount;
        return acc;
      }, {}),
    };
  }, [db, range]);

  return (
    <div className="p-3 space-y-3 pb-6">
      <DateRangePresets value={range} onChange={setRange} />
      <div className="grid grid-cols-2 gap-2">
        <KPICard label="Hulling Revenue" value={fmtINR(data.hullingRev)} sub={fmtQty(data.hullingQty)} tone="green" />
        <KPICard label="Purchases" value={fmtINR(data.purchAmt)} sub={fmtQty(data.purchQty)} tone="blue" />
        <KPICard label="Sales/Dispatch" value={fmtINR(data.salesAmt)} tone="gold" />
        <KPICard label="Expenses" value={fmtINR(data.expAmt)} tone="red" />
      </div>
      <Card className="p-3">
        <h3 className="font-semibold text-forest-800 mb-2">Profit Estimate (cash basis)</h3>
        <div className="text-xs space-y-1">
          <div className="flex justify-between"><span>Revenue (hulling + sales + dispatch):</span><strong>{fmtINR(data.hullingRev + data.salesAmt)}</strong></div>
          <div className="flex justify-between"><span>Less: Paddy purchases:</span><strong className="text-red-600">-{fmtINR(data.purchAmt)}</strong></div>
          <div className="flex justify-between"><span>Less: Expenses:</span><strong className="text-red-600">-{fmtINR(data.expAmt)}</strong></div>
          <div className="flex justify-between border-t pt-1 mt-1"><span className="font-semibold">Estimated Profit:</span><strong className="text-forest-700">{fmtINR(data.hullingRev + data.salesAmt - data.purchAmt - data.expAmt)}</strong></div>
          <div className="text-[10px] text-gray-500 mt-1">Note: This is an estimate. Costs of paddy in stock not yet sold are included. Use actual stock valuation for precise profit.</div>
        </div>
      </Card>
      <Card className="p-3">
        <h3 className="font-semibold text-forest-800 mb-2">Expense Breakdown</h3>
        {Object.entries(data.byExpense).length === 0 ? <div className="text-xs text-gray-500 text-center py-2">No expenses</div> : (
          <div className="space-y-2">
            {Object.entries(data.byExpense).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <div key={cat}>
                <div className="flex justify-between text-xs">
                  <span>{cat}</span><strong>{fmtINR(amt)}</strong>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-forest-500 rounded-full" style={{ width: `${data.expAmt > 0 ? (amt / data.expAmt * 100) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
