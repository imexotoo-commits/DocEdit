import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { PageItem } from './model.js';
import type { LoadedSource } from './pdf.js';
import { PageCanvas } from './PageCanvas.js';
import { clipFor, fullSize, itemSize } from './Viewer.js';

const THUMB_W = 132;
const DRAG_TYPE = 'application/x-docedit-pages';

interface Props {
  pages: PageItem[];
  loaded: LoadedSource[];
  pageLabel(index: number): string;
  selection: Set<string>;
  currentIndex: number;
  onSelect(ids: Set<string>, focusIndex: number): void;
  onActivate(index: number): void;
  onDrop(beforeIndex: number): void;
  onDropFiles(files: File[], beforeIndex: number): void;
  onKeyCommand(cmd: 'delete' | 'rotate-left' | 'rotate-right' | 'nudge-up' | 'nudge-down'): void;
}

export function Thumbnails({ pages, loaded, pageLabel, selection, currentIndex, onSelect, onActivate, onDrop, onDropFiles, onKeyCommand }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState(0);
  const [focus, setFocus] = useState(0);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const itemEls = useRef<(HTMLDivElement | null)[]>([]);

  const focusItem = (i: number) => { setFocus(i); itemEls.current[i]?.scrollIntoView({ block: 'nearest' }); };

  function selectRange(from: number, to: number, add: boolean) {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const ids = new Set(add ? selection : []);
    for (let i = a; i <= b; i++) ids.add(pages[i]!.id);
    return ids;
  }

  function click(i: number, e: React.MouseEvent) {
    const id = pages[i]!.id;
    if (e.shiftKey) onSelect(selectRange(anchor, i, e.ctrlKey || e.metaKey), i);
    else if (e.ctrlKey || e.metaKey) {
      const ids = new Set(selection);
      if (ids.has(id) && ids.size > 1) ids.delete(id); else ids.add(id);
      onSelect(ids, i); setAnchor(i);
    } else { onSelect(new Set([id]), i); setAnchor(i); onActivate(i); }
    setFocus(i);
  }

  function keyDown(e: KeyboardEvent) {
    const n = pages.length;
    const mod = e.ctrlKey || e.metaKey;
    const go = (i: number) => {
      const t = Math.max(0, Math.min(n - 1, i));
      if (e.shiftKey) onSelect(selectRange(anchor, t, false), t);
      else { onSelect(new Set([pages[t]!.id]), t); setAnchor(t); onActivate(t); }
      focusItem(t);
    };
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (mod) onKeyCommand('nudge-up'); else go(focus - 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (mod) onKeyCommand('nudge-down'); else go(focus + 1);
    } else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(n - 1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onKeyCommand('delete'); }
    else if (e.key.toLowerCase() === 'r' && !mod) { e.preventDefault(); onKeyCommand(e.shiftKey ? 'rotate-left' : 'rotate-right'); }
    else if (e.key === 'a' && mod) { e.preventDefault(); onSelect(new Set(pages.map((p) => p.id)), focus); }
    else if (e.key === 'Enter') { e.preventDefault(); onActivate(focus); }
  }

  /** Which gap (0..n) the pointer is over, from the vertical midpoint of the item under it. */
  function gapAt(e: DragEvent): number {
    for (let i = 0; i < pages.length; i++) {
      const r = itemEls.current[i]?.getBoundingClientRect();
      if (r && e.clientY < r.top + r.height / 2) return i;
    }
    return pages.length;
  }

  function dragStart(i: number, e: DragEvent) {
    const id = pages[i]!.id;
    if (!selection.has(id)) onSelect(new Set([id]), i);
    e.dataTransfer.setData(DRAG_TYPE, '1');
    e.dataTransfer.effectAllowed = 'move';
  }

  function dragOver(e: DragEvent) {
    const isPages = e.dataTransfer.types.includes(DRAG_TYPE);
    const isFiles = e.dataTransfer.types.includes('Files');
    if (!isPages && !isFiles) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = isPages ? 'move' : 'copy';
    setDropGap(gapAt(e));
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const gap = dropGap ?? gapAt(e);
    setDropGap(null);
    if (e.dataTransfer.types.includes(DRAG_TYPE)) onDrop(gap);
    else if (e.dataTransfer.files.length) onDropFiles([...e.dataTransfer.files], gap);
  }

  return (
    <div
      ref={listRef}
      className="thumbs"
      role="listbox"
      aria-label="Pages"
      aria-multiselectable="true"
      aria-activedescendant={pages[focus] ? `thumb-${pages[focus]!.id}` : undefined}
      tabIndex={0}
      onKeyDown={keyDown}
      onDragOver={dragOver}
      onDragLeave={(e) => { if (!listRef.current?.contains(e.relatedTarget as Node)) setDropGap(null); }}
      onDrop={drop}
    >
      {pages.map((item, i) => {
        const size = itemSize(item, loaded);
        const scale = THUMB_W / Math.max(size.width, size.height * 0.77);
        const src = item.kind === 'page' ? loaded[item.source] : undefined;
        const ownRotate = item.kind === 'page' ? (src?.pages[item.page]?.rotate ?? 0) : 0;
        const selected = selection.has(item.id);
        return (
          <div key={item.id} className="thumb-slot">
            {dropGap === i && <div className="drop-marker" />}
            <div
              id={`thumb-${item.id}`}
              ref={(el) => { itemEls.current[i] = el; }}
              role="option"
              aria-selected={selected}
              aria-label={`Page ${pageLabel(i)}${item.kind === 'blank' ? ', blank' : ''}${item.rotate ? `, rotated ${item.rotate}°` : ''}`}
              className={`thumb${selected ? ' selected' : ''}${i === focus ? ' focused' : ''}${i === currentIndex ? ' current' : ''}`}
              draggable
              onDragStart={(e) => dragStart(i, e)}
              onDragEnd={() => setDropGap(null)}
              onClick={(e) => click(i, e)}
            >
              <PageCanvas
                doc={src?.doc ?? null}
                pageIndex={item.kind === 'page' ? item.page : 0}
                rotation={(ownRotate + item.rotate) % 360}
                scale={scale}
                width={Math.round(fullSize(item, loaded).width * scale)}
                height={Math.round(fullSize(item, loaded).height * scale)}
                clip={clipFor(item, loaded, scale)}
                root={listRef.current}
              />
              <div className="thumb-label">{pageLabel(i)}{loaded.length > 1 && item.kind === 'page' ? <span className="thumb-src"> · file {item.source + 1}</span> : null}</div>
            </div>
          </div>
        );
      })}
      {dropGap === pages.length && <div className="drop-marker" />}
    </div>
  );
}
