/** Loading the PDF's bytes for the viewer, with a size limit. */

/** Largest PDF the viewer loads (the bytes are kept, and pdf.js needs working memory on top). */
export const MAX_PDF_BYTES = 300 * 1024 * 1024;

export class TooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`This PDF is larger than ${Math.round(limit / 1048576)} MB, more than Oakqueill PDF Viewer opens.`);
    this.name = 'TooLargeError';
  }
}

/**
 * The response body, refused early when the server declares more than `limit` bytes and stopped as soon as more than
 * `limit` bytes actually arrive (a declared length can be missing or wrong). `signal` cancels the download.
 */
export async function readCapped(res: Response, limit = MAX_PDF_BYTES, signal?: AbortSignal): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) { await res.body?.cancel().catch(() => {}); throw new TooLargeError(limit); }
  if (!res.body) return new Uint8Array(0); // no body at all: an empty file, which the PDF reader reports
  const reader = res.body.getReader();
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('The download was cancelled.', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { stop(); throw new TooLargeError(limit); }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', stop);
  }
  if (signal?.aborted) throw new DOMException('The download was cancelled.', 'AbortError');
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}
