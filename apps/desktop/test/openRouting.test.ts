import { describe, expect, it } from 'vitest';
import { pickWindowForOpen } from '../src/main/openRouting.js';

describe('where a PDF from Finder goes', () => {
  it('uses a window that has no document', () => {
    expect(pickWindowForOpen([{ id: 7, hasDoc: false, claimed: false }])).toBe(7);
  });

  it('never takes a window that shows a document, so unsaved changes cannot be discarded', () => {
    expect(pickWindowForOpen([{ id: 1, hasDoc: true, claimed: false }])).toBeNull();
    expect(pickWindowForOpen([{ id: 1, hasDoc: true, claimed: false }, { id: 2, hasDoc: true, claimed: false }])).toBeNull();
  });

  it('skips a window already promised another file, so several files do not race for one window', () => {
    expect(pickWindowForOpen([{ id: 1, hasDoc: false, claimed: true }])).toBeNull();
    expect(pickWindowForOpen([{ id: 1, hasDoc: false, claimed: true }, { id: 2, hasDoc: false, claimed: false }])).toBe(2);
  });

  it('gives each of several files its own window in turn', () => {
    const slots = [{ id: 1, hasDoc: false, claimed: false }];
    const used: Array<number | null> = [];
    for (let n = 0; n < 3; n++) {
      const id = pickWindowForOpen(slots);
      used.push(id);
      if (id === null) slots.push({ id: 10 + n, hasDoc: false, claimed: true }); // a new window, promised to this file
      else slots.find((s) => s.id === id)!.claimed = true;
    }
    expect(used).toEqual([1, null, null]);
    expect(new Set(slots.map((s) => s.id)).size).toBe(3);
  });
});
