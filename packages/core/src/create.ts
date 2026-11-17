import { PDFDocument, PDFNumber, PDFOperator, StandardFonts, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import { saveDoc } from './document.js';
import { DocEditError, PageRangeError } from './errors.js';
import { assertImageSize } from './guard.js';
import type { Pdf } from './types.js';

export class UnsupportedImageError extends DocEditError {
  constructor(index: number) { super(`Image ${index + 1} is not a JPEG or PNG file.`, 'UNSUPPORTED_IMAGE'); }
}

/** Common paper sizes in points (portrait). */
export const PAPER = { letter: [612, 792], legal: [612, 1008], a4: [595.28, 841.89], a5: [419.53, 595.28] } as const satisfies Record<string, readonly [number, number]>;

/** PDF viewers are only required to handle pages up to 200 inches. */
const MAX_PAGE_PT = 14400;

/** A blank document with `count` pages of the given size. */
export async function createBlankPdf(count = 1, size: [number, number] = [612, 792]): Promise<Pdf> {
  if (!Number.isInteger(count) || count < 1) throw new PageRangeError('A document needs at least one page');
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage(size);
  return saveDoc(doc);
}

// ---------------------------------------------------------------- images

export interface ImagesToPdfOptions {
  /** 'image' = each page takes the image's own size (at 96 pixels per inch); otherwise a paper size in points, portrait */
  pageSize?: 'image' | [number, number];
  /** blank border in points (ignored for 'image' pages) */
  margin?: number;
  /** contain = whole image visible; cover = fill the area, cropping overflow; stretch = fill, ignoring aspect */
  fit?: 'contain' | 'cover' | 'stretch';
  /** for paper sizes: 'auto' turns the paper to match each image's shape */
  orientation?: 'auto' | 'portrait' | 'landscape';
}

type ImageKind = 'jpeg' | 'png';

export function detectImage(bytes: Uint8Array): ImageKind | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

/**
 * EXIF orientation (1-8) of a JPEG, or 1 when absent or unreadable.
 * Reads the APP1 "Exif" segment's TIFF header and the 0x0112 tag of IFD0 (TIFF 6.0 / Exif 2.3 layout).
 */
export function jpegOrientation(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // image data starts / end of image
    const len = dv.getUint16(p + 2);
    if (marker === 0xe1 && len >= 16 && String.fromCharCode(...b.subarray(p + 4, p + 10)) === 'Exif\0\0') {
      const t = p + 10;
      const little = b[t] === 0x49 && b[t + 1] === 0x49;
      if (!little && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return 1;
      const u16 = (o: number) => dv.getUint16(t + o, little), u32 = (o: number) => dv.getUint32(t + o, little);
      try {
        const ifd = u32(4);
        const count = u16(ifd);
        for (let i = 0; i < count; i++) {
          const e = ifd + 2 + i * 12;
          if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
        }
      } catch { return 1; }
      return 1;
    }
    p += 2 + len;
  }
  return 1;
}

/**
 * For each EXIF orientation: how the stored image's unit square (u right, v up) maps onto the
 * displayed box (X right, Y up): X = a*u + c*v + e, Y = b*u + d*v + f.
 */
const ORIENT: Record<number, [number, number, number, number, number, number]> = {
  1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, 1, 0], 3: [-1, 0, 0, -1, 1, 1], 4: [1, 0, 0, -1, 0, 1],
  5: [0, -1, -1, 0, 1, 1], 6: [0, -1, 1, 0, 0, 1], 7: [0, 1, 1, 0, 0, 0], 8: [0, 1, -1, 0, 1, 0],
};

/** One page per image, in the given order. */
export async function imagesToPdf(images: Uint8Array[], opts: ImagesToPdfOptions = {}): Promise<Pdf> {
  if (images.length === 0) throw new PageRangeError('Choose at least one image');
  const { pageSize = 'image', margin = 0, fit = 'contain', orientation = 'auto' } = opts;
  const doc = await PDFDocument.create();
  for (const [i, bytes] of images.entries()) {
    const kind = detectImage(bytes);
    if (!kind) throw new UnsupportedImageError(i);
    assertImageSize(bytes);
    const img = kind === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const o = kind === 'jpeg' ? jpegOrientation(bytes) : 1;
    const turned = o >= 5;
    // displayed size in pixels, after orientation
    const dw = turned ? img.height : img.width, dh = turned ? img.width : img.height;

    let pw: number, ph: number, m: number;
    if (pageSize === 'image') {
      const k = Math.min(0.75, MAX_PAGE_PT / Math.max(dw, dh)); // 96 px per inch, capped
      pw = dw * k; ph = dh * k; m = 0;
    } else {
      const [a, b] = pageSize;
      const landscape = orientation === 'landscape' || (orientation === 'auto' && dw > dh);
      [pw, ph] = landscape ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
      m = Math.max(0, Math.min(margin, pw / 2 - 1, ph / 2 - 1));
    }
    const page = doc.addPage([pw, ph]);
    const aw = pw - 2 * m, ah = ph - 2 * m;
    let w = aw, h = ah;
    if (fit !== 'stretch') {
      const s = fit === 'contain' ? Math.min(aw / dw, ah / dh) : Math.max(aw / dw, ah / dh);
      w = dw * s; h = dh * s;
    }
    const x = m + (aw - w) / 2, y = m + (ah - h) / 2;
    drawOriented(page, img.ref, ORIENT[o]!, x, y, w, h, fit === 'cover' ? [m, m, aw, ah] : null);
  }
  return saveDoc(doc);
}

/** Draw an image XObject into the box (x, y, w, h) with an orientation matrix, optionally clipped to a rectangle. */
function drawOriented(page: PDFPage, ref: Parameters<PDFPage['node']['newXObject']>[1], [a, b, c, d, e, f]: number[], x: number, y: number, w: number, h: number, clip: number[] | null) {
  const name = page.node.newXObject('Img', ref);
  const ops: PDFOperator[] = [pushGraphicsState()];
  if (clip) ops.push(op('re', ...clip), op('W'), op('n')); // "x y w h re W n": clip to the margin box
  ops.push(concatTransformationMatrix(a! * w, b! * h, c! * w, d! * h, x + e! * w, y + f! * h), drawObject(name), popGraphicsState());
  page.pushOperators(...ops);
}

const op = (name: string, ...nums: number[]) => PDFOperator.of(name as never, nums.map((n) => PDFNumber.of(n)));

// ---------------------------------------------------------------- text

export interface TextToPdfOptions {
  pageSize?: [number, number];
  margin?: number;
  fontSize?: number;
  /** line height as a multiple of the font size */
  lineHeight?: number;
  /** a TrueType/OpenType font to embed (subset). Without it the standard Helvetica font is used, which covers Western European text only. */
  font?: Uint8Array;
}

export interface TextToPdfResult {
  pdf: Pdf;
  pageCount: number;
  /** characters the font cannot show; they were replaced by "?" */
  missingCharacters: string[];
}

/**
 * Lay out plain text on pages: wraps at word boundaries (long words are broken), keeps blank lines,
 * expands tabs to 4 spaces, and starts a new page at a form feed (\f).
 */
export async function textToPdf(text: string, opts: TextToPdfOptions = {}): Promise<TextToPdfResult> {
  const { pageSize = [612, 792], margin = 72, fontSize = 11, lineHeight = 1.35 } = opts;
  if (!(fontSize > 0) || !(lineHeight > 0)) throw new PageRangeError('Font size and line height must be positive');
  const [pw, ph] = pageSize;
  const usableW = pw - 2 * margin, usableH = ph - 2 * margin;
  if (usableW < fontSize * 2 || usableH < fontSize * lineHeight) throw new PageRangeError('The margins leave no room for text');

  const doc = await PDFDocument.create();
  let font: PDFFont;
  let has: (cp: number) => boolean;
  if (opts.font) {
    doc.registerFontkit(fontkit);
    const parsed = fontkit.create(opts.font as unknown as Buffer);
    if (!('hasGlyphForCodePoint' in parsed)) throw new DocEditError('Font collections (.ttc) are not supported; choose a single font file.', 'UNSUPPORTED_FONT');
    has = (cp) => parsed.hasGlyphForCodePoint(cp);
    font = await doc.embedFont(opts.font, { subset: true });
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
    const charset = new Set(font.getCharacterSet());
    has = (cp) => charset.has(cp);
  }

  const missing = new Set<string>();
  const clean = (s: string) => [...s].map((ch) => {
    const cp = ch.codePointAt(0)!;
    if (cp < 32) return ' ';
    if (has(cp)) return ch;
    missing.add(ch);
    return '?';
  }).join('');

  const width = (s: string) => font.widthOfTextAtSize(s, fontSize);
  const step = fontSize * lineHeight;
  const ascent = fontSize * 0.8;
  let page = doc.addPage([pw, ph]);
  let y = ph - margin - ascent;
  const newPage = () => { page = doc.addPage([pw, ph]); y = ph - margin - ascent; };
  const emit = (line: string) => {
    if (y < margin - fontSize * 0.25) newPage();
    if (line) page.drawText(line, { x: margin, y, size: fontSize, font });
    y -= step;
  };

  const sheets = text.replace(/\r\n?/g, '\n').split('\f');
  sheets.forEach((sheet, si) => {
    if (si > 0) newPage();
    for (const raw of sheet.split('\n')) {
      const para = clean(raw.replace(/\t/g, '    ')).replace(/\s+$/, '');
      if (!para) { emit(''); continue; }
      let line = '';
      for (const word of para.split(/(?<=\s)/)) {
        if (width(line + word) <= usableW) { line += word; continue; }
        if (line) { emit(line.trimEnd()); line = ''; }
        // a single word wider than the line: break it by characters
        let rest = word.trimStart();
        while (width(rest) > usableW) {
          let n = rest.length;
          while (n > 1 && width(rest.slice(0, n)) > usableW) n--;
          emit(rest.slice(0, n)); rest = rest.slice(n);
        }
        line = rest;
      }
      emit(line.trimEnd());
    }
  });
  const pdf = await saveDoc(doc);
  return { pdf, pageCount: doc.getPageCount(), missingCharacters: [...missing] };
}
