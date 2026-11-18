import { describe, expect, it } from 'vitest';
import { readCapped, TooLargeError } from '../src/download.js';

/** A streamed body of `chunks` pieces of `size` bytes, counting how many were pulled. */
function streamed(chunks: number, size: number, headers: Record<string, string> = {}) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) { if (pulled >= chunks) { c.close(); return; } pulled++; c.enqueue(new Uint8Array(size).fill(7)); },
  });
  return { res: new Response(body, { headers }), pulled: () => pulled };
}

describe('PDF download limit', () => {
  it('reads a body within the limit', async () => {
    const { res } = streamed(4, 100);
    const bytes = await readCapped(res, 1000);
    expect(bytes.length).toBe(400);
    expect(bytes[399]).toBe(7);
  });

  it('refuses a declared length over the limit without reading the body', async () => {
    const { res, pulled } = streamed(50, 100, { 'content-length': '5000' });
    await expect(readCapped(res, 1000)).rejects.toBeInstanceOf(TooLargeError);
    expect(pulled()).toBeLessThanOrEqual(1);
  });

  it('stops an undeclared stream as soon as it passes the limit', async () => {
    const { res, pulled } = streamed(1000, 100);
    await expect(readCapped(res, 1000)).rejects.toBeInstanceOf(TooLargeError);
    expect(pulled()).toBeLessThan(15);
  });

  it('stops when a wrong declared length understates the body', async () => {
    const { res } = streamed(30, 100, { 'content-length': '10' });
    await expect(readCapped(res, 1000)).rejects.toBeInstanceOf(TooLargeError);
  });

  it('stops when cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(readCapped(streamed(5, 10).res, 1000, abort.signal)).rejects.toThrow(/cancelled/);
  });
});
