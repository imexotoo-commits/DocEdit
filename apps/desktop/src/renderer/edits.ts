/**
 * Pending content edits. They point at pages by stable page id and are resolved to final page
 * numbers only when saving, so they follow pages through reorders and vanish with deleted pages.
 * Everything here is plain JSON (images as base64) so it can go into undo history and crash recovery.
 */
import type { AnnotationSpec, Corner, DocEdit, OutlineEntry, MarkSpec } from '@docedit/core';
import type { PageItem } from './model.js';

export type PageScope = 'all' | string[];
export interface Base64Image { base64: string; format: 'png' | 'jpg' }

export type PendingEdit =
  | { id: string; type: 'metadata'; meta: { title?: string; author?: string; subject?: string; keywords?: string[] } }
  | { id: string; type: 'fill'; values: Record<string, string | boolean | string[]> }
  | { id: string; type: 'watermark'; pages: PageScope; text: string; size?: number; opacity?: number; angle?: number; color?: [number, number, number] }
  | { id: string; type: 'furniture'; pages: PageScope; items: Array<{ position: Corner; text: string }>; size?: number; margin?: number; startPage?: number; bates?: { prefix?: string; start?: number; digits?: number; suffix?: string } }
  | { id: string; type: 'signature'; pageId: string; rect: Rect; image?: Base64Image; typedName?: string; caption?: string }
  | { id: string; type: 'annotation'; pageId: string; annotation: AnnotationSpec; author?: string }
  | { id: string; type: 'link'; pageId: string; rect: Rect; target: { pageId: string } | { url: string } }
  /** an area to remove permanently; applied only by "Apply redactions" into a new copy */
  | { id: string; type: 'redact'; pageId: string; rect: Rect; text?: string }
  /** a fill-and-sign mark (tick, cross, dot, box, line) drawn into the page */
  | { id: string; type: 'mark'; pageId: string; mark: MarkSpec };

export interface Rect { x: number; y: number; width: number; height: number }

/** A bookmark in the editor: points at a page id (null once that page is deleted). */
export interface OutlineNode { id: string; title: string; pageId: string | null; children: OutlineNode[] }

export type Distributive<T> = T extends unknown ? Omit<T, 'id'> : never;

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Turn pending edits into core edits for the final page order. Edits on deleted pages are dropped. */
export function resolveEdits(pages: PageItem[], edits: PendingEdit[], outline: OutlineNode[] | null): DocEdit[] {
  const index = new Map(pages.map((p, i) => [p.id, i]));
  const scope = (s: PageScope) => (s === 'all' ? pages.map((_, i) => i) : s.flatMap((id) => (index.has(id) ? [index.get(id)!] : [])));
  const out: DocEdit[] = [];
  for (const e of edits) {
    switch (e.type) {
      case 'metadata': out.push({ type: 'metadata', meta: e.meta }); break;
      case 'fill': out.push({ type: 'fill', values: e.values }); break;
      case 'watermark': { const p = scope(e.pages); if (p.length) out.push({ type: 'watermark', pages: p, text: e.text, size: e.size, opacity: e.opacity, angle: e.angle, color: e.color }); break; }
      case 'furniture': { const p = scope(e.pages); if (p.length) out.push({ type: 'furniture', pages: p, items: e.items, size: e.size, margin: e.margin, startPage: e.startPage, bates: e.bates }); break; }
      case 'signature': {
        const i = index.get(e.pageId);
        if (i !== undefined) out.push({ type: 'signature', page: i, rect: e.rect, typedName: e.typedName, caption: e.caption, image: e.image ? { bytes: b64ToBytes(e.image.base64), format: e.image.format } : undefined });
        break;
      }
      case 'annotation': { const i = index.get(e.pageId); if (i !== undefined) out.push({ type: 'annotation', page: i, annotation: e.annotation, author: e.author }); break; }
      case 'redact': break; // never part of a normal save
      case 'mark': { const i = index.get(e.pageId); if (i !== undefined) out.push({ type: 'mark', page: i, mark: e.mark }); break; }
      case 'link': {
        const i = index.get(e.pageId);
        if (i === undefined) break;
        if ('url' in e.target) out.push({ type: 'link', page: i, rect: e.rect, target: { url: e.target.url } });
        else if (index.has(e.target.pageId)) out.push({ type: 'link', page: i, rect: e.rect, target: { page: index.get(e.target.pageId)! } });
        break;
      }
    }
  }
  if (outline) out.push({ type: 'outline', entries: resolveOutline(outline, index) });
  return out;
}

/** Bookmarks whose page was deleted are dropped; their children move up a level. */
export function resolveOutline(nodes: OutlineNode[], index: Map<string, number>): OutlineEntry[] {
  return nodes.flatMap((n) => {
    const kids = resolveOutline(n.children, index);
    const page = n.pageId ? index.get(n.pageId) : undefined;
    return page === undefined ? kids : [{ title: n.title, page, children: kids }];
  });
}

/** Fill values merged into the one fill edit of a document. */
export function fillValues(edits: PendingEdit[]): Record<string, string | boolean | string[]> {
  return Object.assign({}, ...edits.filter((e) => e.type === 'fill').map((e) => (e as Extract<PendingEdit, { type: 'fill' }>).values));
}
