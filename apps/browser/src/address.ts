/** The viewer's address format, shared by the viewer page and the background worker. */

/** The PDF's address, from "viewer.html?file=<address>" (left raw by the browser's redirect rule), and its #fragment. */
export function sourceFromLocation(href: string): { url: string; fragment: string } | null {
  try {
    const at = href.indexOf('?file=');
    if (at < 0) return null;
    let rest = href.slice(at + 6);
    const hash = rest.indexOf('#');
    const fragment = hash >= 0 ? rest.slice(hash + 1) : '';
    if (hash >= 0) rest = rest.slice(0, hash);
    // an encoded address (written by hand or by another tool); malformed encoding is no address at all
    if (/^(https?|file)%3A/i.test(rest)) rest = decodeURIComponent(rest);
    const u = new URL(rest);
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) return null;
    return { url: u.href, fragment };
  } catch {
    return null;
  }
}

/** The address as the viewer compares it: normalised, without its #fragment (which only says where to look). */
export function normalUrl(url: string): string | null {
  try { const u = new URL(url); u.hash = ''; return u.href; } catch { return null; }
}
