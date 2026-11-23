import { describe, expect, it } from 'vitest';
import { pickWindowForOpen } from '../src/main/openRouting.js';

describe('where a PDF from Explorer, Finder or the recent list goes', () => {
  it('goes to the focused window', () => {
    expect(pickWindowForOpen([{ id: 1, focused: false }, { id: 2, focused: true }, { id: 3, focused: false }])).toBe(2);
  });

  it('otherwise to the most recently opened window', () => {
    expect(pickWindowForOpen([{ id: 1, focused: false }, { id: 5, focused: false }])).toBe(5);
  });

  it('needs a new window only when none is open', () => {
    expect(pickWindowForOpen([])).toBeNull();
  });
});
