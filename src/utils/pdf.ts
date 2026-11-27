import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { printHtml, VOUCHER_CSS } from './print';

/** Native "save as" dialog (Android Storage Access Framework). Implemented in FileSavePlugin.java. */
interface FileSavePlugin {
  saveFile(o: { filename: string; mimeType: string; data: string }): Promise<{ uri: string }>;
}
export const FileSave = registerPlugin<FileSavePlugin>('FileSave');
export const isNative = () => Capacitor.isNativePlatform();

export const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 80);

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Renders HTML in an isolated frame (no app CSS) and returns an A4 PDF. Long bills continue on extra pages. */
export async function htmlToPdf(bodyHtml: string): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0';
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}#pdf-root{width:700px;padding:0}${VOUCHER_CSS}</style></head><body><div id="pdf-root">${bodyHtml}</div></body></html>`);
    doc.close();
    await new Promise(r => setTimeout(r, 300));
    try { await (doc as any).fonts?.ready; } catch { /* ignore */ }
    const root = doc.getElementById('pdf-root')!;
    const canvas = await html2canvas(root, { scale: 2, backgroundColor: '#ffffff', windowWidth: 794, logging: false });
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    const margin = 28, imgW = pageW - margin * 2;
    const pxPerPt = canvas.width / imgW;
    const sliceH = Math.floor((pageH - margin * 2) * pxPerPt);
    for (let y = 0, first = true; y < canvas.height; y += sliceH, first = false) {
      const h = Math.min(sliceH, canvas.height - y);
      const slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = h;
      slice.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, h / pxPerPt);
    }
    return pdf.output('blob');
  } finally {
    iframe.remove();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Opens the system share sheet with the PDF attached (WhatsApp, Gmail, Drive, ...). */
export async function sharePdf(title: string, filename: string, bodyHtml: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await htmlToPdf(bodyHtml);
  if (isNative()) {
    const w = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
    try {
      await Share.share({ title, dialogTitle: 'Share PDF', files: [w.uri] });
      return 'shared';
    } catch (e: any) {
      if (/cancel/i.test(String(e?.message))) return 'cancelled';
      throw e;
    }
  }
  const file = new File([blob], filename, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; }
    catch (e: any) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

/** Asks where to save the PDF (Android save dialog / desktop save dialog). Falls back to the print dialog. */
export async function savePdf(title: string, filename: string, bodyHtml: string): Promise<'saved' | 'printed' | 'cancelled'> {
  if (isNative()) {
    const blob = await htmlToPdf(bodyHtml);
    try {
      await FileSave.saveFile({ filename, mimeType: 'application/pdf', data: await blobToBase64(blob) });
      return 'saved';
    } catch (e: any) {
      if (/cancel/i.test(String(e?.message))) return 'cancelled';
      throw e;
    }
  }
  const w = window as any;
  if (typeof w.showSaveFilePicker === 'function') {
    const blob = await htmlToPdf(bodyHtml);
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }] });
      const wr = await handle.createWritable();
      await wr.write(blob); await wr.close();
      return 'saved';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }
  printHtml(title, bodyHtml); // browsers without a save dialog: the print dialog offers "Save as PDF" with a location prompt
  return 'printed';
}

/** Asks where to save any file (CSV, JSON, ...). Android save dialog / desktop save dialog / plain download as the last resort. */
export async function saveFile(filename: string, mimeType: string, blob: Blob): Promise<'saved' | 'downloaded' | 'cancelled'> {
  if (isNative()) {
    try {
      await FileSave.saveFile({ filename, mimeType, data: await blobToBase64(blob) });
      return 'saved';
    } catch (e: any) {
      if (/cancel/i.test(String(e?.message))) return 'cancelled';
      throw e;
    }
  }
  const w = window as any;
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
      const handle = await w.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'File', accept: { [mimeType]: ext ? [ext] : [] } }] });
      const wr = await handle.createWritable();
      await wr.write(blob); await wr.close();
      return 'saved';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
