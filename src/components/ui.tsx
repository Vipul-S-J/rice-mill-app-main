import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../utils/cn';
import { fmtINR, fmtNumber, today, round2, sumPayments, paymentStatus } from '../db';

// ============ Button ============
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}> = ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }) => {
  const variants: Record<string, string> = {
    primary: 'bg-forest-700 text-white hover:bg-forest-800 active:bg-forest-900 shadow-sm',
    secondary: 'bg-white text-forest-800 border border-forest-200 hover:bg-forest-50',
    ghost: 'bg-transparent text-forest-800 hover:bg-forest-50',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
    gold: 'bg-gold-500 text-white hover:bg-gold-600 shadow-sm',
    success: 'bg-green-600 text-white hover:bg-green-700 shadow-sm',
  };
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1.5 text-xs rounded-md',
    md: 'px-3 py-2 text-sm rounded-lg',
    lg: 'px-4 py-2.5 text-base rounded-lg',
  };
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    >
      {loading && <span className="h-3 w-3 border-2 border-white/50 border-t-white rounded-full animate-spin" />}
      {children}
    </button>
  );
};

// ============ Input ============
export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string; suffix?: string; error?: string; wrapperClassName?: string;
}> = ({ label, suffix, error, wrapperClassName, className, ...rest }) => (
  <div className={cn('flex flex-col gap-1', wrapperClassName)}>
    {label && <label className="text-xs font-medium text-gray-700">{label}</label>}
    <div className="relative">
      <input
        className={cn(
          'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors',
          'focus:border-forest-500 focus:ring-2 focus:ring-forest-100',
          'placeholder:text-gray-400 disabled:bg-gray-50',
          error ? 'border-red-400' : '',
          suffix ? 'pr-10' : '',
          className
        )}
        {...rest}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">{suffix}</span>}
    </div>
    {error && <span className="text-xs text-red-600">{error}</span>}
  </div>
);

// ============ Select ============
export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string; error?: string; wrapperClassName?: string; options: { value: string; label: string }[] | string[];
}> = ({ label, error, wrapperClassName, className, options, ...rest }) => {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  return (
    <div className={cn('flex flex-col gap-1', wrapperClassName)}>
      {label && <label className="text-xs font-medium text-gray-700">{label}</label>}
      <select
        className={cn(
          'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors',
          'focus:border-forest-500 focus:ring-2 focus:ring-forest-100 appearance-none bg-no-repeat bg-right pr-8',
          error ? 'border-red-400' : '',
          className
        )}
        style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>")`, backgroundPosition: 'right 8px center' }}
        {...rest}
      >
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
};

// ============ Textarea ============
export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }> = ({ label, className, ...rest }) => (
  <div className="flex flex-col gap-1">
    {label && <label className="text-xs font-medium text-gray-700">{label}</label>}
    <textarea
      className={cn(
        'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors',
        'focus:border-forest-500 focus:ring-2 focus:ring-forest-100 resize-y min-h-[60px]',
        className
      )}
      {...rest}
    />
  </div>
);

// ============ Card ============
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div
    className={cn('bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden', className)}
    {...rest}
  >
    {children}
  </div>
);

// ============ KPI Card ============
export const KPICard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'green' | 'red' | 'gold' | 'blue';
  onClick?: () => void;
  icon?: React.ReactNode;
}> = ({ label, value, sub, tone = 'default', onClick, icon }) => {
  const tones: Record<string, string> = {
    default: 'text-gray-900',
    green: 'text-forest-700',
    red: 'text-red-600',
    gold: 'text-gold-600',
    blue: 'text-blue-700',
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        'bg-white rounded-xl shadow-sm border border-gray-100 p-3 text-left w-full',
        'hover:shadow-md hover:border-forest-200 active:scale-[0.98] transition-all',
        onClick ? 'cursor-pointer' : 'cursor-default'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide truncate">{label}</div>
          <div className={cn('text-lg font-bold mt-0.5 truncate', tones[tone])}>{value}</div>
          {sub && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{sub}</div>}
        </div>
        {icon && <div className="text-forest-500 shrink-0 mt-0.5">{icon}</div>}
      </div>
    </button>
  );
};

// ============ Modal ============
export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
  footer?: React.ReactNode;
}> = ({ open, onClose, title, children, maxWidth = 'max-w-md', footer }) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 animate-fade-in" onClick={onClose}>
      <div
        className={cn(
          'bg-white w-full rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh]',
          maxWidth
        )}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <h3 className="font-semibold text-gray-900 text-base">{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none w-8 h-8 flex items-center justify-center">×</button>
          </div>
        )}
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-gray-100 shrink-0 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};

// ============ Confirm Dialog ============
export const Confirm: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmText?: string;
  variant?: 'danger' | 'primary';
}> = ({ open, onClose, onConfirm, title = 'Confirm', message, confirmText = 'Confirm', variant = 'danger' }) => (
  <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-sm" footer={
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant={variant} onClick={() => { onConfirm(); onClose(); }}>{confirmText}</Button>
    </>
  }>
    <p className="text-sm text-gray-700">{message}</p>
  </Modal>
);

// ============ Badge ============
export const Badge: React.FC<{ children: React.ReactNode; tone?: 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'gold' }> = ({ children, tone = 'gray' }) => {
  const tones: Record<string, string> = {
    green: 'bg-green-50 text-green-700 border-green-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
    gold: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border', tones[tone])}>
      {children}
    </span>
  );
};

// ============ Empty State ============
export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode }> = ({ icon, title, subtitle, action }) => (
  <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
    {icon && <div className="text-forest-300 mb-3">{icon}</div>}
    <div className="text-sm font-semibold text-gray-700">{title}</div>
    {subtitle && <div className="text-xs text-gray-500 mt-1 max-w-xs">{subtitle}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

// ============ Tabs ============
export const Tabs: React.FC<{ tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void }> = ({ tabs, active, onChange }) => (
  <div className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
    {tabs.map(t => (
      <button
        key={t.id}
        onClick={() => onChange(t.id)}
        className={cn(
          'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
          active === t.id ? 'bg-forest-700 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
        )}
      >
        {t.label}{t.count !== undefined && <span className="ml-1 opacity-70">({fmtNumber(t.count, 0)})</span>}
      </button>
    ))}
  </div>
);

// ============ Toast ============
type Toast = { id: string; message: string; type: 'success' | 'error' | 'info' };
let toastQueue: (() => void)[] = [];
export function toast(message: string, type: 'success' | 'error' | 'info' = 'success') {
  toastQueue.forEach(fn => fn());
  const ev = new CustomEvent('sprm-toast', { detail: { id: Math.random().toString(36), message, type } });
  window.dispatchEvent(ev);
}

export const ToastHost: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const handler = (e: Event) => {
      const t = (e as CustomEvent).detail as Toast;
      setToasts(prev => [...prev, t]);
      const removeThis = () => setToasts(prev => prev.filter(x => x.id !== t.id));
      toastQueue.push(removeThis);
      setTimeout(removeThis, 3000);
    };
    window.addEventListener('sprm-toast', handler);
    return () => window.removeEventListener('sprm-toast', handler);
  }, []);
  return (
    <div className="fixed bottom-20 left-0 right-0 z-[100] flex flex-col items-center gap-2 pointer-events-none px-4">
      {toasts.map(t => (
        <div key={t.id} className={cn(
          'px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-fade-in',
          t.type === 'success' ? 'bg-forest-700 text-white' :
          t.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'
        )}>
          {t.message}
        </div>
      ))}
    </div>
  );
};

// ============ List Row ============
export const ListRow: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, subtitle, right, onClick, leading, actions }) => (
  <div
    className={cn(
      'flex items-center gap-3 px-3 py-2.5 bg-white border-b border-gray-100 last:border-b-0',
      onClick ? 'cursor-pointer active:bg-gray-50' : ''
    )}
    onClick={onClick}
  >
    {leading && <div className="shrink-0">{leading}</div>}
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
      {subtitle && <div className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</div>}
      {actions && <div className="flex gap-1.5 mt-1.5">{actions}</div>}
    </div>
    {right && <div className="shrink-0 text-right">{right}</div>}
  </div>
);

// ============ Section Header ============
export const SectionHeader: React.FC<{ title: string; action?: React.ReactNode; sub?: string }> = ({ title, action, sub }) => (
  <div className="flex items-center justify-between px-1 mb-2">
    <div>
      <h2 className="text-sm font-bold text-forest-800 uppercase tracking-wide">{title}</h2>
      {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
    </div>
    {action}
  </div>
);

// ============ DateRange picker ============
export const DateRangePresets: React.FC<{
  value: string;
  onChange: (preset: string, start?: string, end?: string) => void;
}> = ({ value, onChange }) => {
  const presets = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
    { id: 'all', label: 'All' },
  ];
  return (
    <div className="flex gap-1">
      {presets.map(p => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className={cn(
            'px-2.5 py-1 text-[11px] rounded-full font-medium transition-colors',
            value === p.id ? 'bg-forest-700 text-white' : 'bg-white border border-gray-200 text-gray-600'
          )}
        >{p.label}</button>
      ))}
    </div>
  );
};

// ============ Form Row: Numeric with manual override ============
export const CalcField: React.FC<{
  label: string;
  value: number | '';
  onChange: (v: number | '', manual: boolean) => void;
  manual: boolean;
  onRecalc?: () => void;
  suffix?: string;
  step?: string;
  placeholder?: string;
  required?: boolean;
}> = ({ label, value, onChange, manual, onRecalc, suffix, step = '0.01', placeholder, required }) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between">
      <label className="text-xs font-medium text-gray-700">{label}{manual && <span className="ml-1 text-gold-600 text-[10px] font-bold">· MANUAL</span>}</label>
      {manual && onRecalc && (
        <button type="button" onClick={onRecalc} className="text-[11px] text-forest-700 font-medium hover:underline">Recalc</button>
      )}
    </div>
    <input
      type="number"
      inputMode="decimal"
      step={step}
      value={value}
      placeholder={placeholder}
      required={required}
      onChange={e => {
        const v = e.target.value === '' ? '' : Number(e.target.value);
        onChange(v, true);
      }}
      className={cn(
        'w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none',
        'focus:border-forest-500 focus:ring-2 focus:ring-forest-100',
        manual ? 'border-gold-400 bg-amber-50/30' : 'border-gray-200',
        suffix ? 'pr-10' : ''
      )}
    />
    {suffix && <span className="text-xs text-gray-500 -mt-0.5">{suffix}</span>}
  </div>
);

// ============ Mini action button (list rows) ============
export const MiniBtn: React.FC<{
  onClick: (e: React.MouseEvent) => void;
  tone?: 'default' | 'danger' | 'green' | 'blue' | 'gold';
  children: React.ReactNode;
}> = ({ onClick, tone = 'default', children }) => {
  const tones: Record<string, string> = {
    default: 'border-forest-200 text-forest-800 bg-white',
    danger: 'border-red-200 text-red-600 bg-red-50/40',
    green: 'border-green-200 text-green-700 bg-green-50/50',
    blue: 'border-blue-200 text-blue-700 bg-blue-50/40',
    gold: 'border-amber-300 text-amber-700 bg-amber-50/60',
  };
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick(e); }}
      className={cn('px-2.5 py-1 rounded-lg border text-[11px] font-semibold active:scale-95 transition-transform', tones[tone])}
    >{children}</button>
  );
};

// ============ Chips (single choice) ============
export const Chips: React.FC<{
  options: { value: string; label: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}> = ({ options, value, onChange, className }) => (
  <div className={cn('flex gap-1.5 flex-wrap', className)}>
    {options.map(o => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(o.value)}
        className={cn(
          'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
          value === o.value ? 'bg-forest-700 text-white border-forest-700' : 'bg-white text-gray-600 border-gray-200'
        )}
      >{o.label}</button>
    ))}
  </div>
);

// ============ Date filter (today / yesterday / week / month / custom / all) ============
export interface DateFilterValue {
  preset: 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom';
  start?: string;
  end?: string;
}
export const DateFilter: React.FC<{ value: DateFilterValue; onChange: (v: DateFilterValue) => void }> = ({ value, onChange }) => (
  <div className="flex items-center gap-1.5 flex-wrap">
    <Select
      wrapperClassName="w-auto"
      value={value.preset}
      onChange={e => onChange({ ...value, preset: e.target.value as DateFilterValue['preset'] })}
      options={[
        { value: 'all', label: 'All dates' }, { value: 'today', label: 'Today' },
        { value: 'yesterday', label: 'Yesterday' }, { value: 'week', label: 'This week' },
        { value: 'month', label: 'This month' }, { value: 'custom', label: 'Custom range' },
      ]}
    />
    {value.preset === 'custom' && (
      <>
        <input type="date" value={value.start || ''} onChange={e => onChange({ ...value, start: e.target.value })}
          className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs w-[118px]" />
        <span className="text-xs text-gray-400">to</span>
        <input type="date" value={value.end || ''} onChange={e => onChange({ ...value, end: e.target.value })}
          className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs w-[118px]" />
      </>
    )}
  </div>
);

// ============ Quantity input: Qtl + Kg (1 Qtl = 100 kg), value is total kg ============
export const QtyInput: React.FC<{
  label?: string; valueKg: number; onChange: (kg: number) => void;
}> = ({ label = 'Qty (Qtl + Kg)', valueKg, onChange }) => {
  const [q, setQ] = useState('');
  const [k, setK] = useState('');
  useEffect(() => {
    const cur = (Number(q) || 0) * 100 + (Number(k) || 0);
    if (Math.abs(cur - valueKg) > 0.0001) {
      if (!valueKg) { setQ(''); setK(''); }
      else {
        const qq = Math.floor(valueKg / 100 + 1e-9);
        const rem = Math.round((valueKg - qq * 100) * 100) / 100;
        setQ(qq ? String(qq) : '');
        setK(rem ? String(rem) : '');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKg]);
  const emit = (qs: string, ks: string) => onChange(round2((Number(qs) || 0) * 100 + (Number(ks) || 0)));
  const cls = 'w-full min-w-0 rounded-lg border border-gray-200 bg-white px-1.5 py-2 text-sm text-center outline-none focus:border-forest-500 focus:ring-2 focus:ring-forest-100';
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-xs font-medium text-gray-700 truncate">{label}</label>
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0">
          <input type="number" inputMode="decimal" min="0" placeholder="0" value={q} className={cls}
            onChange={e => { setQ(e.target.value); emit(e.target.value, k); }} />
          <div className="text-[9px] text-gray-400 text-center mt-0.5">Qtl</div>
        </div>
        <span className="text-gray-300 -mt-3">.</span>
        <div className="flex-1 min-w-0">
          <input type="number" inputMode="decimal" min="0" placeholder="0" value={k} className={cls}
            onChange={e => { setK(e.target.value); emit(q, e.target.value); }} />
          <div className="text-[9px] text-gray-400 text-center mt-0.5">Kg</div>
        </div>
      </div>
    </div>
  );
};

// ============ Photo attach (compressed, stored locally) ============
export const PhotoAttach: React.FC<{ value?: string; onChange: (v?: string) => void; label?: string }> = ({
  value, onChange, label = 'Bill Photo (optional)',
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const handle = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
        onChange(c.toDataURL('image/jpeg', 0.65));
      };
      img.onerror = () => toast('Could not read that image', 'error');
      img.src = reader.result as string;
    };
    reader.readAsDataURL(f);
  };
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-gray-700">{label}</div>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ''; }} />
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value} alt="Bill" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
          <Button type="button" size="sm" variant="secondary" onClick={() => ref.current?.click()}>Change</Button>
          <Button type="button" size="sm" variant="danger" onClick={() => onChange(undefined)}>Remove</Button>
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-forest-300 text-forest-700 text-xs font-semibold bg-forest-50/40">
          📷 Attach Photo
        </button>
      )}
    </div>
  );
};

// ============ PayBox: "Amount Paid" + Mark Fully Paid + balance + mode ============
export const PayBox: React.FC<{
  total: number;
  existing: { id?: string; date: string; amount: number; mode: string }[];
  onRemoveExisting: (idx: number) => void;
  amount: string; onAmount: (v: string) => void;
  mode: string; onMode: (v: string) => void;
  date: string; onDate: (v: string) => void;
  modes: string[];
}> = ({ total, existing, onRemoveExisting, amount, onAmount, mode, onMode, date, onDate, modes }) => {
  const prior = sumPayments(existing as any);
  const draft = round2(Number(amount) || 0);
  const balance = round2(total - prior - draft);
  const status = paymentStatus(total, prior + draft);
  return (
    <div className="space-y-2.5">
      <div className="text-[11px] font-bold tracking-wide text-forest-800">💰 PAYMENT</div>
      {existing.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-gray-500">Already recorded ({fmtINR(prior)})</div>
          {existing.map((p, i) => (
            <div key={p.id || i} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2 py-1 text-xs">
              <span className="text-green-800 font-medium">{p.date} · {p.mode} · {fmtINR(p.amount)}</span>
              <button type="button" onClick={() => onRemoveExisting(i)} className="text-red-500 px-1.5 text-base leading-none">×</button>
            </div>
          ))}
        </div>
      )}
      <Input label={existing.length ? 'Amount Paid Now (₹)' : 'Amount Paid (₹)'} type="number" inputMode="decimal" step="0.01"
        value={amount} onChange={e => onAmount(e.target.value)} placeholder="0" className="text-lg font-semibold" />
      <button type="button"
        onClick={() => onAmount(String(Math.max(0, round2(total - prior))))}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-forest-800 text-white text-sm font-bold active:scale-[0.99]">
        ✓ Mark Fully Paid
      </button>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-700">Balance Payable</label>
          <div className={cn('rounded-lg border px-3 py-2 text-sm font-bold',
            balance > 0.009 ? 'border-red-200 bg-red-50 text-red-600' : balance < -0.009 ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-green-200 bg-green-50 text-green-700')}>
            {fmtINR(Math.abs(balance))}{balance < -0.009 ? ' over' : ''}
          </div>
        </div>
        <Select label="Payment Mode" value={mode} onChange={e => onMode(e.target.value)} options={modes} />
      </div>
      <div className="grid grid-cols-2 gap-2 items-end">
        <Input type="date" label="Payment Date" value={date} onChange={e => onDate(e.target.value)} />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-700">Payment Status</label>
          <div className={cn('rounded-lg border px-3 py-2 text-sm font-bold capitalize',
            status === 'paid' ? 'border-green-200 bg-green-50 text-green-700' : status === 'partial' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-600')}>
            {status === 'overdue' ? 'unpaid' : status}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ Collapsible ============
export const Collapsible: React.FC<{
  title: React.ReactNode;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  tone?: 'gray' | 'forest' | 'gold';
}> = ({ title, right, defaultOpen = false, children, tone = 'gray' }) => {
  const [open, setOpen] = useState(defaultOpen);
  const tones: Record<string, string> = {
    gray: 'bg-gray-50 border-gray-200',
    forest: 'bg-forest-50 border-forest-200',
    gold: 'bg-amber-50/60 border-amber-200',
  };
  return (
    <div className={cn('rounded-lg border', tones[tone])}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        <span className="flex items-center gap-2">
          {right}
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={cn('text-gray-500 transition-transform', open ? 'rotate-180' : '')}
          ><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>
      {open && <div className="px-3 pb-2.5 pt-0.5 space-y-2 border-t border-gray-200/60">{children}</div>}
    </div>
  );
};

// ============ GST Panel (optional per-transaction) ============
export const GSTPanel: React.FC<{
  mode: 'none' | 'exclusive' | 'inclusive';
  rate: string;
  onModeChange: (m: 'none' | 'exclusive' | 'inclusive') => void;
  onRateChange: (r: string) => void;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ mode, rate, onModeChange, onRateChange, summary, defaultOpen }) => (
  <Collapsible
    title="GST / Tax (optional)"
    defaultOpen={defaultOpen ?? mode !== 'none'}
    right={
      <span className={cn(
        'text-[10px] font-medium px-1.5 py-0.5 rounded-full border',
        mode === 'none' ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-forest-700 text-white border-forest-700'
      )}>
        {mode === 'none' ? 'No GST' : `${rate || 0}% ${mode}`}
      </span>
    }
  >
    <div className="grid grid-cols-2 gap-2 pt-1.5">
      <Select
        label="GST Mode"
        value={mode}
        onChange={e => onModeChange(e.target.value as any)}
        options={[
          { value: 'none', label: 'No GST' },
          { value: 'exclusive', label: 'Exclusive (add on)' },
          { value: 'inclusive', label: 'Inclusive' },
        ]}
      />
      <Input
        label="GST Rate %"
        type="number"
        step="0.01"
        value={rate}
        onChange={e => onRateChange(e.target.value)}
        suffix="%"
        disabled={mode === 'none'}
      />
    </div>
    {mode !== 'none' && summary && <div className="pt-1">{summary}</div>}
  </Collapsible>
);

// ============ Helpers ============
export const Header: React.FC<{ title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode }> = ({ title, subtitle, onBack, right }) => (
  <div className="sticky top-0 z-30 bg-forest-700 text-white px-4 py-3 shadow-md safe-bottom">
    <div className="flex items-center gap-2">
      {onBack && (
        <button onClick={onBack} className="p-1 -ml-1 hover:bg-forest-600 rounded-lg">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-base font-bold leading-tight truncate">{title}</h1>
        {subtitle && <p className="text-[11px] text-forest-100 truncate">{subtitle}</p>}
      </div>
      {right}
    </div>
  </div>
);

// Search bar
export const SearchBar: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string }> = ({ value, onChange, placeholder = 'Search...' }) => (
  <div className="relative">
    <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-gray-200 text-sm outline-none focus:border-forest-400"
    />
  </div>
);

// Total bar at bottom of lists
export const TotalBar: React.FC<{ items: { label: string; value: string; tone?: 'green' | 'red' | 'default' | 'gold' }[] }> = ({ items }) => (
  <div className="bg-forest-700 text-white px-3 py-2 flex items-center justify-between gap-2 flex-wrap rounded-t-xl mt-2">
    {items.map((it, i) => (
      <div key={i} className="text-xs">
        <span className="text-forest-200">{it.label}: </span>
        <span className={cn(
          'font-bold',
          it.tone === 'green' ? 'text-green-300' :
          it.tone === 'red' ? 'text-red-300' :
          it.tone === 'gold' ? 'text-gold-400' : 'text-white'
        )}>{it.value}</span>
      </div>
    ))}
  </div>
);

// Payment summary line
export const PaymentSummary: React.FC<{ total: number; paid: number }> = ({ total, paid }) => {
  const pending = total - paid;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500">Total:</span>
      <span className="font-semibold text-gray-900">{fmtINR(total)}</span>
      <span className="text-gray-400">·</span>
      <span className="text-gray-500">Paid:</span>
      <span className="font-semibold text-green-700">{fmtINR(paid)}</span>
      {pending > 0.01 && (
        <>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500">Due:</span>
          <span className="font-semibold text-red-600">{fmtINR(pending)}</span>
        </>
      )}
    </div>
  );
};

// Reusable PaymentForm inline
export const PaymentForm: React.FC<{
  total: number;
  paid: number;
  payments: { id?: string; date: string; amount: number; mode: string; reference?: string }[];
  onChange: (payments: { id?: string; date: string; amount: number; mode: string; reference?: string }[]) => void;
  modeOptions: string[];
}> = ({ total, paid, payments, onChange, modeOptions }) => {
  const pending = Math.max(0, total - paid);
  const [newPay, setNewPay] = useState({ date: today(), amount: pending, mode: modeOptions[0] || 'Cash', reference: '' });

  const addPayment = () => {
    if (newPay.amount <= 0) { toast('Enter valid amount', 'error'); return; }
    onChange([...payments, { ...newPay }]);
    setNewPay({ date: today(), amount: Math.max(0, pending - newPay.amount), mode: modeOptions[0] || 'Cash', reference: '' });
  };
  const removePayment = (idx: number) => {
    onChange(payments.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-700">Payments</label>
        <Button type="button" size="sm" variant="gold" onClick={() => {
          setNewPay(p => ({ ...p, amount: pending }));
        }}>Fully Paid</Button>
      </div>
      {payments.length > 0 && (
        <div className="space-y-1">
          {payments.map((p, i) => (
            <div key={p.id || i} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 text-xs">
              <div>
                <div className="font-medium text-green-800">{p.mode} - {fmtINR(p.amount)}</div>
                <div className="text-[10px] text-green-600">{p.date}{p.reference ? ` · ${p.reference}` : ''}</div>
              </div>
              <button type="button" onClick={() => removePayment(i)} className="text-red-500 text-sm px-1">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-5 gap-1.5">
        <Input type="date" value={newPay.date} onChange={e => setNewPay(p => ({ ...p, date: e.target.value }))} wrapperClassName="col-span-2" />
        <Input type="number" value={newPay.amount} onChange={e => setNewPay(p => ({ ...p, amount: Number(e.target.value) }))} wrapperClassName="col-span-1" placeholder="Amt" />
        <Select value={newPay.mode} onChange={e => setNewPay(p => ({ ...p, mode: e.target.value }))} options={modeOptions} wrapperClassName="col-span-2" />
      </div>
      <Input value={newPay.reference} onChange={e => setNewPay(p => ({ ...p, reference: e.target.value }))} placeholder="Reference / notes (optional)" />
      <Button type="button" variant="secondary" size="sm" className="w-full" onClick={addPayment}>+ Add Payment</Button>
    </div>
  );
};
