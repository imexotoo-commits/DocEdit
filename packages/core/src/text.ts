import { DocEditError } from './errors.js';
import type { Pdf, Rect } from './types.js';

export interface TextOptions { /** folder URL/path of pdf.js standard font data; auto-detected on Node */ standardFontDataUrl?: string }

/** Load pdf.js lazily (Node-friendly "legacy" build). The desktop app may swap this for the normal build. */
export async function openPdfjs(pdf: Pdf, opts: TextOptions = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let fontUrl = opts.standardFontDataUrl;
  if (!fontUrl && typeof process !== 'undefined' && process.versions?.node) {
    const { createRequire } = await import('node:module');
    const { dirname } = await import('node:path');
    fontUrl = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')) + '/standard_fonts/';
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: fontUrl, verbosity: 0 });
  try { return await task.promise; }
  catch (e) {
    if (e instanceof Error && e.name === 'PasswordException') throw new DocEditError('PDF needs a password', 'ENCRYPTED');
    throw e;
  }
}

/** Plain text of each page, in reading order as pdf.js reports it. */
export async function extractText(pdf: Pdf, opts: TextOptions = {}): Promise<string[]> {
  const doc = await openPdfjs(pdf, opts);
  try {
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) out.push(pageString((await (await doc.getPage(i)).getTextContent()).items as TextItem[]).text);
    return out;
  } finally { await doc.destroy(); }
}

export interface TextMatch { page: number; text: string; /** one rect per text run the match touches */ rects: Rect[] }
export interface FindOptions extends TextOptions { caseSensitive?: boolean; /** extra points added around every rect */ padding?: number }

/** Find text and return where it is on the page (user space). Strings match literally; pass a RegExp for patterns. */
export async function findText(pdf: Pdf, query: string | RegExp, opts: FindOptions = {}): Promise<TextMatch[]> {
  const re = query instanceof RegExp
    ? new RegExp(query.source, query.flags.includes('g') ? query.flags : query.flags + 'g')
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.caseSensitive ? 'g' : 'gi');
  const doc = await openPdfjs(pdf, opts);
  const pad = opts.padding ?? 0;
  try {
    const out: TextMatch[] = [];
    for (let p = 0; p < doc.numPages; p++) {
      const items = (await (await doc.getPage(p + 1)).getTextContent()).items as TextItem[];
      const { text, spans } = pageString(items);
      for (const m of text.matchAll(re)) {
        if (m[0].length === 0) continue;
        const start = m.index!, end = start + m[0].length;
        const rects: Rect[] = [];
        for (const s of spans) {
          const a = Math.max(start, s.start), b = Math.min(end, s.end);
          if (a >= b) continue;
          rects.push(itemRect(s.item, (a - s.start) / (s.end - s.start), (b - s.start) / (s.end - s.start), pad));
        }
        out.push({ page: p, text: m[0], rects });
      }
    }
    return out;
  } finally { await doc.destroy(); }
}

interface TextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }
interface Span { item: TextItem; start: number; end: number }

function pageString(items: TextItem[]): { text: string; spans: Span[] } {
  let text = ''; const spans: Span[] = [];
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    spans.push({ item, start: text.length, end: text.length + item.str.length });
    text += item.str + (item.hasEOL ? '\n' : '');
  }
  return { text, spans };
}

/** Box (axis-aligned, user space) for the fraction f0..f1 of a text run, with a little room for descenders. */
function itemRect(item: TextItem, f0: number, f1: number, pad: number): Rect {
  const [a, b, , , e, f] = item.transform as [number, number, number, number, number, number];
  const len = Math.hypot(a, b) || 1;
  const ux = a / len, uy = b / len;               // baseline direction
  const nx = -uy, ny = ux;                          // up
  const h = item.height || len;                     // glyph height in points
  const w = item.width;
  const p0 = { x: e + ux * w * f0, y: f + uy * w * f0 }, p1 = { x: e + ux * w * f1, y: f + uy * w * f1 };
  const down = 0.22 * h, up = 1.0 * h;
  const pts = [
    { x: p0.x - nx * down, y: p0.y - ny * down }, { x: p1.x - nx * down, y: p1.y - ny * down },
    { x: p1.x + nx * up, y: p1.y + ny * up }, { x: p0.x + nx * up, y: p0.y + ny * up },
  ];
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, width: Math.max(...xs) + pad - x0, height: Math.max(...ys) + pad - y0 };
}
