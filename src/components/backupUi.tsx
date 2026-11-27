import { useEffect, useState } from 'react';
import { Input } from './ui';
import { loadAuto, patchAuto } from '../backup/auto';
import type { AutoSettings } from '../backup/auto';

export const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const fmtWhen = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export function useAutoSettings(): [AutoSettings, (p: Partial<AutoSettings>) => void] {
  const [s, setS] = useState<AutoSettings>(loadAuto);
  useEffect(() => {
    const h = () => setS(loadAuto());
    window.addEventListener('sprm-backup-settings', h);
    return () => window.removeEventListener('sprm-backup-settings', h);
  }, []);
  return [s, p => setS(patchAuto(p))];
}

export const checkPw = (pw: string, pw2: string): string | null =>
  pw.length < 8 ? 'Use at least 8 characters for the password' : pw !== pw2 ? 'The two passwords do not match' : null;

export function PasswordFields({ pw, pw2, setPw, setPw2 }: { pw: string; pw2: string; setPw: (v: string) => void; setPw2: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Input label="Backup password" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 8 characters" />
      <Input label="Confirm password" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
      <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
        ⚠ If you forget this password the encrypted backup <b>cannot be opened by anyone</b>. The password is never stored or sent anywhere. Write it down somewhere safe.
      </div>
    </div>
  );
}
