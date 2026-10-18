import { useState } from 'react';
import { DBProvider } from './context';
import { ToastHost } from './components/ui';
import {
  PartiesPage, StockPage, ExpensesPage,
  ElectricityPage, CashbookPage, OutstandingPage, BagsPage, SettingsPage, BackupPage, ReportsPage,
} from './components/pages';
import { PaddyDispatchPage } from './components/paddyDispatch';
import { HuskDispatchPage } from './components/huskDispatch';
import { VehiclePage } from './components/vehicle';
import { LabourPage } from './components/labour';
import { ProductionPage } from './components/production';
import { TradingPage } from './components/trading';
import { HullingPage } from './components/hulling';
import { PurchasePage } from './components/purchase';
import { Dashboard } from './components/dashboard';
import { Welcome } from './components/Welcome';
import { SalesPage } from './components/sales';
import { InventoryPage } from './components/inventory';

type MainTab = 'home' | 'hulling' | 'purchase' | 'sales' | 'trading' | 'more';
type MorePage = 'inventory' | 'production' | 'stock' | 'parties' | 'bags' | 'dispatch' | 'vehicle' | 'husk' | 'expenses' | 'labour' | 'electricity' | 'reports' | 'outstanding' | 'backup' | 'settings' | 'cashbook';

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
  { id: 'reports', label: 'Reports', icon: '📊', desc: 'Profit, summaries' },
  { id: 'backup', label: 'Backup / Restore', icon: '💾', desc: 'JSON / CSV export' },
  { id: 'settings', label: 'Settings', icon: '🛠', desc: 'Mill details, varieties' },
];

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

  const goToTab = (t: MainTab) => { setMoreStack(null); setTab(t); };
  const nav = (id: string) => {
    if (MORE_IDS.includes(id)) { setTab('more'); setMoreStack(id as MorePage); }
    else goToTab(id as MainTab);
  };
  const currentMoreTitle = moreStack ? MORE_ITEMS.find(m => m.id === moreStack)?.label || '' : '';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto shadow-2xl relative overflow-x-hidden">
      {tab !== 'home' && (
        <header className="sticky top-0 z-30 bg-forest-700 text-white shadow-md">
          <div className="px-4 py-3 flex items-center gap-2 safe-top">
            <button
              onClick={() => { if (tab === 'more' && moreStack) setMoreStack(null); else goToTab('home'); }}
              className="p-1 -ml-1 hover:bg-forest-600 rounded-lg" aria-label="Back"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold leading-tight truncate">
                {tab === 'more' ? (moreStack ? currentMoreTitle : 'More') : TITLES[tab]}
              </h1>
            </div>
          </div>
        </header>
      )}

      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        {tab === 'home' && <Dashboard onNav={nav} />}
        {tab === 'hulling' && <HullingPage />}
        {tab === 'purchase' && <PurchasePage />}
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
        {tab === 'more' && moreStack === 'reports' && <ReportsPage />}
        {tab === 'more' && moreStack === 'backup' && <BackupPage />}
        {tab === 'more' && moreStack === 'settings' && <SettingsPage />}
      </main>

      <nav className="sticky bottom-0 z-30 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] safe-bottom">
        <div className="grid grid-cols-6">
          {MAIN_TABS.map(t => {
            const active = tab === t.id && !(t.id === 'more' && moreStack);
            return (
              <button
                key={t.id}
                onClick={() => { if (t.id === 'more') { setMoreStack(null); setTab('more'); } else goToTab(t.id); }}
                className={`flex flex-col items-center justify-center py-2 text-[10px] font-medium gap-0.5 transition-colors ${active ? 'text-forest-700' : 'text-gray-500'}`}
              >
                <span className={`text-lg leading-none ${active ? 'scale-110' : ''} transition-transform`}>{t.icon}</span>
                <span>{t.label}</span>
                {active && <span className="w-1 h-1 rounded-full bg-forest-600" />}
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
      <div className="bg-gradient-to-br from-forest-700 to-forest-800 text-white rounded-2xl p-4">
        <h2 className="text-lg font-bold">More Modules</h2>
        <p className="text-xs text-forest-200 mt-0.5">All other management tools</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {MORE_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => onOpen(item.id)}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 text-left flex flex-col gap-1 active:scale-95 transition-transform hover:border-forest-200 hover:shadow-md"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">{item.icon}</span>
              <span className="font-semibold text-sm text-gray-900">{item.label}</span>
            </div>
            {item.desc && <div className="text-[11px] text-gray-500 pl-8">{item.desc}</div>}
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
