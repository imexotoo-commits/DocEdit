/** Deciding which page loads are PDFs, for the browsers that cannot do it with request rules. */
import { normalUrl } from './address.js';

export interface PdfResponse { url: string; method: string; type: string; headers: Array<{ name: string; value?: string }> }

const web = (url: string) => /^https?:\/\//i.test(url);
const endsInPdf = (url: string) => /^https?:\/\/[^?#]*\.pdf([?#].*)?$/i.test(url);
const header = (h: PdfResponse['headers'], name: string) => h.find((x) => x.name.toLowerCase() === name)?.value?.trim() ?? '';

/**
 * Whether a main-page load is a PDF the viewer should take over, judged by what the server says (the same rule the
 * Chromium build gives the browser as request rules): a GET of a web address answered as a PDF, or as plain bytes when the
 * address ends in .pdf, and not marked as a download (Content-Disposition: attachment). Returns the address, or null.
 */
export function pdfResponseAddress(r: PdfResponse): string | null {
  if (r.type !== 'main_frame' || r.method.toUpperCase() !== 'GET' || !web(r.url)) return null;
  if (/^attachment/i.test(header(r.headers, 'content-disposition'))) return null;
  const type = header(r.headers, 'content-type').toLowerCase();
  const isPdf = type === 'application/pdf' || type.startsWith('application/pdf;') || type.startsWith('application/x-pdf');
  const isBytes = type.startsWith('application/octet-stream') || type.startsWith('binary/octet-stream');
  if (isPdf || (isBytes && endsInPdf(r.url))) return normalUrl(r.url);
  return null;
}

/** Safari cannot see response headers: a web address whose path ends in .pdf is taken to be a PDF. */
export function pdfAddress(url: string): string | null {
  return endsInPdf(url) ? normalUrl(url) : null;
}
