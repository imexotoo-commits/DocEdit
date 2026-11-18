import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

/**
 * The page is loaded from a file:// URL, and a page from file:// may by default read any other local file with fetch,
 * XMLHttpRequest or an iframe. Script running in the window (if the page were ever tricked into running some) could then read
 * the user's documents. The main process cancels every file:// request that is not inside the app's own renderer folder.
 */
export function isInsideDir(dir: string, url: string): boolean {
  let path: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return true; // not our business: other schemes are decided by the content security policy
    path = fileURLToPath(u); // refuses a host name (UNC paths) and malformed escapes
  } catch { return false; }
  const norm = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
  const root = norm(resolve(dir)), target = norm(resolve(path));
  return target === root || target.startsWith(root + sep);
}

/** What the page says about its document, reduced to safe values (the page is not trusted to send the right shape). */
export function parseDocumentState(state: unknown): { title: string; dirty: boolean } {
  const s = (state && typeof state === 'object' ? state : {}) as { title?: unknown; dirty?: unknown };
  return { title: typeof s.title === 'string' ? s.title.slice(0, 300) : '', dirty: s.dirty === true };
}
