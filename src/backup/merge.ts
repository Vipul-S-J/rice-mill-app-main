import type { Database } from '../types';
import { COLLECTIONS } from './format';

export interface MergeResult { db: Database; added: Record<string, number>; conflicts: number; partiesMatched: number }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Brings records from `inc` into a copy of `cur`. Existing records are never overwritten: a record with the same id
 * is kept as is (and counted as a conflict if it differs). Parties with the same name are treated as the same person.
 */
export function mergeDatabases(cur: Database, inc: Database): MergeResult {
  const db: Database = JSON.parse(JSON.stringify(cur));
  const src: Database = JSON.parse(JSON.stringify(inc));
  const added: Record<string, number> = {};
  let conflicts = 0, partiesMatched = 0;
  const bump = (k: string) => { added[k] = (added[k] || 0) + 1; };

  // parties: same id, else same name -> same person
  const partyMap = new Map<string, string>();
  for (const p of src.parties || []) {
    const byId = db.parties.find(x => x.id === p.id);
    const byName = byId || db.parties.find(x => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    if (byName) {
      partyMap.set(p.id, byName.id);
      if (byName.id !== p.id) partiesMatched++;
      for (const t of p.types) if (!byName.types.includes(t)) byName.types.push(t);
      if (!byName.phone && p.phone) byName.phone = p.phone;
      if (byId && !same(byId, p)) conflicts++;
    } else { db.parties.push(p); partyMap.set(p.id, p.id); bump('parties'); }
  }
  // dropdown masters: match by name, remember id changes
  const idMap = new Map<string, string>();
  const mergeMaster = <T extends { id: string; name: string }>(have: T[], extra: T[] | undefined, sameKind: (a: T, b: T) => boolean, key: string) => {
    for (const it of extra || []) {
      const hit = have.find(x => x.id === it.id) || have.find(x => x.name.trim().toLowerCase() === it.name.trim().toLowerCase() && sameKind(x, it));
      if (hit) idMap.set(it.id, hit.id); else { have.push(it); idMap.set(it.id, it.id); bump(key); }
    }
  };
  mergeMaster(db.varieties, src.varieties, (a, b) => JSON.stringify(a.usage) === JSON.stringify(b.usage), 'varieties');
  mergeMaster(db.categories, src.categories, (a, b) => a.type === b.type, 'categories');
  mergeMaster(db.tradingItems, src.tradingItems, () => true, 'tradingItems');
  const m = (id?: string) => (id && idMap.get(id)) || id;
  const pm = (id?: string) => (id && partyMap.get(id)) || id;

  const fix = (key: string, e: any) => {
    if ('partyId' in e) e.partyId = pm(e.partyId);
    if ('workerPartyId' in e) e.workerPartyId = pm(e.workerPartyId);
    if ('workerId' in e) e.workerId = pm(e.workerId);
    if ('varietyId' in e) e.varietyId = m(e.varietyId);
    if ('categoryId' in e) e.categoryId = m(e.categoryId);
    if ('productId' in e) e.productId = m(e.productId);
    if ('itemId' in e) e.itemId = m(e.itemId);
    if ('paddyVarietyId' in e) e.paddyVarietyId = m(e.paddyVarietyId);
    if (key === 'purchases') for (const l of e.lines || []) l.varietyId = m(l.varietyId);
    if (key === 'sales') for (const l of e.lines || []) l.varietyId = m(l.varietyId);
    if (key === 'production') { for (const i of e.inputs || []) i.varietyId = m(i.varietyId); if (e.outputs) e.outputs.riceVarietyId = m(e.outputs.riceVarietyId); }
    if (key === 'dispatches') for (const a of e.paddy?.allocations || []) a.varietyId = m(a.varietyId);
    return e;
  };
  for (const { key } of COLLECTIONS) {
    if (key === 'parties') continue;
    const have = ((db as any)[key] ||= []) as any[];
    const ids = new Map(have.map(e => [e.id, e]));
    for (const e of ((src as any)[key] || []) as any[]) {
      const x = fix(key, e);
      const ex = ids.get(x.id);
      if (!ex) { have.unshift(x); ids.set(x.id, x); bump(key); }
      else if (!same(ex, x)) conflicts++;
    }
  }
  const logIds = new Set(db.auditLog.map(l => l.id));
  for (const l of src.auditLog || []) if (!logIds.has(l.id)) db.auditLog.push(l);
  db.auditLog.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (db.auditLog.length > 2000) db.auditLog.length = 2000;
  return { db, added, conflicts, partiesMatched };
}
