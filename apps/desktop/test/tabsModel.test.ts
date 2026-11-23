import { describe, expect, it } from 'vitest';
import { closeTab, nextTab } from '../src/renderer/tabsModel.js';

const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];

describe('document tabs', () => {
  it('Ctrl+Tab and Ctrl+Shift+Tab move along the tabs and wrap round', () => {
    expect(nextTab(tabs, 1, 1)).toBe(2);
    expect(nextTab(tabs, 3, 1)).toBe(1);
    expect(nextTab(tabs, 1, -1)).toBe(3);
    expect(nextTab([{ id: 9 }], 9, 1)).toBe(9);
  });

  it('closing the active tab shows its right-hand neighbour, or the left one at the end', () => {
    expect(closeTab(tabs, 2, 2)).toEqual({ tabs: [{ id: 1 }, { id: 3 }], active: 3 });
    expect(closeTab(tabs, 3, 3)).toEqual({ tabs: [{ id: 1 }, { id: 2 }], active: 2 });
  });

  it('closing another tab keeps the active one', () => {
    expect(closeTab(tabs, 1, 3)).toEqual({ tabs: [{ id: 1 }, { id: 2 }], active: 1 });
    expect(closeTab(tabs, 1, 42)).toEqual({ tabs, active: 1 });
  });
});
