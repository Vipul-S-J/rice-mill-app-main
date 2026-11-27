/** Labour & Staff reports as tables (screen, CSV and PDF all use the same data). */
import type { Database } from './types';
import type { Range, TableData } from './reportData';
import { fmtDate, round2, sumPayments } from './db';
import { dayWage, markLabel, monthOf, nameOf, outstandingAdvance, payrollSheet, staffBalanceUpTo, staffOf, workerLedger, workersOf } from './staff';

export type LabourReportId = 'dailyAttendance' | 'monthlyAttendance' | 'workerWages' | 'millVsFarm' | 'advances' | 'payroll' | 'pending' | 'hullingWages' | 'payments';
export const LABOUR_REPORTS: { id: LabourReportId; title: string; sub: string }[] = [
  { id: 'dailyAttendance', title: 'Daily attendance', sub: 'Who was present, absent, on leave' },
  { id: 'monthlyAttendance', title: 'Monthly attendance', sub: 'Days and overtime per worker' },
  { id: 'workerWages', title: 'Worker-wise wages', sub: 'Earned, advanced, paid, pending' },
  { id: 'millVsFarm', title: 'Mill vs farm work', sub: 'Mill days and farm / other work' },
  { id: 'advances', title: 'Worker advances', sub: 'Advances given and outstanding' },
  { id: 'payroll', title: 'Monthly payroll', sub: 'Salary sheet for the months' },
  { id: 'pending', title: 'Pending worker payments', sub: 'What is still to be paid' },
  { id: 'hullingWages', title: 'Hulling labour wages', sub: 'Per-quintal and manual wage entries' },
  { id: 'payments', title: 'Worker payment history', sub: 'Salary, wages and advances paid' },
];
const inR = (r: Range) => (d: string) => (!r.start || d >= r.start) && (!r.end || d <= r.end);
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));
const months = (r: Range, db: Database): string[] => {
  const all = new Set<string>();
  db.payrolls.forEach(p => { if (inR(r)(p.month + '-15')) all.add(p.month); });
  return [...all].sort();
};

export function buildLabourTable(id: LabourReportId, db: Database, r: Range, today: string): TableData {
  const ok = inR(r);
  switch (id) {
    case 'dailyAttendance': {
      const recs = db.attendance.filter(a => ok(a.date));
      const rows: (string | number)[][] = recs.sort((a, b) => b.date.localeCompare(a.date) || nameOf(db, a.workerId).localeCompare(nameOf(db, b.workerId)))
        .map(a => [a.date, nameOf(db, a.workerId), markLabel(a.status), a.hours || '', a.overtimeHours || '', 'Mill']);
      if (r.start && r.start === r.end) { // a single day: also list who was not marked
        const marked = new Set(recs.map(a => a.workerId));
        for (const w of workersOf(db).filter(x => !x.staff?.inactive && !marked.has(x.id))) rows.push([r.start, w.name, 'Not marked', '', '', 'Mill']);
      }
      return { columns: [{ label: 'Date', kind: 'date' }, { label: 'Worker' }, { label: 'Status' }, { label: 'Hours', kind: 'num' }, { label: 'OT hrs', kind: 'num' }, { label: 'Work' }], rows };
    }
    case 'monthlyAttendance': {
      const rows = workersOf(db).map(w => {
        const rec = db.attendance.filter(a => a.workerId === w.id && ok(a.date));
        const c = (s: string) => rec.filter(a => a.status === s).length;
        return [w.name, c('present'), c('half'), c('absent'), c('leave'), round2(rec.reduce((s, a) => s + (a.overtimeHours || 0), 0))] as (string | number)[];
      }).filter(x => (x[1] as number) + (x[2] as number) + (x[3] as number) + (x[4] as number) > 0);
      return { columns: [{ label: 'Worker' }, { label: 'Present', kind: 'num' }, { label: 'Half day', kind: 'num' }, { label: 'Absent', kind: 'num' }, { label: 'Leave', kind: 'num' }, { label: 'OT hrs', kind: 'num' }], rows };
    }
    case 'workerWages': {
      const rows = workersOf(db).map(w => {
        const pays = db.payrolls.filter(p => p.workerId === w.id && p.status === 'final' && ok(p.month + '-28'));
        const salary = sum(pays.map(p => p.gross - p.deductions));
        const hulling = sum(db.labour.filter(l => l.workerPartyId === w.id && ok(l.date)).map(l => l.totalAmount));
        const adv = sum(db.advances.filter(a => a.workerId === w.id && ok(a.date)).map(a => a.amount));
        const paid = sum([...pays.flatMap(p => p.payments.map(x => x.amount)), ...db.labour.filter(l => l.workerPartyId === w.id && ok(l.date)).flatMap(l => l.payments.map(x => x.amount))]);
        const led = workerLedger(db, w.id);
        return [w.name, salary, hulling, round2(salary + hulling), adv, paid, led.length ? led[led.length - 1].balance : 0] as (string | number)[];
      }).filter(x => x.slice(1, 6).some(v => (v as number) !== 0));
      return { columns: [{ label: 'Worker' }, { label: 'Salary earned', kind: 'inr' }, { label: 'Hulling wages', kind: 'inr' }, { label: 'Total earned', kind: 'inr' }, { label: 'Advances', kind: 'inr' }, { label: 'Paid', kind: 'inr' }, { label: 'Pending (all dates)', kind: 'inr' }],
        rows, totals: ['Total', ...[1, 2, 3, 4, 5, 6].map(i => sum(rows.map(x => x[i] as number)))] };
    }
    case 'millVsFarm': {
      const rows = workersOf(db).map(w => {
        const rec = db.attendance.filter(a => a.workerId === w.id && ok(a.date));
        const days = rec.filter(a => a.status === 'present').length + rec.filter(a => a.status === 'half').length * 0.5;
        const work = db.workRecords.filter(x => x.workerId === w.id && ok(x.date));
        return [w.name, days, sum(rec.map(dayWage)), work.length, sum(work.map(x => x.amount))] as (string | number)[];
      }).filter(x => (x[1] as number) > 0 || (x[3] as number) > 0);
      return { columns: [{ label: 'Worker' }, { label: 'Mill days', kind: 'num' }, { label: 'Mill daily wages', kind: 'inr' }, { label: 'Farm / other jobs', kind: 'num' }, { label: 'Farm / other amount', kind: 'inr' }],
        rows, totals: ['Total', sum(rows.map(x => x[1] as number)), sum(rows.map(x => x[2] as number)), sum(rows.map(x => x[3] as number)), sum(rows.map(x => x[4] as number))] };
    }
    case 'advances': {
      const xs = db.advances.filter(a => ok(a.date)).sort((a, b) => b.date.localeCompare(a.date));
      return { columns: [{ label: 'Date', kind: 'date' }, { label: 'Worker' }, { label: 'Amount', kind: 'inr' }, { label: 'Mode' }, { label: 'Remarks' }, { label: 'Worker outstanding now', kind: 'inr' }],
        rows: xs.map(a => [a.date, nameOf(db, a.workerId), a.amount, a.mode, a.remarks || '', outstandingAdvance(db, a.workerId, today)]), totals: ['', 'Total', sum(xs.map(a => a.amount)), '', '', ''] };
    }
    case 'payroll': {
      const ms = months(r, db);
      const rows: (string | number)[][] = [];
      for (const m of ms) for (const p of db.payrolls.filter(x => x.month === m).sort((a, b) => nameOf(db, a.workerId).localeCompare(nameOf(db, b.workerId)))) {
        const s = payrollSheet(db, p);
        rows.push([m, nameOf(db, p.workerId), p.fullDays, p.halfDays, p.absentDays, p.overtimeHours, p.gross, p.deductions, s.previous, s.advances, s.net, s.paid, s.remaining, p.status === 'final' ? 'Final' : 'Draft']);
      }
      return { columns: [{ label: 'Month' }, { label: 'Worker' }, { label: 'Days', kind: 'num' }, { label: 'Half', kind: 'num' }, { label: 'Absent', kind: 'num' }, { label: 'OT hrs', kind: 'num' }, { label: 'Gross', kind: 'inr' }, { label: 'Deductions', kind: 'inr' },
        { label: 'Previous', kind: 'inr' }, { label: 'Advances', kind: 'inr' }, { label: 'Net payable', kind: 'inr' }, { label: 'Paid', kind: 'inr' }, { label: 'Remaining', kind: 'inr' }, { label: 'Status' }], rows };
    }
    case 'pending': {
      const mNow = monthOf(today);
      const rows = workersOf(db).map(w => {
        const staff = staffBalanceUpTo(db, w.id, mNow);
        const hull = sum(db.labour.filter(l => l.workerPartyId === w.id).map(l => l.totalAmount - sumPayments(l.payments)));
        return [w.name, staffOf(w).wageType === 'contract' ? '' : staff, hull, round2((staffOf(w).wageType === 'contract' ? 0 : staff) + hull)] as (string | number)[];
      }).filter(x => Math.abs(x[3] as number) > 0.009);
      return { columns: [{ label: 'Worker' }, { label: 'Salary pending (− = advance)', kind: 'inr' }, { label: 'Hulling wages pending', kind: 'inr' }, { label: 'Total pending', kind: 'inr' }],
        rows, totals: ['Total', '', sum(rows.map(x => x[2] as number)), sum(rows.map(x => x[3] as number))] };
    }
    case 'hullingWages': {
      const xs = db.labour.filter(l => ok(l.date)).sort((a, b) => b.date.localeCompare(a.date));
      return { columns: [{ label: 'Date', kind: 'date' }, { label: 'Worker' }, { label: 'Work' }, { label: 'Quantity', kind: 'qtl' }, { label: 'Wage', kind: 'inr' }, { label: 'Paid', kind: 'inr' }, { label: 'Due', kind: 'inr' }],
        rows: xs.map(l => [l.date, nameOf(db, l.workerPartyId), l.workType, (l.quantityQtl ?? l.hullingNetQtl ?? 0) * 100, l.totalAmount, sumPayments(l.payments), round2(l.totalAmount - sumPayments(l.payments))]),
        totals: ['', 'Total', '', '', sum(xs.map(l => l.totalAmount)), sum(xs.map(l => sumPayments(l.payments))), sum(xs.map(l => l.totalAmount - sumPayments(l.payments)))] };
    }
    case 'payments': {
      const rows: (string | number)[][] = [];
      for (const p of db.payrolls) for (const x of p.payments) if (ok(x.date)) rows.push([x.date, nameOf(db, p.workerId), 'Salary', x.mode, x.amount, x.reference || '']);
      for (const l of db.labour) for (const x of l.payments) if (ok(x.date)) rows.push([x.date, nameOf(db, l.workerPartyId), 'Hulling wage', x.mode, x.amount, x.reference || '']);
      for (const a of db.advances) if (ok(a.date)) rows.push([a.date, nameOf(db, a.workerId), 'Advance', a.mode, a.amount, a.remarks || '']);
      rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
      return { columns: [{ label: 'Date', kind: 'date' }, { label: 'Worker' }, { label: 'Type' }, { label: 'Mode' }, { label: 'Amount', kind: 'inr' }, { label: 'Reference / remarks' }], rows, totals: ['', '', '', 'Total', sum(rows.map(x => x[4] as number)), ''] };
    }
  }
}
export const tableTitle = (id: LabourReportId) => LABOUR_REPORTS.find(x => x.id === id)!.title;
export const rangeText = (r: Range) => `${r.start ? fmtDate(r.start) : 'Beginning'} to ${r.end ? fmtDate(r.end) : 'Latest'}`;
