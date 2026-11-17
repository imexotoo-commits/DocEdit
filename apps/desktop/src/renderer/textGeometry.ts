/**
 * Pure helpers for search and highlights: joining a page's text items into one searchable string,
 * finding matches, turning matches into rectangles in PDF user space, and mapping PDF user space
 * to on-screen pixels for a given page box, rotation and zoom.
 */

/** The parts of a pdf.js text item that search needs. */
export interface TextItemLike {
  str: string;
  /** [a b c d e f]: text space to user space for the start of the item */
  transform: number[];
  /** advance width of the whole item in user space */
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface PageText {
  text: string;
  /** for every character of `text`: [item index, offset in item], or -1 for inserted separators */
  map: Int32Array;
  items: TextItemLike[];
}

export interface Rect { x: number; y: number; width: number; height: number }

export function buildPageText(items: TextItemLike[]): PageText {
  let text = '';
  const map: number[] = [];
  items.forEach((it, i) => {
    for (let k = 0; k < it.str.length; k++) { map.push(i * 65536 + k); }
    text += it.str;
    // pdf.js marks line ends; treat them as a space so phrases that wrap still match
    if (it.hasEOL && !text.endsWith(' ')) { text += ' '; map.push(-1); }
  });
  return { text, map: Int32Array.from(map), items };
}

/** Collapse runs of whitespace so "foo  bar" in a file matches a query of "foo bar". */
function normalize(s: string, caseSensitive: boolean): { norm: string; back: number[] } {
  let norm = '';
  const back: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const space = /\s/.test(ch);
    if (space && prevSpace) continue;
    norm += space ? ' ' : caseSensitive ? ch : ch.toLocaleLowerCase();
    back.push(i);
    prevSpace = space;
  }
  return { norm, back };
}

/** Character ranges [start, end) in `text` that match `query`. Matches do not overlap. */
export function findMatches(text: string, query: string, caseSensitive: boolean): Array<[number, number]> {
  const q = normalize(query.trim(), caseSensitive).norm;
  if (!q) return [];
  const { norm, back } = normalize(text, caseSensitive);
  // toLocaleLowerCase can change length for a few characters; fall back to exact positions then
  const out: Array<[number, number]> = [];
  for (let at = norm.indexOf(q); at >= 0; at = norm.indexOf(q, at + q.length)) {
    const start = back[at]!;
    const end = (back[at + q.length - 1] ?? text.length - 1) + 1;
    out.push([start, end]);
  }
  return out;
}

/** A short excerpt around a match, for the results list. */
export function excerpt(text: string, [start, end]: [number, number], radius = 32): { before: string; match: string; after: string } {
  const a = Math.max(0, start - radius), b = Math.min(text.length, end + radius);
  return {
    before: (a > 0 ? '…' : '') + text.slice(a, start).replace(/\s+/g, ' ').trimStart(),
    match: text.slice(start, end),
    after: text.slice(end, b).replace(/\s+/g, ' ').trimEnd() + (b < text.length ? '…' : ''),
  };
}

/**
 * Rectangles (one per text item touched) covering a match, in PDF user space.
 * Uses the item's advance width spread evenly over its characters, so it is approximate for
 * proportional fonts; text drawn at an angle gets the axis-aligned box around its slanted box.
 */
export function matchRects(pt: PageText, [start, end]: [number, number]): Rect[] {
  const spans = new Map<number, [number, number]>();
  for (let i = start; i < end; i++) {
    const m = pt.map[i]!;
    if (m < 0) continue;
    const item = Math.floor(m / 65536), off = m % 65536;
    const s = spans.get(item);
    if (s) s[1] = off + 1; else spans.set(item, [off, off + 1]);
  }
  const rects: Rect[] = [];
  for (const [i, [a, b]] of spans) {
    const it = pt.items[i]!;
    const [ta = 1, tb = 0, tc = 0, td = 1, te = 0, tf = 0] = it.transform;
    const len = Math.max(1, it.str.length);
    const fontH = Math.hypot(tc, td) || it.height || 10;
    const dirLen = Math.hypot(ta, tb) || 1;
    const ux = ta / dirLen, uy = tb / dirLen; // baseline direction
    const vx = -uy, vy = ux;                  // "up" direction
    const x0 = (it.width * a) / len, x1 = (it.width * b) / len;
    const lo = -0.22 * fontH, hi = 0.95 * fontH; // descender .. ascender, roughly
    const corners = [[x0, lo], [x1, lo], [x1, hi], [x0, hi]].map(([s, t]) => [te + ux * s! + vx * t!, tf + uy * s! + vy * t!]);
    const xs = corners.map((c) => c[0]!), ys = corners.map((c) => c[1]!);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    rects.push({ x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY });
  }
  return rects;
}

/**
 * Map a rectangle in PDF user space to CSS pixels on a page drawn with the given visible box
 * ([x0, y0, x1, y1], as pdf.js `page.view`), absolute rotation (clockwise degrees) and scale.
 */
export function toScreenRect(r: Rect, view: number[], rotation: number, scale: number): Rect {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = view;
  const pt = (x: number, y: number): [number, number] => {
    switch (((rotation % 360) + 360) % 360) {
      case 90: return [(y - y0) * scale, (x - x0) * scale];
      case 180: return [(x1 - x) * scale, (y - y0) * scale];
      case 270: return [(y1 - y) * scale, (x1 - x) * scale];
      default: return [(x - x0) * scale, (y1 - y) * scale];
    }
  };
  const [ax, ay] = pt(r.x, r.y), [bx, by] = pt(r.x + r.width, r.y + r.height);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/** A point in PDF user space to CSS pixels on the drawn page (see toScreenRect). */
export function toScreenPoint(x: number, y: number, view: number[], rotation: number, scale: number): { x: number; y: number } {
  const r = toScreenRect({ x, y, width: 0, height: 0 }, view, rotation, scale);
  return { x: r.x, y: r.y };
}

/** CSS pixels on the drawn page back to PDF user space: the inverse of toScreenPoint. */
export function fromScreenPoint(X: number, Y: number, view: number[], rotation: number, scale: number): { x: number; y: number } {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = view;
  const u = X / scale, v = Y / scale;
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { x: x0 + v, y: y0 + u };
    case 180: return { x: x1 - u, y: y0 + v };
    case 270: return { x: x1 - v, y: y1 - u };
    default: return { x: x0 + u, y: y1 - v };
  }
}

/** A screen rectangle (CSS px on the drawn page) as a user-space rectangle. */
export function fromScreenRect(r: Rect, view: number[], rotation: number, scale: number): Rect {
  const a = fromScreenPoint(r.x, r.y, view, rotation, scale), b = fromScreenPoint(r.x + r.width, r.y + r.height, view, rotation, scale);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Ranges matched by a regular expression (global search; empty matches are skipped). */
export function findRegexMatches(text: string, re: RegExp): Array<[number, number]> {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(g)) if (m[0].length) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

/** Common patterns for finding personal data to redact. */
export const REDACTION_PATTERNS: Array<{ label: string; source: string }> = [
  { label: 'Email addresses', source: String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+` },
  { label: 'Phone numbers', source: String.raw`(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){2,4}` },
  { label: 'US Social Security numbers', source: String.raw`\b\d{3}-\d{2}-\d{4}\b` },
  { label: 'Card numbers', source: String.raw`\b(?:\d[ -]?){13,19}\b` },
  { label: 'IBANs', source: String.raw`\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b` },
  { label: 'Dates (numeric)', source: String.raw`\b\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b` },
];

/** The text whose characters lie (by their centre) inside a user-space rectangle. */
export function textUnder(pt: PageText, r: Rect): string {
  let out = '';
  let prevInside = false;
  for (let i = 0; i < pt.text.length; i++) {
    if (pt.map[i]! < 0) { if (prevInside) out += ' '; continue; }
    const [c] = matchRects(pt, [i, i + 1]);
    const inside = !!c && c.x + c.width / 2 >= r.x && c.x + c.width / 2 <= r.x + r.width && c.y + c.height / 2 >= r.y && c.y + c.height / 2 <= r.y + r.height;
    if (inside) out += pt.text[i];
    else if (prevInside) out += ' ';
    prevInside = inside;
  }
  return out.replace(/\s+/g, ' ').trim();
}
