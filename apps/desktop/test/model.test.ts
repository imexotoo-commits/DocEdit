import { describe, expect, it } from 'vitest';
import {
  commit, createEditor, dropAt, duplicate, insertAfter, isDirty, nudge, redo, remove, rotate, toSlots, undo, type PageItem,
} from '../src/renderer/model.js';

const doc = (n: number) => createEditor({ path: '/x.pdf', name: 'x.pdf', bytes: new Uint8Array(), pageCount: n });
const order = (ps: PageItem[]) => ps.map((p) => (p.kind === 'page' ? p.page + 1 : 'B'));
const ids = (ps: PageItem[], ...pageNumbers: number[]) => new Set(pageNumbers.map((n) => ps[n - 1]!.id));

describe('editor history', () => {
  it('undoes and redoes, and tracks dirty state against the saved list', () => {
    let ed = doc(3);
    const ps = ed.history.present.pages;
    expect(isDirty(ed)).toBe(false);
    ed = commit(ed, remove(ps, ids(ps, 2)));
    expect(order(ed.history.present.pages)).toEqual([1, 3]);
    expect(isDirty(ed)).toBe(true);
    ed = undo(ed);
    expect(order(ed.history.present.pages)).toEqual([1, 2, 3]);
    expect(isDirty(ed)).toBe(false);
    ed = redo(ed);
    expect(order(ed.history.present.pages)).toEqual([1, 3]);
    expect(redo(ed)).toBe(ed);
  });
  it('treats a document that was never saved as having unsaved changes', () => {
    const ed = createEditor({ path: null, name: 'Untitled.pdf', bytes: new Uint8Array(), pageCount: 1 });
    expect(isDirty(ed)).toBe(true);
  });
  it('does not record no-op edits and a new edit clears redo', () => {
    let ed = doc(2);
    expect(commit(ed, [...ed.history.present.pages])).toBe(ed);
    ed = commit(ed, rotate(ed.history.present.pages, new Set(), 90));
    expect(ed.history.past.length).toBe(0);
    ed = commit(ed, rotate(ed.history.present.pages, ids(ed.history.present.pages, 1), 90));
    ed = undo(ed);
    ed = commit(ed, remove(ed.history.present.pages, ids(ed.history.present.pages, 1)));
    expect(ed.history.future).toEqual([]);
  });
});

describe('page operations', () => {
  const ps = doc(5).history.present.pages;
  it('rotates selected pages, wrapping around', () => {
    const r = rotate(rotate(ps, ids(ps, 1, 3), -90), ids(ps, 3), 180);
    expect(r.map((p) => p.rotate)).toEqual([270, 0, 90, 0, 0]);
  });
  it('never deletes every page', () => {
    expect(remove(ps, new Set(ps.map((p) => p.id)))).toBe(ps);
    expect(order(remove(ps, ids(ps, 1, 5)))).toEqual([2, 3, 4]);
  });
  it('duplicates after the last selected page with fresh ids', () => {
    const { pages, newIds } = duplicate(ps, ids(ps, 2, 4));
    expect(order(pages)).toEqual([1, 2, 3, 4, 2, 4, 5]);
    expect(new Set(pages.map((p) => p.id)).size).toBe(7);
    expect(newIds).toEqual([pages[4]!.id, pages[5]!.id]);
  });
  it('drops a selection at a gap, keeping relative order', () => {
    expect(order(dropAt(ps, ids(ps, 1, 2), 4))).toEqual([3, 4, 1, 2, 5]);
    expect(order(dropAt(ps, ids(ps, 4, 5), 0))).toEqual([4, 5, 1, 2, 3]);
    expect(order(dropAt(ps, ids(ps, 2, 4), 5))).toEqual([1, 3, 5, 2, 4]);
    expect(order(dropAt(ps, ids(ps, 3), 3))).toEqual([1, 2, 3, 4, 5]);
  });
  it('nudges a block up and down and stops at the ends', () => {
    expect(order(nudge(ps, ids(ps, 2, 3), 1))).toEqual([1, 4, 2, 3, 5]);
    expect(order(nudge(ps, ids(ps, 2, 3), -1))).toEqual([2, 3, 1, 4, 5]);
    expect(order(nudge(ps, ids(ps, 1), -1))).toEqual([1, 2, 3, 4, 5]);
    expect(order(nudge(ps, ids(ps, 5), 1))).toEqual([1, 2, 3, 4, 5]);
  });
  it('inserts after an index, including before the first page', () => {
    const b: PageItem = { id: 'b', kind: 'blank', width: 100, height: 200, rotate: 0 };
    expect(order(insertAfter(ps, 1, [b]))).toEqual([1, 2, 'B', 3, 4, 5]);
    expect(order(insertAfter(ps, -1, [b]))).toEqual(['B', 1, 2, 3, 4, 5]);
  });
});

describe('save layout', () => {
  it('maps pages to core slots and swaps blank sides for quarter turns', () => {
    const ps: PageItem[] = [
      { id: 'a', kind: 'page', source: 0, page: 2, rotate: 0 },
      { id: 'b', kind: 'page', source: 1, page: 0, rotate: 270 },
      { id: 'c', kind: 'blank', width: 100, height: 200, rotate: 90 },
      { id: 'd', kind: 'blank', width: 100, height: 200, rotate: 180 },
    ];
    expect(toSlots(ps)).toEqual([
      { source: 0, page: 2 }, { source: 1, page: 0, rotate: 270 }, { blank: [200, 100] }, { blank: [100, 200] },
    ]);
  });
});
