import { useDB } from '../context';

/** Wheat-ear brand mark (pure SVG, works offline) */
export function WheatIcon({ className = 'w-12 h-12' }: { className?: string }) {
  const grains: [number, number, number][] = [
    [40, 14, 35], [46, 20, 40], [37, 20, -30], [45, 28, 40], [36, 28, -30], [43, 36, 38], [34, 36, -28], [40, 8, 10],
  ];
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d="M31 60 C29 46 31 34 38 20" stroke="#7a9a2b" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M27 58 C17 52 12 42 14 28 C22 33 27 43 29 56Z" fill="#6b8e23" />
      <path d="M30 58 C24 50 22 44 24 36 C28 41 30 48 31 56Z" fill="#8cb02f" opacity=".8" />
      {grains.map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx="3" ry="5.4" fill="#f5b82e" stroke="#d99a12" strokeWidth=".6" transform={`rotate(${r} ${x} ${y})`} />
      ))}
    </svg>
  );
}

export function Welcome({ onEnter }: { onEnter: () => void }) {
  const { db } = useDB();
  const pills = ['Inventory Tracking', 'Financial Reports', 'Party Ledger', 'JSON Backup'];
  return (
    <div className="fixed inset-0 z-[200] bg-[#00301f] overflow-y-auto">
      <div className="min-h-full max-w-md mx-auto flex flex-col items-center justify-between px-6 pt-16 pb-8 text-center animate-fade-in">
        <div className="flex-1 flex flex-col items-center justify-center w-full">
          <div className="relative w-36 h-36 rounded-full border border-[#8a7a55]/60 flex items-center justify-center">
            <div className="w-32 h-32 rounded-full bg-[#17402f] flex items-center justify-center">
              <div className="w-24 h-24 rounded-full bg-[#2f6b50] flex items-center justify-center overflow-hidden">
                {db.settings.logo
                  ? <img src={db.settings.logo} alt="Logo" className="w-full h-full object-cover" />
                  : <WheatIcon className="w-14 h-14" />}
              </div>
            </div>
          </div>

          <div className="mt-9 text-[13px] font-semibold tracking-[0.42em] text-[#c9a46a] pl-[0.42em]">SHRI PARSHWANATHA</div>
          <h1 className="mt-2 text-[40px] leading-none font-extrabold text-white tracking-tight">SPRM TRADERS</h1>
          <div className="mt-5 h-1 w-14 rounded-full bg-[#3a8a64]" />
          <p className="mt-5 text-[17px] text-[#a9c2b5]">Complete Mill Operations Management</p>

          <div className="mt-7 flex flex-wrap justify-center gap-2.5 max-w-[320px]">
            {pills.map(p => (
              <span key={p} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-[#2d5a46] bg-[#0d3a28] text-[13px] text-[#dbe8e0]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#c9a46a]" />{p}
              </span>
            ))}
          </div>
        </div>

        <div className="w-full mt-10">
          <button
            onClick={onEnter}
            className="w-full py-4 rounded-2xl bg-[#d3a574] text-[#00301f] text-lg font-extrabold tracking-wide shadow-lg active:scale-[0.98] transition-transform"
          >
            JAI JINENDRA <span className="ml-2">→</span>
          </button>
          <div className="mt-4 text-xs text-[#6f8f7e]">Offline-First • No Internet Required</div>
        </div>
      </div>
    </div>
  );
}
