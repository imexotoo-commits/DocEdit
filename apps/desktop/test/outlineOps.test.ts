import { describe, expect, it } from 'vitest';
import { indent, insertAfter, move, outdent, remove, update } from '../src/renderer/outlineOps.js';
import { resolveEdits, resolveOutline, type OutlineNode } from '../src/renderer/edits.js';

const n = (id: string, children: OutlineNode[] = [], pageId: string | null = 'p1'): OutlineNode => ({ id, title: id.toUpperCase(), pageId, children });
const shape = (t: OutlineNode[]): unknown => t.map((x) => (x.children.length ? { [x.id]: shape(x.children) } : x.id));

describe('bookmark tree edits', () => {
  const tree = [n('a'), n('b', [n('b1'), n('b2')]), n('c')];
  it('renames, removes, inserts and moves without touching the input', () => {
    expect(update(tree, 'b2', { title: 'New' })[1]!.children[1]!.title).toBe('New');
    expect(shape(remove(tree, 'b1'))).toEqual(['a', { b: ['b2'] }, 'c']);
    expect(shape(insertAfter(tree, 'b1', n('x')))).toEqual(['a', { b: ['b1', 'x', 'b2'] }, 'c']);
    expect(shape(insertAfter(tree, null, n('x')))).toEqual(['a', { b: ['b1', 'b2'] }, 'c', 'x']);
    expect(shape(move(tree, 'c', -1))).toEqual(['a', 'c', { b: ['b1', 'b2'] }]);
    expect(move(tree, 'a', -1)).toEqual(tree);
    expect(shape(tree)).toEqual(['a', { b: ['b1', 'b2'] }, 'c']);
  });
  it('indents under the previous sibling and outdents after the parent', () => {
    expect(shape(indent(tree, 'c'))).toEqual(['a', { b: ['b1', 'b2', 'c'] }]);
    expect(indent(tree, 'a')).toEqual(tree);
    expect(shape(outdent(tree, 'b1'))).toEqual(['a', { b: ['b2'] }, 'b1', 'c']);
    expect(outdent(tree, 'a')).toEqual(tree);
  });
});

describe('resolving edits for saving', () => {
  it('maps page ids to final positions and drops bookmarks of deleted pages, keeping their children', () => {
    const index = new Map([['p1', 0], ['p3', 1]]);
    const tree = [n('a', [], 'p3'), n('gone', [n('kid', [], 'p1')], 'p2')];
    expect(resolveOutline(tree, index)).toEqual([{ title: 'A', page: 1, children: [] }, { title: 'KID', page: 0, children: [] }]);
  });
  it('drops edits on deleted pages and links to deleted pages; resolves "all" to every page', () => {
    const pages = [{ id: 'p1', kind: 'blank' as const, width: 100, height: 100, rotate: 0 }, { id: 'p3', kind: 'blank' as const, width: 100, height: 100, rotate: 0 }];
    const out = resolveEdits(pages, [
      { id: '1', type: 'annotation', pageId: 'p2', annotation: { kind: 'note', at: { x: 0, y: 0 }, text: 'x' } },
      { id: '2', type: 'annotation', pageId: 'p3', annotation: { kind: 'note', at: { x: 0, y: 0 }, text: 'y' } },
      { id: '3', type: 'link', pageId: 'p1', rect: { x: 0, y: 0, width: 1, height: 1 }, target: { pageId: 'p2' } },
      { id: '4', type: 'link', pageId: 'p1', rect: { x: 0, y: 0, width: 1, height: 1 }, target: { pageId: 'p3' } },
      { id: '5', type: 'watermark', pages: 'all', text: 'W' },
    ], null);
    expect(out).toEqual([
      { type: 'annotation', page: 1, annotation: { kind: 'note', at: { x: 0, y: 0 }, text: 'y' }, author: undefined },
      { type: 'link', page: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, target: { page: 1 } },
      { type: 'watermark', pages: [0, 1], text: 'W', size: undefined, opacity: undefined, angle: undefined, color: undefined },
    ]);
  });
});
