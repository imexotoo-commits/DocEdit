import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageItem } from './model.js';
import type { LoadedSource } from './pdf.js';
import { buildPageText, excerpt, findMatches, findRegexMatches, matchRects, type PageText, type Rect, type TextItemLike } from './textGeometry.js';

export interface SearchHit {
  pageId: string;
  pageIndex: number;
  /** the matched text */
  text: string;
  /** rectangles in PDF user space of the source page */
  rects: Rect[];
  excerpt: { before: string; match: string; after: string };
}

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  /** the query is a regular expression (used by the redaction patterns) */
  pattern: boolean;
  setPattern(v: boolean): void;
  /** set when the pattern does not compile */
  patternError: string;
  hits: SearchHit[];
  active: number;
  /** pages searched so far / pages to search */
  progress: [number, number];
  /** number of non-blank pages that have no extractable text (likely scans) */
  pagesWithoutText: number;
  setQuery(q: string): void;
  setCaseSensitive(v: boolean): void;
  setActive(i: number): void;
  step(dir: 1 | -1): void;
}

/** Text per source page, kept for the lifetime of the loaded documents. */
const textCache = new WeakMap<LoadedSource, Map<number, Promise<PageText>>>();

export function pageText(src: LoadedSource, page: number): Promise<PageText> {
  let m = textCache.get(src);
  if (!m) { m = new Map(); textCache.set(src, m); }
  let p = m.get(page);
  if (!p) {
    p = src.doc.getPage(page + 1)
      .then((pg) => pg.getTextContent())
      .then((tc) => buildPageText(tc.items.filter((i): i is typeof i & TextItemLike => 'str' in i)))
      .catch(() => buildPageText([]));
    m.set(page, p);
  }
  return p;
}

export function useSearch(pages: PageItem[], loaded: LoadedSource[]): SearchState {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [pattern, setPattern] = useState(false);
  const [patternError, setPatternError] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [pagesWithoutText, setPagesWithoutText] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    const token = ++run.current;
    const q = query.trim();
    if (!q) { setHits([]); setProgress([0, 0]); setPagesWithoutText(0); setPatternError(''); return; }
    let re: RegExp | null = null;
    if (pattern) {
      try { re = new RegExp(q, caseSensitive ? 'u' : 'iu'); setPatternError(''); }
      catch (e) { setPatternError(e instanceof Error ? e.message : String(e)); setHits([]); setProgress([0, 0]); return; }
    }
    // report "searching" straight away, so the debounce never shows a stale "No matches"
    setHits([]); setActive(0); setProgress([0, pages.length]);
    // short debounce so typing does not start a search per keystroke
    const timer = setTimeout(async () => {
      const found: SearchHit[] = [];
      let empty = 0;
      for (let i = 0; i < pages.length; i++) {
        const item = pages[i]!;
        if (item.kind === 'page' && loaded[item.source]) {
          const pt = await pageText(loaded[item.source]!, item.page);
          if (run.current !== token) return;
          if (!pt.text.trim()) empty++;
          for (const m of re ? findRegexMatches(pt.text, re) : findMatches(pt.text, q, caseSensitive)) {
            found.push({ pageId: item.id, pageIndex: i, text: pt.text.slice(m[0], m[1]), rects: matchRects(pt, m), excerpt: excerpt(pt.text, m) });
          }
        }
        // publish progress in batches to keep re-renders cheap on long documents
        if (i % 20 === 19 || i === pages.length - 1) { setHits([...found]); setProgress([i + 1, pages.length]); }
      }
      setPagesWithoutText(empty);
    }, 180);
    return () => clearTimeout(timer);
  }, [query, caseSensitive, pattern, pages, loaded]);

  return useMemo(() => ({
    query, caseSensitive, pattern, setPattern, patternError, hits, active: Math.min(active, Math.max(0, hits.length - 1)), progress, pagesWithoutText,
    setQuery, setCaseSensitive, setActive,
    step: (dir: 1 | -1) => setActive((a) => (hits.length ? (a + dir + hits.length) % hits.length : 0)),
  }), [query, caseSensitive, pattern, patternError, hits, active, progress, pagesWithoutText]);
}
