import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import type { PageItem } from './model.js';
import { displaySize, type LoadedSource } from './pdf.js';
import { PageCanvas, type PageLink } from './PageCanvas.js';
import { toScreenRect, type Rect } from './textGeometry.js';

/** Highlights to draw per page id, in PDF user space of that page's source. */
export type Highlights = Map<string, Array<{ rect: Rect; active: boolean }>>;

export interface ViewerHandle {
  scrollToPage(index: number): void;
  /** scroll so a rectangle (PDF user space) on a page is centred in view */
  scrollToRect(index: number, rect: Rect): void;
  /** inner size available for pages, used by fit-width / fit-page */
  viewportSize(): { width: number; height: number };
}

interface Props {
  pages: PageItem[];
  loaded: LoadedSource[];
  scale: number;
  onCurrentPage(index: number): void;
  onResize(): void;
  highlights?: Highlights;
  onLink?(link: PageLink, fromPage: number): void;
  /** extra layer drawn over each page (pending edits, drawing tools), in full-page CSS pixels */
  overlay?(args: { item: PageItem; index: number; view: number[]; rotation: number; scale: number; width: number; height: number }): ReactNode;
}

/** Absolute rotation and visible box needed to place things on a page item. */
export function placement(item: PageItem, loaded: LoadedSource[]): { rotation: number; view: number[] } {
  if (item.kind === 'blank') return { rotation: item.rotate, view: [0, 0, item.width, item.height] };
  const g = loaded[item.source]?.pages[item.page];
  return { rotation: ((g?.rotate ?? 0) + item.rotate) % 360, view: g?.view ?? [0, 0, 612, 792] };
}

const GAP = 16;
const PAD = 24;

/** Displayed size at scale 1 of the visible part of a page (its crop, if any). */
export function itemSize(item: PageItem, loaded: LoadedSource[]) {
  if (item.kind === 'page' && item.crop) {
    const { rotation } = placement(item, loaded);
    return rotation % 180 === 0 ? { width: item.crop.width, height: item.crop.height } : { width: item.crop.height, height: item.crop.width };
  }
  return fullSize(item, loaded);
}

/** Displayed size at scale 1 of the whole page, ignoring a user crop. */
export function fullSize(item: PageItem, loaded: LoadedSource[]) {
  if (item.kind === 'blank') return displaySize({ width: item.width, height: item.height }, item.rotate);
  const g = loaded[item.source]?.pages[item.page];
  return g ? displaySize(g, item.rotate) : { width: 612, height: 792 };
}

/** The css-pixel window of a cropped page within its full rendering, or undefined. */
export function clipFor(item: PageItem, loaded: LoadedSource[], scale: number) {
  if (item.kind !== 'page' || !item.crop) return undefined;
  const { rotation, view } = placement(item, loaded);
  const r = toScreenRect(item.crop, view, rotation, scale);
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer({ pages, loaded, scale, onCurrentPage, onResize, highlights, onLink, overlay }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const pageEls = useRef(new Map<string, HTMLDivElement>());

  useImperativeHandle(ref, () => ({
    scrollToPage(index) {
      const item = pages[index];
      const el = item && pageEls.current.get(item.id);
      if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - PAD / 2 });
    },
    scrollToRect(index, rect) {
      const item = pages[index];
      const el = item && pageEls.current.get(item.id);
      const sc = scroller.current;
      if (!el || !sc || !item) return;
      const { rotation, view } = placement(item, loaded);
      const r = toScreenRect(rect, view, rotation, scale);
      const clip = clipFor(item, loaded, scale);
      if (clip) { r.x -= clip.x; r.y -= clip.y; }
      sc.scrollTo({
        top: el.offsetTop + r.y + r.height / 2 - sc.clientHeight / 2,
        left: Math.max(0, el.offsetLeft + r.x + r.width / 2 - sc.clientWidth / 2),
      });
    },
    viewportSize() {
      const el = scroller.current;
      return el ? { width: el.clientWidth - PAD * 2, height: el.clientHeight - PAD * 2 } : { width: 800, height: 600 };
    },
  }), [pages, loaded, scale]);

  const reportCurrent = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const probe = el.scrollTop + el.clientHeight * 0.35;
    let current = 0;
    pages.forEach((p, i) => { const pe = pageEls.current.get(p.id); if (pe && pe.offsetTop <= probe) current = i; });
    onCurrentPage(current);
  }, [pages, onCurrentPage]);

  useEffect(() => { reportCurrent(); }, [reportCurrent, scale]);

  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onResizeRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className="viewer"
      ref={(el) => { scroller.current = el; setRoot(el); }}
      onScroll={reportCurrent}
      tabIndex={0}
      aria-label="Document pages"
      style={{ padding: PAD, gap: GAP }}
    >
      {pages.map((item, i) => {
        const size = fullSize(item, loaded);
        const w = Math.round(size.width * scale), h = Math.round(size.height * scale);
        const src = item.kind === 'page' ? loaded[item.source] : undefined;
        const { rotation, view } = placement(item, loaded);
        const clip = clipFor(item, loaded, scale);
        const marks = highlights?.get(item.id);
        return (
          <div
            key={item.id}
            className="viewer-page"
            data-page-id={item.id}
            ref={(el) => { if (el) pageEls.current.set(item.id, el); else pageEls.current.delete(item.id); }}
            aria-label={`Page ${i + 1}`}
          >
            <PageCanvas
              doc={src?.doc ?? null}
              pageIndex={item.kind === 'page' ? item.page : 0}
              rotation={rotation}
              scale={scale}
              width={w}
              height={h}
              textLayer
              root={root}
              onLink={onLink ? (l) => onLink(l, i) : undefined}
              clip={clip}
            >
              {marks?.map((m, k) => {
                const r = toScreenRect(m.rect, view, rotation, scale);
                return <div key={k} className={`hit${m.active ? ' active' : ''}`} style={{ left: r.x, top: r.y, width: r.width, height: r.height }} />;
              })}
              {overlay?.({ item, index: i, view, rotation, scale, width: w, height: h })}
            </PageCanvas>
          </div>
        );
      })}
    </div>
  );
});
