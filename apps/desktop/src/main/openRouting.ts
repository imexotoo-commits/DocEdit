/**
 * Where a PDF handed to the app by the system (Finder "Open With", double-click, Dock drop) goes. It never replaces a
 * document that is already open: it takes a window that has no document and is not already promised another file, and
 * otherwise a new window is needed. So unsaved changes are never discarded, and several files opened at once each get
 * their own window instead of racing to replace the same one.
 */
export interface WindowSlot { id: number; hasDoc: boolean; claimed: boolean }

/** The id of the window to use, or null when a new window is needed. */
export function pickWindowForOpen(windows: readonly WindowSlot[]): number | null {
  return windows.find((w) => !w.hasDoc && !w.claimed)?.id ?? null;
}
