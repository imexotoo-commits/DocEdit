import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFPage, PDFRef, PDFString, degrees, type PDFObject } from '@cantoo/pdf-lib';
import { pruneUnreachable } from './redact.js';
import { loadDoc, saveDoc } from './document.js';
import { PageRangeError } from './errors.js';
import { parsePageRange } from './pageRange.js';
import type { Pdf, Rect } from './types.js';

export interface MergeInput { pdf: Pdf; /** page selection, default all, e.g. "1-3,7" */ pages?: string }

/** Concatenate PDFs (optionally only some pages of each) into one new document. */
export async function mergePdfs(inputs: MergeInput[]): Promise<Pdf> {
  if (inputs.length === 0) throw new PageRangeError('mergePdfs needs at least one input');
  const out = await PDFDocument.create();
  for (const input of inputs) {
    const src = await loadDoc(input.pdf);
    const idx = input.pages ? parsePageRange(input.pages, src.getPageCount()) : src.getPageIndices();
    for (const p of await out.copyPages(src, idx)) out.addPage(p);
  }
  return saveDoc(out);
}

/** Pages in the given order (duplicates allowed): extract, reorder and duplicate in one function. */
export async function selectPages(pdf: Pdf, spec: string): Promise<Pdf> {
  const src = await loadDoc(pdf);
  const idx = parsePageRange(spec, src.getPageCount());
  if (idx.length === 0) throw new PageRangeError('Selection is empty');
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, idx)) out.addPage(p);
  return saveDoc(out);
}
export const extractPages = selectPages;
export const reorderPages = selectPages;

/** Remove pages. Refuses to remove every page. */
export async function deletePages(pdf: Pdf, spec: string): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  const drop = new Set(parsePageRange(spec, doc.getPageCount(), { unique: true }));
  if (drop.size >= doc.getPageCount()) throw new PageRangeError('Cannot delete every page');
  [...drop].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
  return saveDoc(doc);
}

/** Split into several PDFs. `chunks` = e.g. ["1-3", "4-6", "7-"], or a number N for N pages per file. */
export async function splitPdf(pdf: Pdf, chunks: string[] | number): Promise<Pdf[]> {
  if (typeof chunks === 'number' && (!Number.isInteger(chunks) || chunks < 1)) throw new PageRangeError('Pages per file must be a whole number of at least 1');
  if (Array.isArray(chunks) && chunks.length === 0) throw new PageRangeError('Give at least one page range');
  const doc = await loadDoc(pdf);
  const n = doc.getPageCount();
  const specs = typeof chunks === 'number'
    ? Array.from({ length: Math.ceil(n / chunks) }, (_, i) => `${i * chunks + 1}-${Math.min(n, (i + 1) * chunks)}`)
    : chunks;
  const out: Pdf[] = [];
  for (const s of specs) out.push(await selectPages(pdf, s));
  return out;
}

/** Rotate pages by a multiple of 90 degrees, added to the current rotation. */
export async function rotatePages(pdf: Pdf, spec: string, byDegrees: number): Promise<Pdf> {
  if (byDegrees % 90 !== 0) throw new PageRangeError('Rotation must be a multiple of 90');
  const doc = await loadDoc(pdf);
  for (const i of parsePageRange(spec, doc.getPageCount(), { unique: true })) {
    const page = doc.getPage(i);
    page.setRotation(degrees((((page.getRotation().angle + byDegrees) % 360) + 360) % 360));
  }
  return saveDoc(doc);
}

/** Insert a blank page of the given size (points) at a 1-based position (n+1 = append). */
export async function insertBlankPage(pdf: Pdf, position: number, size: [number, number] = [612, 792]): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  if (position < 1 || position > doc.getPageCount() + 1) throw new PageRangeError(`Position ${position} is outside 1-${doc.getPageCount() + 1}`);
  doc.insertPage(position - 1, size);
  return saveDoc(doc);
}

/** Set the visible crop box of pages (user space). Content outside stays in the file: not a redaction. */
export async function cropPages(pdf: Pdf, spec: string, box: { x: number; y: number; width: number; height: number }): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  for (const i of parsePageRange(spec, doc.getPageCount(), { unique: true })) doc.getPage(i).setCropBox(box.x, box.y, box.width, box.height);
  return saveDoc(doc);
}

/** One page of an arranged document: a page of one of the sources, or a blank page. */
export type PageSlot =
  | {
    /** index into `sources` */ source: number; /** 0-based page index in that source */ page: number;
    /** degrees added to the page's own rotation, multiple of 90 */ rotate?: number;
    /** new visible area (crop box) in the page's user space; content outside stays in the file */ crop?: Rect;
  }
  | { /** blank page size in points */ blank: [number, number] };

/**
 * Build a new document from an ordered list of page slots taken from one or more sources.
 * Covers reorder, duplicate, delete, rotate, insert blank and insert-from-file in a single pass,
 * which is what an editor's page list saves as. Metadata comes from the first source.
 * Not carried over: outlines/bookmarks and AcroForm fields (the copied page widgets stay visible).
 */
export async function arrangePages(sources: Pdf[], slots: PageSlot[]): Promise<Pdf> {
  if (slots.length === 0) throw new PageRangeError('A document needs at least one page');
  const docs = await Promise.all(sources.map((s) => loadDoc(s)));
  docs.forEach(resolveNamedLinks); // these are private copies, safe to change
  docs.forEach(linksToPageNumbers);
  const out = await PDFDocument.create();
  const first = docs[0];
  if (first) {
    const t = first.getTitle(), a = first.getAuthor(), s = first.getSubject(), k = first.getKeywords(), c = first.getCreationDate();
    if (t) out.setTitle(t); if (a) out.setAuthor(a); if (s) out.setSubject(s); if (k) out.setKeywords([k]); if (c) out.setCreationDate(c);
  }
  // copy each source's needed pages in one call so shared resources are copied once
  const wanted = docs.map(() => new Set<number>());
  for (const slot of slots) {
    if ('blank' in slot) continue;
    const doc = docs[slot.source];
    if (!doc) throw new PageRangeError(`Unknown source ${slot.source}`);
    if (!Number.isInteger(slot.page) || slot.page < 0 || slot.page >= doc.getPageCount()) throw new PageRangeError(`Page ${slot.page + 1} is outside 1-${doc.getPageCount()} of source ${slot.source + 1}`);
    if ((slot.rotate ?? 0) % 90 !== 0) throw new PageRangeError('Rotation must be a multiple of 90');
    wanted[slot.source]!.add(slot.page);
  }
  const copied = new Map<string, Awaited<ReturnType<PDFDocument['copyPages']>>[number]>();
  for (const [si, set] of wanted.entries()) {
    const idx = [...set];
    const pages = await out.copyPages(docs[si]!, idx);
    idx.forEach((p, i) => copied.set(`${si}:${p}`, pages[i]!));
  }
  const used = new Set<string>();
  const sourceOf: number[] = []; // for each output page: its source (-1 for blanks)
  const outRefOf = new Map<string, PDFRef>(); // "source:page" -> first output page made from it
  for (const slot of slots) {
    if ('blank' in slot) { out.addPage(slot.blank); sourceOf.push(-1); continue; }
    const key = `${slot.source}:${slot.page}`;
    // a page object can appear only once in a page tree: duplicates get a fresh copy
    const page = used.has(key) ? (await out.copyPages(docs[slot.source]!, [slot.page]))[0]! : copied.get(key)!;
    used.add(key);
    const r = (((page.getRotation().angle + (slot.rotate ?? 0)) % 360) + 360) % 360;
    page.setRotation(degrees(r));
    if (slot.crop) {
      const { x, y, width, height } = slot.crop;
      if (!(width > 1 && height > 1) || ![x, y, width, height].every(Number.isFinite)) throw new PageRangeError('Crop area is too small');
      page.setCropBox(x, y, width, height);
    }
    out.addPage(page);
    sourceOf.push(slot.source);
    if (!outRefOf.has(key)) outRefOf.set(key, page.ref);
  }
  relinkPages(out, sourceOf, outRefOf);
  pruneUnreachable(out);
  return saveDoc(out);
}

type LinkDest = PDFArray;

/** Internal-link destinations of a document's pages: [page index of the annotation, destination array]. */
function internalLinks(doc: PDFDocument): Array<[number, LinkDest, PDFDict, PDFPage]> {
  const out: Array<[number, LinkDest, PDFDict, PDFPage]> = [];
  doc.getPages().forEach((page, i) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const a = annots!.lookup(k);
      if (!(a instanceof PDFDict) || a.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
      const action = a.lookup(PDFName.of('A'));
      const dest = a.lookup(PDFName.of('Dest')) ?? (action instanceof PDFDict && action.get(PDFName.of('S'))?.toString() === '/GoTo' ? action.lookup(PDFName.of('D')) : undefined);
      if (dest instanceof PDFArray) out.push([i, dest, a, page]);
    }
  });
  return out;
}

/**
 * Before copying: links that name their target ("chapter-2") instead of giving it get the destination the name
 * stands for, written into the link itself. The copy has no name catalog, so a named link would otherwise point
 * nowhere; once explicit, it is remapped (or dropped with its page) like any other. View parameters are kept.
 */
function resolveNamedLinks(doc: PDFDocument) {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('Dests'), PDFDict);
  const legacy = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  const key = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : null);
  /** Look a name up in the name tree (strings), then in the older /Dests dictionary (names). */
  const lookup = (name: string): PDFArray | undefined => {
    const inTree = (node: PDFDict | undefined, depth: number): PDFObject | undefined => {
      if (!node || depth > 32) return undefined;
      const pairs = node.lookupMaybe(PDFName.of('Names'), PDFArray);
      for (let i = 0; pairs && i + 1 < pairs.size(); i += 2) if (key(pairs.lookup(i)) === name) return pairs.lookup(i + 1);
      const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
      for (let i = 0; kids && i < kids.size(); i++) {
        const kid = kids.lookup(i);
        if (!(kid instanceof PDFDict)) continue;
        const lim = kid.lookupMaybe(PDFName.of('Limits'), PDFArray);
        const lo = lim && key(lim.lookup(0)), hi = lim && key(lim.lookup(1));
        if (lo != null && hi != null && (name < lo || name > hi)) continue;
        const found = inTree(kid, depth + 1);
        if (found) return found;
      }
      return undefined;
    };
    let d = inTree(names, 0) ?? legacy?.lookup(PDFName.of(name));
    if (d instanceof PDFDict) d = d.lookup(PDFName.of('D')); // { /D [page /XYZ ...] }
    return d instanceof PDFArray ? d : undefined;
  };
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const a = annots!.lookup(k);
      if (!(a instanceof PDFDict) || a.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
      const action = a.lookup(PDFName.of('A'));
      const goTo = action instanceof PDFDict && action.get(PDFName.of('S'))?.toString() === '/GoTo' ? action : null;
      const [holder, slot] = a.has(PDFName.of('Dest')) ? [a, 'Dest'] : goTo ? [goTo, 'D'] : [null, ''];
      const name = holder && key(holder.lookup(PDFName.of(slot)));
      if (!holder || name == null) continue;
      const target = lookup(name);
      // a copy of the array, so two links sharing one named destination are remapped independently
      if (target) holder.set(PDFName.of(slot), doc.context.obj(Array.from({ length: target.size() }, (_, i) => target.get(i)) as never));
    }
  }
}

/**
 * Before copying: replace each link's target page (an object reference) by its page number, so copying a
 * page does not drag along a separate copy of the page its links point to.
 */
function linksToPageNumbers(doc: PDFDocument) {
  const index = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  for (const [, dest] of internalLinks(doc)) {
    const first = dest.get(0);
    if (first instanceof PDFRef && index.has(first.toString())) dest.set(0, PDFNumber.of(index.get(first.toString())!));
  }
}

/**
 * After copying: point each link (now holding a source page number) at that page in the new document,
 * or remove the link when that page was left out.
 */
function relinkPages(out: PDFDocument, sourceOf: number[], outRefOf: Map<string, PDFRef>) {
  const drop = new Map<PDFPage, Set<PDFDict>>();
  for (const [pageIndex, dest, annot, page] of internalLinks(out)) {
    const first = dest.get(0);
    if (!(first instanceof PDFNumber)) continue;
    const ref = outRefOf.get(`${sourceOf[pageIndex]}:${first.asNumber()}`);
    if (ref) dest.set(0, ref);
    else { if (!drop.has(page)) drop.set(page, new Set()); drop.get(page)!.add(annot); }
  }
  for (const [page, gone] of drop) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)!;
    const kept: PDFObject[] = [];
    for (let k = 0; k < annots.size(); k++) if (!gone.has(annots.lookup(k) as PDFDict)) kept.push(annots.get(k));
    page.node.set(PDFName.of('Annots'), out.context.obj(kept as never));
  }
}
