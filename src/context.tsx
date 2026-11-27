import React, { createContext, useContext, useEffect, useMemo, useReducer, useCallback } from 'react';
import type {
  Database, Party, HullingEntry, PurchaseEntry, ProductionBatch,
  DispatchEntry, SaleEntry, ExpenseEntry, LabourEntry, ElectricityBill,
  StockAdjustment, CashbookEntry, Settings, Variety, Category, Payment, BagMovement, PartyType,
  TradingItem, TradingEntry, WorkRecord, Advance, PayrollEntry, AttendanceStatus
} from './types';
import { loadDB, saveDB, uid, now, nextReceipt, incrementNext, log as logAudit, round2, computeStock, nextTripNo, extraPaidMap } from './db';
import { toast } from './components/ui';
import { mergeDatabases } from './backup/merge';
import { inspectBackup } from './backup/format';

/** Finds a party by typed name (case-insensitive) or creates it - mutates the draft db inside one update. */
function resolveParty(db: Database, name: string, type: PartyType): string {
  const t = (name || '').trim();
  if (!t) return '';
  const p = db.parties.find(x => x.name.trim().toLowerCase() === t.toLowerCase());
  if (p) {
    if (!p.types.includes(type)) { p.types.push(type); p.updatedAt = now(); }
    return p.id;
  }
  const id = uid();
  db.parties.push({
    id, name: t, types: [type], openingBalance: 0, active: true, createdAt: now(), updatedAt: now(),
  });
  return id;
}

/** Cashbook line for a Trading payment: money received on a sale, money paid on a purchase. */
function tradeCash(db: Database, t: TradingEntry, p: Payment) {
  db.cashbook.unshift({
    id: uid(), date: p.date, type: t.kind === 'sell' ? 'receipt' : 'payment', mode: p.mode, amount: p.amount,
    description: `Trading ${t.kind === 'sell' ? 'sale' : 'purchase'}: ${t.itemName} payment`, linkedModule: 'Trading', linkedEntryId: t.id,
    partyId: t.partyId, createdAt: now(),
  });
}

export interface AttendanceInput { id?: string; date: string; workerId: string; status: AttendanceStatus; hours?: number; overtimeHours?: number; notes?: string }

/** Cashbook lines for staff money: advances and salary payments. Re-created from the record each time, so they never duplicate. */
function syncStaffCash(db: Database, module: 'Advance' | 'Payroll', entryId: string, workerId: string, lines: { date: string; mode: string; amount: number; text: string }[]) {
  db.cashbook = db.cashbook.filter(c => !(c.linkedModule === module && c.linkedEntryId === entryId));
  for (const l of lines) {
    db.cashbook.unshift({ id: uid(), date: l.date, type: 'payment', mode: l.mode, amount: l.amount, description: l.text, linkedModule: module, linkedEntryId: entryId, partyId: workerId, createdAt: now() });
  }
}
const workerName = (db: Database, id: string) => db.parties.find(p => p.id === id)?.name || 'worker';

const normPayments = (ps: Payment[] | undefined): Payment[] =>
  (ps || []).map(p => ({ ...p, id: p.id || uid(), createdAt: p.createdAt || now() }));

type Action =
  | { type: 'set'; db: Database }
  | { type: 'update'; updater: (db: Database) => void };

function reducer(state: Database, action: Action): Database {
  switch (action.type) {
    case 'set':
      return action.db;
    case 'update': {
      const copy = JSON.parse(JSON.stringify(state)) as Database;
      action.updater(copy);
      // any entry that now has more paid than its total is written to the log (once per change)
      const before = extraPaidMap(state), after = extraPaidMap(copy);
      for (const [id, a] of Object.entries(after)) {
        if (a.extra !== (before[id]?.extra || 0)) logAudit(copy, 'payment', a.module, `${a.ref}: ₹${a.extra} extra paid (paid more than the total)`, id, { extra: a.extra });
      }
      return copy;
    }
    default:
      return state;
  }
}

interface Ctx {
  db: Database;
  stock: ReturnType<typeof computeStock>;
  // Parties
  upsertParty: (p: Partial<Party> & { name: string; types: Party['types'] }) => string;
  deleteParty: (id: string) => void;
  // Hulling
  addHulling: (entry: Omit<HullingEntry, 'id' | 'createdAt' | 'updatedAt' | 'receiptNumber'>) => string;
  updateHulling: (id: string, entry: Partial<HullingEntry>) => void;
  deleteHulling: (id: string) => void;
  addHullingPayment: (id: string, payment: Omit<Payment, 'id' | 'createdAt'>) => void;
  // Purchase
  addPurchase: (entry: Omit<PurchaseEntry, 'id' | 'createdAt' | 'updatedAt' | 'voucherNumber'>) => string;
  updatePurchase: (id: string, entry: Partial<PurchaseEntry>) => void;
  deletePurchase: (id: string) => void;
  addPurchasePayment: (id: string, payment: Omit<Payment, 'id' | 'createdAt'>) => void;
  addPurchaseBagReturn: (id: string, bm: Omit<BagMovement, 'id' | 'createdAt'>) => void;
  // Production
  addProduction: (entry: Omit<ProductionBatch, 'id' | 'createdAt' | 'updatedAt' | 'batchNumber'>) => string;
  updateProduction: (id: string, entry: Partial<ProductionBatch>) => void;
  deleteProduction: (id: string) => void;
  // Dispatch
  addDispatch: (entry: Omit<DispatchEntry, 'id' | 'createdAt' | 'updatedAt' | 'dispatchNumber'>) => string;
  updateDispatch: (id: string, entry: Partial<DispatchEntry>) => void;
  deleteDispatch: (id: string) => void;
  addDispatchPayment: (id: string, payment: Omit<Payment, 'id' | 'createdAt'>) => void;
  // Sales
  addSale: (entry: Omit<SaleEntry, 'id' | 'createdAt' | 'updatedAt' | 'invoiceNumber'>) => string;
  updateSale: (id: string, entry: Partial<SaleEntry>) => void;
  deleteSale: (id: string) => void;
  addSalePayment: (id: string, payment: Omit<Payment, 'id' | 'createdAt'>) => void;
  // Expenses
  addExpense: (entry: Omit<ExpenseEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateExpense: (id: string, entry: Partial<ExpenseEntry>) => void;
  deleteExpense: (id: string) => void;
  addExpensePayment: (id: string, payment: Omit<Payment, 'id' | 'createdAt'>) => void;
  // Labour
  addLabour: (entry: Omit<LabourEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateLabour: (id: string, entry: Partial<LabourEntry>) => void;
  deleteLabour: (id: string) => void;
  addLabourPayment: (id: string, payment: Omit<Payment, 'id' | 'createdAt'>) => void;
  // Electricity
  addElectricity: (entry: Omit<ElectricityBill, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateElectricity: (id: string, entry: Partial<ElectricityBill>) => void;
  deleteElectricity: (id: string) => void;
  addElectricityPayment: (id: string, payment: Omit<Payment, 'id' | 'createdAt'>) => void;
  // Stock adjustments
  addStockAdjustment: (sa: Omit<StockAdjustment, 'id' | 'createdAt'>) => void;
  // Cashbook
  addCashbook: (c: Omit<CashbookEntry, 'id' | 'createdAt'>) => void;
  // Settings
  updateSettings: (s: Partial<Settings>) => void;
  upsertVariety: (v: Partial<Variety> & { name: string }) => void;
  deleteVariety: (id: string) => void;
  upsertCategory: (c: Partial<Category> & { name: string; type: Category['type'] }) => void;
  deleteCategory: (id: string) => void;
  /** how many saved records still reference this dropdown value */
  varietyUsage: (id: string) => number;
  categoryUsage: (id: string) => number;
  /** permanently remove a dropdown value (only safe when usage is 0) */
  removeVariety: (id: string) => void;
  removeCategory: (id: string) => void;
  // Trading goods
  upsertTradingItem: (t: Partial<TradingItem> & { name: string }) => string;
  hideTradingItem: (id: string) => void;
  removeTradingItem: (id: string) => void;
  tradingItemUsage: (id: string) => number;
  addTrading: (e: Omit<TradingEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTrading: (id: string, e: Partial<TradingEntry>) => void;
  deleteTrading: (id: string) => void;
  addTradingPayment: (id: string, payment: Omit<Payment, 'id' | 'createdAt'>) => void;
  // Staff
  saveAttendance: (e: AttendanceInput) => 'added' | 'updated';
  saveAttendanceBatch: (rows: AttendanceInput[]) => { added: number; updated: number };
  deleteAttendance: (id: string) => void;
  saveWorkRecord: (e: Partial<WorkRecord> & Pick<WorkRecord, 'date' | 'workerId' | 'location' | 'basis' | 'qty' | 'rate' | 'amount'>) => void;
  deleteWorkRecord: (id: string) => void;
  saveAdvance: (e: Partial<Advance> & Pick<Advance, 'date' | 'workerId' | 'amount' | 'mode'>) => void;
  deleteAdvance: (id: string) => void;
  savePayroll: (e: Partial<PayrollEntry> & Pick<PayrollEntry, 'workerId' | 'month'>) => string;
  setPayrollStatus: (id: string, status: 'draft' | 'final') => void;
  deletePayroll: (id: string) => void;
  addPayrollPayment: (id: string, payment: Omit<Payment, 'id' | 'createdAt'>) => void;
  removePayrollPayment: (id: string, paymentId: string) => void;
  // Backup
  backup: () => string;
  restore: (json: string, mode: 'merge' | 'replace') => { count: number };
  restoreFrom: (incoming: Database, mode: 'merge' | 'replace') => { added: Record<string, number>; conflicts: number };
  resetAll: () => void;
  // Bulk
  bulkImport: (module: string, rows: any[]) => { added: number; errors: string[] };
  addHullingBatch: (items: { customerName: string; entry: Omit<HullingEntry, 'id' | 'createdAt' | 'updatedAt' | 'receiptNumber' | 'partyId'> }[]) => number;
  addPurchaseBatch: (items: { customerName: string; entry: Omit<PurchaseEntry, 'id' | 'createdAt' | 'updatedAt' | 'voucherNumber' | 'partyId'> }[]) => number;
}

const DBContext = createContext<Ctx | null>(null);

export function DBProvider({ children }: { children: React.ReactNode }) {
  const [db, dispatch] = useReducer(reducer, undefined as any, () => loadDB());
  const stock = useMemo(() => computeStock(db), [db]);

  // Persist (warn the owner if the device storage is full - never fail silently)
  useEffect(() => {
    if (!saveDB(db)) {
      toast('Storage full! Download a backup now and remove old bill photos.', 'error');
    }
  }, [db]);

  const update = useCallback((updater: (db: Database) => void) => {
    dispatch({ type: 'update', updater });
  }, []);

  // ======== PARTIES ========
  const upsertParty: Ctx['upsertParty'] = (p) => {
    // id must be created BEFORE the (deferred) state update so callers get a real id back
    const newId = p.id || uid();
    update(db => {
      if (p.id) {
        const ex = db.parties.find(x => x.id === p.id);
        if (ex) Object.assign(ex, p, { updatedAt: now() });
        logAudit(db, 'edit', 'Parties', `Updated party: ${p.name}`, p.id);
      } else {
        db.parties.push({
          id: newId,
          name: p.name,
          types: p.types,
          phone: p.phone,
          village: p.village,
          address: p.address,
          openingBalance: round2(p.openingBalance || 0),
          notes: p.notes,
          staff: p.staff,
          active: p.active ?? true,
          createdAt: now(),
          updatedAt: now(),
        });
        logAudit(db, 'create', 'Parties', `Created party: ${p.name}`, newId);
      }
    });
    return newId;
  };

  const deleteParty: Ctx['deleteParty'] = (id) => {
    update(db => {
      const p = db.parties.find(x => x.id === id);
      db.parties = db.parties.filter(x => x.id !== id);
      logAudit(db, 'delete', 'Parties', `Deleted party: ${p?.name || id}`, id);
    });
  };

  // ======== HULLING ========
  const addHulling: Ctx['addHulling'] = (e) => {
    let newId = '';
    update(db => {
      newId = uid();
      const rcpt = nextReceipt(db, 'hulling', db.settings.invoicePrefixes.hulling);
      incrementNext(db, 'hulling');
      db.hulling.unshift({
        ...e,
        id: newId,
        receiptNumber: rcpt,
        payments: e.payments || [],
        createdAt: now(),
        updatedAt: now(),
      } as HullingEntry);
      // Auto-create cashbook entries for payments
      for (const p of e.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'receipt', mode: p.mode, amount: p.amount,
          description: `Hulling #${rcpt} payment`, linkedModule: 'Hulling', linkedEntryId: newId,
          partyId: e.partyId, createdAt: now(),
        });
      }
      logAudit(db, 'create', 'Hulling', `Created hulling receipt ${rcpt}`, newId);
    });
    return newId;
  };
  const updateHulling: Ctx['updateHulling'] = (id, e) => {
    update(db => {
      const ex = db.hulling.find(x => x.id === id);
      if (!ex) return;
      // Remove existing payment cashbook entries and re-add
      const oldPaymentIds = new Set(ex.payments.map(p => p.id));
      db.cashbook = db.cashbook.filter(c => !(c.linkedEntryId === id && c.linkedModule === 'Hulling'));
      Object.assign(ex, e, { updatedAt: now() });
      for (const p of ex.payments) {
        if (!oldPaymentIds.has(p.id) || true) {
          db.cashbook.unshift({
            id: uid(), date: p.date, type: 'receipt', mode: p.mode, amount: p.amount,
            description: `Hulling #${ex.receiptNumber} payment`, linkedModule: 'Hulling', linkedEntryId: id,
            partyId: ex.partyId, createdAt: now(),
          });
        }
      }
      logAudit(db, 'edit', 'Hulling', `Updated hulling ${ex.receiptNumber}`, id);
    });
  };
  const deleteHulling: Ctx['deleteHulling'] = (id) => {
    update(db => {
      const ex = db.hulling.find(x => x.id === id);
      db.hulling = db.hulling.filter(x => x.id !== id);
      db.cashbook = db.cashbook.filter(c => c.linkedEntryId !== id);
      logAudit(db, 'delete', 'Hulling', `Deleted hulling ${ex?.receiptNumber}`, id);
    });
  };
  const addHullingPayment: Ctx['addHullingPayment'] = (id, payment) => {
    update(db => {
      const ex = db.hulling.find(x => x.id === id);
      if (!ex) return;
      const pid = uid();
      ex.payments.push({ ...payment, id: pid, createdAt: now() });
      ex.updatedAt = now();
      db.cashbook.unshift({
        id: uid(), date: payment.date, type: 'receipt', mode: payment.mode, amount: payment.amount,
        description: `Hulling #${ex.receiptNumber} payment`, linkedModule: 'Hulling', linkedEntryId: id,
        partyId: ex.partyId, createdAt: now(),
      });
      logAudit(db, 'payment', 'Hulling', `Added payment to ${ex.receiptNumber}`, id, { amount: payment.amount });
    });
  };

  // ======== PURCHASE ========
  const addPurchase: Ctx['addPurchase'] = (e) => {
    let newId = '';
    update(db => {
      newId = uid();
      const vnum = nextReceipt(db, 'purchase', db.settings.invoicePrefixes.purchase);
      incrementNext(db, 'purchase');
      db.purchases.unshift({
        ...e,
        id: newId,
        voucherNumber: vnum,
        payments: e.payments || [],
        bagMovements: e.bagMovements || [],
        createdAt: now(),
        updatedAt: now(),
      } as PurchaseEntry);
      for (const p of e.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'payment', mode: p.mode, amount: p.amount,
          description: `Purchase #${vnum} payment`, linkedModule: 'Purchase', linkedEntryId: newId,
          partyId: e.partyId, createdAt: now(),
        });
      }
      logAudit(db, 'create', 'Purchase', `Created purchase ${vnum}`, newId);
    });
    return newId;
  };
  const updatePurchase: Ctx['updatePurchase'] = (id, e) => {
    update(db => {
      const ex = db.purchases.find(x => x.id === id);
      if (!ex) return;
      db.cashbook = db.cashbook.filter(c => !(c.linkedEntryId === id && c.linkedModule === 'Purchase'));
      Object.assign(ex, e, { updatedAt: now() });
      for (const p of ex.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'payment', mode: p.mode, amount: p.amount,
          description: `Purchase #${ex.voucherNumber} payment`, linkedModule: 'Purchase', linkedEntryId: id,
          partyId: ex.partyId, createdAt: now(),
        });
      }
      logAudit(db, 'edit', 'Purchase', `Updated purchase ${ex.voucherNumber}`, id);
    });
  };
  const deletePurchase: Ctx['deletePurchase'] = (id) => {
    update(db => {
      const ex = db.purchases.find(x => x.id === id);
      db.purchases = db.purchases.filter(x => x.id !== id);
      db.cashbook = db.cashbook.filter(c => c.linkedEntryId !== id);
      logAudit(db, 'delete', 'Purchase', `Deleted purchase ${ex?.voucherNumber}`, id);
    });
  };
  const addPurchasePayment: Ctx['addPurchasePayment'] = (id, payment) => {
    update(db => {
      const ex = db.purchases.find(x => x.id === id);
      if (!ex) return;
      ex.payments.push({ ...payment, id: uid(), createdAt: now() });
      ex.updatedAt = now();
      db.cashbook.unshift({
        id: uid(), date: payment.date, type: 'payment', mode: payment.mode, amount: payment.amount,
        description: `Purchase #${ex.voucherNumber} payment`, linkedModule: 'Purchase', linkedEntryId: id,
        partyId: ex.partyId, createdAt: now(),
      });
      logAudit(db, 'payment', 'Purchase', `Added payment to ${ex.voucherNumber}`, id, { amount: payment.amount });
    });
  };
  const addPurchaseBagReturn: Ctx['addPurchaseBagReturn'] = (id, bm) => {
    update(db => {
      const ex = db.purchases.find(x => x.id === id);
      if (!ex) return;
      ex.bagMovements.push({ ...bm, id: uid(), createdAt: now() });
      ex.updatedAt = now();
      logAudit(db, 'edit', 'Purchase', `Added bag return to ${ex.voucherNumber}`, id);
    });
  };

  // ======== PRODUCTION ========
  const addProduction: Ctx['addProduction'] = (e) => {
    let newId = '';
    update(db => {
      newId = uid();
      const bnum = nextReceipt(db, 'batch', db.settings.invoicePrefixes.batch);
      incrementNext(db, 'batch');
      db.production.unshift({
        ...e,
        id: newId,
        batchNumber: bnum,
        createdAt: now(),
        updatedAt: now(),
      } as ProductionBatch);
      logAudit(db, 'create', 'Production', `Created batch ${bnum}`, newId);
    });
    return newId;
  };
  const updateProduction: Ctx['updateProduction'] = (id, e) => {
    update(db => {
      const ex = db.production.find(x => x.id === id);
      if (ex) Object.assign(ex, e, { updatedAt: now() });
      logAudit(db, 'edit', 'Production', `Updated batch ${ex?.batchNumber}`, id);
    });
  };
  const deleteProduction: Ctx['deleteProduction'] = (id) => {
    update(db => {
      const ex = db.production.find(x => x.id === id);
      db.production = db.production.filter(x => x.id !== id);
      logAudit(db, 'delete', 'Production', `Deleted batch ${ex?.batchNumber}`, id);
    });
  };

  // ======== DISPATCH ========
  const addDispatch: Ctx['addDispatch'] = (e) => {
    let newId = '';
    update(db => {
      newId = uid();
      const dnum = nextReceipt(db, 'dispatch', db.settings.invoicePrefixes.dispatch);
      incrementNext(db, 'dispatch');
      db.dispatches.unshift({
        ...e,
        id: newId,
        dispatchNumber: dnum,
        tripNumber: (e as any).tripNumber || nextTripNo(db.dispatches),
        payments: e.payments || [],
        createdAt: now(),
        updatedAt: now(),
      } as DispatchEntry);
      for (const p of e.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'receipt', mode: p.mode, amount: p.amount,
          description: `Dispatch #${dnum} payment`, linkedModule: 'Dispatch', linkedEntryId: newId,
          partyId: e.partyId, createdAt: now(),
        });
      }
      logAudit(db, 'create', 'Dispatch', `Created dispatch ${dnum}`, newId);
    });
    return newId;
  };
  const updateDispatch: Ctx['updateDispatch'] = (id, e) => {
    update(db => {
      const ex = db.dispatches.find(x => x.id === id);
      if (!ex) return;
      db.cashbook = db.cashbook.filter(c => !(c.linkedEntryId === id && c.linkedModule === 'Dispatch'));
      Object.assign(ex, e, { updatedAt: now() });
      for (const p of ex.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'receipt', mode: p.mode, amount: p.amount,
          description: `Dispatch #${ex.dispatchNumber} payment`, linkedModule: 'Dispatch', linkedEntryId: id,
          partyId: ex.partyId, createdAt: now(),
        });
      }
      logAudit(db, 'edit', 'Dispatch', `Updated dispatch ${ex.dispatchNumber}`, id);
    });
  };
  const deleteDispatch: Ctx['deleteDispatch'] = (id) => {
    update(db => {
      const ex = db.dispatches.find(x => x.id === id);
      db.dispatches = db.dispatches.filter(x => x.id !== id);
      db.cashbook = db.cashbook.filter(c => c.linkedEntryId !== id);
      logAudit(db, 'delete', 'Dispatch', `Deleted dispatch ${ex?.dispatchNumber}`, id);
    });
  };
  const addDispatchPayment: Ctx['addDispatchPayment'] = (id, payment) => {
    update(db => {
      const ex = db.dispatches.find(x => x.id === id);
      if (!ex) return;
      ex.payments.push({ ...payment, id: uid(), createdAt: now() });
      ex.updatedAt = now();
      db.cashbook.unshift({
        id: uid(), date: payment.date, type: 'receipt', mode: payment.mode, amount: payment.amount,
        description: `Dispatch #${ex.dispatchNumber} payment`, linkedModule: 'Dispatch', linkedEntryId: id,
        partyId: ex.partyId, createdAt: now(),
      });
      logAudit(db, 'payment', 'Dispatch', `Added payment to ${ex.dispatchNumber}`, id);
    });
  };

  // ======== SALES ========
  const addSale: Ctx['addSale'] = (e) => {
    let newId = '';
    update(db => {
      newId = uid();
      const inv = nextReceipt(db, 'sale', db.settings.invoicePrefixes.sale);
      incrementNext(db, 'sale');
      db.sales.unshift({
        ...e,
        id: newId,
        invoiceNumber: inv,
        payments: e.payments || [],
        createdAt: now(),
        updatedAt: now(),
      } as SaleEntry);
      for (const p of e.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'receipt', mode: p.mode, amount: p.amount,
          description: `Sale #${inv} payment`, linkedModule: 'Sale', linkedEntryId: newId,
          partyId: e.partyId, createdAt: now(),
        });
      }
      logAudit(db, 'create', 'Sales', `Created sale ${inv}`, newId);
    });
    return newId;
  };
  const updateSale: Ctx['updateSale'] = (id, e) => {
    update(db => {
      const ex = db.sales.find(x => x.id === id);
      if (!ex) return;
      db.cashbook = db.cashbook.filter(c => !(c.linkedEntryId === id && c.linkedModule === 'Sale'));
      Object.assign(ex, e, { updatedAt: now() });
      for (const p of ex.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'receipt', mode: p.mode, amount: p.amount,
          description: `Sale #${ex.invoiceNumber} payment`, linkedModule: 'Sale', linkedEntryId: id,
          partyId: ex.partyId, createdAt: now(),
        });
      }
      logAudit(db, 'edit', 'Sales', `Updated sale ${ex.invoiceNumber}`, id);
    });
  };
  const deleteSale: Ctx['deleteSale'] = (id) => {
    update(db => {
      const ex = db.sales.find(x => x.id === id);
      db.sales = db.sales.filter(x => x.id !== id);
      db.cashbook = db.cashbook.filter(c => c.linkedEntryId !== id);
      logAudit(db, 'delete', 'Sales', `Deleted sale ${ex?.invoiceNumber}`, id);
    });
  };
  const addSalePayment: Ctx['addSalePayment'] = (id, payment) => {
    update(db => {
      const ex = db.sales.find(x => x.id === id);
      if (!ex) return;
      ex.payments.push({ ...payment, id: uid(), createdAt: now() });
      ex.updatedAt = now();
      db.cashbook.unshift({
        id: uid(), date: payment.date, type: 'receipt', mode: payment.mode, amount: payment.amount,
        description: `Sale #${ex.invoiceNumber} payment`, linkedModule: 'Sale', linkedEntryId: id,
        partyId: ex.partyId, createdAt: now(),
      });
      logAudit(db, 'payment', 'Sales', `Added payment to ${ex.invoiceNumber}`, id);
    });
  };

  // ======== EXPENSES ========
  const addExpense: Ctx['addExpense'] = (e) => {
    let newId = '';
    update(db => {
      newId = uid();
      db.expenses.unshift({
        ...e,
        id: newId,
        payments: e.payments || [],
        createdAt: now(),
        updatedAt: now(),
      } as ExpenseEntry);
      for (const p of e.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'payment', mode: p.mode, amount: p.amount,
          description: `Expense: ${e.payee || e.categoryId}`, linkedModule: 'Expense', linkedEntryId: newId,
          partyId: e.partyId, createdAt: now(),
        });
      }
      logAudit(db, 'create', 'Expenses', `Created expense ${newId}`, newId);
    });
    return newId;
  };
  const updateExpense: Ctx['updateExpense'] = (id, e) => {
    update(db => {
      const ex = db.expenses.find(x => x.id === id);
      if (!ex) return;
      db.cashbook = db.cashbook.filter(c => !(c.linkedEntryId === id && c.linkedModule === 'Expense'));
      Object.assign(ex, e, { updatedAt: now() });
      for (const p of ex.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'payment', mode: p.mode, amount: p.amount,
          description: `Expense: ${ex.payee || ex.categoryId}`, linkedModule: 'Expense', linkedEntryId: id,
          partyId: ex.partyId, createdAt: now(),
        });
      }
      logAudit(db, 'edit', 'Expenses', `Updated expense`, id);
    });
  };
  const deleteExpense: Ctx['deleteExpense'] = (id) => {
    update(db => {
      db.expenses = db.expenses.filter(x => x.id !== id);
      db.cashbook = db.cashbook.filter(c => c.linkedEntryId !== id);
      logAudit(db, 'delete', 'Expenses', `Deleted expense`, id);
    });
  };
  const addExpensePayment: Ctx['addExpensePayment'] = (id, payment) => {
    update(db => {
      const ex = db.expenses.find(x => x.id === id);
      if (!ex) return;
      ex.payments.push({ ...payment, id: uid(), createdAt: now() });
      ex.updatedAt = now();
      db.cashbook.unshift({
        id: uid(), date: payment.date, type: 'payment', mode: payment.mode, amount: payment.amount,
        description: `Expense: ${ex.payee || ex.categoryId}`, linkedModule: 'Expense', linkedEntryId: id,
        partyId: ex.partyId, createdAt: now(),
      });
    });
  };

  // ======== LABOUR ========
  const addLabour: Ctx['addLabour'] = (e) => {
    let newId = '';
    update(db => {
      newId = uid();
      db.labour.unshift({ ...e, id: newId, payments: e.payments || [], createdAt: now(), updatedAt: now() });
      for (const p of e.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'payment', mode: p.mode, amount: p.amount,
          description: `Labour payment`, linkedModule: 'Labour', linkedEntryId: newId,
          partyId: e.workerPartyId, createdAt: now(),
        });
      }
      logAudit(db, 'create', 'Labour', `Created labour entry`, newId);
    });
    return newId;
  };
  const updateLabour: Ctx['updateLabour'] = (id, e) => {
    update(db => {
      const ex = db.labour.find(x => x.id === id);
      if (!ex) return;
      db.cashbook = db.cashbook.filter(c => !(c.linkedEntryId === id && c.linkedModule === 'Labour'));
      Object.assign(ex, e, { updatedAt: now() });
      for (const p of ex.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'payment', mode: p.mode, amount: p.amount,
          description: `Labour payment`, linkedModule: 'Labour', linkedEntryId: id,
          partyId: ex.workerPartyId, createdAt: now(),
        });
      }
    });
  };
  const deleteLabour: Ctx['deleteLabour'] = (id) => {
    update(db => {
      db.labour = db.labour.filter(x => x.id !== id);
      db.cashbook = db.cashbook.filter(c => c.linkedEntryId !== id);
    });
  };
  const addLabourPayment: Ctx['addLabourPayment'] = (id, payment) => {
    update(db => {
      const ex = db.labour.find(x => x.id === id);
      if (!ex) return;
      ex.payments.push({ ...payment, id: uid(), createdAt: now() });
      ex.updatedAt = now();
      db.cashbook.unshift({
        id: uid(), date: payment.date, type: 'payment', mode: payment.mode, amount: payment.amount,
        description: `Labour payment`, linkedModule: 'Labour', linkedEntryId: id,
        partyId: ex.workerPartyId, createdAt: now(),
      });
    });
  };

  // ======== ELECTRICITY ========
  const addElectricity: Ctx['addElectricity'] = (e) => {
    let newId = '';
    update(db => {
      newId = uid();
      db.electricity.unshift({ ...e, id: newId, payments: e.payments || [], createdAt: now(), updatedAt: now() });
      for (const p of e.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'payment', mode: p.mode, amount: p.amount,
          description: `Electricity bill`, linkedModule: 'Electricity', linkedEntryId: newId,
          createdAt: now(),
        });
      }
    });
    return newId;
  };
  const updateElectricity: Ctx['updateElectricity'] = (id, e) => {
    update(db => {
      const ex = db.electricity.find(x => x.id === id);
      if (!ex) return;
      db.cashbook = db.cashbook.filter(c => !(c.linkedEntryId === id && c.linkedModule === 'Electricity'));
      Object.assign(ex, e, { updatedAt: now() });
      for (const p of ex.payments) {
        db.cashbook.unshift({
          id: uid(), date: p.date, type: 'payment', mode: p.mode, amount: p.amount,
          description: `Electricity bill`, linkedModule: 'Electricity', linkedEntryId: id,
          createdAt: now(),
        });
      }
    });
  };
  const deleteElectricity: Ctx['deleteElectricity'] = (id) => {
    update(db => {
      db.electricity = db.electricity.filter(x => x.id !== id);
      db.cashbook = db.cashbook.filter(c => c.linkedEntryId !== id);
    });
  };
  const addElectricityPayment: Ctx['addElectricityPayment'] = (id, payment) => {
    update(db => {
      const ex = db.electricity.find(x => x.id === id);
      if (!ex) return;
      ex.payments.push({ ...payment, id: uid(), createdAt: now() });
      ex.updatedAt = now();
      db.cashbook.unshift({
        id: uid(), date: payment.date, type: 'payment', mode: payment.mode, amount: payment.amount,
        description: `Electricity bill`, linkedModule: 'Electricity', linkedEntryId: id,
        createdAt: now(),
      });
    });
  };

  // ======== STOCK ADJUSTMENT ========
  const addStockAdjustment: Ctx['addStockAdjustment'] = (sa) => {
    update(db => {
      db.stockAdjustments.unshift({ ...sa, id: uid(), createdAt: now() });
      logAudit(db, 'adjustment', 'Stock', `Stock adjustment: ${sa.reason}`);
    });
  };

  // ======== CASHBOOK (manual entry) ========
  const addCashbook: Ctx['addCashbook'] = (c) => {
    update(db => {
      db.cashbook.unshift({ ...c, id: uid(), createdAt: now() });
    });
  };

  // ======== SETTINGS ========
  const updateSettings: Ctx['updateSettings'] = (s) => {
    update(db => {
      Object.assign(db.settings, s);
      logAudit(db, 'settings', 'Settings', 'Updated settings');
    });
  };
  const upsertVariety: Ctx['upsertVariety'] = (v) => {
    update(db => {
      if (v.id) {
        const ex = db.varieties.find(x => x.id === v.id);
        if (ex) Object.assign(ex, v);
      } else {
        db.varieties.push({ id: uid(), name: v.name, category: v.category || 'other', usage: v.usage || ['paddy', 'rice'], active: v.active ?? true });
      }
    });
  };
  const deleteVariety: Ctx['deleteVariety'] = (id) => {
    update(db => {
      const ex = db.varieties.find(x => x.id === id);
      if (ex) ex.active = false;
    });
  };
  const upsertCategory: Ctx['upsertCategory'] = (c) => {
    update(db => {
      if (c.id) {
        const ex = db.categories.find(x => x.id === c.id);
        if (ex) Object.assign(ex, c);
      } else {
        db.categories.push({ id: uid(), name: c.name, type: c.type, active: c.active ?? true });
      }
    });
  };
  const deleteCategory: Ctx['deleteCategory'] = (id) => {
    update(db => {
      const ex = db.categories.find(x => x.id === id);
      if (ex) ex.active = false;
    });
  };
  const varietyUsage: Ctx['varietyUsage'] = (id) => {
    let n = 0;
    for (const p of db.purchases) { if (p.varietyId === id) n++; else if (p.lines?.some(l => l.varietyId === id)) n++; }
    for (const b of db.production) if (b.paddyVarietyId === id || b.outputs.riceVarietyId === id) n++;
    for (const s of db.sales) { if (s.varietyId === id) n++; else if (s.lines?.some(l => l.varietyId === id)) n++; }
    for (const d of db.dispatches) if (d.varietyId === id) n++;
    for (const a of db.stockAdjustments) if (a.varietyId === id) n++;
    return n;
  };
  const categoryUsage: Ctx['categoryUsage'] = (id) => {
    const cat = db.categories.find(c => c.id === id);
    let n = 0;
    if (!cat) return 0;
    if (cat.type === 'product') {
      n += db.sales.filter(s => s.productId === id).length;
      n += db.dispatches.filter(d => d.productId === id).length;
    } else if (cat.type === 'expense') {
      n += db.expenses.filter(e => e.categoryId === id).length;
    } else if (cat.type === 'work_type') {
      n += db.labour.filter(l => l.workType === cat.name).length;
    } else if (cat.type === 'payment_mode') {
      const used = (ps: { mode: string }[]) => ps.some(p => p.mode === cat.name);
      n += db.cashbook.filter(c => c.mode === cat.name).length;
      n += db.hulling.filter(h => used(h.payments)).length;
      n += db.purchases.filter(x => used(x.payments)).length;
      n += db.sales.filter(x => used(x.payments)).length;
      n += db.dispatches.filter(x => used(x.payments)).length;
      n += db.expenses.filter(x => used(x.payments)).length;
      n += db.labour.filter(x => used(x.payments)).length;
      n += db.electricity.filter(x => used(x.payments)).length;
    }
    return n;
  };
  const removeVariety: Ctx['removeVariety'] = (id) => {
    update(db => {
      const ex = db.varieties.find(x => x.id === id);
      db.varieties = db.varieties.filter(x => x.id !== id);
      logAudit(db, 'delete', 'Inventory', `Deleted variety: ${ex?.name || id}`, id);
    });
  };
  const removeCategory: Ctx['removeCategory'] = (id) => {
    update(db => {
      const ex = db.categories.find(x => x.id === id);
      db.categories = db.categories.filter(x => x.id !== id);
      logAudit(db, 'delete', 'Inventory', `Deleted ${ex?.type || 'value'}: ${ex?.name || id}`, id);
    });
  };

  // ======== STAFF ========
  const upsertAttendance = (db: Database, e: AttendanceInput): 'added' | 'updated' => {
    const w = db.parties.find(p => p.id === e.workerId);
    // one record per worker per date: marking the same day again edits the saved one
    const ex = db.attendance.find(a => a.workerId === e.workerId && a.date === e.date);
    const sp = w?.staff;
    if (ex) {
      Object.assign(ex, { status: e.status, hours: e.hours, overtimeHours: e.overtimeHours, notes: e.notes, updatedAt: now() });
      return 'updated';
    }
    db.attendance.push({
      id: uid(), date: e.date, workerId: e.workerId, status: e.status, hours: e.hours, overtimeHours: e.overtimeHours, notes: e.notes,
      rate: sp?.wageRate || 0, wageType: sp?.wageType || 'contract', createdAt: now(), updatedAt: now(),
    });
    return 'added';
  };
  const saveAttendance: Ctx['saveAttendance'] = (e) => {
    const exists = db.attendance.some(a => a.workerId === e.workerId && a.date === e.date);
    update(d => { upsertAttendance(d, e); logAudit(d, exists ? 'edit' : 'create', 'Attendance', `${workerName(d, e.workerId)} ${e.date}: ${e.status}`); });
    return exists ? 'updated' : 'added';
  };
  const saveAttendanceBatch: Ctx['saveAttendanceBatch'] = (rows) => {
    let added = 0, updated = 0;
    const seen = new Set<string>();
    for (const r of rows) { const k = r.workerId + r.date; if (!seen.has(k)) { seen.add(k); db.attendance.some(a => a.workerId === r.workerId && a.date === r.date) ? updated++ : added++; } }
    update(d => { for (const r of rows) upsertAttendance(d, r); logAudit(d, 'create', 'Attendance', `Marked attendance for ${rows.length} worker(s) on ${rows[0]?.date || ''}`); });
    return { added, updated };
  };
  const deleteAttendance: Ctx['deleteAttendance'] = (id) => update(d => { d.attendance = d.attendance.filter(a => a.id !== id); logAudit(d, 'delete', 'Attendance', 'Deleted an attendance record', id); });
  const saveWorkRecord: Ctx['saveWorkRecord'] = (e) => update(d => {
    const ex = e.id ? d.workRecords.find(x => x.id === e.id) : undefined;
    if (ex) Object.assign(ex, e, { updatedAt: now() });
    else d.workRecords.push({ ...e, id: uid(), createdAt: now(), updatedAt: now() } as WorkRecord);
    logAudit(d, ex ? 'edit' : 'create', 'Work records', `${workerName(d, e.workerId)}: ${e.location} work ₹${e.amount}`);
  });
  const deleteWorkRecord: Ctx['deleteWorkRecord'] = (id) => update(d => { d.workRecords = d.workRecords.filter(x => x.id !== id); logAudit(d, 'delete', 'Work records', 'Deleted a work record', id); });
  const saveAdvance: Ctx['saveAdvance'] = (e) => update(d => {
    let a = e.id ? d.advances.find(x => x.id === e.id) : undefined;
    if (a) Object.assign(a, e, { updatedAt: now() });
    else { a = { ...e, id: uid(), createdAt: now(), updatedAt: now() } as Advance; d.advances.push(a); }
    syncStaffCash(d, 'Advance', a.id, a.workerId, [{ date: a.date, mode: a.mode, amount: a.amount, text: `Advance to ${workerName(d, a.workerId)}` }]);
    logAudit(d, e.id ? 'edit' : 'create', 'Advances', `Advance ₹${a.amount} to ${workerName(d, a.workerId)}`, a.id);
  });
  const deleteAdvance: Ctx['deleteAdvance'] = (id) => update(d => {
    d.advances = d.advances.filter(x => x.id !== id);
    d.cashbook = d.cashbook.filter(c => !(c.linkedModule === 'Advance' && c.linkedEntryId === id));
    logAudit(d, 'delete', 'Advances', 'Deleted an advance', id);
  });
  const payrollCash = (d: Database, p: PayrollEntry) => syncStaffCash(d, 'Payroll', p.id, p.workerId, p.payments.map(x => ({ date: x.date, mode: x.mode, amount: x.amount, text: `Salary ${p.month} · ${workerName(d, p.workerId)}` })));
  const savePayroll: Ctx['savePayroll'] = (e) => {
    // one payroll per worker per month: an existing one is updated, never duplicated
    const id = db.payrolls.find(p => p.workerId === e.workerId && p.month === e.month)?.id || e.id || uid();
    update(d => {
      const ex = d.payrolls.find(p => p.workerId === e.workerId && p.month === e.month);
      if (ex) { if (ex.status === 'final') return; Object.assign(ex, e, { id: ex.id, payments: ex.payments, status: 'draft', updatedAt: now() }); }
      else d.payrolls.push({ payments: [], status: 'draft', ...e, id, createdAt: now(), updatedAt: now() } as PayrollEntry);
      logAudit(d, ex ? 'edit' : 'create', 'Payroll', `Payroll ${e.month} for ${workerName(d, e.workerId)}`, id);
    });
    return id;
  };
  const setPayrollStatus: Ctx['setPayrollStatus'] = (id, status) => update(d => {
    const p = d.payrolls.find(x => x.id === id);
    if (!p || p.status === status) return;
    p.status = status; p.finalizedAt = status === 'final' ? now() : undefined; p.updatedAt = now();
    logAudit(d, 'edit', 'Payroll', `${status === 'final' ? 'Finalised' : 'Reopened'} payroll ${p.month} for ${workerName(d, p.workerId)}`, id);
  });
  const deletePayroll: Ctx['deletePayroll'] = (id) => update(d => {
    const p = d.payrolls.find(x => x.id === id);
    if (!p || p.payments.length) return; // a payroll with payments is never deleted
    d.payrolls = d.payrolls.filter(x => x.id !== id);
    logAudit(d, 'delete', 'Payroll', `Deleted payroll ${p.month} for ${workerName(d, p.workerId)}`, id);
  });
  const addPayrollPayment: Ctx['addPayrollPayment'] = (id, payment) => update(d => {
    const p = d.payrolls.find(x => x.id === id);
    if (!p || p.status !== 'final') return; // salary is paid only against a finalised payroll
    const dup = p.payments.some(x => x.date === payment.date && x.amount === payment.amount && x.mode === payment.mode && (x.reference || '') === (payment.reference || '') && Date.now() - Date.parse(x.createdAt) < 15000);
    if (dup) return; // the same payment saved twice within seconds (double tap)
    p.payments.push({ ...payment, id: uid(), createdAt: now() });
    p.updatedAt = now();
    payrollCash(d, p);
    logAudit(d, 'payment', 'Payroll', `Salary payment ₹${payment.amount} to ${workerName(d, p.workerId)} (${p.month})`, id, { amount: payment.amount });
  });
  const removePayrollPayment: Ctx['removePayrollPayment'] = (id, paymentId) => update(d => {
    const p = d.payrolls.find(x => x.id === id);
    if (!p) return;
    p.payments = p.payments.filter(x => x.id !== paymentId);
    payrollCash(d, p);
    logAudit(d, 'edit', 'Payroll', `Removed a salary payment (${p.month}, ${workerName(d, p.workerId)})`, id);
  });
  // ======== TRADING GOODS ========
  const upsertTradingItem: Ctx['upsertTradingItem'] = (t) => {
    const newId = t.id || uid();
    update(db => {
      const baseUnit = (t.baseUnit || 'Piece').trim() || 'Piece';
      const packUnit = (t.packUnit || '').trim() || undefined;
      const packSize = packUnit && Number(t.packSize) > 0 ? Number(t.packSize) : undefined;
      const rateUnits = [...new Set([baseUnit, ...((t.rateUnits || []).map(u => (u || '').trim()).filter(Boolean)), ...(packUnit ? [packUnit] : [])])];
      // Qtl<->Kg are always convertible, keep both visible when either is used
      if (rateUnits.includes('Kg') && !rateUnits.includes('Qtl') && (baseUnit === 'Kg')) rateUnits.push('Qtl');
      if (rateUnits.includes('Qtl') && !rateUnits.includes('Kg')) rateUnits.push('Kg');
      const ex = db.tradingItems.find(x => x.id === (t.id || newId));
      if (t.id && ex) {
        Object.assign(ex, {
          name: t.name.trim(), baseUnit, rateUnits,
          packUnit, packSize,
          openingStock: Number(t.openingStock) || 0,
          openingRate: Number(t.openingRate) || 0,
          lowStock: Number(t.lowStock) || 0,
          active: t.active ?? ex.active, updatedAt: now(),
        });
        logAudit(db, 'edit', 'Trading Items', `Updated trading item: ${ex.name}`, ex.id);
      } else {
        // same name (case-insensitive) -> update instead of duplicating
        const same = db.tradingItems.find(x => x.name.trim().toLowerCase() === t.name.trim().toLowerCase());
        if (same) {
          Object.assign(same, { baseUnit, rateUnits, packUnit, packSize, active: true, updatedAt: now() });
          logAudit(db, 'edit', 'Trading Items', `Updated trading item: ${same.name}`, same.id);
          return same.id;
        }
        db.tradingItems.push({
          id: newId, name: t.name.trim(), baseUnit, rateUnits, packUnit, packSize,
          openingStock: Number(t.openingStock) || 0, openingRate: Number(t.openingRate) || 0,
          lowStock: Number(t.lowStock) || 0, active: t.active ?? true,
          createdAt: now(), updatedAt: now(),
        });
        logAudit(db, 'create', 'Trading Items', `Added trading item: ${t.name.trim()}`, newId);
      }
    });
    return newId;
  };
  const hideTradingItem: Ctx['hideTradingItem'] = (id) => {
    update(db => {
      const ex = db.tradingItems.find(x => x.id === id);
      if (ex) { ex.active = !ex.active; ex.updatedAt = now(); }
      logAudit(db, 'edit', 'Trading Items', `${ex?.active ? 'Showed' : 'Hid'} trading item: ${ex?.name || id}`, id);
    });
  };
  const removeTradingItem: Ctx['removeTradingItem'] = (id) => {
    update(db => {
      const ex = db.tradingItems.find(x => x.id === id);
      db.tradingItems = db.tradingItems.filter(x => x.id !== id);
      logAudit(db, 'delete', 'Trading Items', `Deleted trading item: ${ex?.name || id}`, id);
    });
  };
  const tradingItemUsage: Ctx['tradingItemUsage'] = (id) => db.trading.filter(t => t.itemId === id).length;

  const addTrading: Ctx['addTrading'] = (e) => {
    let newId = '';
    update(db => {
      newId = uid();
      const entry: TradingEntry = { ...e, id: newId, payments: e.payments ? normPayments(e.payments) : undefined, createdAt: now(), updatedAt: now() };
      db.trading.unshift(entry);
      for (const p of entry.payments || []) tradeCash(db, entry, p);
      const it = db.tradingItems.find(x => x.id === e.itemId);
      logAudit(db, 'create', 'Trading', `${e.kind === 'buy' ? 'Bought' : 'Sold'} ${e.qty} ${e.unit} ${it?.name || e.itemName} — ₹${e.total}`, newId);
    });
    return newId;
  };
  const updateTrading: Ctx['updateTrading'] = (id, e) => {
    update(db => {
      const ex = db.trading.find(x => x.id === id);
      if (!ex) return;
      Object.assign(ex, e, { updatedAt: now() });
      if (Array.isArray(ex.payments)) {
        ex.payments = normPayments(ex.payments);
        db.cashbook = db.cashbook.filter(c => !(c.linkedEntryId === id && c.linkedModule === 'Trading'));
        for (const p of ex.payments) tradeCash(db, ex, p);
      }
      logAudit(db, 'edit', 'Trading', `Updated trading ${ex.kind} ${ex.itemName}`, id);
    });
  };
  const deleteTrading: Ctx['deleteTrading'] = (id) => {
    update(db => {
      const ex = db.trading.find(x => x.id === id);
      db.trading = db.trading.filter(x => x.id !== id);
      db.cashbook = db.cashbook.filter(c => !(c.linkedEntryId === id && c.linkedModule === 'Trading'));
      logAudit(db, 'delete', 'Trading', `Deleted trading ${ex?.kind} ${ex?.itemName}`, id);
    });
  };
  const addTradingPayment: Ctx['addTradingPayment'] = (id, payment) => {
    update(db => {
      const ex = db.trading.find(x => x.id === id);
      if (!ex) return;
      const p: Payment = { ...payment, id: uid(), createdAt: now() };
      ex.payments = [...(ex.payments || []), p];
      ex.updatedAt = now();
      tradeCash(db, ex, p);
      logAudit(db, 'payment', 'Trading', `Added payment to ${ex.kind === 'sell' ? 'sale' : 'purchase'} of ${ex.itemName}`, id, { amount: payment.amount });
    });
  };

  // ======== BACKUP/RESTORE ========
  const backup: Ctx['backup'] = () => {
    return JSON.stringify(db, null, 2);
  };
  /** Replace: the whole database becomes the backup. Merge: only records that are not already here are added; nothing is overwritten. */
  const restoreFrom: Ctx['restoreFrom'] = (incoming, mode) => {
    if (mode === 'replace') {
      const next = JSON.parse(JSON.stringify(incoming)) as Database;
      logAudit(next, 'restore', 'Backup', 'Restored a full backup (replaced all data)');
      dispatch({ type: 'set', db: next });
      return { added: {}, conflicts: 0 };
    }
    const r = mergeDatabases(db, incoming);
    const total = Object.values(r.added).reduce((x, y) => x + y, 0);
    logAudit(r.db, 'restore', 'Backup', `Merged a backup (${total} records added, ${r.conflicts} kept as they were)`);
    dispatch({ type: 'set', db: r.db });
    return { added: r.added, conflicts: r.conflicts };
  };
  const restore: Ctx['restore'] = (json, mode) => {
    const ins = inspectBackup(json);
    if (ins.kind !== 'plain') throw new Error('This backup is encrypted. Use the Backup page to enter the password.');
    const r = restoreFrom(ins.db, mode);
    return { count: Object.values(r.added).reduce((x, y) => x + y, 0) };
  };
  const resetAll: Ctx['resetAll'] = () => {
    dispatch({ type: 'set', db: JSON.parse(JSON.stringify(loadDB())) });
  };

  // ======== BULK IMPORT ========
  const bulkImport: Ctx['bulkImport'] = (module, rows) => {
    const errors: string[] = [];
    let added = 0;
    update(db => {
      if (module === 'Parties') {
        for (const [i, r] of rows.entries()) {
          if (!r.name) { errors.push(`Row ${i + 1}: Name is required`); continue; }
          const types: Party['types'] = [];
          if (r.customer) types.push('customer');
          if (r.supplier) types.push('supplier');
          if (r.worker) types.push('worker');
          if (r.vendor) types.push('vendor');
          if (r.transport) types.push('transport');
          if (types.length === 0) types.push('customer');
          db.parties.push({
            id: uid(), name: r.name, types, phone: r.phone, village: r.village,
            address: r.address, openingBalance: round2(Number(r.openingBalance) || 0),
            notes: r.notes, active: true, createdAt: now(), updatedAt: now(),
          });
          added++;
        }
      }
    });
    return { added, errors };
  };

  // ======== BATCH (BULK) ENTRY ========
  const addHullingBatch: Ctx['addHullingBatch'] = (items) => {
    update(db => {
      for (const it of items) {
        const pid = resolveParty(db, it.customerName, 'customer');
        const id = uid();
        const rcpt = nextReceipt(db, 'hulling', db.settings.invoicePrefixes.hulling);
        incrementNext(db, 'hulling');
        const payments = normPayments(it.entry.payments);
        db.hulling.unshift({ ...it.entry, partyId: pid, id, receiptNumber: rcpt, payments, createdAt: now(), updatedAt: now() } as HullingEntry);
        for (const p of payments) {
          db.cashbook.unshift({
            id: uid(), date: p.date, type: 'receipt', mode: p.mode, amount: p.amount,
            description: `Hulling #${rcpt} payment`, linkedModule: 'Hulling', linkedEntryId: id,
            partyId: pid, createdAt: now(),
          });
        }
      }
      logAudit(db, 'create', 'Hulling', `Bulk entry: ${items.length} hulling receipts saved`);
    });
    return items.length;
  };
  const addPurchaseBatch: Ctx['addPurchaseBatch'] = (items) => {
    update(db => {
      for (const it of items) {
        const pid = resolveParty(db, it.customerName, 'supplier');
        const id = uid();
        const vnum = nextReceipt(db, 'purchase', db.settings.invoicePrefixes.purchase);
        incrementNext(db, 'purchase');
        const payments = normPayments(it.entry.payments);
        db.purchases.unshift({
          ...it.entry, partyId: pid, id, voucherNumber: vnum, payments,
          bagMovements: (it.entry.bagMovements || []).map(m => ({ ...m, id: m.id || uid(), createdAt: m.createdAt || now() })),
          createdAt: now(), updatedAt: now(),
        } as PurchaseEntry);
        for (const p of payments) {
          db.cashbook.unshift({
            id: uid(), date: p.date, type: 'payment', mode: p.mode, amount: p.amount,
            description: `Purchase #${vnum} payment`, linkedModule: 'Purchase', linkedEntryId: id,
            partyId: pid, createdAt: now(),
          });
        }
      }
      logAudit(db, 'create', 'Purchase', `Bulk entry: ${items.length} paddy purchases saved`);
    });
    return items.length;
  };

  const value: Ctx = {
    addHullingBatch, addPurchaseBatch,
    db, stock,
    upsertParty, deleteParty,
    addHulling, updateHulling, deleteHulling, addHullingPayment,
    addPurchase, updatePurchase, deletePurchase, addPurchasePayment, addPurchaseBagReturn,
    addProduction, updateProduction, deleteProduction,
    addDispatch, updateDispatch, deleteDispatch, addDispatchPayment,
    addSale, updateSale, deleteSale, addSalePayment,
    addExpense, updateExpense, deleteExpense, addExpensePayment,
    addLabour, updateLabour, deleteLabour, addLabourPayment,
    addElectricity, updateElectricity, deleteElectricity, addElectricityPayment,
    addStockAdjustment, addCashbook,
    updateSettings, upsertVariety, deleteVariety, upsertCategory, deleteCategory,
    varietyUsage, categoryUsage, removeVariety, removeCategory,
    upsertTradingItem, hideTradingItem, removeTradingItem, tradingItemUsage,
    addTrading, updateTrading, deleteTrading, addTradingPayment,
    saveAttendance, saveAttendanceBatch, deleteAttendance, saveWorkRecord, deleteWorkRecord, saveAdvance, deleteAdvance,
    savePayroll, setPayrollStatus, deletePayroll, addPayrollPayment, removePayrollPayment,
    backup, restore, restoreFrom, resetAll, bulkImport,
  };

  return <DBContext.Provider value={value}>{children}</DBContext.Provider>;
}

export function useDB() {
  const ctx = useContext(DBContext);
  if (!ctx) throw new Error('useDB must be used inside DBProvider');
  return ctx;
}
