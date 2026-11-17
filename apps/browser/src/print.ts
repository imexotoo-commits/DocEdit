/**
 * How much printing may render. Every printed page becomes an image held until the print dialog closes, so pages are
 * capped in size and a whole job is capped in total pixels; larger documents print in page ranges.
 */
export const PRINT_DPI = 150;
/** one page: at most this many pixels, and no side longer than MAX_SIDE */
export const MAX_PAGE_PIXELS = 4096 * 4096;
export const MAX_SIDE = 8192;
/** one print job: about 120 letter-size pages at 150 dpi */
export const PRINT_BUDGET = 250_000_000;

/** The render scale for a page of this size in points: 150 dpi, less for very large pages. */
export function printScale(widthPt: number, heightPt: number): number {
  let s = PRINT_DPI / 72;
  const w = Math.max(1, widthPt), h = Math.max(1, heightPt);
  s = Math.min(s, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_PAGE_PIXELS / (w * h)));
  return s;
}

/** Pixels a page takes when printed. */
export function printPixels(widthPt: number, heightPt: number): number {
  const s = printScale(widthPt, heightPt);
  return Math.ceil(widthPt * s) * Math.ceil(heightPt * s);
}

/** The last page (0-based, inclusive) that still fits the budget when printing from `from`. */
export function lastFitting(pixels: number[], from: number): number {
  let total = 0;
  for (let i = from; i < pixels.length; i++) {
    total += pixels[i]!;
    if (total > PRINT_BUDGET) return Math.max(from, i - 1);
  }
  return pixels.length - 1;
}

/** Total pixels of pages from..to (0-based, inclusive). */
export function rangePixels(pixels: number[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i <= to; i++) total += pixels[i] ?? 0;
  return total;
}

/** "5", "3-10" or "3–10" (1-based) → 0-based [from, to], or null when it is not a range of this document. */
export function parseRange(text: string, count: number): [number, number] | null {
  const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(text);
  if (!m) return null;
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
  if (a < 1 || b < a || b > count) return null;
  return [a - 1, b - 1];
}
