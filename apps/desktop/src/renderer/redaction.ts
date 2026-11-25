/**
 * Permanent redaction in the app. The core's applyRedactions does the destruction (marked pages are
 * replaced by pictures in a new document, everything unreachable is pruned); this module supplies a
 * pdf.js rasterizer and then checks the result independently before anything is written:
 *  1. no text under any mark (nor any search term used to make marks) is extractable anywhere;
 *  2. those strings do not occur in the raw file bytes;
 *  3. every marked area is dark when the output is rendered;
 *  4. every redacted page has no extractable text at all (it is a picture).
 * If any check fails the result is discarded (fail closed).
 */
import { applyRedactions, checkRedactionCoverage, type RedactionMark, type Rasterizer, type RasterPage } from '@docedit/core';
import { loadSource, type LoadedSource } from './pdf.js';
import { buildPageText, type TextItemLike } from './textGeometry.js';

export class PdfJsRasterizer implements Rasterizer {
  private cache = new Map<Uint8Array, Promise<LoadedSource>>();
  async renderPage(pdf: Uint8Array, pageIndex: number, scale: number): Promise<RasterPage> {
    let src = this.cache.get(pdf);
    if (!src) { src = loadSource(pdf, 'redaction'); this.cache.set(pdf, src); }
    const page = await (await src).doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: null, canvasContext: ctx, viewport, intent: 'print' }).promise;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    canvas.width = 0; canvas.height = 0;
    return { width: Math.round(viewport.width), height: Math.round(viewport.height), data, transform: viewport.transform as RasterPage['transform'], scale };
  }
  async close() { for (const s of this.cache.values()) void (await s).doc.loadingTask.destroy(); this.cache.clear(); }
}

export interface RedactionCheck { label: string; ok: boolean; detail?: string }
export interface RedactionResult { bytes: Uint8Array | null; checks: RedactionCheck[]; redactedPages: number }

/**
 * @param laidOut the document as it would be saved (page order and other edits applied)
 * @param marks marks on that document's pages
 * @param secrets strings that must not survive (text under marks and search terms)
 */
export async function redact(laidOut: Uint8Array, marks: RedactionMark[], secrets: string[], dpi: number, onStep: (s: string) => void): Promise<RedactionResult> {
  const ras = new PdfJsRasterizer();
  try {
    onStep('Removing marked content…');
    const out = await applyRedactions(laidOut, marks, ras, { dpi, secrets });
    onStep('Checking the result…');
    const checks = await verify(laidOut, out, marks, secrets);
    return { bytes: checks.every((c) => c.ok) ? out : null, checks, redactedPages: new Set(marks.map((m) => m.page)).size };
  } finally { await ras.close(); }
}

async function verify(before: Uint8Array, out: Uint8Array, marks: RedactionMark[], secrets: string[]): Promise<RedactionCheck[]> {
  const checks: RedactionCheck[] = [];
  const src = await loadSource(out, 'redacted');
  try {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const wanted = [...new Set(secrets.map(norm).filter((s) => s.length >= 2))];
    // 1 + 4: text extraction
    const found = new Set<string>();
    const textOnRedacted: number[] = [];
    const redactedPages = new Set(marks.map((m) => m.page));
    for (let i = 0; i < src.doc.numPages; i++) {
      const tc = await (await src.doc.getPage(i + 1)).getTextContent();
      const text = norm(buildPageText(tc.items.filter((x): x is typeof x & TextItemLike => 'str' in x)).text);
      for (const w of wanted) if (text.includes(w)) found.add(w);
      if (redactedPages.has(i) && text.length) textOnRedacted.push(i + 1);
    }
    checks.push({ label: 'Redacted text cannot be extracted', ok: found.size === 0, detail: found.size ? `Still found: ${[...found].slice(0, 5).join(', ')}` : `${wanted.length} string${wanted.length === 1 ? '' : 's'} checked on ${src.doc.numPages} pages` });
    checks.push({ label: 'Redacted pages contain no text', ok: textOnRedacted.length === 0, detail: textOnRedacted.length ? `Text remains on page ${textOnRedacted.join(', ')}` : `${redactedPages.size} page${redactedPages.size === 1 ? '' : 's'}` });
    // 2: the file bytes, with every compressed stream inflated (Latin-1 and UTF-16BE spellings)
    const raw = (await deepText(out)).toLowerCase();
    const utf16 = (s: string) => Array.from(s).map((c) => '\0' + c).join('');
    const inBytes = wanted.filter((w) => raw.includes(w) || raw.includes(utf16(w)));
    checks.push({ label: 'Redacted text is not in the file bytes', ok: inBytes.length === 0, detail: inBytes.length ? `Found: ${inBytes.slice(0, 5).join(', ')}` : 'including compressed streams' });
    // 3: every pixel inside every mark is opaque fill in the output (core check, same rasterizer and
    // rounding as the burn step; marks that miss their page fail)
    const checker = new PdfJsRasterizer();
    const coverage = await checkRedactionCoverage(before, out, marks, checker).finally(() => checker.close());
    const offPage = coverage.filter((c) => c.reason === 'off-page').length, uncovered = coverage.filter((c) => c.reason === 'not-covered').length;
    checks.push({ label: 'Every marked area is fully covered', ok: coverage.length === 0, detail: coverage.length ? [offPage ? `${offPage} mark${offPage === 1 ? ' is' : 's are'} outside the page` : '', uncovered ? `${uncovered} mark${uncovered === 1 ? ' is' : 's are'} not fully covered` : ''].filter(Boolean).join('; ') : `${marks.length} mark${marks.length === 1 ? '' : 's'}, every pixel checked` });
  } finally { void src.doc.loadingTask.destroy(); }
  return checks;
}


/** The file as text: raw bytes plus every Flate stream inflated, so a search cannot miss compressed content. */
export async function deepText(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder('latin1').decode(bytes);
  const parts = [raw];
  const re = /stream\r?\n/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    try {
      const ds = new Blob([bytes.slice(start, end)]).stream().pipeThrough(new DecompressionStream('deflate'));
      parts.push(new TextDecoder('latin1').decode(await new Response(ds).arrayBuffer()));
    } catch { /* not a Flate stream */ }
  }
  return parts.join('\n');
}
