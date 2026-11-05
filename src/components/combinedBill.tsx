import { useEffect, useMemo, useState } from 'react';
import { useDB } from '../context';
import { bagSummary, collectBillLines, fmtDate, fmtINR, round2, summarizeBill } from '../db';
import type { BillLine, BillSummary } from '../db';
import type { Database, Party } from '../types';
import { esc, printHtml, shareText, VOUCHER_CSS } from '../utils/print';
import { Button, Card, Input, toast } from './ui';
import { PartyInput } from './pages';

type Manual = { id: string; side: 'charge' | 'credit'; description: string; amount: number };

const who = (side: BillSummary['netSide']) => side === 'customer' ? 'Customer pays the mill' : side === 'mill' ? 'Mill pays the customer' : 'Nothing to pay';

/** Single source for the on-screen preview and the printed / saved PDF. */
export function combinedBillHtml(db: Database, party: Party, lines: BillLine[], sum: BillSummary, o: { from: string; to: string; showPending: boolean; pendingBags: number }): string {
  const s = db.settings;
  const rows = (side: 'charge' | 'credit') => lines.filter(l => l.side === side)
    .map(l => `<tr><td>${l.date ? fmtDate(l.date) : '-'}</td><td>${esc(l.ref)}</td><td>${esc(l.description)}</td><td class="r">${fmtINR(l.amount)}</td></tr>`).join('');
  const block = (title: string, side: 'charge' | 'credit', total: number) => lines.some(l => l.side === side) ? `
    <div class="h">${title}</div>
    <table><tr><th>Date</th><th>Ref</th><th>Particulars</th><th class="r">Amount</th></tr>${rows(side)}
    <tr class="tot"><td colspan="3">Total</td><td class="r">${fmtINR(total)}</td></tr></table>` : '';
  const period = o.from || o.to ? `${o.from ? fmtDate(o.from) : 'Beginning'} to ${o.to ? fmtDate(o.to) : 'Latest'}` : 'All dates';
  const cls = (side: BillSummary['netSide']) => side === 'customer' ? 'red' : side === 'mill' ? 'g' : '';
  const finalRow = (label: string, side: BillSummary['netSide'], amt: number) =>
    `<tr class="tot"><td>${label}<div class="muted">${who(side)}</div></td><td class="r ${cls(side)}">${fmtINR(amt)}</td></tr>`;
  const showSettled = o.showPending && (sum.paidByCustomer > 0 || sum.paidToCustomer > 0);
  return `<div class="vch"><style>${VOUCHER_CSS}</style>
  <div class="c"><h1>${esc(s.millName)}</h1><div class="muted">${esc(s.address)}</div>
    ${s.phone ? `<div class="muted">Ph: ${esc(s.phone)}</div>` : ''}${s.gstin ? `<div class="muted">GSTIN: ${esc(s.gstin)}</div>` : ''}</div>
  <div class="row">
    <div><div class="b" style="font-size:14px;color:#1b4332">COMBINED BILL</div><div class="muted">Period: ${esc(period)}</div></div>
    <div style="text-align:right"><div class="muted">Customer</div><div class="b" style="font-size:13px">${esc(party.name)}</div>
      ${party.village ? `<div class="muted">${esc(party.village)}</div>` : ''}${party.phone ? `<div class="muted">${esc(party.phone)}</div>` : ''}</div>
  </div>
  ${block('Charges to customer (hulling, paddy / rice / bran / salt bought from the mill)', 'charge', sum.charges)}
  ${block('Credits to customer (paddy / bran / salt given to the mill)', 'credit', sum.credits)}
  <div class="h">Settlement</div>
  <table>
    <tr><td>Total charges</td><td class="r">${fmtINR(sum.charges)}</td></tr>
    <tr><td>Less: total credits</td><td class="r">- ${fmtINR(sum.credits)}</td></tr>
    ${showSettled ? `<tr><td class="b">Net after set-off</td><td class="r b ${cls(sum.netSide)}">${fmtINR(sum.net)}<div class="muted">${who(sum.netSide)}</div></td></tr>` : ''}
    ${showSettled ? `${sum.paidByCustomer > 0 ? `<tr><td>Already received from customer</td><td class="r">${fmtINR(sum.paidByCustomer)}</td></tr>` : ''}
    ${sum.paidToCustomer > 0 ? `<tr><td>Already paid to customer</td><td class="r">${fmtINR(sum.paidToCustomer)}</td></tr>` : ''}` : ''}
    ${o.showPending ? finalRow('BALANCE TO SETTLE', sum.balanceSide, sum.balance) : finalRow('NET AMOUNT', sum.netSide, sum.net)}
  </table>
  ${o.showPending && o.pendingBags > 0 ? `<div class="muted">Bags still pending with the mill: <b>${o.pendingBags}</b></div>` : ''}
  <div class="sig"><div>Authorised signatory</div><div>Customer signature</div></div>
  <div class="ft">${esc(s.receiptFooter)}</div></div>`;
}

export function CombinedBillPage() {
  const { db } = useDB();
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<Manual[]>([]);
  const [showPending, setShowPending] = useState(true);
  const [mDesc, setMDesc] = useState('');
  const [mAmt, setMAmt] = useState('');
  const [mSide, setMSide] = useState<'charge' | 'credit'>('credit');

  const party = useMemo(() => {
    const n = name.trim().toLowerCase();
    return n ? db.parties.find(p => p.name.trim().toLowerCase() === n) : undefined;
  }, [db.parties, name]);
  const all = useMemo(() => party ? collectBillLines(db, party.id, from || undefined, to || undefined) : [], [db, party?.id, from, to]);

  // entries that still have something outstanding are ticked by default; settled ones can be ticked by hand
  useEffect(() => {
    setSel(new Set(all.filter(l => Math.abs(l.amount - l.paid) > 0.009).map(l => l.id)));
    setManual([]);
  }, [party?.id, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines: BillLine[] = useMemo(() => [
    ...all.filter(l => sel.has(l.id)),
    ...manual.map(m => ({ id: m.id, side: m.side, kind: 'Other', date: '', ref: '-', description: m.description, amount: m.amount, paid: 0, manual: true })),
  ], [all, sel, manual]);
  const sum = useMemo(() => summarizeBill(lines), [lines]);
  const pendingBags = useMemo(() => {
    const ids = new Set(lines.filter(l => l.id.startsWith('purchase:')).map(l => l.id.slice(9)));
    return db.purchases.filter(p => ids.has(p.id)).reduce((n, p) => n + Math.max(0, bagSummary(p.bagMovements).pending), 0);
  }, [db.purchases, lines]);

  const html = party ? combinedBillHtml(db, party, lines, sum, { from, to, showPending, pendingBags }) : '';
  const toggle = (id: string) => setSel(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const addManual = () => {
    const amt = round2(Number(mAmt));
    if (!mDesc.trim()) { toast('Enter what it is (e.g. Bran, Salt, Bags)', 'error'); return; }
    if (!(amt > 0)) { toast('Enter the amount', 'error'); return; }
    setManual(m => [...m, { id: 'manual:' + Math.random().toString(36).slice(2, 8), side: mSide, description: mDesc.trim(), amount: amt }]);
    setMDesc(''); setMAmt('');
  };

  const Group = ({ title, side, tone }: { title: string; side: 'charge' | 'credit'; tone: string }) => {
    const rows = all.filter(l => l.side === side);
    return (
      <Card className="p-3">
        <h3 className={`font-semibold text-sm mb-1 ${tone}`}>{title}</h3>
        {rows.length === 0 ? <div className="text-xs text-gray-500 py-2">Nothing recorded.</div> : (
          <div className="divide-y divide-gray-100">
            {rows.map(l => (
              <label key={l.id} className="flex items-start gap-2 py-1.5 text-xs">
                <input type="checkbox" className="mt-0.5" checked={sel.has(l.id)} onChange={() => toggle(l.id)} />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{l.description}</span>
                  <span className="block text-[10px] text-gray-500">{fmtDate(l.date)} · {l.ref}{l.paid > 0 ? ` · paid ${fmtINR(l.paid)}` : ''}</span>
                </span>
                <b className="shrink-0">{fmtINR(l.amount)}</b>
              </label>
            ))}
          </div>
        )}
      </Card>
    );
  };

  const tone = sum.balanceSide === 'customer' ? 'border-red-200 bg-red-50 text-red-700' : sum.balanceSide === 'mill' ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-600';
  const shownSide = showPending ? sum.balanceSide : sum.netSide;
  const shownAmt = showPending ? sum.balance : sum.net;

  return (
    <div className="p-3 space-y-3 pb-8">
      <div className="rounded-2xl bg-gradient-to-br from-forest-800 to-forest-600 text-white p-4">
        <div className="text-lg font-extrabold">Combined Bill</div>
        <p className="text-xs text-forest-100 mt-1">One bill per customer: hulling, rice / bran / salt bought, paddy / bran given. Credits are set off against charges.</p>
      </div>
      <Card className="p-3 space-y-2">
        <PartyInput label="Customer" required value={name} onChange={setName} placeholder="Type or pick the customer" />
        <div className="grid grid-cols-2 gap-2">
          <Input label="From (optional)" type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
          <Input label="To (optional)" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
        </div>
        {name.trim() && !party && <div className="text-[11px] text-red-600">No customer with this exact name.</div>}
      </Card>

      {party && <>
        <Group title="Charges: customer owes the mill" side="charge" tone="text-red-700" />
        <Group title="Credits: mill owes the customer" side="credit" tone="text-green-700" />

        <Card className="p-3 space-y-2">
          <h3 className="font-semibold text-sm text-forest-800">Add item not recorded in the app</h3>
          <p className="text-[11px] text-gray-500">For example bran or salt given by the customer, or bags sold to the customer.</p>
          <Input value={mDesc} onChange={e => setMDesc(e.target.value)} placeholder="Description (e.g. Bran 5 bags)" />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" inputMode="decimal" value={mAmt} onChange={e => setMAmt(e.target.value)} placeholder="Amount (₹)" />
            <select value={mSide} onChange={e => setMSide(e.target.value as 'charge' | 'credit')} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm">
              <option value="credit">Customer gave the mill</option>
              <option value="charge">Customer bought from the mill</option>
            </select>
          </div>
          <Button size="sm" onClick={addManual}>＋ Add to bill</Button>
          {manual.map(m => (
            <div key={m.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1.5">
              <span className="truncate">{m.description} <span className="text-gray-500">({m.side === 'credit' ? 'given' : 'bought'})</span></span>
              <span className="flex items-center gap-2 shrink-0"><b>{fmtINR(m.amount)}</b>
                <button onClick={() => setManual(x => x.filter(y => y.id !== m.id))} className="text-red-500 text-base leading-none">×</button></span>
            </div>
          ))}
        </Card>

        <div className={`rounded-xl border p-3 ${tone}`}>
          <div className="text-[11px] font-semibold uppercase">{showPending ? 'Balance to settle' : 'Net amount'}</div>
          <div className="text-2xl font-extrabold">{fmtINR(shownAmt)}</div>
          <div className="text-xs font-semibold">{who(shownSide)}</div>
          <div className="text-[11px] mt-1 opacity-80">Charges {fmtINR(sum.charges)} − credits {fmtINR(sum.credits)}</div>
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
          <input type="checkbox" checked={showPending} onChange={e => setShowPending(e.target.checked)} />
          Show payments already made and pending balance in the bill
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={async () => {
            const msg = `${db.settings.millName}\nCombined bill · ${party.name}\nCharges: ${fmtINR(sum.charges)}\nCredits: ${fmtINR(sum.credits)}\n${who(shownSide)}: ${fmtINR(shownAmt)}`;
            const r = await shareText(`Combined bill ${party.name}`, msg);
            if (r === 'copied') toast('Summary copied — paste it in WhatsApp'); else if (r === 'failed') toast('Sharing not available on this device', 'error');
          }}>Share</Button>
          <Button variant="gold" className="flex-1" disabled={lines.length === 0} onClick={() => printHtml(`Combined bill ${party.name}`, html)}>Print / Save PDF</Button>
        </div>
        {lines.length === 0
          ? <Card className="p-4 text-center text-xs text-gray-500">Tick at least one entry above to build the bill.</Card>
          : <div className="bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />}
      </>}
    </div>
  );
}
