import { useState } from 'react';
import { round2 } from '../db';
import { toast } from './ui';

/**
 * Manual rounding of a payable total.
 *  - dir 'up'  => "Round Total Up"   (hulling):  230.50 -> 231.00
 *  - dir 'down'=> "Round Total Down" (purchase): 230.50 -> 230.00
 * Nothing is ever rounded automatically, and a total can only be rounded once.
 * The original (pre-rounding) total and the adjustment are both returned for storing.
 */
export function useRoundedTotal(computed: number, dir: 'up' | 'down') {
  const [finalOverride, setFinalOverride] = useState<string | null>(null);
  const [roundAdj, setRoundAdj] = useState(0);
  const [roundFrom, setRoundFrom] = useState(0);

  const manual = finalOverride !== null;
  // A rounding only stays applied while the figure it was taken from is unchanged
  const adj = manual ? roundAdj : (roundAdj !== 0 && Math.abs(computed - roundFrom) < 0.005 ? roundAdj : 0);
  const final = manual ? round2(Number(finalOverride) || 0) : round2(computed + adj);
  const original = manual ? round2(final - adj) : round2(computed);

  const round = () => {
    if (adj !== 0) { toast('Total is already rounded - tap Recalculate to undo', 'error'); return; }
    const cur = final;
    const target = dir === 'up' ? Math.ceil(cur - 1e-9) : Math.floor(cur + 1e-9);
    const delta = round2(target - cur);
    if (delta === 0) { toast('Total is already a whole rupee amount', 'info'); return; }
    if (manual) setFinalOverride(String(target));
    setRoundAdj(delta);
    setRoundFrom(manual ? cur : computed);
  };
  const setManual = (v: string) => { setFinalOverride(v); setRoundAdj(0); };
  const recalc = () => { setFinalOverride(null); setRoundAdj(0); };
  const reset = (init?: { final: number; roundAdj: number; original: number; manual: boolean }) => {
    if (!init) { setFinalOverride(null); setRoundAdj(0); setRoundFrom(0); return; }
    if (init.manual) { setFinalOverride(String(init.final)); setRoundAdj(init.roundAdj); setRoundFrom(init.original); }
    else { setFinalOverride(null); setRoundAdj(init.roundAdj); setRoundFrom(init.original); }
  };

  return { final, original, adj, manual, finalOverride, round, setManual, recalc, reset };
}
