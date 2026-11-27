import { useMemo, useState } from 'react';
import { useDB } from '../context';
import { fmtINR, round2, today } from '../db';
import { Card, Tabs } from './ui';
import { LabourPage } from './labour';
import { StaffTab } from './staffMgmt';
import { AttendanceTab } from './staffAttendance';
import { AdvancesTab, LedgerTab } from './staffMoney';
import { PayrollTab } from './staffPayroll';
import { StaffReportsTab } from './staffReports';
import { ledgerPending, monthOf, monthLabel, outstandingAdvance, workersOf } from '../staff';

type Tab = 'overview' | 'staff' | 'attendance' | 'ledger' | 'advances' | 'payroll' | 'hulling' | 'reports';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'staff', label: 'Staff' }, { id: 'attendance', label: 'Attendance' }, { id: 'ledger', label: 'Worker Ledger' },
  { id: 'advances', label: 'Advances' }, { id: 'payroll', label: 'Salary & Payroll' }, { id: 'hulling', label: 'Hulling Labour Wages' }, { id: 'reports', label: 'Reports' },
];

/** The one Labour & Staff section: staff, attendance, advances, payroll, ledgers, the existing hulling wages, and reports. */
export function LabourStaffPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [ledgerWorker, setLedgerWorker] = useState('');
  return (
    <div className="p-3 space-y-3 pb-6">
      <Tabs tabs={TABS} active={tab} onChange={id => setTab(id as Tab)} />
      {tab === 'overview' && <Overview go={setTab} />}
      {tab === 'staff' && <StaffTab onLedger={id => { setLedgerWorker(id); setTab('ledger'); }} />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'ledger' && <LedgerTab key={ledgerWorker} presetWorker={ledgerWorker} />}
      {tab === 'advances' && <AdvancesTab />}
      {tab === 'payroll' && <PayrollTab />}
      {tab === 'hulling' && <div className="-m-3"><LabourPage /></div>}
      {tab === 'reports' && <StaffReportsTab />}
    </div>
  );
}

function Overview({ go }: { go: (t: Tab) => void }) {
  const { db } = useDB();
  const t = today(), m = monthOf(t);
  const s = useMemo(() => {
    const staff = workersOf(db).filter(w => !w.staff?.inactive);
    const markedToday = new Set(db.attendance.filter(a => a.date === t).map(a => a.workerId));
    const present = db.attendance.filter(a => a.date === t && (a.status === 'present' || a.status === 'half')).length;
    const payrolls = db.payrolls.filter(p => p.month === m);
    const pending = round2(staff.reduce((x, w) => x + Math.max(0, ledgerPending(db, w.id)), 0));
    const adv = round2(staff.reduce((x, w) => x + outstandingAdvance(db, w.id, t), 0));
    const payable = staff.filter(w => w.staff && w.staff.wageType !== 'contract');
    return { staff: staff.length, present, unmarked: payable.filter(w => !markedToday.has(w.id)).length, drafts: payrolls.filter(p => p.status === 'draft').length, finals: payrolls.filter(p => p.status === 'final').length, pending, adv, noPayroll: payable.filter(w => !payrolls.some(p => p.workerId === w.id)).length };
  }, [db, t, m]);
  const Stat = ({ l, v, tone = 'text-gray-900' }: { l: string; v: string; tone?: string }) => (
    <div className="rounded-2xl bg-white border border-gray-100 p-3 shadow-soft"><div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{l}</div><div className={`text-xl font-extrabold ${tone}`}>{v}</div></div>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat l="Active staff" v={String(s.staff)} />
        <Stat l="Present today" v={String(s.present)} tone="text-forest-700" />
        <Stat l="Pending to pay" v={fmtINR(s.pending, { decimals: 0 })} tone="text-red-600" />
        <Stat l="Advances outstanding" v={fmtINR(s.adv, { decimals: 0 })} tone="text-amber-700" />
      </div>
      <Card className="p-3 space-y-1.5">
        <div className="text-sm font-bold text-forest-800">{monthLabel(m)} payroll</div>
        <div className="text-xs text-gray-600">{s.finals} finalised · {s.drafts} draft · {s.noPayroll} not generated yet</div>
        {s.unmarked > 0 && <div className="text-xs text-amber-700">⚠ Attendance not marked today for {s.unmarked} worker(s)</div>}
      </Card>
      <div className="grid grid-cols-2 gap-2">
        {([['staff', '👷 Register worker'], ['attendance', '✅ Mark attendance'], ['advances', '💵 Give advance'], ['payroll', '🧾 Salary & payroll'], ['hulling', '🌾 Hulling wages'], ['reports', '📊 Reports']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => go(id)} className="rounded-2xl border border-gray-200 bg-white p-3 text-left text-sm font-bold text-forest-800 active:scale-[0.98] shadow-soft">{label}</button>
        ))}
      </div>
      <p className="text-[11px] text-gray-500">Workers are the same records as before, so every old hulling wage entry and payment is still linked to its worker. Old workers show as “Hulling wage worker” until you add their staff details.</p>
    </div>
  );
}
