/**
 * Which window a PDF handed to the app by the system (Explorer or Finder "Open With", double-click, Dock drop, the recent
 * list) goes to: the focused window, otherwise the most recently opened one. The window opens it in a new tab whenever
 * its current tab shows a document, so nothing open is replaced and several files simply become several tabs.
 */
export interface WindowSlot { id: number; focused: boolean }

/** The id of the window to use, or null when there is none and a new window is needed. */
export function pickWindowForOpen(windows: readonly WindowSlot[]): number | null {
  return windows.find((w) => w.focused)?.id ?? windows[windows.length - 1]?.id ?? null;
}
