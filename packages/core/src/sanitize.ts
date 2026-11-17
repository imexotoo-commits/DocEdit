/**
 * Find and remove hidden information before sharing a document (ISO 32000 references in comments).
 * Sanitizing always rewrites the file from scratch and drops every object that is no longer reachable,
 * which also removes earlier revisions kept by incremental saves.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, PDFString, PDFHexString, type PDFObject } from '@cantoo/pdf-lib';
import { loadDoc, saveDoc } from './document.js';
import { DocEditError } from './errors.js';
import { pruneUnreachable } from './redact.js';
import type { Pdf } from './types.js';

export type HiddenCategory = 'metadata' | 'attachments' | 'comments' | 'scripts' | 'forms' | 'private' | 'revisions' | 'hiddenLayers';

export interface InspectionItem {
  category: HiddenCategory;
  /** how many things were found */
  count: number;
  /** short, human-readable examples (names, keys) */
  examples: string[];
  /** false when sanitize cannot remove this category safely (it is only reported) */
  removable: boolean;
}

/** Actions that run code, start programs, send data or fetch other files (ISO 32000 12.6.4). URI and GoTo are not included. */
const RISKY_ACTIONS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE', 'ResetForm', 'Rendition', 'Movie', 'Sound', 'RichMediaExecute']);
const KEEP_ANNOTS = new Set(['Link', 'Widget']);

const name = (v: PDFObject | undefined) => (v instanceof PDFName ? v.decodeText() : undefined);
const text = (v: PDFObject | undefined) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined);

/** Count incremental-update sections: every revision ends with its own startxref. */
export function countRevisions(bytes: Uint8Array): number {
  const s = Buffer.from(bytes).toString('latin1');
  return (s.match(/startxref\s+\d+\s+%%EOF/g) ?? []).length || 1;
}

export async function inspectDocument(pdf: Pdf): Promise<InspectionItem[]> {
  const doc = await loadDoc(pdf);
  const items: InspectionItem[] = [];
  const add = (category: HiddenCategory, examples: string[], removable = true, count = examples.length) => { if (count) items.push({ category, count, examples: [...new Set(examples)].slice(0, 6), removable }); };
  const cat = doc.catalog;
  const lookup = <T extends PDFObject>(d: PDFDict, k: string, t: { prototype: T }) => d.lookupMaybe(PDFName.of(k), t as never) as T | undefined;

  // metadata: Info dictionary entries and XMP streams
  const meta: string[] = [];
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info instanceof PDFDict) for (const [k, v] of info.entries()) if (text(v) || v) meta.push(`${k.decodeText()}${text(v) ? `: ${text(v)!.slice(0, 40)}` : ''}`);
  if (cat.get(PDFName.of('Metadata'))) meta.push('XMP metadata');
  doc.getPages().forEach((p, i) => { if (p.node.get(PDFName.of('Metadata'))) meta.push(`XMP metadata on page ${i + 1}`); });
  add('metadata', meta);

  // attachments: EmbeddedFiles name tree and file attachment annotations
  const files: string[] = [];
  const names = lookup(cat, 'Names', PDFDict);
  const ef = names && lookup(names, 'EmbeddedFiles', PDFDict);
  if (ef) collectNameTree(ef, (n) => files.push(n));
  // comments and annotation actions
  const comments: string[] = [];
  const scripts: string[] = [];
  doc.getPages().forEach((p, i) => {
    const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const a = annots!.lookup(k);
      if (!(a instanceof PDFDict)) continue;
      const sub = name(a.get(PDFName.of('Subtype'))) ?? '?';
      if (sub === 'FileAttachment') files.push(`attachment on page ${i + 1}`);
      else if (!KEEP_ANNOTS.has(sub) && sub !== 'Popup') comments.push(`${sub} on page ${i + 1}`);
      riskyIn(a, `${sub} on page ${i + 1}`, scripts);
    }
    if (p.node.get(PDFName.of('AA'))) scripts.push(`page ${i + 1} open/close actions`);
  });
  add('attachments', files);
  add('comments', comments);

  // scripts: document JavaScript, open action, catalog and field actions
  const js = names && lookup(names, 'JavaScript', PDFDict);
  if (js) collectNameTree(js, (n) => scripts.push(`document script “${n}”`));
  const open = cat.lookup(PDFName.of('OpenAction'));
  const openRisk = open instanceof PDFDict ? riskyInChain(open) : undefined;
  if (openRisk) scripts.push(`open action (${openRisk})`);
  walkOutline(cat, (item, title) => { const r = riskyInChain(item.lookup(PDFName.of('A'))); if (r) scripts.push(`${r} action on bookmark “${title}”`); });
  if (cat.get(PDFName.of('AA'))) scripts.push('document actions');
  const acro = lookup(cat, 'AcroForm', PDFDict);
  const fieldNames: string[] = [];
  if (acro) {
    walkFields(lookup(acro, 'Fields', PDFArray), (f, n) => {
      fieldNames.push(n);
      if (f.get(PDFName.of('AA'))) scripts.push(`field “${n}” actions`);
    });
    if (acro.get(PDFName.of('XFA'))) fieldNames.push('XFA form data');
  }
  add('scripts', scripts);
  add('forms', fieldNames);

  // private data: page thumbnails, application data dictionaries
  const priv: string[] = [];
  if (cat.get(PDFName.of('PieceInfo'))) priv.push('application data (document)');
  doc.getPages().forEach((p, i) => {
    if (p.node.get(PDFName.of('Thumb'))) priv.push(`thumbnail of page ${i + 1}`);
    if (p.node.get(PDFName.of('PieceInfo'))) priv.push(`application data on page ${i + 1}`);
  });
  if (cat.get(PDFName.of('SpiderInfo'))) priv.push('web capture data');
  add('private', priv);

  // revisions kept in the file by incremental saves
  const revs = countRevisions(pdf);
  if (revs > 1) add('revisions', [`${revs - 1} earlier revision${revs === 2 ? '' : 's'}`], true, revs - 1);

  // layers that are switched off: their content is inside the page streams
  const ocp = lookup(cat, 'OCProperties', PDFDict);
  const d = ocp && lookup(ocp, 'D', PDFDict);
  const off = d && lookup(d, 'OFF', PDFArray);
  const hidden: string[] = [];
  for (let k = 0; k < (off?.size() ?? 0); k++) { const g = off!.lookup(k); if (g instanceof PDFDict) hidden.push(text(g.get(PDFName.of('Name'))) ?? 'unnamed layer'); }
  add('hiddenLayers', hidden, false);
  return items;
}

/** Remove the chosen categories. Always rewrites the file and prunes unreachable objects. */
export async function sanitizeDocument(pdf: Pdf, remove: HiddenCategory[]): Promise<Pdf> {
  const want = new Set(remove);
  if (want.has('hiddenLayers')) throw new DocEditError('Hidden layers cannot be removed automatically; redact the pages that contain them instead.', 'UNSUPPORTED');
  const doc = await loadDoc(pdf);
  const cat = doc.catalog;
  const ctx = doc.context;
  const names = cat.lookupMaybe(PDFName.of('Names'), PDFDict);

  if (want.has('metadata')) {
    ctx.trailerInfo.Info = ctx.register(ctx.obj({}));
    cat.delete(PDFName.of('Metadata'));
    for (const p of doc.getPages()) p.node.delete(PDFName.of('Metadata'));
  }
  if (want.has('attachments')) {
    names?.delete(PDFName.of('EmbeddedFiles'));
    cat.delete(PDFName.of('AF'));
    filterAnnots(doc, (sub) => sub !== 'FileAttachment');
  }
  if (want.has('comments')) filterAnnots(doc, (sub) => KEEP_ANNOTS.has(sub));
  if (want.has('scripts')) {
    names?.delete(PDFName.of('JavaScript'));
    cat.delete(PDFName.of('AA'));
    const open = cat.lookup(PDFName.of('OpenAction'));
    if (open instanceof PDFDict) { if (riskyInChain(open)) cat.delete(PDFName.of('OpenAction')); else open.delete(PDFName.of('Next')); }
    walkOutline(cat, (item) => { item.delete(PDFName.of('AA')); stripRisky(item); });
    for (const p of doc.getPages()) {
      p.node.delete(PDFName.of('AA'));
      const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      for (let k = 0; k < (annots?.size() ?? 0); k++) { const a = annots!.lookup(k); if (a instanceof PDFDict) stripRisky(a); }
    }
    const acro = cat.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (acro) walkFields(acro.lookupMaybe(PDFName.of('Fields'), PDFArray), (f) => f.delete(PDFName.of('AA')));
  }
  if (want.has('forms')) {
    const form = doc.getForm();
    form.flatten(); // values stay visible as page content, the fields themselves go
    cat.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.delete(PDFName.of('XFA'));
    cat.delete(PDFName.of('AcroForm'));
  }
  if (want.has('private')) {
    cat.delete(PDFName.of('PieceInfo'));
    cat.delete(PDFName.of('SpiderInfo'));
    for (const p of doc.getPages()) { p.node.delete(PDFName.of('Thumb')); p.node.delete(PDFName.of('PieceInfo')); }
  }
  pruneUnreachable(doc);
  // a fresh file (no earlier revisions), with readable structure so anyone can check what is left
  return saveDoc(doc, { objectStreams: false });
}

// ---------------------------------------------------------------- helpers

function collectNameTree(node: PDFDict, visit: (name: string) => void, depth = 0) {
  if (depth > 32) return;
  const arr = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  for (let i = 0; i + 1 < (arr?.size() ?? 0); i += 2) visit(text(arr!.lookup(i)) ?? '(unnamed)');
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
  for (let i = 0; i < (kids?.size() ?? 0); i++) { const k = kids!.lookup(i); if (k instanceof PDFDict) collectNameTree(k, visit, depth + 1); }
}

function walkFields(fields: PDFArray | undefined, visit: (f: PDFDict, name: string) => void, prefix = '', depth = 0) {
  if (!fields || depth > 32) return;
  for (let i = 0; i < fields.size(); i++) {
    const f = fields.lookup(i);
    if (!(f instanceof PDFDict)) continue;
    const t = text(f.get(PDFName.of('T')));
    const full = t ? (prefix ? `${prefix}.${t}` : t) : prefix;
    if (t) visit(f, full);
    walkFields(f.lookupMaybe(PDFName.of('Kids'), PDFArray), visit, full, depth + 1);
  }
}

/** Record risky actions of an annotation: /A (and its /Next chain) and /AA. */
function riskyIn(a: PDFDict, where: string, out: string[]) {
  let act = a.lookup(PDFName.of('A'));
  for (let n = 0; act instanceof PDFDict && n < 16; n++) {
    const s = name(act.get(PDFName.of('S')));
    if (s && RISKY_ACTIONS.has(s)) out.push(`${s} action on ${where}`);
    act = act.lookup(PDFName.of('Next'));
  }
  if (a.get(PDFName.of('AA'))) out.push(`actions on ${where}`);
}

function stripRisky(a: PDFDict) {
  a.delete(PDFName.of('AA'));
  const act = a.lookup(PDFName.of('A'));
  if (!(act instanceof PDFDict)) return;
  if (riskyInChain(act)) a.delete(PDFName.of('A'));
  else act.delete(PDFName.of('Next')); // a safe first action may chain to a risky one
}

/** The first risky action type anywhere in an action and its /Next chain (a dictionary or an array of them). */
function riskyInChain(first: unknown): string | undefined {
  const stack: unknown[] = [first];
  const seen = new Set<unknown>();
  for (let n = 0; stack.length && n < 256; n++) {
    const act = stack.pop();
    if (act instanceof PDFArray) { for (let i = 0; i < act.size(); i++) stack.push(act.lookup(i)); continue; }
    if (!(act instanceof PDFDict) || seen.has(act)) continue;
    seen.add(act);
    const s = name(act.get(PDFName.of('S')));
    if (s && RISKY_ACTIONS.has(s)) return s;
    stack.push(act.lookup(PDFName.of('Next')));
  }
  return undefined;
}

/** Visit every bookmark (outline item), following /First and /Next with a visit cap so loops cannot hang. */
function walkOutline(cat: PDFDict, visit: (item: PDFDict, title: string) => void) {
  const root = cat.lookup(PDFName.of('Outlines'));
  if (!(root instanceof PDFDict)) return;
  const seen = new Set<PDFDict>([root]);
  const stack: unknown[] = [root.lookup(PDFName.of('First'))];
  while (stack.length && seen.size < 100000) {
    const item = stack.pop();
    if (!(item instanceof PDFDict) || seen.has(item)) continue;
    seen.add(item);
    visit(item, text(item.get(PDFName.of('Title'))) ?? '');
    stack.push(item.lookup(PDFName.of('Next')), item.lookup(PDFName.of('First')));
  }
}

function filterAnnots(doc: PDFDocument, keep: (subtype: string) => boolean) {
  for (const p of doc.getPages()) {
    const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    const kept: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const raw = annots.get(i);
      const a = annots.lookup(i);
      const sub = a instanceof PDFDict ? name(a.get(PDFName.of('Subtype'))) ?? '' : '';
      // popups belong to the comment they open
      if (sub === 'Popup') { const parent = (a as PDFDict).lookup(PDFName.of('Parent')); const ps = parent instanceof PDFDict ? name(parent.get(PDFName.of('Subtype'))) ?? '' : ''; if (keep(ps)) kept.push(raw); continue; }
      if (keep(sub)) kept.push(raw);
    }
    p.node.set(PDFName.of('Annots'), doc.context.obj(kept as never));
  }
}

void PDFRef; void PDFStream;
