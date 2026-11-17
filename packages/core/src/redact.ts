import { PDFDocument, PDFName, PDFRef, PDFDict, PDFArray, PDFStream, PDFObject, PDFString, PDFHexString, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from '@cantoo/pdf-lib';
import { loadDoc, saveDoc } from './document.js';
import { PageRangeError } from './errors.js';
import type { RasterPage, Rasterizer } from './render.js';
import { findText, type FindOptions, type TextOptions } from './text.js';
import type { Pdf, Rect } from './types.js';

/** An area to destroy: page index (0-based) and a rectangle in user space. */
export interface RedactionMark { page: number; rect: Rect }

/** Turn a text search into redaction marks (one per text run touched). Review them before applying. */
export async function findRedactionMarks(pdf: Pdf, query: string | RegExp, opts: FindOptions = {}): Promise<RedactionMark[]> {
  const matches = await findText(pdf, query, { padding: 1, ...opts });
  return matches.flatMap((m) => m.rects.map((rect) => ({ page: m.page, rect })));
}

export interface RedactOptions {
  /** render resolution, default 200 dpi. Higher = sharper and bigger file. */
  dpi?: number;
  /** fill colour of the redaction box, default black */ fill?: [number, number, number];
  /** drop /Link annotations on kept pages (they can point at redacted pages). Default true. */
  stripLinks?: boolean;
  /**
   * Strings that must not survive anywhere. On pages without marks, any annotation or form field whose text
   * (contents, rich text, field value, title, subject) contains one of them is removed. Without this, unmarked
   * pages keep their annotations and form values as they are.
   */
  secrets?: string[];
}

/**
 * TRUE redaction by rasterizing. Every page that has marks is rendered to pixels, the marked areas are painted over in the
 * pixel buffer, and the page is replaced by that picture in a NEW document. Nothing of the original page (text, vector art,
 * fonts, hidden layers, old revisions) is copied, so there is nothing left to recover. Pages without marks are copied unchanged.
 * Trade-offs (documented in docs/REDACTION.md): redacted pages are no longer selectable text, files get larger,
 * annotations/links on redacted pages are lost, document outline/metadata are not carried over.
 */
export async function applyRedactions(pdf: Pdf, marks: RedactionMark[], rasterizer: Rasterizer, opts: RedactOptions = {}): Promise<Pdf> {
  const src = await loadDoc(pdf);
  const n = src.getPageCount();
  for (const m of marks) {
    if (!Number.isInteger(m.page) || m.page < 0 || m.page >= n) throw new PageRangeError(`Redaction on page ${m.page + 1} but the document has ${n}`);
    if (![m.rect.x, m.rect.y, m.rect.width, m.rect.height].every(Number.isFinite) || m.rect.width <= 0 || m.rect.height <= 0) throw new PageRangeError(`Redaction area on page ${m.page + 1} is not a valid rectangle`);
  }
  if (marks.length === 0) return pdf;
  const byPage = new Map<number, RedactionMark[]>();
  for (const m of marks) byPage.set(m.page, [...(byPage.get(m.page) ?? []), m]);
  const scale = (opts.dpi ?? 200) / 72;
  const fill = opts.fill ?? [0, 0, 0];
  const secrets = normalizeSecrets(opts.secrets);

  const out = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < n; i++) {
    const hits = byPage.get(i);
    if (!hits) {
      const [copied] = await out.copyPages(src, [i]);
      if (opts.stripLinks ?? true) stripLinkAnnots(copied!);
      if (secrets.length) stripSecretAnnots(copied!, secrets);
      out.addPage(copied!);
      continue;
    }
    const raster = await rasterizer.renderPage(pdf, i, scale);
    // a mark with nothing of it on the visible page (outside the crop box, say) would hide nothing: refuse it
    if (hits.some((h) => !pixelBox(raster, h.rect))) throw new PageRangeError(`A redaction area on page ${i + 1} is outside the visible page, so it would hide nothing`);
    for (const h of hits) burn(raster, h.rect, fill);
    const page = out.addPage([raster.width / raster.scale, raster.height / raster.scale]);
    const rgb = new Uint8Array(raster.width * raster.height * 3);
    for (let s = 0, d = 0; s < raster.data.length; s += 4, d += 3) { rgb[d] = raster.data[s]!; rgb[d + 1] = raster.data[s + 1]!; rgb[d + 2] = raster.data[s + 2]!; }
    const ref = out.context.register(out.context.flateStream(rgb, {
      Type: 'XObject', Subtype: 'Image', Width: raster.width, Height: raster.height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    }));
    const name = page.node.newXObject('Redacted', ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(page.getWidth(), 0, 0, page.getHeight(), 0, 0), drawObject(name), popGraphicsState());
  }
  out.setProducer('docedit'); out.setCreator('docedit'); out.setTitle(''); out.setAuthor(''); out.setSubject(''); out.setKeywords([]);
  pruneUnreachable(out);
  return saveDoc(out, { objectStreams: false });
}

function burn(r: RasterPage, rect: Rect, fill: [number, number, number]): void {
  const box = pixelBox(r, rect);
  if (!box) return;
  const [x0, y0, x1, y1] = box;
  const R = Math.round(fill[0] * 255), G = Math.round(fill[1] * 255), B = Math.round(fill[2] * 255);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * r.width + x) * 4; r.data[o] = R; r.data[o + 1] = G; r.data[o + 2] = B; r.data[o + 3] = 255; }
}

const normText = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
function normalizeSecrets(list: string[] | undefined): string[] { return [...new Set((list ?? []).map(normText).filter((x) => x.length >= 2))]; }

const TEXT_KEYS = ['Contents', 'RC', 'V', 'DV', 'T', 'TU', 'Subj', 'TM'];
/** Text carried by an annotation and, for form widgets, by its field ancestors. Bounded walk; /P and /Popup are skipped. */
function annotText(a: PDFDict): string[] {
  const out: string[] = [];
  let d: PDFDict | undefined = a;
  for (let depth = 0; d && depth < 32; depth++) {
    for (const k of TEXT_KEYS) collectStrings(d.lookup(PDFName.of(k)), out, 0);
    const parent: PDFObject | undefined = d.lookup(PDFName.of('Parent'));
    d = parent instanceof PDFDict && parent !== d ? parent : undefined;
  }
  return out;
}
function collectStrings(o: PDFObject | undefined, out: string[], depth: number): void {
  if (!o || depth > 8) return;
  if (o instanceof PDFString || o instanceof PDFHexString) out.push(o.decodeText());
  else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) collectStrings(o.lookup(i), out, depth + 1);
  else if (o instanceof PDFStream) { try { out.push(new TextDecoder('latin1').decode(o.getContents())); } catch { /* undecodable stream */ } }
}
function hasSecret(text: string[], secrets: string[]): string | undefined {
  const joined = normText(text.join(' '));
  return secrets.find((x) => joined.includes(x));
}

function stripSecretAnnots(page: import('@cantoo/pdf-lib').PDFPage, secrets: string[]): void {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return;
  const keep: PDFRef[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    const dict = page.doc.context.lookupMaybe(ref, PDFDict);
    if (dict && hasSecret(annotText(dict), secrets)) continue;
    if (ref instanceof PDFRef) keep.push(ref);
  }
  if (keep.length === annots.size()) return;
  if (keep.length === 0) page.node.delete(PDFName.of('Annots'));
  else page.node.set(PDFName.of('Annots'), page.doc.context.obj(keep));
}

function stripLinkAnnots(page: import('@cantoo/pdf-lib').PDFPage): void {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return;
  const keep: PDFRef[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    const dict = page.doc.context.lookupMaybe(ref, PDFDict);
    if (dict?.get(PDFName.of('Subtype')) !== PDFName.of('Link') && ref instanceof PDFRef) keep.push(ref);
  }
  if (keep.length === 0) page.node.delete(PDFName.of('Annots'));
  else page.node.set(PDFName.of('Annots'), page.doc.context.obj(keep));
}

/** After redacting, search the result for the secrets again. Returns what is still findable (should be empty). */
export async function verifyRedaction(pdf: Pdf, secrets: string[], opts: TextOptions = {}): Promise<{ secret: string; page: number; where?: 'annotation' }[]> {
  const left: { secret: string; page: number; where?: 'annotation' }[] = [];
  for (const s of secrets) for (const m of await findText(pdf, s, opts)) left.push({ secret: s, page: m.page });
  // annotations and form field values are not page text: look at them separately
  const wanted = normalizeSecrets(secrets);
  if (wanted.length) {
    const doc = await loadDoc(pdf);
    doc.getPages().forEach((p, i) => {
      const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      for (let k = 0; k < (annots?.size() ?? 0); k++) {
        const a = annots!.lookup(k);
        const hit = a instanceof PDFDict ? hasSecret(annotText(a), wanted) : undefined;
        if (hit) left.push({ secret: hit, page: i, where: 'annotation' });
      }
    });
  }
  return left;
}


/**
 * pdf-lib never garbage-collects: an object you detach from a page is still written to the file. For redaction that would
 * leave removed content in the bytes, so delete every indirect object that cannot be reached from the catalog or Info dictionary.
 */
export function pruneUnreachable(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<PDFRef>();
  const visit = (o: PDFObject | undefined): void => {
    if (!o) return;
    if (o instanceof PDFRef) { if (seen.has(o)) return; seen.add(o); visit(ctx.lookup(o)); }
    else if (o instanceof PDFDict) for (const [, v] of o.entries()) visit(v);
    else if (o instanceof PDFStream) visit(o.dict);
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) visit(o.get(i));
  };
  visit(ctx.trailerInfo.Root); visit(ctx.trailerInfo.Info);
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref)) { ctx.delete(ref); removed++; }
  return removed;
}

export interface CoverageProblem {
  /** index into the marks array */
  mark: number;
  page: number;
  reason: 'off-page' | 'not-covered';
  /** pixels inside the mark that are not the fill colour */
  uncovered?: number;
}

/**
 * Independent check of a redaction result: every mark must fall on its page, and every pixel inside it
 * must be the opaque fill colour in the output. The mark is located on the ORIGINAL page with the same
 * rasterizer and the same rounding as the burn step (a redacted page becomes an unrotated picture of the
 * page as displayed), then the whole interior is examined in the output, not a sample.
 * Returns the problems found; an empty list means full coverage.
 */
export async function checkRedactionCoverage(before: Pdf, after: Pdf, marks: RedactionMark[], rasterizer: Rasterizer, opts: { scale?: number; fill?: [number, number, number]; tolerance?: number } = {}): Promise<CoverageProblem[]> {
  const scale = opts.scale ?? 1.5;
  const fill = (opts.fill ?? [0, 0, 0]).map((c) => Math.round(c * 255));
  const tol = opts.tolerance ?? 48;
  const problems: CoverageProblem[] = [];
  const pages = [...new Set(marks.map((m) => m.page))];
  for (const page of pages) {
    const rb = await rasterizer.renderPage(before, page, scale);
    const ra = await rasterizer.renderPage(after, page, scale);
    marks.forEach((m, k) => {
      if (m.page !== page) return;
      const box = pixelBox(rb, m.rect);
      if (!box) { problems.push({ mark: k, page, reason: 'off-page' }); return; }
      // stay one pixel inside the box: resampling the output picture can soften its very edge
      const [x0, y0, x1, y1] = box[2] - box[0] > 2 && box[3] - box[1] > 2 ? [box[0] + 1, box[1] + 1, box[2] - 1, box[3] - 1] : box;
      let bad = 0;
      for (let y = y0; y < Math.min(y1, ra.height); y++) {
        for (let x = x0; x < Math.min(x1, ra.width); x++) {
          const o = (y * ra.width + x) * 4;
          if (ra.data[o + 3]! < 255 || Math.abs(ra.data[o]! - fill[0]!) > tol || Math.abs(ra.data[o + 1]! - fill[1]!) > tol || Math.abs(ra.data[o + 2]! - fill[2]!) > tol) bad++;
        }
      }
      // pixels of the box beyond the output picture's edge are not covered either
      bad += Math.max(0, x1 - ra.width) * (y1 - y0) + Math.max(0, y1 - ra.height) * (x1 - x0);
      if (bad) problems.push({ mark: k, page, reason: 'not-covered', uncovered: bad });
    });
  }
  return problems;
}

/** The pixel box burn() fills for a rectangle, clipped to the raster; null when nothing of it is on the page. */
function pixelBox(r: RasterPage, rect: Rect): [number, number, number, number] | null {
  const [a, b, c, d, e, f] = r.transform;
  const pts = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
    .map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f] as const);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))), x1 = Math.min(r.width, Math.ceil(Math.max(...pts.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))), y1 = Math.min(r.height, Math.ceil(Math.max(...pts.map((p) => p[1]))));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}
