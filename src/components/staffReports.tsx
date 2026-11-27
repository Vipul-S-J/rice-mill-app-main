import { useMemo, useState } from 'react';
import { useDB } from '../context';
import { today } from '../db';
import { formatCell, toCsv } from '../reportData';
import type { Range } from '../reportData';
import { LABOUR_REPORTS, buildLabourTable, rangeText, tableTitle } from '../staffReportData';
import type { LabourReportId } from '../staffReportData';
import { Button, Card, EmptyState, Input, SearchBar, toast } from './ui';
import { cn } from '../utils/cn';
import { esc } from '../utils/print';
import { saveFile } from '../utils/pdf';
import { savePdfWithToast, sharePdfWithToast } from './pdfActions';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PRESETS: { id: string; label: string; get: () => Range }[] = [
  { id: 'today', label: 'Today', get: () => ({ start: today(), end: today() }) },
  { id: 'month', label: 'This month', get: () => { const n = new Date(); return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: today() }; } },
  { id: 'year', label: 'This year', get: () => ({ start: `${new Date().getFullYear()}-01-01`, end: today() }) },
  { id: 'all', label: 'All time', get: () => ({ start: '', end: '' }) },
];

export function StaffReportsTab() {
  const { db } = useDB();
  const [id, setId] = useState<LabourReportId>('dailyAttendance');
  const [range, setRange] = useState<Range>(PRESETS[0].get());
  const [preset, setPreset] = useState('today');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const t = useMemo(() => buildLabourTable(id, db, range, today()), [db, id, range]);
  const rows = useMemo(() => {
    let r = t.rows.filter(row => !q.trim() || row.join(' ').toLowerCase().includes(q.trim().toLowerCase()));
    if (sort) r = [...r].sort((a, b) => { const x = a[sort.col], y = b[sort.col]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir; });
    return r;
  }, [t, q, sort]);
  const shown = { ...t, rows, totals: q.trim() ? undefined : t.totals };
  const title = tableTitle(id);
  const html = () => `<div class="vch"><div class="c"><h1>${esc(db.settings.millName)}</h1><div class="muted">${esc(title)} · ${esc(rangeText(range))}</div></div>
    <table><tr>${t.columns.map(c => `<th${c.kind === 'inr' || c.kind === 'qtl' || c.kind === 'num' ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('')}</tr>
    ${rows.map(r => `<tr>${r.map((v, j) => `<td${['inr', 'qtl', 'num'].includes(t.columns[j]?.kind || '') ? ' class="r"' : ''}>${esc(formatCell(v, t.columns[j]?.kind))}</td>`).join('')}</tr>`).join('')}
    ${shown.totals ? `<tr class="tot">${shown.totals.map((v, j) => `<td${['inr', 'qtl', 'num'].includes(t.columns[j]?.kind || '') ? ' class="r"' : ''}>${esc(typeof v === 'number' ? formatCell(v, t.columns[j]?.kind) : v)}</td>`).join('')}</tr>` : ''}</table></div>`;
  const csv = async () => {
    if (rows.length === 0) { toast('Nothing to export', 'error'); return; }
    try {
      const r = await saveFile(`${title.replace(/[^\w]+/g, '_')}_${range.start || 'start'}_to_${range.end || 'latest'}.csv`, 'text/csv', new Blob([toCsv(shown)], { type: 'text/csv;charset=utf-8' }));
      if (r !== 'cancelled') toast('CSV saved');
    } catch (e: any) { toast(`Could not save the CSV: ${e?.message || e}`, 'error'); }
  };
  const align = (k?: string) => (k === 'inr' || k === 'qtl' || k === 'num' ? 'text-right' : 'text-left');
  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Input label="From" type="date" value={range.start} onChange={e => { setPreset(''); setRange(r => ({ ...r, start: e.target.value })); }} />
          <Input label="To" type="date" value={range.end} onChange={e => { setPreset(''); setRange(r => ({ ...r, end: e.target.value })); }} />
        </div>
        <div className="flex gap-1.5 flex-wrap">{PRESETS.map(p => <button key={p.id} onClick={() => { setPreset(p.id); setRange(p.get()); }}
          className={cn('px-3 py-1 text-xs rounded-full font-semibold', preset === p.id ? 'bg-forest-700 text-white' : 'bg-white border border-gray-200 text-forest-800')}>{p.label}</button>)}</div>
      </Card>
      <div className="grid grid-cols-2 gap-2">
        {LABOUR_REPORTS.map(r => (
          <button key={r.id} onClick={() => { setId(r.id); setSort(null); }} aria-pressed={id === r.id}
            className={cn('text-left rounded-2xl border p-2.5 bg-white', id === r.id ? 'border-forest-500 bg-forest-50 ring-2 ring-forest-200' : 'border-gray-200')}>
            <div className="text-[13px] font-bold leading-tight">{r.title}</div><div className="text-[10px] text-gray-500 leading-tight mt-0.5">{r.sub}</div>
          </button>
        ))}
      </div>
      <SearchBar value={q} onChange={setQ} placeholder="Search in this report…" />
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={csv}>⬇ CSV</Button>
        <Button variant="secondary" className="flex-1" onClick={() => sharePdfWithToast(`${title} ${range.start}`, html(), `${db.settings.millName}\n${title} · ${rangeText(range)}`)}>Share PDF</Button>
        <Button variant="gold" className="flex-1" onClick={() => savePdfWithToast(`${title} ${range.start}`, html())}>Print / PDF</Button>
      </div>
      <Card>
        <div className="bg-gradient-to-br from-forest-900 to-forest-700 text-white px-4 py-3"><div className="font-extrabold">{title}</div><div className="text-[11px] text-forest-100">{rangeText(range)}</div></div>
        {rows.length === 0 ? <EmptyState title="No records for these dates" /> : (
          <div className="overflow-x-auto"><table className="w-full text-xs min-w-max">
            <thead><tr>{t.columns.map((c, i) => (
              <th key={c.label} onClick={() => setSort(s => ({ col: i, dir: s && s.col === i && s.dir === 1 ? -1 : 1 }))}
                className={cn('px-2 py-2 font-bold text-[10px] uppercase tracking-wide text-forest-700 bg-forest-50 whitespace-nowrap cursor-pointer select-none', align(c.kind))}>{c.label}{sort?.col === i ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>))}</tr></thead>
            <tbody>
              {rows.map((r, i) => <tr key={i} className="border-b border-gray-100">{r.map((v, j) => <td key={j} className={cn('px-2 py-1.5 whitespace-nowrap', align(t.columns[j]?.kind))}>{formatCell(v, t.columns[j]?.kind)}</td>)}</tr>)}
              {shown.totals && <tr className="bg-forest-50 font-bold">{shown.totals.map((v, j) => <td key={j} className={cn('px-2 py-2 whitespace-nowrap', align(t.columns[j]?.kind))}>{typeof v === 'number' ? formatCell(v, t.columns[j]?.kind) : v}</td>)}</tr>}
            </tbody></table></div>
        )}
      </Card>
    </div>
  );
}
