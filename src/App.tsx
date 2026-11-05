import React, { useState } from 'react';
import { DBProvider } from './context';
import { ToastHost } from './components/ui';
import {
  PartiesPage, StockPage, ExpensesPage,
  ElectricityPage, CashbookPage, OutstandingPage, BagsPage, SettingsPage, BackupPage,
} from './components/pages';
import { PaddyDispatchPage } from './components/paddyDispatch';
import { HuskDispatchPage } from './components/huskDispatch';
import { VehiclePage } from './components/vehicle';
import { ReportsPage } from './components/reports';
import { CombinedBillPage } from './components/combinedBill';
import { LabourPage } from './components/labour';
import { ProductionPage } from './components/production';
import { TradingPage } from './components/trading';
import { HullingPage } from './components/hulling';
import { PurchasePage } from './components/purchase';
import type { PurchasePrefill } from './components/purchase';
import { Dashboard } from './components/dashboard';
import { Welcome } from './components/Welcome';
import { SalesPage } from './components/sales';
import { InventoryPage } from './components/inventory';

type MainTab = 'home' | 'hulling' | 'purchase' | 'sales' | 'trading' | 'more';
type MorePage = 'inventory' | 'production' | 'stock' | 'parties' | 'bags' | 'dispatch' | 'vehicle' | 'husk' | 'expenses' | 'labour' | 'electricity' | 'reports' | 'outstanding' | 'backup' | 'settings' | 'cashbook' | 'combined';

const TITLES: Record<MainTab, string> = {
  home: 'SPRM Rice Mill', hulling: 'Hulling', purchase: 'Paddy Purchase', sales: 'Sales', trading: 'Trading Goods', more: 'More',
};

const MAIN_TABS: { id: MainTab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'hulling', label: 'Hulling', icon: '🌾' },
  { id: 'purchase', label: 'Purchase', icon: '🛒' },
  { id: 'sales', label: 'Sales', icon: '💰' },
  { id: 'trading', label: 'Trading', icon: '🏪' },
  { id: 'more', label: 'More', icon: '☰' },
];

const MORE_ITEMS: { id: MorePage; label: string; icon: string; desc?: string }[] = [
  { id: 'inventory', label: 'Inventory', icon: '🗂', desc: 'All dropdown values and masters' },
  { id: 'parties', label: 'Parties', icon: '👥', desc: 'Customers, suppliers, workers' },
  { id: 'production', label: 'Production', icon: '⚙️', desc: 'Batch processing' },
  { id: 'stock', label: 'Stock', icon: '📦', desc: 'Paddy, rice, by-products' },
  { id: 'bags', label: 'Bags', icon: '👜', desc: 'Bag tracking & returns' },
  { id: 'husk', label: 'Husk Dispatch', icon: '📦', desc: 'Bags / kg, rate lots, net receivable' },
  { id: 'vehicle', label: 'Vehicle', icon: '🚚', desc: 'Trips, drivers, transport charges' },
  { id: 'dispatch', label: 'Paddy Dispatch', icon: '🚛', desc: 'FIFO / manual lots, P&L' },
  { id: 'expenses', label: 'Expenses', icon: '💸', desc: 'Business & personal' },
  { id: 'labour', label: 'Labour', icon: '👷', desc: 'Wages & payments' },
  { id: 'electricity', label: 'Electricity', icon: '⚡', desc: 'Bills & payments' },
  { id: 'cashbook', label: 'Cashbook', icon: '📒', desc: 'Cash in / out' },
  { id: 'outstanding', label: 'Outstanding', icon: '⏰', desc: 'Receivables / Payables' },
  { id: 'combined', label: 'Combined Bill', icon: '🧾', desc: 'Hulling + paddy + rice + bran in one bill' },
  { id: 'reports', label: 'Reports', icon: '📊', desc: 'Profit, summaries' },
  { id: 'backup', label: 'Backup / Restore', icon: '💾', desc: 'JSON / CSV export' },
  { id: 'settings', label: 'Settings', icon: '🛠', desc: 'Mill details, varieties' },
];


const NAV_PATHS: Record<MainTab, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  hulling: <><path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" /><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" /></>,
  purchase: <><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></>,
  sales: <><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></>,
  trading: <><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" /><path d="M2 7h20" /></>,
  more: <><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>,
};
function NavIcon({ id }: { id: MainTab }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{NAV_PATHS[id]}</svg>;
}

const MORE_IDS = MORE_ITEMS.map(m => m.id) as string[];

export default function App() {
  return (
    <DBProvider>
      <AppShell />
    </DBProvider>
  );
}

function AppShell() {
  const [entered, setEntered] = useState(false);
  const [tab, setTab] = useState<MainTab>('home');
  const [moreStack, setMoreStack] = useState<MorePage | null>(null);
  const [purchasePrefill, setPurchasePrefill] = useState<PurchasePrefill | null>(null);

  const goToTab = (t: MainTab) => { setMoreStack(null); setTab(t); };
  const nav = (id: string) => {
    if (MORE_IDS.includes(id)) { setTab('more'); setMoreStack(id as MorePage); }
    else goToTab(id as MainTab);
  };
  const currentMoreTitle = moreStack ? MORE_ITEMS.find(m => m.id === moreStack)?.label || '' : '';

  return (
    <div className="min-h-screen bg-[#f4f6f8] flex flex-col max-w-md mx-auto shadow-2xl relative overflow-x-hidden">
      {tab !== 'home' && (
        <header className="sticky top-0 z-30 bg-gradient-to-r from-forest-700 to-forest-600 text-white shadow-lg shadow-forest-900/10">
          <div className="px-4 py-3 flex items-center gap-2 safe-top">
            <button
              onClick={() => { if (tab === 'more' && moreStack) setMoreStack(null); else goToTab('home'); }}
              className="w-9 h-9 -ml-1 flex items-center justify-center bg-white/15 hover:bg-white/25 active:scale-95 transition-all rounded-xl" aria-label="Back"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-[17px] font-extrabold tracking-tight leading-tight truncate">
                {tab === 'more' ? (moreStack ? currentMoreTitle : 'More') : TITLES[tab]}
              </h1>
            </div>
          </div>
        </header>
      )}

      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        {tab === 'home' && <Dashboard onNav={nav} />}
        {tab === 'hulling' && <HullingPage onPaddy={p => { setPurchasePrefill(p); goToTab('purchase'); }} />}
        {tab === 'purchase' && <PurchasePage prefill={purchasePrefill} onPrefillUsed={() => setPurchasePrefill(null)} />}
        {tab === 'sales' && <SalesPage />}
        {tab === 'trading' && <TradingPage />}
        {tab === 'more' && !moreStack && <MoreMenu onOpen={setMoreStack} />}
        {tab === 'more' && moreStack === 'parties' && <PartiesPage />}
        {tab === 'more' && moreStack === 'inventory' && <InventoryPage />}
        {tab === 'more' && moreStack === 'production' && <ProductionPage />}
        {tab === 'more' && moreStack === 'stock' && <StockPage />}
        {tab === 'more' && moreStack === 'bags' && <BagsPage />}
        {tab === 'more' && moreStack === 'vehicle' && <VehiclePage />}
        {tab === 'more' && moreStack === 'husk' && <HuskDispatchPage />}
        {tab === 'more' && moreStack === 'dispatch' && <PaddyDispatchPage />}
        {tab === 'more' && moreStack === 'expenses' && <ExpensesPage />}
        {tab === 'more' && moreStack === 'labour' && <LabourPage />}
        {tab === 'more' && moreStack === 'electricity' && <ElectricityPage />}
        {tab === 'more' && moreStack === 'cashbook' && <CashbookPage />}
        {tab === 'more' && moreStack === 'outstanding' && <OutstandingPage />}
        {tab === 'more' && moreStack === 'combined' && <CombinedBillPage />}
        {tab === 'more' && moreStack === 'reports' && <ReportsPage />}
        {tab === 'more' && moreStack === 'backup' && <BackupPage />}
        {tab === 'more' && moreStack === 'settings' && <SettingsPage />}
      </main>

      <nav className="sticky bottom-0 z-30 px-3 pt-2 pb-2 bg-gradient-to-t from-[#f4f6f8] via-[#f4f6f8]/95 to-transparent safe-bottom">
        <div className="grid grid-cols-6 rounded-2xl bg-white/95 backdrop-blur border border-gray-100 shadow-soft p-1">
          {MAIN_TABS.map(t => {
            const active = tab === t.id && !(t.id === 'more' && moreStack);
            return (
              <button
                key={t.id}
                onClick={() => { if (t.id === 'more') { setMoreStack(null); setTab('more'); } else goToTab(t.id); }}
                aria-label={t.label}
                className={`flex flex-col items-center justify-center py-1.5 rounded-xl text-[10px] font-semibold gap-0.5 transition-all active:scale-95 ${active ? 'bg-forest-50 text-forest-700' : 'text-gray-400'}`}
              >
                <NavIcon id={t.id} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <ToastHost />
      {!entered && <Welcome onEnter={() => setEntered(true)} />}
    </div>
  );
}

function MoreMenu({ onOpen }: { onOpen: (id: MorePage) => void }) {
  return (
    <div className="p-3 space-y-3 pb-6">
      <div className="bg-gradient-to-br from-forest-700 to-forest-500 text-white rounded-3xl p-5 shadow-lg shadow-forest-700/20">
        <h2 className="text-lg font-bold">More Modules</h2>
        <p className="text-xs text-forest-200 mt-0.5">All other management tools</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {MORE_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => onOpen(item.id)}
            className="bg-white rounded-2xl border border-gray-100 shadow-soft p-3 text-left flex flex-col gap-1.5 active:scale-[0.97] transition-all hover:border-forest-200"
          >
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-forest-50 flex items-center justify-center text-lg shrink-0">{item.icon}</span>
              <span className="font-bold text-sm text-gray-900 leading-tight">{item.label}</span>
            </div>
            {item.desc && <div className="text-[11px] text-gray-500">{item.desc}</div>}
          </button>
        ))}
      </div>
      <div className="bg-forest-50 rounded-xl p-3 text-[11px] text-forest-800">
        <div className="font-semibold mb-1">SPRM Rice Mill Management</div>
        <div>Offline-first · Data stays on your device. Use Backup regularly to export JSON copies.</div>
      </div>
    </div>
  );
}
