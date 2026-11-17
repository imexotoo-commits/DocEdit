/**
 * Editing model: a document is a list of source files plus an ordered list of page items.
 * Every page item has a stable id that survives reorders, so selection, thumbnails and render caches
 * follow the page. Edits produce a new page list; history is the list of past page lists.
 */
import type { SaveSlot } from '../shared/api.js';
import type { OutlineNode, PendingEdit } from './edits.js';

export interface Rect { x: number; y: number; width: number; height: number }

export interface SourceFile {
  path: string | null;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

export type PageItem =
  | { id: string; kind: 'page'; source: number; page: number; /** extra rotation added by the user, 0/90/180/270 */ rotate: number; /** visible area in the page's user space, when cropped */ crop?: Rect }
  | { id: string; kind: 'blank'; width: number; height: number; rotate: number };

export interface DocState {
  pages: PageItem[];
  /** content edits waiting to be written on save */
  edits: PendingEdit[];
  /** the bookmark tree once the user has edited it (or it had to be remapped); null = the file's own */
  outline: OutlineNode[] | null;
}

export const emptyState = (pages: PageItem[]): DocState => ({ pages, edits: [], outline: null });

export interface Editor {
  /** crash-recovery session id for this editing session */
  recoveryId: string;
  sources: SourceFile[];
  /** where Save writes; null until the document has a file */
  path: string | null;
  title: string;
  history: { past: DocState[]; present: DocState; future: DocState[] };
  /** the state as last saved/opened, for the dirty check */
  saved: DocState;
  /** password protection to apply on save; kept in memory only (never in history or recovery) */
  protection?: { userPassword?: string; ownerPassword?: string; permissions?: Record<string, unknown> } | null;
  /** protection was changed since the last save */
  protectionChanged?: boolean;
  /** the document's content itself was replaced (redaction applied in place) and has not been saved */
  sourceChanged?: boolean;
}

let counter = 0;
export const newId = () => `p${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function pagesForSource(source: number, pageCount: number): PageItem[] {
  return Array.from({ length: pageCount }, (_, page) => ({ id: newId(), kind: 'page' as const, source, page, rotate: 0 }));
}

export function createEditor(file: SourceFile): Editor {
  const pages = pagesForSource(0, file.pageCount);
  const state = emptyState(pages);
  return { recoveryId: 'r' + newId(), sources: [file], path: file.path, title: file.name, history: { past: [], present: state, future: [] }, saved: state };
}

/** Rebuild an editor from crash-recovery data; it starts out with unsaved changes. Malformed page entries are dropped. */
export function restoreEditor(rec: { id: string; title: string; path: string | null; pages: unknown[]; edits?: unknown[]; outline?: unknown }, sources: SourceFile[]): Editor {
  // page ids are kept so that edits and bookmarks still point at their pages
  const keepId = (raw: unknown) => { const id = (raw as { id?: unknown }).id; return typeof id === 'string' && /^[\w-]{1,64}$/.test(id) ? id : newId(); };
  const pages: PageItem[] = [];
  for (const raw of rec.pages) {
    const p = raw as Partial<PageItem> & Record<string, unknown>;
    const rotate = [0, 90, 180, 270].includes(p.rotate as number) ? (p.rotate as number) : 0;
    if (p.kind === 'page' && Number.isInteger(p.source) && Number.isInteger(p.page)) {
      const src = sources[p.source as number];
      const c = p.crop as Rect | undefined;
      const crop = c && [c.x, c.y, c.width, c.height].every(Number.isFinite) && c.width > 1 && c.height > 1 ? { x: c.x, y: c.y, width: c.width, height: c.height } : undefined;
      if (src && (p.page as number) >= 0 && (p.page as number) < src.pageCount) pages.push({ id: keepId(raw), kind: 'page', source: p.source as number, page: p.page as number, rotate, ...(crop ? { crop } : {}) });
    } else if (p.kind === 'blank' && Number(p.width) > 0 && Number(p.height) > 0) {
      pages.push({ id: keepId(raw), kind: 'blank', width: Number(p.width), height: Number(p.height), rotate });
    }
  }
  if (pages.length === 0) throw new Error('The recovered data has no usable pages.');
  // edits and bookmarks are trusted only as far as their shape; anything odd fails at save with a message
  const edits = Array.isArray(rec.edits) ? (rec.edits.filter((e) => e && typeof e === 'object' && typeof (e as { type?: unknown }).type === 'string') as PendingEdit[]) : [];
  const outline = Array.isArray(rec.outline) ? (rec.outline as OutlineNode[]) : null;
  return { recoveryId: rec.id, sources, path: rec.path, title: rec.title, history: { past: [], present: { pages, edits, outline }, future: [] }, saved: emptyState([]) };
}

/** Commit a new page list as one undoable step. A no-op edit leaves history untouched. */
export function commit(ed: Editor, pages: PageItem[]): Editor {
  if (sameList(pages, ed.history.present.pages)) return ed;
  return commitState(ed, { ...ed.history.present, pages });
}

/** Commit any change of the document state (pages, edits, bookmarks) as one undoable step. */
export function commitState(ed: Editor, next: DocState): Editor {
  const cur = ed.history.present;
  if (next.pages === cur.pages && next.edits === cur.edits && next.outline === cur.outline) return ed;
  return { ...ed, history: { past: [...ed.history.past, cur], present: next, future: [] } };
}

export function undo(ed: Editor): Editor {
  const prev = ed.history.past.at(-1);
  if (!prev) return ed;
  return { ...ed, history: { past: ed.history.past.slice(0, -1), present: prev, future: [ed.history.present, ...ed.history.future] } };
}

export function redo(ed: Editor): Editor {
  const [next, ...rest] = ed.history.future;
  if (!next) return ed;
  return { ...ed, history: { past: [...ed.history.past, ed.history.present], present: next, future: rest } };
}

export const isDirty = (ed: Editor) => {
  const a = ed.history.present, b = ed.saved;
  return ed.path === null || !!ed.protectionChanged || !!ed.sourceChanged || !sameList(a.pages, b.pages) || a.edits !== b.edits || a.outline !== b.outline;
};

function sameList(a: PageItem[], b: PageItem[]) {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

// ---- page operations: pure functions from (pages, selection) to pages ----

const norm = (deg: number) => ((deg % 360) + 360) % 360;

export function rotate(pages: PageItem[], ids: Set<string>, by: number): PageItem[] {
  return pages.map((p) => (ids.has(p.id) ? { ...p, rotate: norm(p.rotate + by) } : p));
}

/** Refuses to delete every page; returns the input unchanged in that case. */
export function remove(pages: PageItem[], ids: Set<string>): PageItem[] {
  const kept = pages.filter((p) => !ids.has(p.id));
  return kept.length === 0 ? pages : kept;
}

/** Copies of the selected pages are inserted right after the last selected page, in document order. */
export function duplicate(pages: PageItem[], ids: Set<string>): { pages: PageItem[]; newIds: string[] } {
  const chosen = pages.filter((p) => ids.has(p.id));
  if (chosen.length === 0) return { pages, newIds: [] };
  const copies = chosen.map((p) => ({ ...p, id: newId() }));
  const last = lastIndexOf(pages, ids);
  return { pages: [...pages.slice(0, last + 1), ...copies, ...pages.slice(last + 1)], newIds: copies.map((c) => c.id) };
}

/** Moves the selected pages (keeping their relative order) so they start at `target` in the list without them. */
export function moveTo(pages: PageItem[], ids: Set<string>, target: number): PageItem[] {
  const moving = pages.filter((p) => ids.has(p.id));
  const rest = pages.filter((p) => !ids.has(p.id));
  const at = Math.max(0, Math.min(rest.length, target));
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/**
 * Drag-and-drop helper: `beforeIndex` is a gap in the full list (0 = before the first page, n = after the last).
 * Converts it to a position in the list without the moving pages.
 */
export function dropAt(pages: PageItem[], ids: Set<string>, beforeIndex: number): PageItem[] {
  const removedBefore = pages.slice(0, beforeIndex).filter((p) => ids.has(p.id)).length;
  return moveTo(pages, ids, beforeIndex - removedBefore);
}

/** Moves the selection one step up (-1) or down (+1) as a block. */
export function nudge(pages: PageItem[], ids: Set<string>, dir: -1 | 1): PageItem[] {
  const first = pages.findIndex((p) => ids.has(p.id));
  if (first < 0) return pages;
  const rest = pages.filter((p) => !ids.has(p.id));
  const startInRest = pages.slice(0, first).filter((p) => !ids.has(p.id)).length;
  return moveTo(pages, ids, Math.max(0, Math.min(rest.length, startInRest + dir)));
}

export function insertAfter(pages: PageItem[], index: number, items: PageItem[]): PageItem[] {
  const at = Math.max(0, Math.min(pages.length, index + 1));
  return [...pages.slice(0, at), ...items, ...pages.slice(at)];
}

export function lastIndexOf(pages: PageItem[], ids: Set<string>): number {
  for (let i = pages.length - 1; i >= 0; i--) if (ids.has(pages[i]!.id)) return i;
  return -1;
}

/** Set (or with null, remove) a crop box on the selected pages. Blank pages are left alone. */
export function setCrop(pages: PageItem[], ids: Set<string>, crop: (p: Extract<PageItem, { kind: 'page' }>) => Rect | null): PageItem[] {
  return pages.map((p) => {
    if (!ids.has(p.id) || p.kind !== 'page') return p;
    const c = crop(p);
    if (!c) { const { crop: _drop, ...rest } = p; return rest; }
    return { ...p, crop: c };
  });
}

/** True when the page list is exactly the first source, unchanged; saving can then keep the file as it is. */
export function isUnchangedLayout(pages: PageItem[], sources: SourceFile[]): boolean {
  const first = sources[0];
  return !!first && pages.length === first.pageCount
    && pages.every((p, i) => p.kind === 'page' && p.source === 0 && p.page === i && p.rotate === 0 && !p.crop);
}

/** The layout Save sends to the main process. */
export function toSlots(pages: PageItem[]): SaveSlot[] {
  return pages.map((p) => {
    if (p.kind === 'blank') {
      // a blank page has no /Rotate of its own, so rotation is the same as swapping its sides
      return { blank: p.rotate % 180 === 0 ? [p.width, p.height] : [p.height, p.width] };
    }
    const slot: SaveSlot = { source: p.source, page: p.page };
    if (p.rotate) slot.rotate = p.rotate;
    if (p.crop) slot.crop = p.crop;
    return slot;
  });
}
