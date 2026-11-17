/** The Swift side. Every call is a message with a reply; bytes travel as base64. */
interface Handler { postMessage(msg: unknown): Promise<unknown> }
declare global {
  interface Window { webkit?: { messageHandlers?: { native?: Handler } } }
}

export const hasNative = () => !!window.webkit?.messageHandlers?.native;

export async function native<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const h = window.webkit?.messageHandlers?.native;
  if (!h) throw new Error('This feature needs the Oakqueill iOS app.');
  return (await h.postMessage({ op, args })) as T;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
