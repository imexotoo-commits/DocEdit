/**
 * Content edits applied in one pass: load once, apply an ordered list, save once.
 * Page indices refer to the document being edited (0-based). Text uses an embedded font when one is
 * given (full Unicode coverage of that font), otherwise Helvetica (Western European only).
 *
 * Positions of page furniture (watermarks, headers, footers) are given relative to the page as it is
 * displayed - after /Rotate and within the crop box - so a header stays at the visual top of a turned page.
 */
import {
  PDFArray, PDFDocument, PDFFont, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFPage, PDFRef, PDFString, StandardFonts,
  appendBezierCurve, beginText, closePath, degrees, endText, fill, lineTo, moveTo, popGraphicsState, pushGraphicsState,
  rgb, setFillingRgbColor, setFontAndSize, setGraphicsState, setLineWidth, setStrokingRgbColor, showText, stroke,
  PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, LineCapStyle,
} from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import { loadDoc, saveDoc } from './document.js';
import { DocEditError, PageRangeError } from './errors.js';
import { drawImageFitted, type ImageBytes } from './stamp.js';
import type { Color, Metadata, Pdf, Rect } from './types.js';
import { assertImageSize } from './guard.js';

export type Corner = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

/** Header/footer text may use {page} (number in this document), {total}, {date}, {bates}. */
export interface FurnitureText { position: Corner; text: string }

export type AnnotationSpec =
  | { kind: 'highlight' | 'underline' | 'strikeout'; /** one rectangle per line, user space */ rects: Rect[]; color?: Color; opacity?: number; note?: string }
  | { kind: 'note'; at: { x: number; y: number }; text: string; color?: Color }
  | { kind: 'freetext'; rect: Rect; text: string; size?: number; color?: Color }
  | { kind: 'square' | 'circle'; rect: Rect; color?: Color; width?: number; note?: string }
  | { kind: 'ink'; /** strokes of points, user space */ paths: Array<Array<{ x: number; y: number }>>; color?: Color; width?: number; note?: string };

/** A fill-and-sign mark drawn into the page content (not an annotation), like ink on paper. */
export type MarkSpec =
  | { shape: 'check' | 'cross' | 'dot' | 'box'; /** user space */ rect: Rect }
  | { shape: 'line'; from: { x: number; y: number }; to: { x: number; y: number } };

export interface OutlineEntry { title: string; /** 0-based page index */ page: number; children?: OutlineEntry[] }

export type DocEdit =
  | { type: 'metadata'; meta: Metadata }
  | { type: 'fill'; values: Record<string, string | boolean | string[]> }
  | { type: 'flatten' }
  | { type: 'watermark'; pages: number[]; text: string; size?: number; color?: Color; opacity?: number; angle?: number }
  | {
    type: 'furniture'; pages: number[]; items: FurnitureText[]; size?: number; margin?: number; color?: Color;
    /** {page} starts at this number for the first page of the document */ startPage?: number;
    /** {bates}: prefix + zero-padded number, counted over the pages it is applied to, in order */ bates?: { prefix?: string; start?: number; digits?: number; suffix?: string };
    /** text used for {date} */ date?: string;
  }
  | { type: 'image'; page: number; rect: Rect; image: ImageBytes; opacity?: number }
  | { type: 'signature'; page: number; rect: Rect; image?: ImageBytes; typedName?: string; caption?: string }
  | { type: 'annotation'; page: number; annotation: AnnotationSpec; author?: string }
  | { type: 'outline'; entries: OutlineEntry[] }
  | { type: 'mark'; page: number; mark: MarkSpec; color?: Color }
  | { type: 'link'; page: number; rect: Rect; target: { page: number } | { url: string } };

export interface ApplyEditsOptions { font?: Uint8Array }

export async function applyEdits(pdf: Pdf, edits: DocEdit[], opts: ApplyEditsOptions = {}): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  const fonts = new FontCache(doc, opts.font);
  const n = doc.getPageCount();
  const page = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new PageRangeError(`Page ${i + 1} is outside 1-${n}`);
    return doc.getPage(i);
  };
  for (const e of edits) {
    switch (e.type) {
      case 'metadata': applyMetadata(doc, e.meta); break;
      case 'fill': fillForm(doc, e.values); break;
      case 'flatten': doc.getForm().flatten(); break;
      case 'watermark': for (const i of e.pages) await watermark(page(i), e, await fonts.get(e.text, true)); break;
      case 'furniture': await furniture(doc, e, page, fonts); break;
      case 'image': drawImageFitted(page(e.page), await embedImage(doc, e.image), e.rect, e.opacity ?? 1); break;
      case 'signature': await signature(doc, page(e.page), e, fonts); break;
      case 'annotation': await annotate(doc, page(e.page), e.annotation, e.author, fonts); break;
      case 'outline': writeOutline(doc, e.entries); break;
      case 'link': addLink(doc, page(e.page), e.rect, e.target, n); break;
      case 'mark': drawMark(page(e.page), e.mark, e.color); break;
    }
  }
  return saveDoc(doc);
}

// ---------------------------------------------------------------- fonts

class FontCache {
  private std = new Map<string, PDFFont>();
  private custom: PDFFont | null = null;
  constructor(private doc: PDFDocument, private bytes?: Uint8Array) {}
  /** Helvetica when the text is plain Western European and no font was given, otherwise the embedded font. */
  async get(text: string, bold = false): Promise<PDFFont> {
    if (this.bytes && !isWinAnsi(text)) {
      if (!this.custom) { this.doc.registerFontkit(fontkit); this.custom = await this.doc.embedFont(this.bytes, { subset: true }); }
      return this.custom;
    }
    const name = bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
    let f = this.std.get(name);
    if (!f) { f = await this.doc.embedFont(name); this.std.set(name, f); }
    return f;
  }
}

/** Characters the standard fonts can encode (WinAnsi). */
function isWinAnsi(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c > 0x7e && c < 0xa0 && c !== 0x80) || (c > 0xff && !'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.includes(ch))) return false;
  }
  return true;
}

// ---------------------------------------------------------------- displayed frame

/** Size of the page as displayed, and a mapping from displayed coordinates (origin bottom-left, y up) to user space. */
export function displayFrame(page: PDFPage): { width: number; height: number; rotation: number; toUser(x: number, y: number): { x: number; y: number } } {
  const box = page.getCropBox();
  const x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const turned = r === 90 || r === 270;
  return {
    width: turned ? box.height : box.width,
    height: turned ? box.width : box.height,
    rotation: r,
    toUser(X, Y) {
      switch (r) {
        case 90: return { x: x1 - Y, y: y0 + X };
        case 180: return { x: x1 - X, y: y1 - Y };
        case 270: return { x: x0 + Y, y: y1 - X };
        default: return { x: x0 + X, y: y0 + Y };
      }
    },
  };
}

/** The inverse of displayFrame().toUser: user space to displayed coordinates. */
function toDisplayed(page: PDFPage, x: number, y: number): { x: number; y: number } {
  const box = page.getCropBox();
  const x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
  switch (((page.getRotation().angle % 360) + 360) % 360) {
    case 90: return { x: y - y0, y: x1 - x };
    case 180: return { x: x1 - x, y: y1 - y };
    case 270: return { x: y1 - y, y: x - x0 };
    default: return { x: x - x0, y: y - y0 };
  }
}

/** Check and cross strokes in a unit square, y up, as the page is displayed. */
const MARK_STROKES: Record<'check' | 'cross', Array<[number, number, number, number]>> = {
  check: [[0.1, 0.5, 0.38, 0.16], [0.38, 0.16, 0.9, 0.86]],
  cross: [[0.14, 0.14, 0.86, 0.86], [0.14, 0.86, 0.86, 0.14]],
};

function drawMark(page: PDFPage, m: MarkSpec, c: Color = [0.08, 0.08, 0.1]) {
  const color = rgb(...c);
  if (m.shape === 'line') { page.drawLine({ start: m.from, end: m.to, thickness: 1.5, color, lineCap: LineCapStyle.Round }); return; }
  const { x, y, width: w, height: h } = m.rect;
  const s = Math.min(w, h);
  if (!(s > 0)) return;
  if (m.shape === 'box') { page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: Math.max(0.75, s * 0.06) }); return; }
  if (m.shape === 'dot') { page.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: s * 0.32, yScale: s * 0.32, color }); return; }
  // upright as displayed, whatever the page's /Rotate
  const a = toDisplayed(page, x, y), b = toDisplayed(page, x + w, y + h);
  const X = Math.min(a.x, b.x), Y = Math.min(a.y, b.y), W = Math.abs(a.x - b.x), H = Math.abs(a.y - b.y);
  const f = displayFrame(page);
  for (const [u1, v1, u2, v2] of MARK_STROKES[m.shape]) {
    page.drawLine({ start: f.toUser(X + u1 * W, Y + v1 * H), end: f.toUser(X + u2 * W, Y + v2 * H), thickness: Math.max(1, s * 0.12), color, lineCap: LineCapStyle.Round });
  }
}

/** Draw a line of text whose baseline starts at displayed (X, Y), reading left to right as displayed. */
function drawDisplayedText(page: PDFPage, text: string, X: number, Y: number, size: number, font: PDFFont, color: Color, opacity = 1, extraAngle = 0) {
  const f = displayFrame(page);
  const p = f.toUser(X, Y);
  page.drawText(text, { x: p.x, y: p.y, size, font, color: rgb(...color), opacity, rotate: degrees(f.rotation + extraAngle) });
}

// ---------------------------------------------------------------- edits

function applyMetadata(doc: PDFDocument, m: Metadata) {
  if (m.title !== undefined) doc.setTitle(m.title, { showInWindowTitleBar: !!m.title });
  if (m.author !== undefined) doc.setAuthor(m.author);
  if (m.subject !== undefined) doc.setSubject(m.subject);
  if (m.keywords !== undefined) doc.setKeywords([m.keywords.join(', ')]);
  if (m.creator !== undefined) doc.setCreator(m.creator);
  if (m.producer !== undefined) doc.setProducer(m.producer);
  if (m.creationDate) doc.setCreationDate(m.creationDate);
  doc.setModificationDate(m.modificationDate ?? new Date());
}

function fillForm(doc: PDFDocument, values: Record<string, string | boolean | string[]>) {
  const form = doc.getForm();
  for (const [name, v] of Object.entries(values)) {
    const f = form.getFieldMaybe(name);
    if (!f) throw new DocEditError(`No form field named "${name}"`, 'NO_SUCH_FIELD');
    if (f instanceof PDFTextField) f.setText(String(v));
    else if (f instanceof PDFCheckBox) (v ? f.check() : f.uncheck());
    else if (f instanceof PDFRadioGroup) f.select(radioOption(f, String(v)));
    else if (f instanceof PDFDropdown) f.select(String(v));
    else if (f instanceof PDFOptionList) f.select(Array.isArray(v) ? v : [String(v)]);
    else throw new DocEditError(`Field "${name}" cannot be filled`, 'UNFILLABLE');
  }
  form.updateFieldAppearances();
}

/** A radio choice given either as its option name or as the on-state name of one of its buttons. */
function radioOption(f: PDFRadioGroup, v: string): string {
  const options = f.getOptions();
  if (options.includes(v)) return v;
  const widgets = f.acroField.getWidgets();
  const i = widgets.findIndex((w) => w.getOnValue()?.decodeText() === v);
  if (i >= 0 && options[i] !== undefined) return options[i]!;
  throw new DocEditError(`“${v}” is not a choice of ${f.getName()} (choices: ${options.join(', ')})`, 'BAD_VALUE');
}

async function watermark(page: PDFPage, o: Extract<DocEdit, { type: 'watermark' }>, font: PDFFont) {
  const f = displayFrame(page);
  const angle = o.angle ?? 45;
  // shrink so the text fits within the page diagonal
  let size = o.size ?? 60;
  const rad = (angle * Math.PI) / 180;
  const reach = Math.abs(Math.cos(rad)) * f.width + Math.abs(Math.sin(rad)) * f.height;
  while (size > 8 && font.widthOfTextAtSize(o.text, size) > reach * 0.85) size -= 2;
  const tw = font.widthOfTextAtSize(o.text, size), th = size * 0.7;
  // start point so the text box centre is the page centre (displayed coordinates)
  const X = f.width / 2 - (tw / 2) * Math.cos(rad) + (th / 2) * Math.sin(rad);
  const Y = f.height / 2 - (tw / 2) * Math.sin(rad) - (th / 2) * Math.cos(rad);
  drawDisplayedText(page, o.text, X, Y, size, font, o.color ?? [0.55, 0.55, 0.55], o.opacity ?? 0.3, angle);
}

export function formatBates(n: number, b: NonNullable<Extract<DocEdit, { type: 'furniture' }>['bates']>): string {
  return `${b.prefix ?? ''}${String(n).padStart(b.digits ?? 6, '0')}${b.suffix ?? ''}`;
}

async function furniture(doc: PDFDocument, o: Extract<DocEdit, { type: 'furniture' }>, page: (i: number) => PDFPage, fonts: FontCache) {
  const size = o.size ?? 10, margin = o.margin ?? 28, color = o.color ?? [0, 0, 0];
  const total = doc.getPageCount();
  const sorted = [...new Set(o.pages)].sort((a, b) => a - b);
  for (const [k, i] of sorted.entries()) {
    const p = page(i);
    const f = displayFrame(p);
    for (const item of o.items) {
      const text = item.text
        .replaceAll('{page}', String((o.startPage ?? 1) + i))
        .replaceAll('{total}', String(total))
        .replaceAll('{date}', o.date ?? new Date().toISOString().slice(0, 10))
        .replaceAll('{bates}', o.bates ? formatBates((o.bates.start ?? 1) + k, o.bates) : '');
      if (!text) continue;
      const font = await fonts.get(text);
      const tw = font.widthOfTextAtSize(text, size);
      const X = item.position.endsWith('left') ? margin : item.position.endsWith('right') ? f.width - margin - tw : (f.width - tw) / 2;
      const Y = item.position.startsWith('top') ? f.height - margin - size * 0.75 : margin;
      drawDisplayedText(p, text, X, Y, size, font, color);
    }
  }
}

async function embedImage(doc: PDFDocument, image: ImageBytes) {
  assertImageSize(image.bytes);
  return image.format === 'png' ? doc.embedPng(image.bytes) : doc.embedJpg(image.bytes);
}

async function signature(doc: PDFDocument, page: PDFPage, s: Extract<DocEdit, { type: 'signature' }>, fonts: FontCache) {
  if (!s.image && !s.typedName) throw new DocEditError('A signature needs an image or a typed name', 'BAD_SIGNATURE');
  const captionH = s.caption ? 10 : 0;
  const box = { ...s.rect, y: s.rect.y + captionH, height: s.rect.height - captionH };
  if (s.image) drawImageFitted(page, await embedImage(doc, s.image), box);
  else if (s.typedName) {
    const font = isWinAnsi(s.typedName) ? await doc.embedFont(StandardFonts.TimesRomanItalic) : await fonts.get(s.typedName);
    let size = box.height * 0.7;
    while (size > 6 && font.widthOfTextAtSize(s.typedName, size) > box.width) size -= 1;
    page.drawText(s.typedName, { x: box.x, y: box.y + (box.height - size) / 2, size, font, color: rgb(0.05, 0.1, 0.45) });
  }
  if (s.caption) {
    const font = await fonts.get(s.caption);
    page.drawLine({ start: { x: s.rect.x, y: s.rect.y + captionH }, end: { x: s.rect.x + s.rect.width, y: s.rect.y + captionH }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(s.caption, { x: s.rect.x, y: s.rect.y + 1, size: 7, font, color: rgb(0.3, 0.3, 0.3) });
  }
}

// ---------------------------------------------------------------- annotations (ISO 32000 12.5)

const op = (name: string, ...args: Array<number | PDFName>) => PDFOperator.of(name as never, args.map((a) => (typeof a === 'number' ? PDFNumber.of(a) : a)));
const pdfText = (s: string) => PDFHexString.fromText(s);
const pdfDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return PDFString.of(`D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`);
};

function union(rects: Rect[], pad = 0): [number, number, number, number] {
  const x0 = Math.min(...rects.map((r) => r.x)) - pad, y0 = Math.min(...rects.map((r) => r.y)) - pad;
  const x1 = Math.max(...rects.map((r) => r.x + r.width)) + pad, y1 = Math.max(...rects.map((r) => r.y + r.height)) + pad;
  return [x0, y0, x1, y1];
}

async function annotate(doc: PDFDocument, page: PDFPage, a: AnnotationSpec, author: string | undefined, fonts: FontCache) {
  const ctx = doc.context;
  const color = a.color ?? (a.kind === 'highlight' ? [1, 0.85, 0.1] : a.kind === 'note' ? [1, 0.8, 0.2] : [0.85, 0.1, 0.1]);
  const [r, g, b] = color;
  const dict: Record<string, unknown> = {
    Type: 'Annot', F: 4, C: [r, g, b], M: pdfDate(new Date()), NM: pdfText(`docedit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`), P: page.ref,
  };
  if (author) dict.T = pdfText(author);
  let bbox: [number, number, number, number];
  let ops: PDFOperator[] = [];
  const resources: Record<string, unknown> = {};

  switch (a.kind) {
    case 'highlight': case 'underline': case 'strikeout': {
      if (!a.rects.length) throw new DocEditError('Nothing to mark', 'BAD_ANNOTATION');
      dict.Subtype = a.kind === 'highlight' ? 'Highlight' : a.kind === 'underline' ? 'Underline' : 'StrikeOut';
      // QuadPoints order per quad: upper-left, upper-right, lower-left, lower-right
      dict.QuadPoints = a.rects.flatMap((q) => [q.x, q.y + q.height, q.x + q.width, q.y + q.height, q.x, q.y, q.x + q.width, q.y]);
      if (a.note) dict.Contents = pdfText(a.note);
      bbox = union(a.rects, 1);
      if (a.kind === 'highlight') {
        const opacity = a.opacity ?? 1;
        dict.CA = opacity;
        resources.ExtGState = { GS0: { BM: 'Multiply', ca: opacity, CA: opacity } };
        ops = [setGraphicsState('GS0'), setFillingRgbColor(r, g, b)];
        for (const q of a.rects) ops.push(op('re', q.x, q.y, q.width, q.height));
        ops.push(fill());
      } else {
        ops = [setStrokingRgbColor(r, g, b)];
        for (const q of a.rects) {
          const w = Math.max(0.5, q.height / 14);
          const y = a.kind === 'underline' ? q.y + w : q.y + q.height * 0.48;
          ops.push(setLineWidth(w), moveTo(q.x, y), lineTo(q.x + q.width, y), stroke());
        }
      }
      break;
    }
    case 'note': {
      dict.Subtype = 'Text';
      dict.Contents = pdfText(a.text);
      dict.Name = 'Comment';
      dict.Open = false;
      const s = 20;
      bbox = [a.at.x, a.at.y - s, a.at.x + s, a.at.y];
      const [x, y] = [bbox[0], bbox[1]];
      // a small speech bubble
      ops = [setFillingRgbColor(r, g, b), setStrokingRgbColor(0.25, 0.25, 0.25), setLineWidth(1),
        moveTo(x + 2, y + 6), lineTo(x + 18, y + 6), lineTo(x + 18, y + 18), lineTo(x + 2, y + 18), closePath(), op('B'),
        moveTo(x + 5, y + 6), lineTo(x + 4, y + 1), lineTo(x + 10, y + 6), op('B'),
        setStrokingRgbColor(0.25, 0.25, 0.25), moveTo(x + 5, y + 14), lineTo(x + 15, y + 14), moveTo(x + 5, y + 10), lineTo(x + 13, y + 10), stroke()];
      break;
    }
    case 'freetext': {
      dict.Subtype = 'FreeText';
      dict.Contents = pdfText(a.text);
      const size = a.size ?? 12;
      dict.DA = PDFString.of(`/Helv ${size} Tf ${r} ${g} ${b} rg`);
      bbox = [a.rect.x, a.rect.y, a.rect.x + a.rect.width, a.rect.y + a.rect.height];
      const font = await fonts.get(a.text);
      resources.Font = { F1: font.ref };
      const lines = wrapText(a.text, font, size, a.rect.width - 4);
      ops = [beginText(), setFillingRgbColor(r, g, b), setFontAndSize('F1', size)];
      let ty = a.rect.y + a.rect.height - size - 2;
      for (const line of lines) {
        if (ty < a.rect.y) break;
        ops.push(op('Tm', 1, 0, 0, 1, a.rect.x + 2, ty), showText(font.encodeText(line)));
        ty -= size * 1.2;
      }
      ops.push(endText());
      break;
    }
    case 'square': case 'circle': {
      dict.Subtype = a.kind === 'square' ? 'Square' : 'Circle';
      if (a.note) dict.Contents = pdfText(a.note);
      const w = a.width ?? 2;
      dict.BS = { W: w, S: 'S' };
      bbox = [a.rect.x, a.rect.y, a.rect.x + a.rect.width, a.rect.y + a.rect.height];
      const { x, y, width, height } = { x: a.rect.x + w / 2, y: a.rect.y + w / 2, width: a.rect.width - w, height: a.rect.height - w };
      ops = [setStrokingRgbColor(r, g, b), setLineWidth(w)];
      if (a.kind === 'square') ops.push(op('re', x, y, width, height), stroke());
      else ops.push(...ellipse(x, y, width, height), stroke());
      break;
    }
    case 'ink': {
      const pts = a.paths.flat();
      if (!pts.length) throw new DocEditError('Nothing drawn', 'BAD_ANNOTATION');
      dict.Subtype = 'Ink';
      if (a.note) dict.Contents = pdfText(a.note);
      const w = a.width ?? 2;
      dict.BS = { W: w, S: 'S' };
      dict.InkList = a.paths.map((path) => path.flatMap((p) => [p.x, p.y]));
      bbox = union(pts.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })), w);
      ops = [setStrokingRgbColor(r, g, b), setLineWidth(w), op('J', 1), op('j', 1)];
      for (const path of a.paths) {
        if (!path.length) continue;
        ops.push(moveTo(path[0]!.x, path[0]!.y));
        for (const p of path.slice(1)) ops.push(lineTo(p.x, p.y));
        if (path.length === 1) ops.push(lineTo(path[0]!.x + 0.01, path[0]!.y));
      }
      ops.push(stroke());
      break;
    }
  }

  dict.Rect = bbox;
  const ap = ctx.formXObject([pushGraphicsState(), ...ops, popGraphicsState()], { BBox: bbox, Resources: resources as never });
  dict.AP = { N: ctx.register(ap) };
  const ref = ctx.register(ctx.obj(dict as never));
  addAnnot(page, ref);
}

function addAnnot(page: PDFPage, ref: PDFRef) {
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of('Annots'), page.doc.context.obj([ref]));
}

/** Four Bezier arcs approximating an ellipse inscribed in the rectangle. */
function ellipse(x: number, y: number, w: number, h: number): PDFOperator[] {
  const k = 0.5522848, rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  return [
    moveTo(cx + rx, cy),
    appendBezierCurve(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry),
    appendBezierCurve(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy),
    appendBezierCurve(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry),
    appendBezierCurve(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy),
    closePath(),
  ];
}

export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of para.split(/(?<=\s)/)) {
      if (font.widthOfTextAtSize(line + word, size) <= width || !line) line += word;
      else { out.push(line.trimEnd()); line = word.trimStart(); }
    }
    out.push(line.trimEnd());
  }
  return out;
}

// ---------------------------------------------------------------- outline and links

/** Replace the document outline (bookmarks) with the given tree. An empty list removes it. */
function writeOutline(doc: PDFDocument, entries: OutlineEntry[]) {
  const ctx = doc.context;
  const n = doc.getPageCount();
  if (!entries.length) { doc.catalog.delete(PDFName.of('Outlines')); return; }
  const root = ctx.nextRef();
  const count = (list: OutlineEntry[]): number => list.reduce((s, e) => s + 1 + count(e.children ?? []), 0);
  const build = (list: OutlineEntry[], parent: PDFRef): { first: PDFRef; last: PDFRef } => {
    const refs = list.map(() => ctx.nextRef());
    list.forEach((e, i) => {
      if (!Number.isInteger(e.page) || e.page < 0 || e.page >= n) throw new PageRangeError(`Bookmark “${e.title}” points to page ${e.page + 1}, outside 1-${n}`);
      const d: Record<string, unknown> = {
        Title: pdfText(e.title), Parent: parent,
        Dest: [doc.getPage(e.page).ref, PDFName.of('XYZ'), null, null, null],
      };
      if (i > 0) d.Prev = refs[i - 1];
      if (i < list.length - 1) d.Next = refs[i + 1];
      if (e.children?.length) {
        const kids = build(e.children, refs[i]!);
        d.First = kids.first; d.Last = kids.last; d.Count = -count(e.children); // closed by default
      }
      ctx.assign(refs[i]!, ctx.obj(d as never) as never);
    });
    return { first: refs[0]!, last: refs.at(-1)! };
  };
  const top = build(entries, root);
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: count(entries) }) as never);
  doc.catalog.set(PDFName.of('Outlines'), root);
}

function addLink(doc: PDFDocument, page: PDFPage, rect: Rect, target: { page: number } | { url: string }, n: number) {
  const ctx = doc.context;
  const d: Record<string, unknown> = { Type: 'Annot', Subtype: 'Link', Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height], Border: [0, 0, 0], F: 4, P: page.ref };
  if ('url' in target) {
    const u = new URL(target.url); // throws on malformed addresses
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) throw new DocEditError('Links may only point to web or email addresses', 'BAD_LINK');
    d.A = ctx.obj({ S: 'URI', URI: PDFString.of(u.href) });
  } else {
    if (!Number.isInteger(target.page) || target.page < 0 || target.page >= n) throw new PageRangeError(`Link target page ${target.page + 1} is outside 1-${n}`);
    d.Dest = [doc.getPage(target.page).ref, PDFName.of('XYZ'), null, null, null];
  }
  addAnnot(page, ctx.register(ctx.obj(d as never)));
}

