/**
 * A minimal ZIP writer (deflate via the platform's CompressionStream), enough for .docx files.
 * Written for this project; follows the PKWARE APPNOTE layout: local headers, data, central directory, end record.
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Limits of the classic ZIP format this writer produces (no zip64): 65,535 entries and 4 GB per size or offset. A file
 * past them is refused rather than written with sizes that wrap around into a corrupt archive. (A .docx that large is
 * beyond what Word opens, and beyond what this page can hold in memory anyway.)
 */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xfffffffe;
export class ZipTooLargeError extends Error {
  constructor() { super('The document is too large to export in this format (over 4 GB or 65,535 parts).'); this.name = 'ZipTooLargeError'; }
}

export interface ZipEntry { name: string; data: Uint8Array | string; /** store without compression (already compressed data such as PNG) */ store?: boolean }

export async function zip(entries: ZipEntry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  if (entries.length > ZIP_MAX_ENTRIES) throw new ZipTooLargeError();
  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const crc = crc32(raw);
    const packed = e.store ? raw : await deflateRaw(raw);
    const method = e.store ? 0 : 8;
    if (raw.length > ZIP_MAX_BYTES || packed.length > ZIP_MAX_BYTES || offset > ZIP_MAX_BYTES) throw new ZipTooLargeError();
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); // time 0, date 1980-01-01
    local.setUint32(14, crc, true); local.setUint32(18, packed.length, true); local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, packed);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, method, true); dir.setUint16(12, 0, true); dir.setUint16(14, 0x21, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, packed.length, true); dir.setUint32(24, raw.length, true);
    dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + packed.length;
  }
  const dirSize = central.reduce((s, p) => s + p.length, 0);
  if (offset > ZIP_MAX_BYTES || dirSize > ZIP_MAX_BYTES || offset + dirSize > ZIP_MAX_BYTES) throw new ZipTooLargeError();
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
