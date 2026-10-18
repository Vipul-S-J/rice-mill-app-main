import type { Database, PurchaseEntry } from '../types';
import { fmtINR, fmtQtlKg, fmtNumber, fmtDate, sumPayments, round2, bagSummary } from '../db';
import { esc, VOUCHER_CSS, printHtml, shareText } from '../utils/print';
import { Modal, Button, toast } from './ui';

const SIZE_LABEL: Record<string, string> = { small: 'Small', big: 'Big' };

/** Single source for the voucher: used for on-screen preview AND the printed / saved PDF. */
export function purchaseVoucherHtml(db: Database, p: PurchaseEntry): string {
  const s = db.settings;
  const party = db.parties.find(x => x.id === p.partyId);
  const vName = (id: string) => db.varieties.find(v => v.id === id)?.name || id;
  const paid = sumPayments(p.payments);
  const pending = round2(p.finalTotal - paid);
  const bag = bagSummary(p.bagMovements);
  const m0 = p.bagMovements[0];
  const paddyValue = round2(p.lines.reduce((a, l) => a + l.amount, 0));
  const hasGst = p.gstMode && p.gstMode !== 'none' && (p.totalTax || 0) > 0;
  const hasWb = (p.grossKg || 0) > 0;

  const lineRows = p.lines.map((l, i) => `
    <tr><td>${i + 1}</td><td>${esc(vName(l.varietyId))}</td><td>${SIZE_LABEL[l.size] || ''}</td>
    <td class="r">${l.bags || '-'}</td>
    <td class="r">${esc(fmtQtlKg(l.qtyKg))}<br><span class="muted">${fmtNumber(l.qtyKg, 2)} kg · ${fmtNumber(l.qtyKg / 100, 3)} Qtl</span></td>
    <td class="r">${fmtINR(l.ratePerQtl)}</td><td class="r b">${fmtINR(l.amount)}</td></tr>`).join('');

  const wbRows = hasWb ? `
    <div class="h">Weighbridge</div>
    <table>
      <tr><td>Gross load weight</td><td class="r">${fmtNumber(p.grossKg, 2)} kg</td></tr>
      <tr><td>Empty vehicle / tare</td><td class="r">- ${fmtNumber(p.tareKg, 2)} kg</td></tr>
      <tr><td>Bag weight</td><td class="r">- ${fmtNumber(p.bagWeightKg, 2)} kg</td></tr>
      <tr><td>Moisture deduction</td><td class="r">- ${fmtNumber(p.moistureDeductionKg, 2)} kg</td></tr>
      <tr><td>Other deductions</td><td class="r">- ${fmtNumber(p.otherDeductionsKg, 2)} kg</td></tr>
      <tr><td class="b">Net weight (gross − all deductions)</td><td class="r b">${fmtNumber(p.grossKg - p.tareKg - p.bagWeightKg - p.moistureDeductionKg - p.otherDeductionsKg, 2)} kg</td></tr>
    </table>` : '';

  const payRows = p.payments.length ? `
    <div class="h">Payments</div>
    <table><tr><th>Date</th><th>Mode</th><th>Ref</th><th class="r">Amount</th></tr>
    ${p.payments.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.mode)}</td><td>${esc(x.reference || '-')}</td><td class="r">${fmtINR(x.amount)}</td></tr>`).join('')}</table>` : '';

  const bagHistory = p.bagMovements.length > 1 ? `
    <table><tr><th>Date</th><th>Entry</th><th class="r">Returned (New/Old)</th><th class="r">Adjust</th></tr>
    ${p.bagMovements.slice(1).map(m => `<tr><td>${fmtDate(m.date)}</td><td>${esc(m.manualAdjustmentReason || m.notes || 'Bag return')}</td>
    <td class="r">${m.newBagsReturned || 0} / ${(m.oldBagsReturned || 0) + (m.bagsReturned || 0)}</td><td class="r">${m.manualAdjustment || 0}</td></tr>`).join('')}</table>` : '';

  const bagSection = (bag.issued > 0 || bag.received > 0 || bag.returned > 0 || bag.adjustment !== 0) ? `
    <div class="h">Bags</div>
    <table>
      <tr><td>Bags received (with paddy)</td><td class="r">${bag.received}</td></tr>
      <tr><td>New bags sent back</td><td class="r">${bag.newIssued}</td></tr>
      <tr><td>Old bags sent back</td><td class="r">${bag.oldIssued}</td></tr>
      ${bag.returned > 0 ? `<tr><td>Bags sent back later (New ${bag.newReturned} / Old ${bag.oldReturned})</td><td class="r">${bag.returned}</td></tr>` : ''}
      ${m0?.bagUnitCost ? `<tr><td>Cost per new bag</td><td class="r">${fmtINR(m0.bagUnitCost)}</td></tr>` : ''}
      ${bag.charge > 0 ? `<tr><td>New bag charge (deducted from payable)</td><td class="r">${fmtINR(bag.charge)}</td></tr>` : ''}
      ${bag.loss > 0 ? `<tr><td>New bags sent back free (cost to mill)</td><td class="r">${fmtINR(bag.loss)}</td></tr>` : ''}
      ${bag.adjustment !== 0 ? `<tr><td>Manual adjustment${m0?.manualAdjustmentReason ? ' (' + esc(m0.manualAdjustmentReason) + ')' : ''}</td><td class="r">${bag.adjustment}</td></tr>` : ''}
      <tr class="tot"><td>Pending bags (still with mill)</td><td class="r ${bag.pending > 0 ? 'red' : 'g'}">${bag.pending}</td></tr>
    </table>${bagHistory}` : '';

  return `<div class="vch"><style>${VOUCHER_CSS}</style>
  <div class="c"><h1>${esc(s.millName)}</h1>
    <div class="muted">${esc(s.address)}</div>
    ${s.phone ? `<div class="muted">Ph: ${esc(s.phone)}</div>` : ''}
    ${s.gstin ? `<div class="muted">GSTIN: ${esc(s.gstin)}</div>` : ''}</div>
  <div class="row">
    <div><div class="b" style="font-size:14px;color:#1b4332">PADDY PURCHASE VOUCHER</div>
      <div>Voucher No: <b>${esc(p.voucherNumber)}</b></div><div>Date: ${fmtDate(p.date)}</div></div>
    <div style="text-align:right"><div class="muted">Customer</div><div class="b" style="font-size:13px">${esc(party?.name || '-')}</div>
      ${party?.village ? `<div class="muted">${esc(party.village)}</div>` : ''}
      ${party?.phone ? `<div class="muted">${esc(party.phone)}</div>` : ''}
      ${p.vehicleNumber ? `<div>Vehicle: ${esc(p.vehicleNumber)}</div>` : ''}</div>
  </div>
  <table><tr><th>#</th><th>Variety</th><th>Size</th><th class="r">Bags</th><th class="r">Net Qty</th><th class="r">Rate/Qtl</th><th class="r">Amount</th></tr>${lineRows}
    <tr><td colspan="4" class="b">Total net quantity</td><td class="r b">${esc(fmtQtlKg(p.netKg))}<br><span class="muted">${fmtNumber(p.netKg, 2)} kg · ${fmtNumber(p.netKg / 100, 3)} Qtl</span></td><td></td><td class="r b">${fmtINR(paddyValue)}</td></tr></table>
  ${wbRows}
  <div class="h">Amount</div>
  <table>
    <tr><td>Paddy value</td><td class="r">${fmtINR(paddyValue)}</td></tr>
    ${hasGst ? `<tr><td>Taxable value</td><td class="r">${fmtINR(p.taxableAmount || 0)}</td></tr>
    <tr><td>CGST (${(p.gstRate || 0) / 2}%)</td><td class="r">${fmtINR(p.cgst || 0)}</td></tr>
    <tr><td>SGST (${(p.gstRate || 0) / 2}%)</td><td class="r">${fmtINR(p.sgst || 0)}</td></tr>
    <tr><td>Total tax (${p.gstMode})</td><td class="r">${fmtINR(p.totalTax || 0)}</td></tr>` : ''}
    ${bag.charge > 0 ? `<tr><td>Less: new bag charge</td><td class="r red">- ${fmtINR(bag.charge)}</td></tr>` : ''}
    <tr><td>Original total</td><td class="r">${fmtINR(p.roundOriginal)}</td></tr>
    ${p.roundAdjustment !== 0 ? `<tr><td>Rounding adjustment</td><td class="r gold">${p.roundAdjustment > 0 ? '+' : '-'} ${fmtINR(Math.abs(p.roundAdjustment))}</td></tr>` : ''}
    <tr class="tot"><td>NET PAYABLE</td><td class="r">${fmtINR(p.finalTotal)}</td></tr>
    <tr><td>Paid</td><td class="r g b">${fmtINR(paid)}</td></tr>
    <tr><td>Balance pending</td><td class="r ${pending > 0.009 ? 'red' : 'g'} b">${fmtINR(Math.max(0, pending))}</td></tr>
  </table>
  ${payRows}
  ${bagSection}
  ${p.notes ? `<div class="h">Notes</div><div>${esc(p.notes)}</div>` : ''}
  <div class="sig"><div>Authorised signatory</div><div>Customer / receiver signature</div></div>
  <div class="ft">${esc(s.receiptFooter)}</div></div>`;
}

export function purchaseShareText(db: Database, p: PurchaseEntry): string {
  const party = db.parties.find(x => x.id === p.partyId);
  const paid = sumPayments(p.payments);
  const vName = (id: string) => db.varieties.find(v => v.id === id)?.name || id;
  const lines = p.lines.map(l => `• ${vName(l.varietyId)} ${fmtQtlKg(l.qtyKg)} @ ${fmtINR(l.ratePerQtl)}/Qtl = ${fmtINR(l.amount)}`).join('\n');
  return `${db.settings.millName}\nPaddy Purchase ${p.voucherNumber} · ${fmtDate(p.date)}\nCustomer: ${party?.name || '-'}\n${lines}\nTotal: ${fmtINR(p.finalTotal)}\nPaid: ${fmtINR(paid)} · Pending: ${fmtINR(Math.max(0, p.finalTotal - paid))}`;
}

export function PurchaseVoucherModal({ db, entry, onClose }: { db: Database; entry: PurchaseEntry; onClose: () => void }) {
  const html = purchaseVoucherHtml(db, entry);
  return (
    <Modal open onClose={onClose} title={`Voucher ${entry.voucherNumber}`} maxWidth="max-w-xl" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="secondary" onClick={async () => {
          const r = await shareText(`Purchase ${entry.voucherNumber}`, purchaseShareText(db, entry));
          if (r === 'copied') toast('Summary copied — paste it in WhatsApp');
          else if (r === 'failed') toast('Sharing not available on this device', 'error');
        }}>Share</Button>
        <Button variant="gold" onClick={() => printHtml(`Purchase Voucher ${entry.voucherNumber}`, html)}>Print / Save PDF</Button>
      </>
    }>
      <div className="bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
      <p className="text-[11px] text-gray-500 mt-2">Tip: in the print window choose “Save as PDF” to keep a PDF copy or send it on WhatsApp.</p>
    </Modal>
  );
}
