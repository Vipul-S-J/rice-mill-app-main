import { savePdf, sharePdf, safeName } from '../utils/pdf';
import { shareText } from '../utils/print';
import { toast } from './ui';

/** Share button: builds the PDF and opens the share sheet. If the PDF cannot be built, falls back to a text summary. */
export async function sharePdfWithToast(title: string, html: string, fallbackText: string) {
  toast('Preparing PDF…', 'info');
  try {
    const r = await sharePdf(title, safeName(title) + '.pdf', html);
    if (r === 'downloaded') toast('PDF downloaded. Attach it from your files to share.');
  } catch {
    const r = await shareText(title, fallbackText);
    if (r === 'copied') toast('PDF not available here. Summary copied; paste it in WhatsApp.', 'info');
    else if (r === 'failed') toast('Sharing is not available on this device', 'error');
  }
}
/** Print / Save PDF button: asks where to save the PDF. */
export async function savePdfWithToast(title: string, html: string) {
  toast('Preparing PDF…', 'info');
  try {
    const r = await savePdf(title, safeName(title) + '.pdf', html);
    if (r === 'saved') toast('PDF saved to the location you chose');
  } catch (e: any) {
    toast(`Could not save the PDF: ${e?.message || 'unknown error'}`, 'error');
  }
}
