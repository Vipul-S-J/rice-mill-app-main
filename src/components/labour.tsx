import React, { useMemo, useState } from 'react';
import { useDB } from '../context';
import {
  fmtDate, fmtINR, fmtNumber, inRange, round2, sumPayments, today, withDraftPayment,
} from '../db';
import type { LabourEntry, Payment } from '../types';
import type { DateFilterValue } from './ui';
import {
  Badge, Button, Card, Confirm, DateFilter, EmptyState, Input, MiniBtn, Modal,
  PayBox, SearchBar, Select, toast,
} from './ui';
import { AddPaymentModal, PartyInput, partyName, useEnsureParty, usePaymentModes, useWorkTypes } from './pages';

type TopTab = 'calculate' | 'manual';
type WageType = 'per-qtl' | 'fixed';

const fmt2 = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(round2(n));
const q = (n: number) => `${fmt2(n)} Qtl`;

// Helper: list every ISO date string between from and to (inclusive)
function dateRangeList(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function LabourPage() {
  const { db, addLabour, updateLabour, deleteLabour, addLabourPayment } = useDB();
  const modes = usePaymentModes();
  const workTypes = useWorkTypes();
  const ensureParty = useEnsureParty();

  // Top toggle: "Calculate from Hulling" vs "Manual Entry" (matching user's screenshot)
  const [tab, setTab] = useState<TopTab>('calculate');

  // Search & filters for bottom list
  const [search, setSearch] = useState('');
  const [dateF, setDateF] = useState<DateFilterValue>({ preset: 'all' });
  const [sort, setSort] = useState('date-desc');

  // Edit / delete / pay
  const [editing, setEditing] = useState<LabourEntry | null>(null);
  const [del, setDel] = useState<LabourEntry | null>(null);
  const [payEntry, setPayEntry] = useState<LabourEntry | null>(null);

  // -------------------- Form State --------------------
  const [workerName, setWorkerName] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState(today());
  const [singleDate, setSingleDate] = useState(today());
  const [ratePerQtl, setRatePerQtl] = useState('25');
  const [wageType, setWageType] = useState<WageType>('per-qtl');
  const [workType, setWorkType] = useState(workTypes[0]?.name || 'Hulling');
  const [fixedAmount, setFixedAmount] = useState('');
  const [manualQtyQtl, setManualQtyQtl] = useState('');
  const [absentDates, setAbsentDates] = useState<string[]>([]);
  const [showAbsentModal, setShowAbsentModal] = useState(false);
  const [notes, setNotes] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payAmt, setPayAmt] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [payDate, setPayDate] = useState(today());

  // Manual adjustment fields (so user can adjust the auto-calculated result if needed)
  const [manualTotalOverride, setManualTotalOverride] = useState<string | null>(null);

  // Filtered hulling in date range
  const hullingInRange = useMemo(() => {
    if (tab !== 'calculate' || !fromDate || !toDate || fromDate > toDate) return [];
    return db.hulling.filter(h => h.date >= fromDate && h.date <= toDate);
  }, [db.hulling, tab, fromDate, toDate]);

  // Gross hulling total in range (kg & Qtl)
  const grossHullingKg = useMemo(() => {
    return hullingInRange.reduce((s, h) => s + (h.quantityKg || 0), 0);
  }, [hullingInRange]);
  const grossHullingQtl = round2(grossHullingKg / 100);

  // Hulling done on absent days
  const absentHullingKg = useMemo(() => {
    if (!absentDates.length) return 0;
    const set = new Set(absentDates);
    return hullingInRange.filter(h => set.has(h.date)).reduce((s, h) => s + (h.quantityKg || 0), 0);
  }, [hullingInRange, absentDates]);
  const absentHullingQtl = round2(absentHullingKg / 100);

  // Net hulling Qtl worker is credited for
  const netHullingQtl = Math.max(0, round2(grossHullingQtl - absentHullingQtl));

  // Range day count for fixed wage deduction calculation
  const totalDaysInRange = useMemo(() => {
    if (!fromDate || !toDate || fromDate > toDate) return 1;
    return dateRangeList(fromDate, toDate).length;
  }, [fromDate, toDate]);

  // Auto-calculated wage before manual override
  const autoCalculatedTotal = useMemo(() => {
    if (tab === 'calculate') {
      if (wageType === 'per-qtl') {
        const r = Number(ratePerQtl) || 0;
        return round2(netHullingQtl * r);
      } else {
        // Trainee / fixed worker with date range:
        // absent days deduct amount from selected absent days based on fixed amount
        const fix = Number(fixedAmount) || 0;
        if (!fix) return 0;
        const perDay = totalDaysInRange > 0 ? fix / totalDaysInRange : 0;
        const ded = round2(perDay * absentDates.length);
        return Math.max(0, round2(fix - ded));
      }
    } else {
      // Manual entry
      if (wageType === 'per-qtl') {
        const qtl = Number(manualQtyQtl) || 0;
        const r = Number(ratePerQtl) || 0;
        return round2(qtl * r);
      } else {
        return round2(Number(fixedAmount) || 0);
      }
    }
  }, [tab, wageType, ratePerQtl, netHullingQtl, fixedAmount, totalDaysInRange, absentDates.length, manualQtyQtl]);

  const effectiveTotal = manualTotalOverride !== null ? Math.max(0, Number(manualTotalOverride) || 0) : autoCalculatedTotal;

  // Fixed wage per-day deduction amount
  const fixedDeduction = useMemo(() => {
    if (wageType !== 'fixed' || tab !== 'calculate') return 0;
    const fix = Number(fixedAmount) || 0;
    if (!fix || !totalDaysInRange) return 0;
    return round2((fix / totalDaysInRange) * absentDates.length);
  }, [wageType, tab, fixedAmount, totalDaysInRange, absentDates.length]);

  // Available dates to pick as absent
  const possibleAbsentDates = useMemo(() => {
    return dateRangeList(fromDate, toDate);
  }, [fromDate, toDate]);

  // Load entry for editing
  const startEdit = (entry: LabourEntry) => {
    setEditing(entry);
    setWorkerName(partyName(db, entry.workerPartyId));
    setWageType(entry.wageType);
    setWorkType(entry.workType);
    setTab(entry.calcMode === 'hulling' ? 'calculate' : 'manual');
    if (entry.calcMode === 'hulling') {
      setFromDate(entry.fromDate || entry.date);
      setToDate(entry.toDate || entry.date);
      setRatePerQtl(entry.ratePerQtl ? String(entry.ratePerQtl) : '25');
      setFixedAmount(entry.fixedAmount ? String(entry.fixedAmount) : '');
      setAbsentDates(entry.absentDates || []);
    } else {
      setSingleDate(entry.date);
      setFromDate(entry.fromDate || '');
      setToDate(entry.toDate || '');
      setManualQtyQtl(entry.quantityQtl ? String(entry.quantityQtl) : '');
      setRatePerQtl(entry.ratePerQtl ? String(entry.ratePerQtl) : '25');
      setFixedAmount(entry.fixedAmount ? String(entry.fixedAmount) : '');
      setAbsentDates([]);
    }
    setManualTotalOverride(String(entry.totalAmount));
    setNotes(entry.notes || '');
    setPayments(entry.payments || []);
    setPayAmt('');
    setPayDate(today());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditing(null);
    setWorkerName('');
    setFromDate('');
    setToDate(today());
    setSingleDate(today());
    setRatePerQtl('25');
    setWageType('per-qtl');
    setWorkType(workTypes[0]?.name || 'Hulling');
    setFixedAmount('');
    setManualQtyQtl('');
    setAbsentDates([]);
    setNotes('');
    setPayments([]);
    setPayAmt('');
    setManualTotalOverride(null);
  };

  // Save handler
  const handleSave = () => {
    if (!workerName.trim()) { toast('Worker name is required', 'error'); return; }
    if (tab === 'calculate') {
      if (!fromDate || !toDate) { toast('From date and To date are required', 'error'); return; }
      if (fromDate > toDate) { toast('From date cannot be after To date', 'error'); return; }
      if (wageType === 'per-qtl' && !(Number(ratePerQtl) > 0)) { toast('Rate per quintal is required', 'error'); return; }
      if (wageType === 'fixed' && !(Number(fixedAmount) > 0)) { toast('Fixed amount is required', 'error'); return; }
    } else {
      if (!singleDate) { toast('Date is required', 'error'); return; }
      if (wageType === 'per-qtl' && !(Number(manualQtyQtl) > 0)) { toast('Quantity (Qtl) is required', 'error'); return; }
      if (wageType === 'fixed' && !(Number(fixedAmount) > 0)) { toast('Fixed amount is required', 'error'); return; }
    }

    const workerId = ensureParty(workerName.trim(), 'worker');
    const existingPayments = payments;
    const finalPayments = withDraftPayment(existingPayments, payAmt, payMode, payDate);

    const payload: Omit<LabourEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      date: tab === 'calculate' ? toDate : singleDate,
      workerPartyId: workerId,
      workType,
      wageType,
      calcMode: tab === 'calculate' ? 'hulling' : 'manual',
      fromDate: tab === 'calculate' ? fromDate : undefined,
      toDate: tab === 'calculate' ? toDate : undefined,
      absentDates: tab === 'calculate' && absentDates.length ? absentDates : undefined,
      hullingTotalQtl: tab === 'calculate' ? grossHullingQtl : undefined,
      hullingNetQtl: tab === 'calculate' && wageType === 'per-qtl' ? netHullingQtl : undefined,
      quantityQtl: tab === 'calculate' ? (wageType === 'per-qtl' ? netHullingQtl : undefined) : (wageType === 'per-qtl' ? Number(manualQtyQtl) : undefined),
      ratePerQtl: wageType === 'per-qtl' ? Number(ratePerQtl) : undefined,
      fixedAmount: wageType === 'fixed' ? Number(fixedAmount) : undefined,
      dailyRate: wageType === 'fixed' && tab === 'calculate' && totalDaysInRange ? round2((Number(fixedAmount) || 0) / totalDaysInRange) : undefined,
      deductionAmount: wageType === 'fixed' && tab === 'calculate' ? fixedDeduction : undefined,
      totalAmount: effectiveTotal,
      notes: notes.trim() || undefined,
      payments: finalPayments,
    };

    if (editing) {
      updateLabour(editing.id, payload);
      toast('Labour entry updated');
    } else {
      addLabour(payload);
      toast('Labour entry saved');
    }
    resetForm();
  };

  // Filtered entries list
  const entries = useMemo(() => {
    let list = [...db.labour];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(l => {
        const wName = partyName(db, l.workerPartyId).toLowerCase();
        return wName.includes(q) || (l.workType || '').toLowerCase().includes(q) || (l.notes || '').toLowerCase().includes(q);
      });
    }
    list = list.filter(l => inRange(l.date, dateF));
    list.sort((a, b) => {
      switch (sort) {
        case 'date-asc': return a.date.localeCompare(b.date);
        case 'amt-asc': return a.totalAmount - b.totalAmount;
        case 'amt-desc': return b.totalAmount - a.totalAmount;
        default: return b.date.localeCompare(a.date);
      }
    });
    return list;
  }, [db, search, dateF, sort]);

  const totals = useMemo(() => {
    const total = entries.reduce((s, l) => s + l.totalAmount, 0);
    const paid = entries.reduce((s, l) => s + sumPayments(l.payments), 0);
    return { count: entries.length, total, paid, due: round2(total - paid) };
  }, [entries]);

  return (
    <div className="p-3 pb-8 space-y-4">

      {/* Top Toggle: Manual Entry vs Calculate from Hulling */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => { setTab('manual'); setManualTotalOverride(null); }}
          className={`py-2.5 px-3 rounded-2xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
            tab === 'manual'
              ? 'bg-[#0b3d2c] text-white border-[#0b3d2c] shadow'
              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
          }`}
        >
          <span>✏️</span> Manual Entry
        </button>
        <button
          type="button"
          onClick={() => { setTab('calculate'); setManualTotalOverride(null); }}
          className={`py-2.5 px-3 rounded-2xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
            tab === 'calculate'
              ? 'bg-[#0b3d2c] text-white border-[#0b3d2c] shadow'
              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
          }`}
        >
          <span>⚙️</span> Calculate from Hulling
        </button>
      </div>

      {/* Main Entry Card */}
      <Card className="p-4 space-y-3 border-2 border-forest-200 shadow-sm bg-white">
        <div className="flex items-center justify-between">
          <div className="text-base font-extrabold text-forest-900 flex items-center gap-2">
            <span>{tab === 'calculate' ? '⚙️' : '✏️'}</span>
            <span>{editing ? `Edit Labour Entry` : tab === 'calculate' ? 'Calculate Wages from Hulling' : 'Manual Wage Entry'}</span>
          </div>
          {editing && (
            <span className="text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">Editing</span>
          )}
        </div>

        {/* Wage Type Selector: Per-Qtl vs Fixed (Trainee/Monthly) */}
        <div className="grid grid-cols-2 gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
          <button
            type="button"
            onClick={() => { setWageType('per-qtl'); setManualTotalOverride(null); }}
            className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
              wageType === 'per-qtl' ? 'bg-[#0b3d2c] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            🌾 Per Quintal (Hulling)
          </button>
          <button
            type="button"
            onClick={() => { setWageType('fixed'); setManualTotalOverride(null); }}
            className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
              wageType === 'fixed' ? 'bg-[#0b3d2c] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            💼 Fixed / Trainee Wage
          </button>
        </div>

        {/* Date Inputs */}
        {tab === 'calculate' ? (
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              label="From Date *"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setManualTotalOverride(null); }}
            />
            <Input
              type="date"
              label="To Date *"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setManualTotalOverride(null); }}
            />
          </div>
        ) : (
          <Input
            type="date"
            label="Date *"
            value={singleDate}
            onChange={e => { setSingleDate(e.target.value); setManualTotalOverride(null); }}
          />
        )}

        {/* Worker Name & Rate / Fixed */}
        <div className="grid grid-cols-2 gap-2">
          <PartyInput
            label="Worker Name"
            required
            value={workerName}
            onChange={setWorkerName}
            types={['worker']}
            placeholder="Worker name"
          />
          {wageType === 'per-qtl' ? (
            <Input
              label="Rate per Quintal (₹) *"
              type="number"
              inputMode="decimal"
              value={ratePerQtl}
              onChange={e => { setRatePerQtl(e.target.value); setManualTotalOverride(null); }}
              placeholder="e.g. 25"
            />
          ) : (
            <Input
              label="Fixed Amount (₹) *"
              type="number"
              inputMode="decimal"
              value={fixedAmount}
              onChange={e => { setFixedAmount(e.target.value); setManualTotalOverride(null); }}
              placeholder="e.g. 15000"
            />
          )}
        </div>

        {/* Manual Quantity in Manual Mode */}
        {tab === 'manual' && wageType === 'per-qtl' && (
          <Input
            label="Quantity (Qtl) *"
            type="number"
            inputMode="decimal"
            value={manualQtyQtl}
            onChange={e => { setManualQtyQtl(e.target.value); setManualTotalOverride(null); }}
            placeholder="e.g. 120.50"
          />
        )}

        {/* Work Type selector if not standard hulling */}
        <div className="grid grid-cols-2 gap-2">
          <Select
            label="Work Type"
            value={workType}
            onChange={e => setWorkType(e.target.value)}
            options={workTypes.map(w => ({ value: w.name, label: w.name }))}
          />
          <Input
            label="Notes (optional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Shift / bonus / note"
          />
        </div>

        {/* Absent Days Box (in Calculate from Hulling mode) */}
        {tab === 'calculate' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <span>📅</span>
                <span>Absent Days (optional)</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!fromDate || !toDate || fromDate > toDate) {
                    toast('Select From and To dates first', 'error');
                    return;
                  }
                  setShowAbsentModal(true);
                }}
                className="text-[11px] font-bold text-amber-800 bg-white border border-amber-300 rounded-lg px-2.5 py-1 hover:bg-amber-50 active:scale-95 transition-all shadow-sm"
              >
                + Add Absent Dates
              </button>
            </div>

            {absentDates.length > 0 ? (
              <div className="space-y-1">
                <div className="flex flex-wrap gap-1">
                  {absentDates.map(d => (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1 bg-white border border-amber-300 text-amber-900 text-[11px] font-semibold rounded-full px-2 py-0.5 shadow-sm"
                    >
                      <span>{fmtDate(d)}</span>
                      <button
                        type="button"
                        onClick={() => setAbsentDates(prev => prev.filter(x => x !== d))}
                        className="text-red-500 font-bold hover:text-red-700"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-amber-800 pt-1">
                  {wageType === 'per-qtl' ? (
                    <>
                      <span>Hulling on absent days ({q(absentHullingQtl)}) deducted — other worker did hulling on those days.</span>
                    </>
                  ) : (
                    <>
                      <span>{absentDates.length} of {totalDaysInRange} days absent: ₹{fmtNumber(fixedDeduction)} deducted proportionally.</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-amber-700">
                No absent days marked. Worker gets credit for the entire date range.
              </p>
            )}
          </div>
        )}

        {/* Live Calculation Preview Banner */}
        {tab === 'calculate' && fromDate && toDate && (
          <div className="rounded-xl border border-forest-200 bg-forest-50/60 p-3 space-y-1 text-xs">
            <div className="flex justify-between text-gray-700">
              <span>Hulling in period ({hullingInRange.length} entries):</span>
              <b>{q(grossHullingQtl)} ({fmtNumber(grossHullingKg)} kg)</b>
            </div>
            {wageType === 'per-qtl' && absentDates.length > 0 && (
              <div className="flex justify-between text-red-700">
                <span>− Absent days hulling ({absentDates.length} days):</span>
                <b>−{q(absentHullingQtl)}</b>
              </div>
            )}
            {wageType === 'per-qtl' && (
              <div className="flex justify-between text-forest-800 font-semibold border-t border-forest-200 pt-1">
                <span>Net Hulling Credited:</span>
                <b>{q(netHullingQtl)} @ ₹{ratePerQtl}/Qtl</b>
              </div>
            )}
            {wageType === 'fixed' && (
              <div className="flex justify-between text-forest-800 border-t border-forest-200 pt-1">
                <span>Fixed Wage:</span>
                <span>₹{fmtNumber(Number(fixedAmount) || 0)}</span>
              </div>
            )}
            {wageType === 'fixed' && absentDates.length > 0 && (
              <div className="flex justify-between text-red-700">
                <span>− Absent Days Deduction ({absentDates.length} days):</span>
                <b>−₹{fmtNumber(fixedDeduction)}</b>
              </div>
            )}
          </div>
        )}

        {/* Editable Total Amount Field with Re-Calculate action */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-700">Total Wage Amount</label>
            {manualTotalOverride !== null && (
              <button
                type="button"
                onClick={() => setManualTotalOverride(null)}
                className="text-[11px] font-bold text-forest-700 underline"
              >
                Reset to Auto ({fmtINR(autoCalculatedTotal)})
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                type="number"
                inputMode="decimal"
                value={manualTotalOverride !== null ? manualTotalOverride : String(autoCalculatedTotal)}
                onChange={e => setManualTotalOverride(e.target.value)}
                placeholder="Total amount"
                className="text-lg font-extrabold text-forest-900 bg-white"
              />
            </div>
            {manualTotalOverride !== null && (
              <span className="text-[10px] font-bold text-amber-800 bg-amber-100 rounded px-2 py-1 shrink-0">
                Manual Edit
              </span>
            )}
          </div>
        </div>

        {/* Payments / Advances Box */}
        <div className="rounded-xl border border-forest-100 p-3 bg-white">
          <PayBox
            total={effectiveTotal}
            existing={payments}
            onRemoveExisting={i => setPayments(p => p.filter((_, x) => x !== i))}
            amount={payAmt}
            onAmount={setPayAmt}
            mode={payMode}
            onMode={setPayMode}
            date={payDate}
            onDate={setPayDate}
            modes={modes}
          />
        </div>

        {/* Save / Clear Buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            className="flex-1 bg-[#0b3d2c] hover:bg-[#082c20] text-white py-3 text-sm font-bold shadow-sm"
            onClick={handleSave}
          >
            💾 {editing ? 'Update Labour Entry' : 'Save Labour Entry'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={resetForm}
          >
            Clear
          </Button>
        </div>
      </Card>

      {/* Search & Date Filters for Bottom List */}
      <div className="space-y-2">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search worker name..."
        />
        <DateFilter value={dateF} onChange={setDateF} />
        <div className="flex gap-2">
          <Select
            wrapperClassName="flex-1"
            value={sort}
            onChange={e => setSort(e.target.value)}
            options={[
              { value: 'date-desc', label: 'Date: Newest first' },
              { value: 'date-asc', label: 'Date: Oldest first' },
              { value: 'amt-desc', label: 'Amount: High → Low' },
              { value: 'amt-asc', label: 'Amount: Low → High' },
            ]}
          />
        </div>
      </div>

      {/* Summary KPI Bar */}
      {entries.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-center text-xs bg-white border border-gray-100 rounded-xl p-2.5 shadow-sm">
          <div>
            <span className="text-gray-400 block text-[10px] uppercase font-bold">Entries</span>
            <b className="text-gray-800 text-sm">{entries.length}</b>
          </div>
          <div>
            <span className="text-gray-400 block text-[10px] uppercase font-bold">Total Wages</span>
            <b className="text-forest-800 text-sm">{fmtINR(totals.total)}</b>
          </div>
          <div>
            <span className="text-gray-400 block text-[10px] uppercase font-bold">Balance Due</span>
            <b className={`text-sm ${totals.due > 0.009 ? 'text-red-600' : 'text-green-700'}`}>
              {fmtINR(totals.due)}
            </b>
          </div>
        </div>
      )}

      {/* Labour Entries List */}
      <Card>
        {entries.length === 0 ? (
          <EmptyState
            title="No entries found"
            subtitle="Record wages using Calculate from Hulling or Manual Entry above."
          />
        ) : (
          entries.map(l => {
            const paid = sumPayments(l.payments);
            const due = round2(l.totalAmount - paid);
            const worker = partyName(db, l.workerPartyId);
            return (
              <div key={l.id} className="p-3 border-b border-gray-100 last:border-0 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <b className="text-sm text-gray-900">{worker}</b>
                      <Badge tone={l.calcMode === 'hulling' ? 'green' : 'blue'}>
                        {l.calcMode === 'hulling' ? '⚙️ Auto Hulling' : '✏️ Manual'}
                      </Badge>
                      <Badge tone={l.wageType === 'per-qtl' ? 'gold' : 'gray'}>
                        {l.wageType === 'per-qtl' ? 'Per-Qtl' : 'Fixed'}
                      </Badge>
                    </div>

                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {l.fromDate && l.toDate ? (
                        <span>{fmtDate(l.fromDate)} → {fmtDate(l.toDate)}</span>
                      ) : (
                        <span>{fmtDate(l.date)}</span>
                      )}
                      <span> · {l.workType}</span>
                    </div>

                    {l.calcMode === 'hulling' && l.hullingTotalQtl !== undefined && (
                      <div className="text-[11px] text-gray-700 mt-1">
                        Hulling: {q(l.hullingTotalQtl)}
                        {l.hullingNetQtl !== undefined && l.hullingNetQtl !== l.hullingTotalQtl && (
                          <span className="text-forest-700 font-semibold"> (Net credited: {q(l.hullingNetQtl)})</span>
                        )}
                        {l.ratePerQtl ? ` @ ₹${l.ratePerQtl}/Qtl` : ''}
                      </div>
                    )}

                    {l.calcMode !== 'hulling' && l.quantityQtl && (
                      <div className="text-[11px] text-gray-700 mt-1">
                        Quantity: {q(l.quantityQtl)} @ ₹{l.ratePerQtl}/Qtl
                      </div>
                    )}

                    {l.absentDates && l.absentDates.length > 0 && (
                      <div className="text-[10px] text-amber-800 mt-0.5">
                        ⚠️ {l.absentDates.length} absent day(s): {l.absentDates.map(d => fmtDate(d)).join(', ')}
                        {l.deductionAmount ? ` (deducted ₹${fmtNumber(l.deductionAmount)})` : ''}
                      </div>
                    )}

                    {l.notes && (
                      <div className="text-[11px] text-gray-500 italic mt-0.5">{l.notes}</div>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <b className="text-sm text-forest-900 block">{fmtINR(l.totalAmount)}</b>
                    <span className="text-[10px] block">
                      {due > 0.009 ? (
                        <span className="text-red-600 font-bold">Due {fmtINR(due)}</span>
                      ) : (
                        <span className="text-green-700 font-bold">PAID</span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex gap-1.5 pt-1">
                  <MiniBtn tone="blue" onClick={() => startEdit(l)}>✎ Edit</MiniBtn>
                  {due > 0.009 && (
                    <MiniBtn tone="green" onClick={() => setPayEntry(l)}>+ Pay</MiniBtn>
                  )}
                  <MiniBtn tone="danger" onClick={() => setDel(l)}>🗑 Delete</MiniBtn>
                </div>
              </div>
            );
          })
        )}
      </Card>

      {/* Add Payment Modal */}
      {payEntry && (
        <AddPaymentModal
          open
          total={payEntry.totalAmount}
          paid={sumPayments(payEntry.payments)}
          modes={modes}
          onClose={() => setPayEntry(null)}
          onSave={(p: Omit<Payment, 'id' | 'createdAt'>) => {
            addLabourPayment(payEntry.id, p);
            setPayEntry(null);
            toast('Payment added');
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={() => {
          if (del) {
            deleteLabour(del.id);
            toast('Labour entry deleted');
            setDel(null);
          }
        }}
        title="Delete Labour Entry?"
        message={`Delete wage entry for ${partyName(db, del?.workerPartyId || '')} (₹${fmtNumber(del?.totalAmount || 0)})? Ledger and cashbook effects will be reversed.`}
        confirmText="Delete"
      />

      {/* Modal to pick Absent Dates */}
      <AbsentDatesModal
        open={showAbsentModal}
        onClose={() => setShowAbsentModal(false)}
        allDates={possibleAbsentDates}
        selectedDates={absentDates}
        onSave={dates => {
          setAbsentDates(dates);
          setShowAbsentModal(false);
          setManualTotalOverride(null);
        }}
      />
    </div>
  );
}

// Modal component to select multiple absent dates within the period
function AbsentDatesModal({
  open,
  onClose,
  allDates,
  selectedDates,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  allDates: string[];
  selectedDates: string[];
  onSave: (dates: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(selectedDates);

  React.useEffect(() => {
    if (open) setPicked(selectedDates);
  }, [open, selectedDates]);

  const toggle = (d: string) => {
    setPicked(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort()));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Select Absent Dates"
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(picked)}>
            Apply Absent Dates ({picked.length})
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-600">
          Pick dates the worker was absent during this period. Hulling volume done on these days is not credited, or fixed wage is deducted proportionally.
        </p>

        {allDates.length === 0 ? (
          <div className="text-center text-xs text-gray-400 py-4">No dates in selected range.</div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto p-1">
            {allDates.map(d => {
              const checked = picked.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggle(d)}
                  className={`flex items-center justify-between p-2 rounded-lg border text-xs font-semibold transition-all ${
                    checked
                      ? 'bg-amber-100 border-amber-400 text-amber-900 shadow-sm'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span>{fmtDate(d)}</span>
                  <span>{checked ? '✓ Absent' : 'Present'}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex justify-between items-center text-xs text-gray-500 pt-1 border-t border-gray-100">
          <span>{picked.length} of {allDates.length} days absent</span>
          {picked.length > 0 && (
            <button
              type="button"
              onClick={() => setPicked([])}
              className="text-red-600 font-bold hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
