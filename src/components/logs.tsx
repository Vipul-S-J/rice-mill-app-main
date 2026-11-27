import { useMemo, useState } from 'react';
import { useDB } from '../context';
import { Card, EmptyState, SearchBar, Select } from './ui';

const ACTION_STYLE: Record<string, string> = {
  create: 'bg-green-50 text-green-700', edit: 'bg-blue-50 text-blue-700', delete: 'bg-red-50 text-red-700',
  payment: 'bg-amber-50 text-amber-800', backup: 'bg-violet-50 text-violet-700', restore: 'bg-violet-50 text-violet-700',
  settings: 'bg-gray-100 text-gray-700', import: 'bg-sky-50 text-sky-700', adjustment: 'bg-orange-50 text-orange-700',
};

/** Activity log (moved here from the Home page). Newest first. */
export function LogsPage() {
  const { db } = useDB();
  const [search, setSearch] = useState('');
  const [module, setModule] = useState('all');
  const [action, setAction] = useState('all');
  const [limit, setLimit] = useState(50);
  const modules = useMemo(() => [...new Set(db.auditLog.map(l => l.module))].sort(), [db.auditLog]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return db.auditLog.filter(l =>
      (module === 'all' || l.module === module) && (action === 'all' || l.action === action) &&
      (!q || l.description.toLowerCase().includes(q) || l.module.toLowerCase().includes(q)));
  }, [db.auditLog, search, module, action]);
  return (
    <div className="p-3 space-y-3 pb-6">
      <SearchBar value={search} onChange={setSearch} placeholder="Search the activity log…" />
      <div className="grid grid-cols-2 gap-2">
        <Select value={module} onChange={e => setModule(e.target.value)} options={[{ value: 'all', label: 'All modules' }, ...modules.map(m => ({ value: m, label: m }))]} />
        <Select value={action} onChange={e => setAction(e.target.value)} options={[{ value: 'all', label: 'All actions' }, ...Object.keys(ACTION_STYLE).map(a => ({ value: a, label: a[0].toUpperCase() + a.slice(1) }))]} />
      </div>
      <Card>
        {list.length === 0 ? <EmptyState title="No activity found" subtitle="Entries appear here as you add, edit or delete records." /> : list.slice(0, limit).map(l => (
          <div key={l.id} className="flex items-start gap-3 px-3 py-2.5 border-b border-gray-100 last:border-0">
            <span className={`mt-0.5 shrink-0 text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${ACTION_STYLE[l.action] || 'bg-gray-100 text-gray-700'}`}>{l.action}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-gray-800 break-words">{l.description}</div>
              <div className="text-[10px] text-gray-400">{l.module} · {new Date(l.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
        ))}
      </Card>
      {list.length > limit && <button onClick={() => setLimit(l => l + 50)} className="w-full text-xs font-semibold text-forest-700 py-2">Show more ({list.length - limit} older)</button>}
    </div>
  );
}
