import { describe, expect, it } from 'vitest';
import { buildPageText, excerpt, findMatches, matchRects, toScreenRect, type TextItemLike } from '../src/renderer/textGeometry.js';

const item = (str: string, x: number, y: number, size = 10, extra: Partial<TextItemLike> = {}): TextItemLike =>
  ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size, ...extra });

describe('search text', () => {
  it('joins items, treats line ends as spaces and finds case-insensitive matches', () => {
    const pt = buildPageText([item('Hello ', 0, 0), item('World', 30, 0, 10, { hasEOL: true }), item('hello again', 0, -12)]);
    expect(pt.text).toBe('Hello World hello again');
    expect(findMatches(pt.text, 'hello', false)).toEqual([[0, 5], [12, 17]]);
    expect(findMatches(pt.text, 'hello', true)).toEqual([[12, 17]]);
    expect(findMatches(pt.text, 'world hello', false)).toEqual([[6, 17]]);
    expect(findMatches(pt.text, '   ', false)).toEqual([]);
  });
  it('matches across collapsed whitespace and does not overlap', () => {
    expect(findMatches('a   b  a b', 'a b', false)).toEqual([[0, 5], [7, 10]]);
    expect(findMatches('aaaa', 'aa', false)).toEqual([[0, 2], [2, 4]]);
  });
  it('makes excerpts with ellipses only when cut', () => {
    expect(excerpt('the quick brown fox', [4, 9], 4)).toEqual({ before: 'the ', match: 'quick', after: ' bro…' });
    expect(excerpt('so the quick brown fox', [7, 12], 4)).toEqual({ before: '…the ', match: 'quick', after: ' bro…' });
    expect(excerpt('fox', [0, 3])).toEqual({ before: '', match: 'fox', after: '' });
  });
});

describe('match rectangles', () => {
  it('covers the matched characters of each item touched', () => {
    const pt = buildPageText([item('abcd', 100, 200), item('efgh', 120, 200)]);
    const rects = matchRects(pt, [2, 6]); // "cdef"
    expect(rects).toHaveLength(2);
    expect(rects[0]!.x).toBeCloseTo(110); expect(rects[0]!.width).toBeCloseTo(10);
    expect(rects[1]!.x).toBeCloseTo(120); expect(rects[1]!.width).toBeCloseTo(10);
    expect(rects[0]!.y).toBeLessThan(200); expect(rects[0]!.y + rects[0]!.height).toBeGreaterThan(205);
  });
  it('handles text drawn upward (rotated 90° in the content)', () => {
    const pt = buildPageText([{ str: 'ab', transform: [0, 10, -10, 0, 50, 100], width: 10, height: 10 }]);
    const [r] = matchRects(pt, [0, 2]);
    expect(r!.y).toBeCloseTo(100); expect(r!.height).toBeCloseTo(10);
    expect(r!.x).toBeLessThan(50); expect(r!.x + r!.width).toBeGreaterThan(50);
  });
});

describe('screen mapping', () => {
  const view = [0, 0, 600, 800]; // portrait page
  const r = { x: 100, y: 700, width: 50, height: 20 }; // near the top-left
  it('maps unrotated pages with y flipped', () => {
    expect(toScreenRect(r, view, 0, 2)).toEqual({ x: 200, y: 160, width: 100, height: 40 });
  });
  it('maps quarter and half turns so the box stays on the same content', () => {
    // 90° clockwise: the page's top edge becomes its right edge
    expect(toScreenRect(r, view, 90, 1)).toEqual({ x: 700, y: 100, width: 20, height: 50 });
    expect(toScreenRect(r, view, 180, 1)).toEqual({ x: 450, y: 700, width: 50, height: 20 });
    expect(toScreenRect(r, view, 270, 1)).toEqual({ x: 80, y: 450, width: 20, height: 50 });
  });
  it('honours a visible box that does not start at the origin (cropped pages)', () => {
    expect(toScreenRect(r, [50, 100, 550, 750], 0, 1)).toEqual({ x: 50, y: 30, width: 50, height: 20 });
  });
});

describe('screen to page mapping', () => {
  it('inverts the page-to-screen mapping for every rotation, scale and box', async () => {
    const { fromScreenPoint, toScreenPoint, fromScreenRect } = await import('../src/renderer/textGeometry.js');
    for (const view of [[0, 0, 600, 800], [50, 100, 550, 750]]) {
      for (const rot of [0, 90, 180, 270]) {
        for (const scale of [0.5, 1.7]) {
          const s = toScreenPoint(123, 456, view, rot, scale);
          const back = fromScreenPoint(s.x, s.y, view, rot, scale);
          expect(back.x).toBeCloseTo(123); expect(back.y).toBeCloseTo(456);
          const r = { x: 100, y: 200, width: 50, height: 30 };
          const sr = toScreenRect(r, view, rot, scale);
          const br = fromScreenRect(sr, view, rot, scale);
          expect([br.x, br.y, br.width, br.height].map((v) => +v.toFixed(6))).toEqual([100, 200, 50, 30]);
        }
      }
    }
  });
});

describe('redaction helpers', () => {
  it('finds pattern matches, including every built-in pattern on a sample', async () => {
    const { findRegexMatches, REDACTION_PATTERNS } = await import('../src/renderer/textGeometry.js');
    const text = 'Mail jane.doe+x@example.co.uk or call +44 20 7946 0958. SSN 123-45-6789, card 4111 1111 1111 1111, IBAN GB82 WEST 1234 5698 7654 32, born 1990-04-12.';
    const found = Object.fromEntries(REDACTION_PATTERNS.map((p) => [p.label, findRegexMatches(text, new RegExp(p.source)).map(([a, b]) => text.slice(a, b))]));
    expect(found['Email addresses']).toEqual(['jane.doe+x@example.co.uk']);
    expect(found['US Social Security numbers']).toEqual(['123-45-6789']);
    expect(found['Card numbers']).toContain('4111 1111 1111 1111');
    expect(found['IBANs']).toEqual(['GB82 WEST 1234 5698 7654 32']);
    expect(found['Phone numbers']!.some((s) => s.includes('7946 0958'))).toBe(true);
    expect(found['Dates (numeric)']).toContain('1990-04-12');
    expect(findRegexMatches('aaa', /x*/)).toEqual([]);
  });
  it('reads the text under a box', async () => {
    const { textUnder } = await import('../src/renderer/textGeometry.js');
    const pt = buildPageText([item('Name: Jane Doe', 100, 500), item('Other line', 100, 480)]);
    // characters are 5 units wide: "Jane Doe" starts at index 6 -> x = 130 .. 170
    expect(textUnder(pt, { x: 129, y: 495, width: 42, height: 15 })).toBe('Jane Doe');
    expect(textUnder(pt, { x: 0, y: 0, width: 10, height: 10 })).toBe('');
  });
});
