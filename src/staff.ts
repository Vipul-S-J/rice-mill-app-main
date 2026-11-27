/** Staff, attendance, advances and payroll calculations (pure, no UI). */
import type { AttendanceEntry, Database, Party, PayrollEntry, StaffProfile, WageType } from './types';
import { round2, sumPayments } from './db';

export const WAGE_LABEL: Record<WageType, string> = { daily: 'Daily wage', monthly: 'Monthly salary', hourly: 'Hourly wage', contract: 'Contract / piece-rate' };
export const monthOf = (date: string) => date.slice(0, 7);
export const daysInMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
export const monthEnd = (m: string) => `${m}-${String(daysInMonth(m)).padStart(2, '0')}`;
export const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }); };

/** Everyone registered as a worker. Old workers (from hulling wages) have no profile yet and count as contract workers. */
export const workersOf = (db: Database): Party[] => db.parties.filter(p => p.types.includes('worker'));
export const staffOf = (p?: Party): StaffProfile => p?.staff || { wageType: 'contract', wageRate: 0 };
export const nameOf = (db: Database, id: string) => db.parties.find(p => p.id === id)?.name || '(Unknown)';

/** Overtime rate per hour. Blank on the profile = worked out from the wage rate (8-hour day, 30-day month). */
export function otRateOf(s: StaffProfile): number {
  if (s.otRate && s.otRate > 0) return s.otRate;
  if (s.wageType === 'daily') return round2(s.wageRate / 8);
  if (s.wageType === 'monthly') return round2(s.wageRate / 30 / 8);
  if (s.wageType === 'hourly') return s.wageRate;
  return 0;
}
/** Hours counted for an hourly worker's day: typed hours, else 8 for a full day and 4 for a half day. */
export const hoursOf = (a: AttendanceEntry) => (a.hours && a.hours > 0 ? a.hours : a.status === 'present' ? 8 : a.status === 'half' ? 4 : 0);

/** Wage of one marked day (daily / hourly workers). Monthly salaries are worked out per month instead. */
export function dayWage(a: AttendanceEntry): number {
  if (a.wageType === 'daily') return a.status === 'present' ? a.rate : a.status === 'half' ? a.rate / 2 : 0;
  if (a.wageType === 'hourly') return hoursOf(a) * a.rate;
  return 0;
}

export interface PayrollAuto {
  wageType: WageType; rate: number;
  fullDays: number; halfDays: number; absentDays: number; leaveDays: number; hours: number; overtimeHours: number;
  basic: number; overtimeAmount: number; otherWork: number; absenceDeduction: number;
  gross: number; deductions: number;
}
/** Automatic payroll figures for one worker and month. The administrator can edit the result before finalising. */
export function computePayrollAuto(db: Database, workerId: string, month: string): PayrollAuto {
  const w = db.parties.find(p => p.id === workerId);
  const sp = staffOf(w);
  const recs = db.attendance.filter(a => a.workerId === workerId && monthOf(a.date) === month);
  const count = (st: string) => recs.filter(a => a.status === st).length;
  const full = count('present'), half = count('half'), absent = count('absent'), leave = count('leave');
  const hours = round2(recs.reduce((s, a) => s + (sp.wageType === 'hourly' ? hoursOf(a) : 0), 0));
  const ot = round2(recs.reduce((s, a) => s + (a.overtimeHours || 0), 0));
  let basic = 0, absenceDeduction = 0;
  if (sp.wageType === 'monthly') {
    basic = sp.wageRate;
    // absent days (and half of a half-day) are deducted; leave is paid. Unmarked days are never deducted.
    absenceDeduction = round2((absent + half * 0.5) * (sp.wageRate / daysInMonth(month)));
  } else {
    basic = round2(recs.reduce((s, a) => s + dayWage(a), 0));
  }
  const overtimeAmount = round2(ot * otRateOf(sp));
  const otherWork = round2(db.workRecords.filter(r => r.workerId === workerId && monthOf(r.date) === month).reduce((s, r) => s + r.amount, 0));
  return {
    wageType: sp.wageType, rate: sp.wageRate, fullDays: full, halfDays: half, absentDays: absent, leaveDays: leave, hours, overtimeHours: ot,
    basic: round2(basic), overtimeAmount, otherWork, absenceDeduction, gross: round2(basic + overtimeAmount + otherWork), deductions: absenceDeduction,
  };
}

const net = (p: PayrollEntry) => round2(p.gross - p.deductions);
/**
 * Staff account of a worker up to the end of `month`: wages earned in final payrolls minus advances given and salary paid.
 * Positive = the mill owes the worker. Negative = the worker holds an advance that is not yet recovered.
 */
export function staffBalanceUpTo(db: Database, workerId: string, month: string, includePayrollId?: string): number {
  const ps = db.payrolls.filter(p => p.workerId === workerId && p.month <= month);
  const credits = ps.filter(p => p.status === 'final' || p.id === includePayrollId).reduce((s, p) => s + net(p), 0);
  const paid = ps.reduce((s, p) => s + sumPayments(p.payments), 0);
  const adv = db.advances.filter(a => a.workerId === workerId && monthOf(a.date) <= month).reduce((s, a) => s + a.amount, 0);
  return round2(credits - paid - adv);
}
export interface PayrollSheet { previous: number; advances: number; earned: number; net: number; paid: number; remaining: number }
/** The numbers shown on a payroll row. Chain-consistent: remaining of one month is the previous pending of the next. */
export function payrollSheet(db: Database, p: PayrollEntry): PayrollSheet {
  const previous = staffBalanceUpTo(db, p.workerId, prevMonth(p.month));
  const advances = round2(db.advances.filter(a => a.workerId === p.workerId && monthOf(a.date) === p.month).reduce((s, a) => s + a.amount, 0));
  const earned = net(p);
  const netPayable = round2(previous + earned - advances);
  const paid = sumPayments(p.payments);
  return { previous, advances, earned, net: netPayable, paid, remaining: round2(netPayable - paid) };
}
/** Salary recorded as an expense (final payrolls only, dated at the end of their month). Hulling wage entries are counted separately. */
export function staffWagesIn(db: Database, from: string, to: string): number {
  return round2(db.payrolls.filter(p => p.status === 'final').filter(p => { const d = monthEnd(p.month); return (!from || d >= from) && (!to || d <= to); }).reduce((s, p) => s + net(p), 0));
}
/** Advance the worker still holds (not yet recovered through salary). */
export const outstandingAdvance = (db: Database, workerId: string, today: string) => Math.max(0, -staffBalanceUpTo(db, workerId, monthOf(today)));

export interface LedgerLine { date: string; kind: 'Opening' | 'Wages' | 'Deduction' | 'Hulling wages' | 'Advance' | 'Payment'; text: string; credit: number; debit: number; balance: number }
/** Everything the mill owes / has paid a worker, in date order. credit = mill owes more, debit = paid or advanced. */
export function workerLedger(db: Database, workerId: string): LedgerLine[] {
  const rows: Omit<LedgerLine, 'balance'>[] = [];
  const w = db.parties.find(p => p.id === workerId);
  const open = w?.openingBalance || 0;
  if (open) rows.push({ date: '', kind: 'Opening', text: 'Opening balance', credit: open < 0 ? -open : 0, debit: open > 0 ? open : 0 });
  for (const p of db.payrolls.filter(x => x.workerId === workerId)) {
    const end = monthEnd(p.month);
    if (p.status === 'final') {
      rows.push({ date: end, kind: 'Wages', text: `Wages for ${monthLabel(p.month)}`, credit: p.gross, debit: 0 });
      if (p.deductions) rows.push({ date: end, kind: 'Deduction', text: `Deductions ${monthLabel(p.month)}`, credit: 0, debit: p.deductions });
    }
    for (const pay of p.payments) rows.push({ date: pay.date, kind: 'Payment', text: `Salary paid (${pay.mode}) for ${monthLabel(p.month)}`, credit: 0, debit: pay.amount });
  }
  for (const l of db.labour.filter(x => x.workerPartyId === workerId)) {
    rows.push({ date: l.date, kind: 'Hulling wages', text: `Hulling wages (${l.workType})`, credit: l.totalAmount, debit: 0 });
    for (const pay of l.payments) rows.push({ date: pay.date, kind: 'Payment', text: `Hulling wage paid (${pay.mode})`, credit: 0, debit: pay.amount });
  }
  for (const a of db.advances.filter(x => x.workerId === workerId)) rows.push({ date: a.date, kind: 'Advance', text: `Advance (${a.mode})${a.remarks ? ` · ${a.remarks}` : ''}`, credit: 0, debit: a.amount });
  rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let bal = 0;
  return rows.map(r => { bal = round2(bal + r.credit - r.debit); return { ...r, balance: bal }; });
}
export const ledgerPending = (db: Database, workerId: string) => { const l = workerLedger(db, workerId); return l.length ? l[l.length - 1].balance : 0; };

/** Wage of a marked day, for display (monthly workers show nothing: the salary is worked out per month). */
export const markLabel = (s: AttendanceEntry['status']) => ({ present: 'Present', half: 'Half day', absent: 'Absent', leave: 'Leave' }[s]);
