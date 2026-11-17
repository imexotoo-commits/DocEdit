/** Links a document asks to open, checked by the main process. */

/** Email link fields passed on to the mail program; others (attach=, file=, ...) are dropped. */
const MAIL_FIELDS = new Set(['to', 'cc', 'bcc', 'subject', 'body']);
export function safeMailto(url: URL): { href: string; dropped: string[] } {
  const keep: string[] = [], dropped: string[] = [];
  for (const [k, v] of url.searchParams) {
    if (MAIL_FIELDS.has(k.toLowerCase())) keep.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    else dropped.push(k);
  }
  return { href: `mailto:${url.pathname}${keep.length ? `?${keep.join('&')}` : ''}`, dropped };
}
