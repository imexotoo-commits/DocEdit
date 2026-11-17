import { PageRangeError } from './errors.js';

/**
 * Parse a human page selection into sorted-as-written, zero-based indices.
 * Grammar (1-based for people): "1,3,5-7", "8-" (8 to end), "-3" (first three), "all", "last", "2-last".
 * Duplicates are kept in the order written (useful for reorder/extract); use `unique: true` to drop them.
 */
export function parsePageRange(spec: string, pageCount: number, opts: { unique?: boolean } = {}): number[] {
  const out: number[] = [];
  const text = spec.trim().toLowerCase();
  if (!text) throw new PageRangeError('Empty page range');
  const num = (tok: string): number => {
    if (tok === 'last') return pageCount;
    if (!/^\d+$/.test(tok)) throw new PageRangeError(`Bad page number "${tok}" in "${spec}"`);
    return Number(tok);
  };
  const check = (n: number) => {
    if (n < 1 || n > pageCount) throw new PageRangeError(`Page ${n} is outside 1-${pageCount}`);
    return n;
  };
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part === 'all') { for (let i = 0; i < pageCount; i++) out.push(i); continue; }
    const m = part.match(/^([^-]*)-([^-]*)$/);
    if (m) {
      const a = m[1] === '' ? 1 : check(num(m[1]!));
      const b = m[2] === '' ? pageCount : check(num(m[2]!));
      if (a <= b) for (let i = a; i <= b; i++) out.push(i - 1);
      else for (let i = a; i >= b; i--) out.push(i - 1); // "5-2" = reversed run
    } else out.push(check(num(part)) - 1);
  }
  return opts.unique ? [...new Set(out)] : out;
}
