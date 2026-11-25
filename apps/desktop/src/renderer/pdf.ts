/** pdf.js setup for the renderer: loading documents safely and reading what the editor needs up front. */
import { hasDigitalSignature } from './signedBytes.js';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
export { pdfjs };

/** Size of a page at scale 1 with its own /Rotate applied, plus that rotation. */
export interface PageGeometry {
  width: number; height: number; rotate: number;
  /** visible box in user space [x0, y0, x1, y1] (crop box), as pdf.js page.view */
  view: number[];
}

export interface LoadedSource {
  doc: PDFDocumentProxy;
  pages: PageGeometry[];
  /** page labels from the file (e.g. "iii", "A-1"), or null when the file defines none */
  labels: string[] | null;
  /** Things that a page-level save does not carry over yet, so the user can be told before saving. */
  notes: { outline: boolean; formFields: boolean; signatures: boolean };
}

export class PdfOpenError extends Error {
  constructor(message: string, readonly needsPassword = false) { super(message); }
}

/** How long opening one file may take. A normal document opens in well under a second; a file built to stall the parser never finishes. */
export const OPEN_TIMEOUT_MS = 30_000;

/** `password`: for a protected file viewed without decrypting it first (the browser viewer). */
export async function loadSource(bytes: Uint8Array, name: string, password?: string): Promise<LoadedSource> {
  let doc: PDFDocumentProxy;
  const deadline = Date.now() + OPEN_TIMEOUT_MS;
  let timedOut = false;
  const tooSlow = () => new PdfOpenError(`“${name}” took longer than ${OPEN_TIMEOUT_MS / 1000} seconds to open, so it was stopped. The file may be damaged or built to stall PDF readers.`);
  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of (detaches) the buffer it is given
    enableXfa: false,
    cMapUrl: './pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: './pdfjs/standard_fonts/',
    // JPEG 2000 and JBIG2 images (scans) and colour profiles. Absolute, because pdf.js's worker fetches these and would read a
    // relative address against its own folder.
    wasmUrl: new URL('./pdfjs/wasm/', document.baseURI).href,
    iccUrl: new URL('./pdfjs/iccs/', document.baseURI).href,
    ...(password !== undefined ? { password } : {}),
  });
  const timer = setTimeout(() => { timedOut = true; void task.destroy(); }, OPEN_TIMEOUT_MS);
  try {
    doc = await task.promise;
  } catch (err) {
    if (timedOut) throw tooSlow();
    const n = (err as { name?: string })?.name;
    if (n === 'PasswordException') throw new PdfOpenError(password !== undefined ? 'The password is not correct.' : `“${name}” is password-protected.`, true);
    if (n === 'InvalidPDFException') throw new PdfOpenError(`“${name}” is damaged or is not a valid PDF.`);
    throw new PdfOpenError(`Could not open “${name}”: ${err instanceof Error ? err.message : String(err)}`);
  } finally { clearTimeout(timer); }
  const pages: PageGeometry[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (Date.now() > deadline) { void doc.loadingTask.destroy(); throw tooSlow(); } // a page tree built to be endless
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ width: vp.width, height: vp.height, rotate: page.rotate, view: [...page.view] });
  }
  const labels = await doc.getPageLabels().catch(() => null);
  const [outline, fields] = await Promise.all([doc.getOutline().catch(() => null), doc.getFieldObjects().catch(() => null)]);
  const allFields = fields ? Object.values(fields).flat() as Array<{ type?: string }> : [];
  return {
    doc, pages, labels,
    notes: {
      outline: !!outline && outline.length > 0,
      formFields: allFields.length > 0,
      signatures: hasDigitalSignature(bytes) || allFields.some((f) => f.type === 'signature'),
    },
  };
}

/** Displayed size at scale 1 once the user's extra rotation is added. */
export function displaySize(g: { width: number; height: number }, extraRotate: number): { width: number; height: number } {
  // g is already in the page's own rotation; a quarter turn more swaps the sides.
  return extraRotate % 180 === 0 ? { width: g.width, height: g.height } : { width: g.height, height: g.width };
}
