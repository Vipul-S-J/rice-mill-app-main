// SPRM Rice Mill Management System - Type Definitions

export type PartyType = 'customer' | 'supplier' | 'worker' | 'vendor' | 'transport';

export interface Party {
  id: string;
  name: string;
  types: PartyType[];
  phone?: string;
  village?: string;
  address?: string;
  openingBalance: number; // positive = receivable, negative = payable
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  date: string;
  amount: number;
  mode: string;
  reference?: string;
  notes?: string;
  isAdvance?: boolean;
  createdAt: string;
}

export type PaymentStatus = 'paid' | 'partial' | 'unpaid' | 'overdue';
export type PaddySize = 'small' | 'big';
export type BagGivenType = 'none' | 'old' | 'new' | 'mixed';

export interface BagMovement {
  id: string;
  date: string;
  bagsReceived?: number;
  newBagsIssued?: number;
  oldBagsIssued?: number;
  newBagsReturned?: number;
  oldBagsReturned?: number;
  /** legacy field from older versions - counted as old bags returned */
  bagsReturned?: number;
  newBagCharge?: number; // amount charged to customer (deducted from payable)
  newBagLoss?: number; // cost absorbed by mill when new bags are given free
  bagUnitCost?: number;
  chargeCustomer?: boolean;
  givenType?: BagGivenType;
  settlementMethod?: 'one-for-one' | 'flexible';
  manualAdjustment?: number;
  manualAdjustmentReason?: string;
  notes?: string;
  createdAt: string;
}

export interface HullingEntry {
  id: string;
  receiptNumber: string;
  date: string;
  partyId: string;
  vehicleNumber?: string;
  /** informational bag count only - bags are NOT tracked in stock/ledger for hulling */
  bagsCount?: number;
  quantityKg: number;
  ratePerQtl: number;
  gstMode: 'none' | 'exclusive' | 'inclusive';
  gstRate: number;
  baseAmount: number; // qtl * rate
  taxableAmount: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  roundOriginal: number;
  roundAdjustment: number;
  finalTotal: number;
  manualOverrides: Record<string, boolean>;
  notes?: string;
  billPhoto?: string;
  payments: Payment[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseLine {
  id: string;
  varietyId: string;
  size: PaddySize;
  bags?: number;
  qtyKg: number;
  ratePerQtl: number;
  amount: number;
}

export interface PurchaseEntry {
  id: string;
  voucherNumber: string;
  date: string;
  partyId: string;
  vehicleNumber?: string;
  /** first line variety (kept for compatibility) */
  varietyId: string;
  lines: PurchaseLine[];
  grossKg: number;
  tareKg: number;
  bagWeightKg: number;
  otherDeductionsKg: number;
  moistureDeductionKg: number;
  netKg: number; // sum of lines
  billableQtl: number;
  ratePerQtl: number; // weighted average
  baseAmount: number; // sum of line amounts
  gstMode?: 'none' | 'exclusive' | 'inclusive';
  gstRate?: number;
  taxableAmount?: number;
  cgst?: number;
  sgst?: number;
  totalTax?: number;
  roundOriginal: number;
  roundAdjustment: number;
  finalTotal: number;
  manualOverrides: Record<string, boolean>;
  notes?: string;
  billPhoto?: string;
  payments: Payment[];
  bagMovements: BagMovement[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductionInputLot {
  /** lot key e.g. purchaseId:lineIdx or adj:adjustmentId */
  key: string;
  purchaseId?: string | null;
  qtyKg: number;
  date?: string;
  party?: string;
  ratePerQtl?: number;
}

export interface ProductionInput {
  varietyId: string;
  qtyKg: number;
  /** lot-level allocation (manual mode, or FIFO-resolved at save time) */
  lots?: ProductionInputLot[];
}

export interface ProductionBatch {
  id: string;
  batchNumber: string;
  date: string;
  /** small / big paddy run */
  paddyType?: 'small' | 'big';
  /** first-in-first-out auto lot order, or manual per-lot selection */
  mode?: 'fifo' | 'manual';
  inputs?: ProductionInput[];
  /** legacy single-variety input (kept for backward compatibility) */
  paddyVarietyId: string;
  paddyInputKg: number;
  sourcePurchaseIds?: string[];
  outputs: {
    riceVarietyId: string;
    riceKg: number;
    brokenRiceKg: number;
    branKg: number;
    huskKg: number;
    otherKg: number;
    otherName?: string;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
}


export interface PaddyDispatchAlloc {
  /** purchase lot key (purchaseId:lineIdx or adj:id) */
  key: string;
  varietyId: string;
  qtyKg: number;
  ratePerQtl?: number;
  party?: string;
  date?: string;
}
export interface PaddyDispatchRow {
  id: string;
  label: string;
  qtyKg: number;
  /** sell split rows (single rate = one row) */
  rateRows: { qtyKg: number; ratePerQtl: number }[];
  revenue: number;
  buyCost: number;
}
export interface PaddyDispatchDetail {
  size: 'small' | 'big' | 'both';
  mode: 'fifo' | 'manual';
  viewMode: 'paddy' | 'customer';
  sellMode: 'single' | 'multiple';
  grossLoadKg: number;
  totalBags: number;
  driverName?: string;
  vehicleOwner?: string;
  vendorMobile?: string;
  emptyWeightKg: number;
  /** net weight (load - empty) unless manually overridden */
  netWeightKg: number;
  bagWeightDedKg: number;
  moistureDedKg: number;
  otherWeightDedKg: number;
  /** final billable weight after every deduction */
  netSaleKg: number;
  /** netSaleKg / load weight - share of each row's quantity that is billed */
  billFactor: number;
  buyBasis: 'actual' | 'average';
  transportRate: number;
  vehicleCharges: number;
  loadingCharges: number;
  labourCharges: number;
  deductionsRs: number;
  miscCharges: number;
  allocations: PaddyDispatchAlloc[];
  rows: PaddyDispatchRow[];
  selectedKg: number;
  revenue: number;
  buyCost: number;
  expenses: number;
  profit: number;
  /** amount the buyer pays = full selling amount (expenses are the mill's own cost) */
  payable: number;
  paymentMode: string;
  paymentStatus: 'paid' | 'partial' | 'unpaid';
}

export interface HuskDispatchDetail {
  measureBy: 'bags' | 'weight';
  /** qty is bags or kg depending on measureBy; rate is per bag or per kg */
  lots: { qty: number; rate: number; amount: number }[];
  approxBags?: number;
  approxKg?: number;
  driverName?: string;
  totalAmount: number;
  coolie: number;
  transport: number;
  /** total amount - coolie - transport : what the buyer pays */
  netReceivable: number;
  paymentMode: string;
  paymentStatus: 'paid' | 'partial' | 'unpaid';
}

export interface DispatchEntry {
  id: string;
  dispatchNumber: string;
  date: string;
  partyId: string;
  vehicleNumber?: string;
  productId: string; // rice, broken, bran, husk, other
  varietyId?: string;
  grossKg: number;
  tareKg: number;
  bagWeightKg: number;
  otherDeductionsKg: number;
  netKg: number;
  billableQtl: number;
  ratePerQtl: number;
  baseAmount: number;
  transportCost: number;
  loadingCost: number;
  unloadingCost: number;
  driverBata: number;
  snacksCost: number;
  otherCosts: number;
  totalCosts: number;
  gstMode: 'none' | 'exclusive' | 'inclusive';
  gstRate: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  roundOriginal: number;
  roundAdjustment: number;
  finalTotal: number;
  manualOverrides: Record<string, boolean>;
  notes?: string;
  payments: Payment[];
  /** present for paddy dispatches created from the Paddy Dispatch screen */
  paddy?: PaddyDispatchDetail;
  /** present for husk dispatches created from the Husk Dispatch screen */
  husk?: HuskDispatchDetail;
  /** running trip number, shared by paddy and husk dispatches (shown in the Vehicle section) */
  tripNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleEntry {
  id: string;
  invoiceNumber: string;
  date: string;
  partyId: string;
  productId: string;
  itemName?: string;
  varietyId?: string;
  lines?: SaleLine[];
  quantityKg: number;
  ratePerQtl: number;
  gstMode: 'none' | 'exclusive' | 'inclusive';
  gstRate: number;
  baseAmount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  roundOriginal: number;
  roundAdjustment: number;
  finalTotal: number;
  transportCost?: number;
  vehicleNumber?: string;
  manualOverrides: Record<string, boolean>;
  notes?: string;
  billPhoto?: string;
  payments: Payment[];
  createdAt: string;
  updatedAt: string;
}

export interface SaleLine {
  id: string;
  varietyId?: string;
  itemName?: string;
  quantityKg: number;
  bags25?: number;
  bags10?: number;
  looseKg?: number;
  rate: number;
  rateUnit: 'qtl' | 'kg';
  amount: number;
}

export interface ExpenseEntry {
  id: string;
  date: string;
  categoryId: string;
  payee?: string;
  partyId?: string;
  amount: number;
  mode: string;
  isPaid: boolean;
  dueDate?: string;
  isPersonal?: boolean;
  notes?: string;
  billPhoto?: string;
  payments: Payment[];
  createdAt: string;
  updatedAt: string;
}

export interface LabourEntry {
  id: string;
  date: string;
  workerPartyId: string;
  workType: string;
  wageType: 'per-qtl' | 'fixed';
  /** 'hulling' auto-calculated from mill hulling entries, or 'manual' */
  calcMode?: 'hulling' | 'manual';
  fromDate?: string;
  toDate?: string;
  absentDates?: string[];
  hullingTotalQtl?: number;
  hullingNetQtl?: number;
  quantityQtl?: number;
  ratePerQtl?: number;
  fixedAmount?: number;
  dailyRate?: number;
  deductionAmount?: number;
  totalAmount: number;
  notes?: string;
  payments: Payment[];
  createdAt: string;
  updatedAt: string;
}

export interface ElectricityBill {
  id: string;
  billDate: string;
  periodFrom?: string;
  periodTo?: string;
  meterReadingFrom?: number;
  meterReadingTo?: number;
  units?: number;
  amount: number;
  dueDate?: string;
  isPaid: boolean;
  mode?: string;
  attachment?: string;
  notes?: string;
  payments: Payment[];
  createdAt: string;
  updatedAt: string;
}

export interface StockAdjustment {
  id: string;
  date: string;
  itemType: 'paddy' | 'rice' | 'broken' | 'bran' | 'husk' | 'new-bags' | 'old-bags' | 'rice-bag-25' | 'rice-bag-10' | 'other';
  varietyId?: string;
  /** signed: positive adds stock, negative removes */
  quantityKg?: number;
  quantityBags?: number;
  /** cost per bag when adding new bags (used for average bag cost) */
  unitCost?: number;
  reason: string;
  notes?: string;
  createdAt: string;
}

export interface CashbookEntry {
  id: string;
  date: string;
  type: 'receipt' | 'payment' | 'transfer';
  mode: string;
  amount: number;
  fromMode?: string;
  toMode?: string;
  description?: string;
  linkedModule?: string;
  linkedEntryId?: string;
  partyId?: string;
  notes?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  action: 'create' | 'edit' | 'delete' | 'payment' | 'backup' | 'restore' | 'settings' | 'import' | 'adjustment';
  module: string;
  entryId?: string;
  description: string;
  details?: any;
}

export interface Variety {
  id: string;
  name: string;
  category: 'small' | 'big' | 'other';
  usage?: ('paddy' | 'rice')[];
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  type: 'expense' | 'product' | 'payment_mode' | 'work_type';
  active: boolean;
}

export interface TradingItem {
  id: string;
  name: string;
  /** unit that quantity is entered in and stock is tracked in, e.g. Bag, Litre, Kg, Piece */
  baseUnit: string;
  /** units the price/rate can be quoted in — always includes baseUnit */
  rateUnits: string[];
  /** optional pack for a second rate, e.g. Bag for "Apple Rice 5kg" */
  packUnit?: string;
  /** how many base units one pack holds, e.g. 5 (Kg per Bag) */
  packSize?: number;
  openingStock?: number;
  /** purchase cost per base unit for opening stock (used in P&L average) */
  openingRate?: number;
  /** low-stock alert level in base units (0 = off) */
  lowStock?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TradingEntry {
  id: string;
  kind: 'buy' | 'sell';
  date: string;
  itemId: string;
  /** item name snapshot at save time */
  itemName: string;
  /** quantity in base units */
  qty: number;
  /** base unit snapshot */
  unit: string;
  /** price per rateUnit */
  rate: number;
  rateUnit: string;
  packSize?: number;
  total: number;
  /** supplier name (buy) or customer name (sell), plain text */
  party?: string;
  notes?: string;
  /** sale id this was imported from via "Import from Misc Sales" */
  sourceSaleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  millName: string;
  address: string;
  phone: string;
  gstin?: string;
  logo?: string;
  receiptFooter: string;
  defaultHullingRate: number;
  defaultBagCost: number;
  defaultGstRate: number;
  taxMode: 'none' | 'gst';
  currency: string;
  /** low-stock alert thresholds in Qtl (0 = alert disabled) */
  minStockQtl: { paddy: number; rice: number; bran: number; husk: number };
  invoicePrefixes: {
    hulling: string;
    purchase: string;
    dispatch: string;
    sale: string;
    batch: string;
  };
  nextNumbers: {
    hulling: number;
    purchase: number;
    dispatch: number;
    sale: number;
    batch: number;
  };
}

export interface Database {
  version: number;
  parties: Party[];
  hulling: HullingEntry[];
  purchases: PurchaseEntry[];
  production: ProductionBatch[];
  dispatches: DispatchEntry[];
  sales: SaleEntry[];
  expenses: ExpenseEntry[];
  labour: LabourEntry[];
  electricity: ElectricityBill[];
  cashbook: CashbookEntry[];
  stockAdjustments: StockAdjustment[];
  auditLog: AuditLog[];
  varieties: Variety[];
  categories: Category[];
  tradingItems: TradingItem[];
  trading: TradingEntry[];
  settings: Settings;
}
