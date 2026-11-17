import { forwardRef, useEffect, useRef } from 'react';
import type { SearchState } from './useSearch.js';
import { REDACTION_PATTERNS } from './textGeometry.js';

interface Props {
  search: SearchState;
  pageLabel(index: number): string;
  onGo(hitIndex: number): void;
  /** turn every hit into a pending redaction mark */
  onMarkAll?(): void;
}

export const SearchPanel = forwardRef<HTMLInputElement, Props>(function SearchPanel({ search, pageLabel, onGo, onMarkAll }, inputRef) {
  const listRef = useRef<HTMLOListElement>(null);
  const { hits, active, progress, query } = search;
  const searching = !!query.trim() && progress[0] < progress[1];
  // the first Enter after typing shows the first hit; later ones move on
  const navigated = useRef(false);
  useEffect(() => { navigated.current = false; }, [query, search.caseSensitive]);
  const go = (i: number) => { navigated.current = true; onGo(i); };

  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className="search-panel">
      <div className="search-box">
        <input
          ref={inputRef}
          type="search"
          placeholder="Find in document"
          aria-label="Find in document"
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits.length) {
              e.preventDefault();
              const next = e.shiftKey ? (active - 1 + hits.length) % hits.length : (active + 1) % hits.length;
              go(navigated.current || e.shiftKey ? next : active);
            }
          }}
        />
        <div className="search-row">
          <label className="check">
            <input type="checkbox" checked={search.caseSensitive} onChange={(e) => search.setCaseSensitive(e.target.checked)} />
            Match case
          </label>
          <label className="check" title="Treat the search as a regular expression">
            <input type="checkbox" checked={search.pattern} onChange={(e) => search.setPattern(e.target.checked)} />
            Pattern
          </label>
          <span className="spacer" />
          <button disabled={!hits.length} onClick={() => go((active - 1 + hits.length) % hits.length)} aria-label="Previous match" title="Previous match (Shift+Enter, Shift+F3)">↑</button>
          <button disabled={!hits.length} onClick={() => go((active + 1) % hits.length)} aria-label="Next match" title="Next match (Enter, F3)">↓</button>
        </div>
        {/* personal-data patterns are for redaction, which only the editor offers */}
        {onMarkAll && (
          <select aria-label="Find personal data" value="" onChange={(e) => { const p = REDACTION_PATTERNS.find((x) => x.label === e.target.value); if (p) { search.setPattern(true); search.setQuery(p.source); } }}>
            <option value="">Find personal data…</option>
            {REDACTION_PATTERNS.map((p) => <option key={p.label}>{p.label}</option>)}
          </select>
        )}
        {search.patternError && <div className="form-error small">Pattern error: {search.patternError}</div>}
        {onMarkAll && hits.length > 0 && !searching && <button onClick={onMarkAll} title="Add a pending redaction mark over every match">Mark all {hits.length} for redaction</button>}
        <div className="search-status" aria-live="polite">
          {!query.trim() ? 'Type to search the text of every page.'
            : searching ? `Searching… page ${progress[0]} of ${progress[1]}`
            : hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'No matches.'}
          {!searching && search.pagesWithoutText > 0 && query.trim() && (
            <div className="muted">{search.pagesWithoutText} page{search.pagesWithoutText === 1 ? ' has' : 's have'} no searchable text (scanned images need text recognition, which is not available yet).</div>
          )}
        </div>
      </div>
      <ol className="search-results" ref={listRef}>
        {hits.map((h, i) => (
          <li key={i}>
            <button className={i === active ? 'active' : ''} onClick={() => go(i)}>
              <span className="result-page">Page {pageLabel(h.pageIndex)}</span>
              <span className="result-text">{h.excerpt.before}<mark>{h.excerpt.match}</mark>{h.excerpt.after}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
});
