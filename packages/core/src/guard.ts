import { DocEditError, InvalidPdfError } from './errors.js';
import type { Pdf } from './types.js';

/** Largest object count / field width we accept in a cross-reference stream (pdf-lib loops over them without a bound). */
const MAX_XREF_ENTRIES = 1 << 23;
const MAX_FIELD_WIDTH = 8;
const CHUNK = 16 * 1048576;
const OVERLAP = 4096;

const W_RE = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
const SIZE_RE = /\/Size\s+(\d+)/g;
const INDEX_RE = /\/Index\s*\[([\d\s]*)\]/g;

function check(text: string): string | undefined {
  for (const m of text.matchAll(W_RE)) {
    if (Number(m[1]) > MAX_FIELD_WIDTH || Number(m[2]) > MAX_FIELD_WIDTH || Number(m[3]) > MAX_FIELD_WIDTH) return 'a cross-reference stream declares an impossible field width';
  }
  for (const m of text.matchAll(SIZE_RE)) if (Number(m[1]) > MAX_XREF_ENTRIES) return 'the cross-reference size is not plausible';
  for (const m of text.matchAll(INDEX_RE)) {
    const n = (m[1] ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) if (n[i + 1]! > MAX_XREF_ENTRIES || n[i]! > 2 ** 32) return 'a cross-reference index range is not plausible';
  }
  return undefined;
}

/**
 * Refuse files whose cross-reference parameters would make the parser loop for minutes or forever.
 * Runs before any pdf-lib load; the scan is a plain text pass so it cannot itself be tricked into looping.
 */
export function assertSafeStructure(pdf: Pdf): void {
  const latin1 = new TextDecoder('latin1');
  for (let start = 0; start < pdf.length; start += CHUNK) {
    const problem = check(latin1.decode(pdf.subarray(start, Math.min(pdf.length, start + CHUNK + OVERLAP))));
    if (problem) throw new InvalidPdfError(new Error(problem));
  }
}

/** Largest PNG accepted (its pixels are decoded in memory; 80 megapixels is A3 at 600 dpi with room to spare). */
export const MAX_PNG_PIXELS = 80_000_000;

/**
 * Refuse a PNG too large to decode safely, from its header alone (width and height in IHDR). JPEGs are copied into the
 * PDF without being decoded, so their size costs nothing here.
 */
export function assertImageSize(bytes: Uint8Array): void {
  const png = bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!png) return;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint32(16), h = dv.getUint32(20);
  if (w === 0 || h === 0 || w * h > MAX_PNG_PIXELS) {
    throw new DocEditError(`This image is too large (${w} \u00d7 ${h} pixels). Images up to ${MAX_PNG_PIXELS / 1e6} megapixels are supported.`, 'IMAGE_TOO_LARGE');
  }
}
