/** Escape text before putting it into generated HTML */
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Stylesheet shared by the on-screen voucher preview and the printed/saved PDF so both always match */
export const VOUCHER_CSS = `
.vch{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1f2937;font-size:12px;line-height:1.45}
.vch h1{margin:0;font-size:19px;color:#1b4332}
.vch .c{text-align:center;border-bottom:2px solid #1b4332;padding-bottom:8px;margin-bottom:10px}
.vch .muted{color:#6b7280;font-size:11px}
.vch .row{display:flex;justify-content:space-between;gap:10px;margin-bottom:10px}
.vch table{width:100%;border-collapse:collapse;margin:6px 0}
.vch th{background:#f0f7f3;color:#1b4332;font-size:10px;text-transform:uppercase;letter-spacing:.03em;text-align:left;padding:5px 6px}
.vch td{padding:5px 6px;border-bottom:1px solid #eee;vertical-align:top}
.vch .r{text-align:right}
.vch .b{font-weight:700}
.vch .tot td{background:#f0f7f3;font-weight:700;font-size:13px;border-top:1.5px solid #1b4332}
.vch .h{font-weight:700;color:#1b4332;margin:10px 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.vch .g{color:#15803d}.vch .red{color:#dc2626}.vch .gold{color:#a17d17}
.vch .sig{display:flex;gap:28px;margin-top:38px}
.vch .sig div{flex:1;border-top:1px solid #6b7280;padding-top:3px;text-align:center;font-size:10px;color:#4b5563}
.vch .ft{text-align:center;margin-top:12px;font-size:10px;color:#6b7280}
`;

/** Opens the device print dialog (choose "Save as PDF" to keep a PDF copy). Uses a hidden frame - no pop-up needed. */
export function printHtml(title: string, bodyHtml: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) { iframe.remove(); return; }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>@page{margin:12mm}body{margin:0;padding:6px}${VOUCHER_CSS}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  setTimeout(() => {
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ }
    setTimeout(() => iframe.remove(), 4000);
  }, 350);
}

/** Share a plain-text summary using the phone's share sheet; falls back to copying to clipboard. */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
  } catch (e: any) {
    if (e && e.name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
