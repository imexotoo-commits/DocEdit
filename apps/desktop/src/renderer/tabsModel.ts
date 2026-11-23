import type { OpenedFile } from '../shared/api.js';

/** One document tab: its id, and the file it opens when created (if any). */
export interface TabEntry { id: number; initialFile?: OpenedFile; initialNotice?: string }

/** The tab `step` places from `from` (wrapping round), as Ctrl+Tab and Ctrl+Shift+Tab move. */
export function nextTab(tabs: readonly TabEntry[], from: number, step: 1 | -1): number {
  const i = tabs.findIndex((t) => t.id === from);
  if (i < 0 || tabs.length === 0) return tabs[0]?.id ?? from;
  return tabs[(i + step + tabs.length) % tabs.length]!.id;
}

/** The tabs after closing `id`, and which tab is then active: the same one, or the neighbour to the right (left at the end). */
export function closeTab(tabs: readonly TabEntry[], active: number, id: number): { tabs: TabEntry[]; active: number } {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return { tabs: [...tabs], active };
  const rest = tabs.filter((t) => t.id !== id);
  if (id !== active) return { tabs: rest, active };
  const next = rest[Math.min(i, rest.length - 1)];
  return { tabs: rest, active: next?.id ?? active };
}
