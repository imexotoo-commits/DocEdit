import { useState } from 'react';
import type { OutlineNode } from './edits.js';
import type { PageItem } from './model.js';
import { newId } from './model.js';
import * as ops from './outlineOps.js';

interface Props {
  tree: OutlineNode[];
  pages: PageItem[];
  currentPage: number;
  onChange(tree: OutlineNode[]): void;
  onGo(pageIndex: number): void;
  onRename(node: OutlineNode, apply: (title: string) => void): void;
}

/** Editable bookmark tree. Keyboard: arrows move the selection; buttons act on the selected bookmark. */
export function BookmarksEditor({ tree, pages, currentPage, onChange, onGo, onRename }: Props) {
  const [sel, setSel] = useState<string | null>(null);
  const flat: OutlineNode[] = [];
  const walk = (list: OutlineNode[]) => list.forEach((n) => { flat.push(n); walk(n.children); });
  walk(tree);
  const selected = flat.find((n) => n.id === sel) ?? null;
  const pageIndex = (n: OutlineNode) => (n.pageId ? pages.findIndex((p) => p.id === n.pageId) : -1);

  function add() {
    const page = pages[currentPage];
    if (!page) return;
    const node: OutlineNode = { id: newId(), title: `Page ${currentPage + 1}`, pageId: page.id, children: [] };
    onChange(ops.insertAfter(tree, sel, node));
    setSel(node.id);
    onRename(node, (title) => onChange(ops.insertAfter(tree, sel, { ...node, title })));
  }

  const act = (fn: (t: OutlineNode[], id: string) => OutlineNode[]) => () => { if (sel) onChange(fn(tree, sel)); };

  return (
    <div className="bm-editor">
      <div className="bm-actions" role="toolbar" aria-label="Bookmark actions">
        <button onClick={add} title="Add a bookmark for the current page">Add</button>
        <button disabled={!selected} onClick={() => selected && onRename(selected, (title) => onChange(ops.update(tree, selected.id, { title })))}>Rename</button>
        <button disabled={!selected} onClick={() => selected && onChange(ops.update(tree, selected.id, { pageId: pages[currentPage]?.id ?? null }))} title="Point the bookmark at the current page">Set page</button>
        <button disabled={!selected} onClick={act((t, id) => ops.move(t, id, -1))} aria-label="Move up">↑</button>
        <button disabled={!selected} onClick={act((t, id) => ops.move(t, id, 1))} aria-label="Move down">↓</button>
        <button disabled={!selected} onClick={act(ops.indent)} aria-label="Indent">→</button>
        <button disabled={!selected} onClick={act(ops.outdent)} aria-label="Outdent">←</button>
        <button disabled={!selected} className="danger" onClick={() => { if (sel) { onChange(ops.remove(tree, sel)); setSel(null); } }}>Delete</button>
      </div>
      {!tree.length && <div className="panel-empty">No bookmarks. Go to a page and press Add.</div>}
      <ul className="outline" role="tree" aria-label="Bookmarks"
        tabIndex={0}
        onKeyDown={(e) => {
          const i = flat.findIndex((n) => n.id === sel);
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(flat[Math.min(flat.length - 1, i + 1)]?.id ?? null); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(flat[Math.max(0, i - 1)]?.id ?? null); }
          else if (e.key === 'Enter' && selected) { const p = pageIndex(selected); if (p >= 0) onGo(p); }
          else if (e.key === 'F2' && selected) onRename(selected, (title) => onChange(ops.update(tree, selected.id, { title })));
          else if (e.key === 'Delete' && sel) { onChange(ops.remove(tree, sel)); setSel(null); }
        }}>
        {tree.map((n) => <Row key={n.id} node={n} depth={0} sel={sel} onSel={setSel} pageIndex={pageIndex} onGo={onGo} />)}
      </ul>
    </div>
  );
}

function Row({ node, depth, sel, onSel, pageIndex, onGo }: { node: OutlineNode; depth: number; sel: string | null; onSel(id: string): void; pageIndex(n: OutlineNode): number; onGo(i: number): void }) {
  const p = pageIndex(node);
  return (
    <li role="treeitem" aria-selected={node.id === sel} aria-expanded={node.children.length ? true : undefined}>
      <div className={`outline-row${node.id === sel ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
        <button className="outline-title" onClick={() => { onSel(node.id); if (p >= 0) onGo(p); }} title={p >= 0 ? `Page ${p + 1}` : 'Its page was deleted'}>
          {node.title || '(untitled)'} <span className="muted small">{p >= 0 ? p + 1 : '—'}</span>
        </button>
      </div>
      {node.children.length > 0 && <ul role="group">{node.children.map((c) => <Row key={c.id} node={c} depth={depth + 1} sel={sel} onSel={onSel} pageIndex={pageIndex} onGo={onGo} />)}</ul>}
    </li>
  );
}
