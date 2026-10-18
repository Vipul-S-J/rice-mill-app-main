import { useEffect, useMemo, useState } from 'react';
import { useDB } from '../context';
import type { Category, TradingItem, Variety } from '../types';
import { computeTradingStock, fmtTradeQty, TRADE_UNITS } from '../db';
import { Badge, Button, Card, Chips, Confirm, Input, Modal, Select, toast } from './ui';

type Section = 'paddy' | 'rice' | 'products' | 'payments' | 'expenses' | 'work' | 'trading';

const SECTIONS: { id: Section; label: string; icon: string; note: string }[] = [
  { id: 'paddy', label: 'Paddy Varieties', icon: '🌾', note: 'Used in purchase, paddy sale, production and stock filters.' },
  { id: 'rice', label: 'Rice Varieties', icon: '🍚', note: 'Used in production, rice sales and rice stock.' },
  { id: 'products', label: 'Sale Items', icon: '🏷', note: 'Paddy, Rice, Bran, Husk and any future sale item.' },
  { id: 'payments', label: 'Payment Modes', icon: '💳', note: 'Used in every payment form.' },
  { id: 'expenses', label: 'Expense Categories', icon: '💸', note: 'Used in Expenses and reports.' },
  { id: 'work', label: 'Work Types', icon: '👷', note: 'Used in Labour entries.' },
  { id: 'trading', label: 'Trading Goods', icon: '🏪', note: 'Items bought & sold in Trading — each with its own measuring unit and rate unit.' },
];

export function InventoryPage() {
  const { db, upsertVariety, upsertCategory, varietyUsage, categoryUsage, removeVariety, removeCategory,
    upsertTradingItem, hideTradingItem, removeTradingItem, tradingItemUsage } = useDB();
  const [section, setSection] = useState<Section>('paddy');
  const [showAdd, setShowAdd] = useState(false);
  const [editingVar, setEditingVar] = useState<Variety | null>(null);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editingTrade, setEditingTrade] = useState<TradingItem | null>(null);
  const tradeStock = useMemo(() => computeTradingStock(db), [db]);
  const [confirm, setConfirm] = useState<{ kind: 'variety' | 'category'; id: string; name: string } | null>(null);
  const [del, setDel] = useState<{ kind: 'variety' | 'category' | 'trading'; id: string; name: string; used: number } | null>(null);

  const meta = SECTIONS.find(s => s.id === section)!;
  const usage = section === 'paddy' || section === 'rice' ? section : null;
  const categoryType: Category['type'] | null = section === 'products' ? 'product' : section === 'payments' ? 'payment_mode' : section === 'expenses' ? 'expense' : section === 'work' ? 'work_type' : null;
  const varieties = useMemo(() => usage ? db.varieties.filter(v => (v.usage || ['paddy', 'rice']).includes(usage)) : [], [db.varieties, usage]);
  const categories = useMemo(() => categoryType ? db.categories.filter(c => c.type === categoryType) : [], [db.categories, categoryType]);

  const deactivate = () => {
    if (!confirm) return;
    if (confirm.kind === 'category') {
      const c = db.categories.find(x => x.id === confirm.id);
      if (c) upsertCategory({ ...c, active: !c.active });
    } else {
      const v = db.varieties.find(x => x.id === confirm.id);
      if (v && usage) {
        const nextUsage = (v.usage || ['paddy', 'rice']).filter(x => x !== usage);
        upsertVariety({ ...v, usage: nextUsage, active: nextUsage.length ? v.active : false });
      }
    }
    toast('Inventory master updated'); setConfirm(null);
  };

  const askDelete = (kind: 'variety' | 'category' | 'trading', id: string, name: string) =>
    setDel({ kind, id, name, used: kind === 'variety' ? varietyUsage(id) : kind === 'trading' ? tradingItemUsage(id) : categoryUsage(id) });

  const doDelete = () => {
    if (!del) return;
    if (del.used > 0) { toast('Still used by saved records — hide it instead', 'error'); setDel(null); return; }
    if (del.kind === 'variety') removeVariety(del.id); else if (del.kind === 'trading') removeTradingItem(del.id); else removeCategory(del.id);
    toast(`“${del.name}” deleted permanently`); setDel(null);
  };

  const toggleTrade = (id: string) => { hideTradingItem(id); toast('Inventory master updated'); };

  return (
    <div className="p-3 pb-8 space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-forest-800 to-forest-600 text-white p-4">
        <div className="text-lg font-extrabold">Inventory Masters</div>
        <p className="text-xs text-forest-100 mt-1">All dropdown values live here. Future dropdown masters will also be added to this section.</p>
      </div>

      <div className="overflow-x-auto -mx-3 px-3">
        <div className="flex gap-2 min-w-max pb-1">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`px-3 py-2 rounded-xl border text-xs font-bold ${section === s.id ? 'bg-forest-700 border-forest-700 text-white' : 'bg-white border-gray-200 text-gray-600'}`}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div><h2 className="font-bold text-forest-900">{meta.icon} {meta.label}</h2><p className="text-[11px] text-gray-500 mt-0.5">{meta.note}</p></div>
        <Button size="sm" onClick={() => { setEditingVar(null); setEditingCat(null); setEditingTrade(null); setShowAdd(true); }}>＋ Add</Button>
      </div>

      <Card>
        {section === 'trading' ? db.tradingItems.map(t => (
          <div key={t.id} className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{t.name}</div>
              <div className="flex gap-1 mt-0.5 flex-wrap">
                <Badge tone="blue">Qty: {t.baseUnit}</Badge>
                <Badge tone="gold">Rate: {t.rateUnits.join(' / ')}</Badge>
                {t.packUnit && t.packSize ? <Badge tone="green">1 {t.packUnit} = {t.packSize} {t.baseUnit}</Badge> : null}
                <Badge tone={(t.lowStock || 0) > 0 && (tradeStock[t.id] ?? 0) <= (t.lowStock || 0) ? 'red' : 'gray'}>Stock: {fmtTradeQty(tradeStock[t.id] ?? 0, t.baseUnit)}</Badge>
                {!t.active && <Badge tone="red">Inactive</Badge>}
              </div>
            </div>
            <button onClick={() => { setEditingTrade(t); setShowAdd(true); }} className="text-xs font-semibold text-blue-700">Edit</button>
            <button onClick={() => toggleTrade(t.id)} className={`text-xs font-semibold ${t.active ? 'text-amber-700' : 'text-green-700'}`}>{t.active ? 'Hide' : 'Show'}</button>
            <button onClick={() => askDelete('trading', t.id, t.name)} className="text-xs font-semibold text-red-600">Delete</button>
          </div>
        )) : usage ? varieties.map(v => (
          <div key={v.id} className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 last:border-0">
            <div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{v.name}</div>
              <div className="flex gap-1 mt-0.5">{section === 'paddy' && <Badge tone={v.category === 'big' ? 'green' : v.category === 'small' ? 'gold' : 'gray'}>{v.category} paddy</Badge>}{section === 'rice' && <Badge tone="green">rice variety</Badge>}{!v.active && <Badge tone="red">Inactive</Badge>}</div>
            </div>
            <button onClick={() => { setEditingVar(v); setShowAdd(true); }} className="text-xs font-semibold text-blue-700">Edit</button>
            <button onClick={() => setConfirm({ kind: 'variety', id: v.id, name: v.name })} className="text-xs font-semibold text-amber-700">Hide</button>
            <button onClick={() => askDelete('variety', v.id, v.name)} className="text-xs font-semibold text-red-600">Delete</button>
          </div>
        )) : categories.map(c => (
          <div key={c.id} className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 last:border-0">
            <div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{c.name}</div>{!c.active && <Badge tone="red">Inactive</Badge>}</div>
            <button onClick={() => { setEditingCat(c); setShowAdd(true); }} className="text-xs font-semibold text-blue-700">Edit</button>
            <button onClick={() => setConfirm({ kind: 'category', id: c.id, name: c.name })} className={`text-xs font-semibold ${c.active ? 'text-amber-700' : 'text-green-700'}`}>{c.active ? 'Hide' : 'Show'}</button>
            <button onClick={() => askDelete('category', c.id, c.name)} className="text-xs font-semibold text-red-600">Delete</button>
          </div>
        ))}
        {(section === 'trading' ? db.tradingItems : usage ? varieties : categories).length === 0 && <div className="p-8 text-center text-sm text-gray-400">No values in this section yet.</div>}
      </Card>

      <MasterModal open={showAdd} onClose={() => { setShowAdd(false); setEditingVar(null); setEditingCat(null); setEditingTrade(null); }} section={section}
        variety={editingVar} category={editingCat} tradingItem={editingTrade}
        onVariety={(data) => { upsertVariety(data); setShowAdd(false); toast('Variety saved'); }}
        onCategory={(data) => { upsertCategory(data); setShowAdd(false); toast('Dropdown value saved'); }}
        onTrading={(data) => { upsertTradingItem(data); setShowAdd(false); toast('Trading item saved'); }} />
      <Confirm open={!!confirm} onClose={() => setConfirm(null)} onConfirm={deactivate}
        title="Hide from dropdown" message={confirm?.kind === 'variety' ? `Hide “${confirm?.name}” from this dropdown? Saved records keep their value and it can be re-added later.` : `Change the active status of “${confirm?.name}”? Saved records are not changed.`}
        confirmText="Continue" />
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={doDelete}
        title={del && del.used > 0 ? 'Cannot delete' : 'Delete permanently?'}
        message={del && del.used > 0
          ? `“${del.name}” is used by ${del.used} saved record(s). Deleting it would break those records — use Hide instead so old entries keep their value.`
          : `Permanently delete “${del?.name}”? It is not used by any saved record. This cannot be undone.`}
        confirmText={del && del.used > 0 ? 'OK' : 'Delete permanently'} />
    </div>
  );
}

function MasterModal({ open, onClose, section, variety, category, tradingItem, onVariety, onCategory, onTrading }: {
  open: boolean; onClose: () => void; section: Section; variety: Variety | null; category: Category | null; tradingItem: TradingItem | null;
  onVariety: (v: Partial<Variety> & { name: string }) => void;
  onCategory: (c: Partial<Category> & { name: string; type: Category['type'] }) => void;
  onTrading: (t: Partial<TradingItem> & { name: string }) => void;
}) {
  const { db } = useDB();
  const usage = section === 'paddy' || section === 'rice' ? section : null;
  const [name, setName] = useState('');
  const [size, setSize] = useState<'small' | 'big' | 'other'>('small');
  const [active, setActive] = useState(true);
  const [baseUnit, setBaseUnit] = useState('Bag');
  const [customUnit, setCustomUnit] = useState('');
  const [packOn, setPackOn] = useState(false);
  const [packUnit, setPackUnit] = useState('Bag');
  const [packSize, setPackSize] = useState('');
  const [openingStock, setOpeningStock] = useState('');
  const [openingRate, setOpeningRate] = useState('');
  const [lowStock, setLowStock] = useState('');
  const catType: Category['type'] = section === 'products' ? 'product' : section === 'payments' ? 'payment_mode' : section === 'expenses' ? 'expense' : 'work_type';

  useEffect(() => {
    if (!open) return;
    setName(variety?.name || category?.name || tradingItem?.name || '');
    setSize(variety?.category || 'small');
    setActive(variety?.active ?? category?.active ?? tradingItem?.active ?? true);
    const bu = tradingItem?.baseUnit || 'Bag';
    setBaseUnit(TRADE_UNITS.includes(bu) ? bu : 'Custom');
    setCustomUnit(TRADE_UNITS.includes(bu) ? '' : bu);
    setPackOn(!!(tradingItem?.packUnit && tradingItem?.packSize));
    setPackUnit(tradingItem?.packUnit || 'Bag');
    setPackSize(tradingItem?.packSize ? String(tradingItem.packSize) : '');
    setOpeningStock(tradingItem?.openingStock ? String(tradingItem.openingStock) : '');
    setOpeningRate(tradingItem?.openingRate ? String(tradingItem.openingRate) : '');
    setLowStock(tradingItem?.lowStock ? String(tradingItem.lowStock) : '');
  }, [open, variety?.id, category?.id, tradingItem?.id]);

  const save = () => {
    const n = name.trim(); if (!n) { toast('Enter a name', 'error'); return; }
    if (section === 'trading') {
      const bu = (baseUnit === 'Custom' ? customUnit.trim() : baseUnit) || 'Piece';
      if (baseUnit === 'Custom' && !customUnit.trim()) { toast('Enter the custom unit', 'error'); return; }
      const pu = packOn ? (packUnit.trim() || 'Bag') : undefined;
      const ps = packOn ? Number(packSize) : undefined;
      if (packOn && !(ps && ps > 0)) { toast('Enter pack size (e.g. 5 for a 5kg bag)', 'error'); return; }
      if (packOn && pu === bu) { toast('Pack unit must differ from the stock unit', 'error'); return; }
      onTrading({
        id: tradingItem?.id, name: n, baseUnit: bu, rateUnits: packOn && pu ? [bu, pu] : [bu],
        packUnit: pu, packSize: ps,
        openingStock: Number(openingStock) || 0, openingRate: Number(openingRate) || 0,
        lowStock: Number(lowStock) || 0, active,
      });
      return;
    }
    if (usage) {
      const same = db.varieties.find(v => v.name.toLowerCase() === n.toLowerCase() && v.id !== variety?.id);
      if (same) onVariety({ ...same, usage: [...new Set([...(same.usage || ['paddy', 'rice']), usage])], active: true });
      else onVariety({ id: variety?.id, name: n, category: usage === 'paddy' ? size : (variety?.category || 'other'), usage: variety ? variety.usage : [usage], active });
    } else onCategory({ id: category?.id, name: n, type: catType, active });
  };

  return <Modal open={open} onClose={onClose} title={`${variety || category || tradingItem ? 'Edit' : 'Add'} ${SECTIONS.find(s => s.id === section)?.label}`} maxWidth="max-w-sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
    <div className="space-y-3">
      <Input label={section === 'trading' ? 'Item name' : 'Name'} value={name} onChange={e => setName(e.target.value)} placeholder={section === 'trading' ? 'e.g. Diesel, Salt, Apple Rice 5kg' : 'Dropdown value'} />
      {section === 'trading' && <>
        <div className="grid grid-cols-2 gap-2">
          <Select label="Quantity & stock unit" value={baseUnit} onChange={e => setBaseUnit(e.target.value)} options={[...TRADE_UNITS, 'Custom']} />
          {baseUnit === 'Custom' && <Input label="Custom unit" value={customUnit} onChange={e => setCustomUnit(e.target.value)} placeholder="e.g. Can" />}
        </div>
        <div className="rounded-xl border border-gray-200 p-2.5 space-y-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <input type="checkbox" checked={packOn} onChange={e => setPackOn(e.target.checked)} />
            Also allow rate per pack (e.g. per Bag for Apple Rice 5kg)
          </label>
          {packOn && <div className="grid grid-cols-2 gap-2">
            <Input label="Pack unit" value={packUnit} onChange={e => setPackUnit(e.target.value)} placeholder="Bag" />
            <Input label={`Base units per ${packUnit || 'pack'}`} type="number" inputMode="decimal" value={packSize} onChange={e => setPackSize(e.target.value)} placeholder="5" />
          </div>}
          <p className="text-[10px] text-gray-500">Rate is always allowed per {baseUnit === 'Custom' ? (customUnit || 'stock unit') : baseUnit}. Kg ⇄ Qtl converts automatically.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Input label="Opening stock" type="number" inputMode="decimal" value={openingStock} onChange={e => setOpeningStock(e.target.value)} placeholder="0" />
          <Input label="Cost / unit (₹)" type="number" inputMode="decimal" value={openingRate} onChange={e => setOpeningRate(e.target.value)} placeholder="0" />
          <Input label="Low alert at" type="number" inputMode="decimal" value={lowStock} onChange={e => setLowStock(e.target.value)} placeholder="Off" />
        </div>
        <Chips value={active ? 'yes' : 'no'} onChange={v => setActive(v === 'yes')} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />
      </>}
      {usage === 'paddy' && <><Select label="Paddy size mapping" value={size} onChange={e => setSize(e.target.value as any)} options={[{ value: 'small', label: 'Small Paddy' }, { value: 'big', label: 'Big Paddy' }, { value: 'other', label: 'Other / not mapped' }]} />
        <Chips value={active ? 'yes' : 'no'} onChange={v => setActive(v === 'yes')} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} /></>}
      {usage === 'rice' && <Chips value={active ? 'yes' : 'no'} onChange={v => setActive(v === 'yes')} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />}
    </div>
  </Modal>;
}