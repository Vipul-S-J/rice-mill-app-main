/** Colour themes. The palette lives in index.css (html[data-theme=...]); this only picks and remembers one. */
export const THEMES = [
  { id: 'emerald', label: 'Emerald', swatch: '#0f6e48' },
  { id: 'ocean', label: 'Ocean', swatch: '#1d4ed8' },
  { id: 'sunset', label: 'Sunset', swatch: '#c2410c' },
  { id: 'violet', label: 'Violet', swatch: '#6d28d9' },
  { id: 'graphite', label: 'Graphite', swatch: '#334155' },
] as const;
export type ThemeId = typeof THEMES[number]['id'];
const KEY = 'sprm-theme';

export function getTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY) as ThemeId | null;
    if (v && THEMES.some(t => t.id === v)) return v;
  } catch { /* storage unavailable */ }
  return 'emerald';
}
export function applyTheme(id: ThemeId) {
  const t = THEMES.find(x => x.id === id) || THEMES[0];
  document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.swatch);
  try { localStorage.setItem(KEY, t.id); } catch { /* ignore */ }
}
