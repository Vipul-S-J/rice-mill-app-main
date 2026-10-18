import { useMemo, useState } from 'react';
import { useDB } from '../context';
import { fmtDate, fmtINR, round2, today } from '../db';
import type { DispatchEntry } from '../types';
import { Badge, Card, EmptyState, Select } from './ui';
import { ReceiptModal, partyName } from './pages';

const fmt2 = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(round2(n));
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
};

/** Everything the Vehicle section shows is derived from dispatches, so it can never go out of sync. */
function tripOf(d: DispatchEntry) {
  const p = d.paddy, h = d.husk;
  const loadKg = p ? p.grossLoadKg : d.netKg;
  const freight = d.transportCost;                                   // paddy: gross load x rate | husk: transport charges
  const rent = p ? p.vehicleCharges : h ? 0 : d.driverBata;         // paddy: extra vehicle charges
  const vehicleCost = round2(freight + rent);
  const huskBags = h ? (h.measureBy === 'bags' ? h.lots.reduce((s, l) => s + l.qty, 0) : h.approxBags || 0) : 0;
  return {
    d, loadKg, freight, rent, vehicleCost,
    otherCost: round2(Math.max(0, d.totalCosts - vehicleCost)),
    bags: p ? p.totalBags || 0 : huskBags,
    trip: d.tripNumber || '—',
    type: (p ? 'paddy' : h ? 'husk' : 'other') as 'paddy' | 'husk' | 'other',
    driver: p?.driverName || h?.driverName || '', owner: p?.vehicleOwner || '', mobile: p?.vendorMobile || '',
    kind: p ? (p.size === 'both' ? 'Small + Big paddy' : p.size === 'big' ? 'Big paddy' : 'Small paddy') : h ? 'Husk' : 'Other product',
  };
}

export function VehiclePage() {
  const { db } = useDB();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [tab, setTab] = useState<'trips' | 'vehicles'>('trips');
  const [search, setSearch] = useState('');
  const [typeF, setTypeF] = useState<'all' | 'paddy' | 'husk'>('all');
  const [slip, setSlip] = useState<DispatchEntry | null>(null);

  const months = useMemo(() => {
    const s = new Set<string>([today().slice(0, 7)]);
    db.dispatches.forEach(d => s.add(d.date.slice(0, 7)));
    return [...s].sort().reverse();
  }, [db.dispatches]);

  const trips = useMemo(() => {
    const q = search.trim().toLowerCase();
    return db.dispatches
      .filter(d => !month || d.date.startsWith(month))
      .map(tripOf)
      .filter(t => typeF === 'all' || t.type === typeF)
      .filter(t => !q || t.trip.toLowerCase().includes(q) || (t.d.vehicleNumber || '').toLowerCase().includes(q) || t.driver.toLowerCase().includes(q) || t.owner.toLowerCase().includes(q) || partyName(db, t.d.partyId).toLowerCase().includes(q))
      .sort((a, b) => b.d.date.localeCompare(a.d.date) || b.d.createdAt.localeCompare(a.d.createdAt));
  }, [db, month, search, typeF]);

  const totals = useMemo(() => ({
    trips: trips.length,
    loadKg: trips.reduce((s, t) => s + t.loadKg, 0),
    cost: round2(trips.reduce((s, t) => s + t.vehicleCost, 0)),
  }), [trips]);

  const byVehicle = useMemo(() => {
    const m = new Map<string, { vehicle: string; trips: number; loadKg: number; cost: number; owner: string; drivers: Set<string>; last: string }>();
    for (const t of trips) {
      const k = t.d.vehicleNumber || 'No vehicle number';
      const e = m.get(k) || { vehicle: k, trips: 0, loadKg: 0, cost: 0, owner: '', drivers: new Set<string>(), last: '' };
      e.trips++; e.loadKg += t.loadKg; e.cost = round2(e.cost + t.vehicleCost);
      if (t.owner) e.owner = t.owner;
      if (t.driver) e.drivers.add(t.driver);
      if (t.d.date > e.last) e.last = t.d.date;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  }, [trips]);

  const seg = (on: boolean) => `flex-1 py-2 rounded-xl text-[13px] font-bold border ${on ? 'bg-[#0b3d2c] text-white border-[#0b3d2c]' : 'bg-white text-gray-600 border-gray-200'}`;

  return (
    <div className="p-3 pb-8 space-y-3">
      <Card className="p-3 space-y-3">
        <div className="text-sm font-extrabold text-[#0b3d2c]">🚚 Transport Trips — Dispatches</div>
        <div className="flex gap-2 items-center">
          <Select value={month} onChange={e => setMonth(e.target.value)} wrapperClassName="flex-1"
            options={months.map(m => ({ value: m, label: monthLabel(m) }))} />
          <button onClick={() => setMonth('')} className={`px-4 py-2 rounded-xl border text-sm font-bold ${month === '' ? 'bg-[#0b3d2c] text-white border-[#0b3d2c]' : 'border-forest-400 text-forest-800'}`}>All</button>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Trip no, vehicle, driver, owner, buyer…"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-forest-500" />
        <div className="flex gap-2">
          {([['all', 'All trips'], ['paddy', '🌾 Paddy'], ['husk', '📦 Husk']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTypeF(k)} className={`flex-1 py-1.5 rounded-lg border text-xs font-bold ${typeF === k ? 'bg-[#0b3d2c] text-white border-[#0b3d2c]' : 'bg-white text-gray-600 border-gray-200'}`}>{l}</button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white border border-gray-200 py-2"><div className="text-[9px] font-bold text-gray-400 uppercase">Trips</div><div className="text-base font-extrabold">{totals.trips}</div></div>
        <div className="rounded-xl bg-white border border-gray-200 py-2"><div className="text-[9px] font-bold text-gray-400 uppercase">Total load</div><div className="text-base font-extrabold">{fmt2(totals.loadKg / 100)} <span className="text-[10px]">Qtl</span></div></div>
        <div className="rounded-xl bg-white border border-gray-200 py-2"><div className="text-[9px] font-bold text-gray-400 uppercase">Vehicle cost</div><div className="text-base font-extrabold text-red-600">{fmtINR(totals.cost)}</div></div>
      </div>

      <div className="flex gap-2">
        <button className={seg(tab === 'trips')} onClick={() => setTab('trips')}>Trips</button>
        <button className={seg(tab === 'vehicles')} onClick={() => setTab('vehicles')}>By Vehicle</button>
      </div>

      {trips.length === 0 && <Card><EmptyState title="No trips found" subtitle="Trips appear here automatically when you save a dispatch with a vehicle." /></Card>}

      {tab === 'trips' && trips.map(t => (
        <Card key={t.d.id} className="p-3 space-y-2" onClick={() => setSlip(t.d)}>
          <div className="flex justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-extrabold text-amber-700">{t.trip} · {fmtDate(t.d.date)}</div>
              <div className="text-sm font-extrabold text-gray-900">{t.d.vehicleNumber || 'No vehicle number'}</div>
              <div className="text-[11px] text-gray-500">{t.d.dispatchNumber} · {partyName(db, t.d.partyId)}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-extrabold text-red-600">{fmtINR(t.vehicleCost)}</div>
              <div className="text-[10px] text-gray-500">vehicle cost</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="gold">{t.loadKg > 0 ? `${fmt2(t.loadKg / 100)} Qtl load` : 'Load by bags'}</Badge>
            {t.bags > 0 && <Badge tone="gray">{t.bags} bags</Badge>}
            <Badge tone={t.type === 'husk' ? 'gold' : 'green'}>{t.kind}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-gray-600">
            <div>Driver: <b className="text-gray-900">{t.driver || '—'}</b></div>
            <div>Owner: <b className="text-gray-900">{t.owner || '—'}</b></div>
            {t.mobile && <div className="col-span-2">Mobile: <b className="text-gray-900">{t.mobile}</b></div>}
          </div>
          <div className="text-[11px] bg-gray-50 rounded-lg px-2.5 py-1.5 flex flex-wrap gap-x-3">
            <span>{t.type === 'paddy' ? 'Freight' : 'Transport'} <b>{fmtINR(t.freight)}</b></span>
            {t.rent > 0 && <span>Vehicle charges <b>{fmtINR(t.rent)}</b></span>}
            {t.otherCost > 0 && <span className="text-gray-500">{t.type === 'husk' ? 'Coolie' : 'Other trip costs'} {fmtINR(t.otherCost)}</span>}
          </div>
        </Card>
      ))}

      {tab === 'vehicles' && byVehicle.map(v => (
        <Card key={v.vehicle} className="p-3 space-y-1.5">
          <div className="flex justify-between">
            <div className="text-sm font-extrabold text-gray-900">{v.vehicle}</div>
            <div className="text-sm font-extrabold text-red-600">{fmtINR(v.cost)}</div>
          </div>
          <div className="text-[11px] text-gray-600">{v.trips} trip{v.trips === 1 ? '' : 's'} · {fmt2(v.loadKg / 100)} Qtl · last {fmtDate(v.last)}</div>
          <div className="text-[11px] text-gray-600">Owner: <b>{v.owner || '—'}</b> · Drivers: <b>{v.drivers.size ? [...v.drivers].join(', ') : '—'}</b></div>
        </Card>
      ))}

      <div className="text-[11px] text-gray-500 px-1">Trips come from Paddy Dispatch and Husk Dispatch. Edit the load, driver, owner or charges there and this page updates itself.</div>
      {slip && <ReceiptModal entry={slip} onClose={() => setSlip(null)} type="dispatch" />}
    </div>
  );
}
