import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from './pdf.js';
import type { PageItem } from './model.js';
import type { OutlineNode as EditorNode } from './edits.js';
import { newId } from './model.js';

/** One bookmark as pdf.js reports it (only the fields we use). */
interface OutlineNode { title: string; dest: unknown; url: string | null; unsafeUrl?: string; items: OutlineNode[] }

interface Props {
  doc: PDFDocumentProxy;
  /** source page index -> position in the current page list, or -1 when that page was deleted */
  onDest(dest: unknown): void;
  onUrl(url: string): void;
}

/** Read-only bookmark tree of the main document. Editing bookmarks is part of phase 2. */
export function Outline({ doc, onDest, onUrl }: Props) {
  const [nodes, setNodes] = useState<OutlineNode[] | null>(null);
  useEffect(() => {
    let live = true;
    doc.getOutline().then((o) => { if (live) setNodes((o as OutlineNode[] | null) ?? []); }, () => { if (live) setNodes([]); });
    return () => { live = false; };
  }, [doc]);

  if (nodes === null) return <div className="panel-empty">Loading…</div>;
  if (nodes.length === 0) return <div className="panel-empty">This document has no bookmarks.</div>;
  return (
    <ul className="outline" role="tree" aria-label="Bookmarks">
      {nodes.map((n, i) => <OutlineItem key={i} node={n} depth={0} onDest={onDest} onUrl={onUrl} />)}
    </ul>
  );
}

function OutlineItem({ node, depth, onDest, onUrl }: { node: OutlineNode; depth: number; onDest(d: unknown): void; onUrl(u: string): void }) {
  const [open, setOpen] = useState(depth === 0 && node.items.length <= 12);
  const url = node.url ?? node.unsafeUrl;
  const hasKids = node.items.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasKids ? open : undefined}>
      <div className="outline-row" style={{ paddingLeft: 6 + depth * 14 }}>
        {hasKids
          ? <button className="twisty" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
          : <span className="twisty" />}
        <button className="outline-title" title={url ?? node.title}
          onClick={() => { if (url) onUrl(url); else if (node.dest != null) onDest(node.dest); }}>
          {node.title || '(untitled)'}
        </button>
      </div>
      {hasKids && open && (
        <ul role="group">{node.items.map((c, i) => <OutlineItem key={i} node={c} depth={depth + 1} onDest={onDest} onUrl={onUrl} />)}</ul>
      )}
    </li>
  );
}

/** The file's bookmarks as editor nodes pointing at page ids of `source` (null when that page is gone). */
export async function loadOutlineNodes(doc: PDFDocumentProxy, pages: PageItem[], source: number): Promise<EditorNode[]> {
  const raw = ((await doc.getOutline().catch(() => null)) ?? []) as Array<{ title: string; dest: unknown; items: unknown[] }>;
  const pageIdOf = async (dest: unknown): Promise<string | null> => {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      const t = Array.isArray(explicit) ? explicit[0] : null;
      const idx = typeof t === 'number' ? t : t && typeof t === 'object' ? await doc.getPageIndex(t as { num: number; gen: number }) : -1;
      return pages.find((p) => p.kind === 'page' && p.source === source && p.page === idx)?.id ?? null;
    } catch { return null; }
  };
  const conv = async (list: Array<{ title: string; dest: unknown; items: unknown[] }>): Promise<EditorNode[]> =>
    Promise.all(list.map(async (n) => ({ id: newId(), title: n.title, pageId: await pageIdOf(n.dest), children: await conv(n.items as never) })));
  return conv(raw);
}
