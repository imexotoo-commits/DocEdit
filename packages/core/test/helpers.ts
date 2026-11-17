import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { deflateSync, inflateSync } from 'node:zlib';

/** One page per string, the string drawn big at (50,700) so text extraction and search can find it. */
export async function makePdf(pages: string[], opts: { size?: [number, number] } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage(opts.size ?? [612, 792]);
    page.drawText(text, { x: 50, y: 700, size: 24, font });
  }
  return doc.save();
}

/** 1x1 opaque red PNG (valid, built by hand so tests need no fixtures on disk). */
export function redPng(): Uint8Array {
  const crc = (buf: Uint8Array) => { let c, crcv = 0xffffffff; for (const b of buf) { c = (crcv ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); out.set([...type].map((c) => c.charCodeAt(0)), 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length))); return out;
  };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, 1); dv.setUint32(4, 1); ihdr.set([8, 2, 0, 0, 0], 8);
  const idat = deflateSync(Uint8Array.from([0, 255, 0, 0]));
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())];
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

/** Add a /Link annotation on page `from` that points at page `to` (used to prove redaction does not drag pages along). */
export async function addInternalLink(pdf: Uint8Array, from: number, to: number): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const dest = doc.context.obj([doc.getPage(to).ref, PDFName.of('Fit')]);
  const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 40], Border: [0, 0, 0], Dest: dest }));
  doc.getPage(from).node.set(PDFName.of('Annots'), doc.context.obj([link]));
  void PDFString;
  return doc.save();
}

export const text = (u: Uint8Array) => Buffer.from(u).toString('latin1');

/**
 * Everything a reader of the file could get at: the raw bytes plus every stream inflated.
 * Use this, not text(), to prove a string is gone: compressed streams hide strings from a plain byte search.
 */
export function deepText(u: Uint8Array): string {
  const raw = Buffer.from(u).toString('latin1');
  const parts = [raw];
  const re = /stream\r?\n/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    try { parts.push(inflateSync(Buffer.from(u.subarray(start, end))).toString('latin1')); } catch { /* not Flate */ }
  }
  return parts.join('\n');
}
