/**
 * Only the most recently started request may report back. Starting a new one, or cancelling (the document changed,
 * the view went away), makes every earlier one stale: its result and its error are both ignored.
 */
export function latestOnly() {
  let current = 0;
  return {
    start(): () => boolean { const id = ++current; return () => id === current; },
    cancel(): void { current++; },
  };
}
