/**
 * Structural check of a signed PDF revision: do the first `end` bytes form a complete, self-consistent version of the
 * document, and does the signature's own dictionary belong to it?
 *
 * A "%%EOF" line alone proves nothing (anyone can write one). Here the revision is read the way a PDF reader opens a
 * file: from its last `startxref`, through every cross-reference section (classic tables and cross-reference
 * streams, including /Prev chains and hybrid /XRefStm), checking that each object they list really starts where they
 * say, that the trailer's /Root is in the revision, and that the signature dictionary is a plain object in the
 * revision whose /Contents is exactly the gap the byte range leaves out.
 * Anything unusual or unsupported gives "not established", never "covered".
 */
import { PDFArray, PDFContext, PDFDict, PDFName, PDFNumber, PDFObjectParser, PDFRawStream, PDFRef, decodePDFRawStream, type PDFObject } from '@cantoo/pdf-lib';

export type RevisionCheck = { ok: true } | { ok: false; reason: string };

type Entry = { type: 0 } | { type: 1; offset: number; gen: number } | { type: 2; stream: number; index: number };

const MAX_SECTIONS = 512;
const MAX_ENTRIES = 1_000_000;
const latin1 = new TextDecoder('latin1');
const isWs = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;

class Fail extends Error {}
const fail = (reason: string): never => { throw new Fail(reason); };

export function checkSignedRevision(pdf: Uint8Array, end: number, sigRef: { num: number; gen: number } | null, gap: [number, number]): RevisionCheck {
  try {
    if (end <= 0 || end > pdf.length) fail('The signed bytes are outside the file.');
    const rev = pdf.subarray(0, end);
    const tail = latin1.decode(rev.subarray(Math.max(0, end - 1024)));
    const m = /startxref\s+(\d{1,15})\s+%%EOF[\r\n\t ]*$/.exec(tail);
    if (!m) fail('The signed bytes do not end with a cross-reference pointer and an end-of-file marker.');
    const start = Number(m![1]);
    if (!(start > 0 && start < end)) fail('The signed version points at a cross-reference outside itself.');

    const ctx = PDFContext.create();
    const entries = new Map<number, Entry>();
    let root: PDFRef | null = null;
    const seen = new Set<number>();
    const queue = [start];
    let sections = 0;
    while (queue.length) {
      const at = queue.shift()!;
      if (seen.has(at)) continue; // a loop in /Prev
      seen.add(at);
      if (++sections > MAX_SECTIONS) fail('The signed version has too many cross-reference sections.');
      if (!(at >= 0 && at < end)) fail('A cross-reference section of the signed version lies outside it.');
      const { list, trailer } = readSection(rev, at, ctx);
      for (const [num, e] of list) if (!entries.has(num)) entries.set(num, e); // newer sections win
      if (entries.size > MAX_ENTRIES) fail('The signed version lists too many objects.');
      if (!root) { const r = trailer.get(PDFName.of('Root')); if (r instanceof PDFRef) root = r; }
      const stm = trailer.get(PDFName.of('XRefStm')), prev = trailer.get(PDFName.of('Prev'));
      if (stm instanceof PDFNumber) queue.push(stm.asNumber());
      if (prev instanceof PDFNumber) queue.push(prev.asNumber());
    }

    // every object the revision lists must be where it says: plain objects at their offset, compressed ones in
    // a real object stream of this revision, at the index given
    const objects = new RevisionObjects(rev, entries, ctx);
    for (const [num, e] of entries) {
      if (e.type === 1) {
        if (!(e.offset >= 0 && e.offset < end)) fail(`Object ${num} of the signed version lies outside it.`);
        const head = objectHeader(rev, e.offset);
        if (!head || head.num !== num || head.gen !== e.gen) fail(`The cross-reference of the signed version does not match its contents (object ${num}).`);
      } else if (e.type === 2) objects.checkCompressed(num, e);
    }

    // the document root is a catalog, and the signature hangs off its form
    if (!root) fail('The signed version has no document root.');
    const catalog = objects.get(root!);
    if (!(catalog instanceof PDFDict) || !isName(catalog.get(PDFName.of('Type')), 'Catalog')) fail('The document root of the signed version is not a catalog.');
    if (!sigRef) fail('The signature dictionary cannot be located in the signed version.');
    if (!objects.signatureReachable(catalog as PDFDict, sigRef!)) fail('The signature is not part of the form of the signed version.');

    // the signature dictionary: a plain object of this revision whose own /Contents value is exactly the excluded bytes
    const e = entries.get(sigRef!.num);
    if (!e || e.type !== 1 || e.gen !== sigRef!.gen) fail('The signature dictionary is not a plain object of the signed version.');
    const head = objectHeader(rev, (e as { offset: number }).offset)!;
    const span = contentsSpan(rev, head.after);
    if (!span) fail('The signature dictionary of the signed version cannot be read.');
    if (span!.start !== gap[0] || span!.end !== gap[1]) fail('The excluded bytes are not the signature dictionary’s own /Contents value.');
    return { ok: true };
  } catch (err) {
    if (err instanceof Fail) return { ok: false, reason: err.message };
    return { ok: false, reason: 'The structure of the signed version could not be checked.' };
  }
}

/** "12 0 obj" at `at` (after any whitespace). */
function objectHeader(b: Uint8Array, at: number): { num: number; gen: number; after: number } | null {
  let i = at;
  while (i < b.length && isWs(b[i]!)) i++;
  const m = /^(\d{1,10})[\0\t\n\f\r ]+(\d{1,5})[\0\t\n\f\r ]+obj\b/.exec(latin1.decode(b.subarray(i, Math.min(b.length, i + 40))));
  return m ? { num: Number(m[1]), gen: Number(m[2]), after: i + m[0].length } : null;
}

function readSection(b: Uint8Array, at: number, ctx: PDFContext): { list: Array<[number, Entry]>; trailer: PDFDict } {
  let i = at;
  while (i < b.length && isWs(b[i]!)) i++;
  if (latin1.decode(b.subarray(i, i + 4)) === 'xref') return readTable(b, i + 4, ctx);
  return readStream(b, i, ctx);
}

/** A classic table: subsections of 20-byte entries, then "trailer" and its dictionary. */
function readTable(b: Uint8Array, from: number, ctx: PDFContext): { list: Array<[number, Entry]>; trailer: PDFDict } {
  // a table is at most 20 bytes per entry; read a generous window and parse it strictly
  const text = latin1.decode(b.subarray(from, Math.min(b.length, from + 22 * MAX_ENTRIES / 10)));
  const list: Array<[number, Entry]> = [];
  let pos = 0;
  const sub = /[\0\t\n\f\r ]*(\d{1,10})[ \t]+(\d{1,10})[\0\t\n\f\r ]+/y;
  const row = /(\d{10})[ ](\d{5})[ ]([nf])(?:\r\n|[ ][\r\n]|\r|\n)/y;
  for (;;) {
    const t = /[\0\t\n\f\r ]*trailer/y; t.lastIndex = pos;
    if (t.exec(text)) { pos = t.lastIndex; break; }
    sub.lastIndex = pos;
    const h = sub.exec(text);
    if (!h) fail('A cross-reference table of the signed version is damaged.');
    pos = sub.lastIndex;
    const first = Number(h![1]), count = Number(h![2]);
    if (count > MAX_ENTRIES) fail('A cross-reference table of the signed version is too large.');
    for (let k = 0; k < count; k++) {
      row.lastIndex = pos;
      const r = row.exec(text);
      if (!r) fail('A cross-reference table of the signed version is damaged.');
      pos = row.lastIndex;
      list.push([first + k, r![3] === 'n' ? { type: 1, offset: Number(r![1]), gen: Number(r![2]) } : { type: 0 }]);
    }
  }
  const trailer = PDFObjectParser.forBytes(b.subarray(from + pos), ctx).parseObject();
  if (!(trailer instanceof PDFDict)) fail('The trailer of the signed version is damaged.');
  return { list, trailer: trailer as PDFDict };
}

/** A cross-reference stream: "n g obj << /Type /XRef /W [...] ... >> stream ... endstream". */
function readStream(b: Uint8Array, at: number, ctx: PDFContext): { list: Array<[number, Entry]>; trailer: PDFDict } {
  const head = objectHeader(b, at);
  if (!head) fail('The signed version does not point at a cross-reference.');
  const obj = PDFObjectParser.forBytes(b.subarray(head!.after), ctx).parseObject();
  if (!(obj instanceof PDFRawStream)) fail('The signed version does not point at a cross-reference.');
  const dict = (obj as PDFRawStream).dict;
  const type = dict.get(PDFName.of('Type'));
  if (!(type instanceof PDFName) || type.decodeText() !== 'XRef') fail('The signed version does not point at a cross-reference.');
  const nums = (k: string) => { const a = dict.get(PDFName.of(k)); return a instanceof PDFArray ? Array.from({ length: a.size() }, (_, i) => { const n = a.get(i); return n instanceof PDFNumber ? n.asNumber() : NaN; }) : null; };
  const w = nums('W'), size = dict.get(PDFName.of('Size'));
  if (!w || w.length !== 3 || w.some((x) => !(Number.isInteger(x) && x >= 0 && x <= 8)) || !(size instanceof PDFNumber)) fail('A cross-reference stream of the signed version is damaged.');
  const index = nums('Index') ?? [0, (size as PDFNumber).asNumber()];
  if (index.length % 2 || index.some((x) => !(Number.isInteger(x) && x >= 0))) fail('A cross-reference stream of the signed version is damaged.');
  const data = decodePDFRawStream(obj as PDFRawStream).decode();
  const width = w![0]! + w![1]! + w![2]!;
  const field = (p: number, n: number, dflt: number) => { if (!n) return dflt; let v = 0; for (let k = 0; k < n; k++) v = v * 256 + data[p + k]!; return v; };
  const list: Array<[number, Entry]> = [];
  let p = 0;
  for (let s = 0; s < index.length; s += 2) {
    const first = index[s]!, count = index[s + 1]!;
    if (count > MAX_ENTRIES || p + count * width > data.length) fail('A cross-reference stream of the signed version is damaged.');
    for (let k = 0; k < count; k++, p += width) {
      const t = field(p, w![0]!, 1), f2 = field(p + w![0]!, w![1]!, 0), f3 = field(p + w![0]! + w![1]!, w![2]!, 0);
      list.push([first + k, t === 1 ? { type: 1, offset: f2, gen: f3 } : t === 2 ? { type: 2, stream: f2, index: f3 } : { type: 0 }]);
    }
  }
  return { list, trailer: dict };
}

const isName = (o: unknown, n: string) => o instanceof PDFName && o.decodeText() === n;

/** Objects of the signed revision, read through its own cross-reference (never through later updates). */
class RevisionObjects {
  private cache = new Map<number, PDFObject | null>();
  private streams = new Map<number, { data: Uint8Array; first: number; pairs: number[] }>();
  constructor(private rev: Uint8Array, private entries: Map<number, Entry>, private ctx: PDFContext) {}

  get(ref: { objectNumber: number; generationNumber: number }): PDFObject | null {
    const num = ref.objectNumber;
    if (this.cache.has(num)) return this.cache.get(num)!;
    const e = this.entries.get(num);
    let obj: PDFObject | null = null;
    if (e?.type === 1 && e.gen === ref.generationNumber) {
      const head = objectHeader(this.rev, e.offset);
      if (head) obj = PDFObjectParser.forBytes(this.rev.subarray(head.after), this.ctx).parseObject();
    } else if (e?.type === 2 && ref.generationNumber === 0) {
      const s = this.stream(e.stream);
      const at = this.checkCompressed(num, e);
      obj = PDFObjectParser.forBytes(s.data.subarray(s.first + at), this.ctx).parseObject();
    }
    this.cache.set(num, obj);
    return obj;
  }

  /** A compressed entry must name a real object stream of this revision that holds this object at that index. */
  checkCompressed(num: number, e: { stream: number; index: number }): number {
    const s = this.stream(e.stream);
    if (!(e.index >= 0 && e.index * 2 + 1 < s.pairs.length) || s.pairs[e.index * 2] !== num) fail(`Compressed object ${num} is not where the signed version says.`);
    return s.pairs[e.index * 2 + 1]!;
  }

  private stream(num: number) {
    const cached = this.streams.get(num);
    if (cached) return cached;
    const e = this.entries.get(num);
    if (!e || e.type !== 1) fail(`The object stream ${num} of the signed version is missing.`);
    const head = objectHeader(this.rev, (e as { offset: number }).offset);
    const obj = head && PDFObjectParser.forBytes(this.rev.subarray(head.after), this.ctx).parseObject();
    if (!(obj instanceof PDFRawStream) || !isName(obj.dict.get(PDFName.of('Type')), 'ObjStm')) fail(`Object ${num} of the signed version is not an object stream.`);
    const raw = obj as PDFRawStream;
    const n = raw.dict.get(PDFName.of('N')), first = raw.dict.get(PDFName.of('First'));
    if (!(n instanceof PDFNumber) || !(first instanceof PDFNumber) || n.asNumber() > 100_000) fail(`The object stream ${num} of the signed version is damaged.`);
    const data = decodePDFRawStream(raw).decode();
    const f = (first as PDFNumber).asNumber();
    const pairs = (latin1.decode(data.subarray(0, f)).match(/\d+/g) ?? []).map(Number);
    if (pairs.length < (n as PDFNumber).asNumber() * 2) fail(`The object stream ${num} of the signed version is damaged.`);
    const out = { data, first: f, pairs };
    this.streams.set(num, out);
    return out;
  }

  private resolve(o: PDFObject | undefined): PDFObject | undefined { return o instanceof PDFRef ? this.get(o) ?? undefined : o; }

  /** Walk the signed revision's form (AcroForm /Fields, /Kids) to the signature's dictionary. */
  signatureReachable(catalog: PDFDict, sig: { num: number; gen: number }): boolean {
    const form = this.resolve(catalog.get(PDFName.of('AcroForm')));
    const fields = form instanceof PDFDict ? this.resolve(form.get(PDFName.of('Fields'))) : undefined;
    if (!(fields instanceof PDFArray)) return false;
    const same = (r: unknown) => r instanceof PDFRef && r.objectNumber === sig.num && r.generationNumber === sig.gen;
    let visited = 0;
    const walk = (list: PDFArray, depth: number): boolean => {
      if (depth > 32) return false;
      for (let i = 0; i < list.size(); i++) {
        if (++visited > 20_000) return false;
        const ref = list.get(i), field = this.resolve(ref);
        if (!(field instanceof PDFDict)) continue;
        const v = field.get(PDFName.of('V'));
        if (same(v) || (same(ref) && v instanceof PDFDict)) return true; // /V as its own object, or written inline
        const kids = this.resolve(field.get(PDFName.of('Kids')));
        if (kids instanceof PDFArray && walk(kids, depth + 1)) return true;
      }
      return false;
    };
    return walk(fields, 0);
  }
}

// ---------------------------------------------------------------- a small PDF tokenizer, to locate /Contents exactly

type Tok = { kind: 'dict' | 'enddict' | 'array' | 'endarray' | 'name' | 'string' | 'hex' | 'word'; start: number; end: number };
const DELIM = new Set(Array.from('()<>[]{}/%', (c) => c.charCodeAt(0)));

function skipSpace(b: Uint8Array, i: number): number {
  for (;;) {
    while (i < b.length && isWs(b[i]!)) i++;
    if (b[i] !== 0x25) return i; // a comment runs to the end of the line
    while (i < b.length && b[i] !== 0x0a && b[i] !== 0x0d) i++;
  }
}

function token(b: Uint8Array, at: number): Tok | null {
  const i = skipSpace(b, at);
  if (i >= b.length) return null;
  const c = b[i]!;
  if (c === 0x3c && b[i + 1] === 0x3c) return { kind: 'dict', start: i, end: i + 2 };
  if (c === 0x3e && b[i + 1] === 0x3e) return { kind: 'enddict', start: i, end: i + 2 };
  if (c === 0x5b) return { kind: 'array', start: i, end: i + 1 };
  if (c === 0x5d) return { kind: 'endarray', start: i, end: i + 1 };
  if (c === 0x3c) { const j = b.indexOf(0x3e, i); return j < 0 ? null : { kind: 'hex', start: i, end: j + 1 }; }
  if (c === 0x28) { // literal string: balanced parentheses, backslash escapes
    let depth = 0;
    for (let j = i; j < b.length; j++) {
      if (b[j] === 0x5c) { j++; continue; }
      if (b[j] === 0x28) depth++;
      else if (b[j] === 0x29 && --depth === 0) return { kind: 'string', start: i, end: j + 1 };
    }
    return null;
  }
  let j = i + 1;
  while (j < b.length && !isWs(b[j]!) && !DELIM.has(b[j]!)) j++;
  return { kind: c === 0x2f ? 'name' : 'word', start: i, end: j };
}

const text = (b: Uint8Array, t: Tok) => latin1.decode(b.subarray(t.start, t.end));

/** Skip one value; a reference ("12 0 R") counts as one. */
function skipValue(b: Uint8Array, t: Tok, depth = 0): number | null {
  if (depth > 64) return null;
  if (t.kind === 'dict' || t.kind === 'array') {
    const close = t.kind === 'dict' ? 'enddict' : 'endarray';
    let at = t.end;
    for (;;) {
      const n = token(b, at);
      if (!n) return null;
      if (n.kind === close) return n.end;
      const after = skipValue(b, n, depth + 1);
      if (after === null) return null;
      at = after;
    }
  }
  if (t.kind === 'word' && /^\d+$/.test(text(b, t))) {
    const g = token(b, t.end), r = g && token(b, g.end);
    if (g && r && /^\d+$/.test(text(b, g)) && text(b, r) === 'R') return r.end;
  }
  return t.end;
}

/** The byte span of the top-level /Contents value of the dictionary that starts at `at`, when it is one hex string. */
export function contentsSpan(b: Uint8Array, at: number): { start: number; end: number } | null {
  const open = token(b, at);
  if (open?.kind !== 'dict') return null;
  let pos = open.end;
  let found: { start: number; end: number } | null = null;
  for (;;) {
    const key = token(b, pos);
    if (!key) return null;
    if (key.kind === 'enddict') return found;
    if (key.kind !== 'name') return null;
    const value = token(b, key.end);
    if (!value) return null;
    if (text(b, key) === '/Contents') {
      if (found || value.kind !== 'hex') return null; // twice, or not a hex string: refuse rather than guess
      found = { start: value.start, end: value.end };
    }
    const after = skipValue(b, value);
    if (after === null) return null;
    pos = after;
  }
}
