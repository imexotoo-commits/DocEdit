import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildDocx, buildText, reflow, type TextPiece } from '../src/renderer/export/docx.js';
import { crc32 } from '../src/renderer/export/zip.js';

/** Read a ZIP with Node's own inflate, checking every CRC. */
function unzip(buf: Uint8Array): Map<string, Buffer> {
  const b = Buffer.from(buf), out = new Map<string, Buffer>();
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = b.readUInt32LE(end + 16);
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    const method = b.readUInt16LE(at + 10), crc = b.readUInt32LE(at + 16), size = b.readUInt32LE(at + 20), n = b.readUInt16LE(at + 28), local = b.readUInt32LE(at + 42);
    const name = b.subarray(at + 46, at + 46 + n).toString('utf8');
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    expect(crc32(data), name).toBe(crc);
    out.set(name, data);
    at += 46 + n + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
  }
  return out;
}

const piece = (str: string, x: number, y: number, size = 11): TextPiece => ({ str, x, y, size, width: str.length * size * 0.5, upright: true });

describe('PDF to Word', () => {
  it('rebuilds headings and paragraphs from positioned text', () => {
    const blocks = reflow([
      piece('Annual report', 72, 720, 24),
      piece('The first line of a', 72, 680), piece('paragraph', 72 + 19 * 5.5 + 3, 680),
      piece('continues on the next line and ends here.', 72, 667),
      piece('A second paragraph after a gap.', 72, 630),
      piece('Results', 72, 600, 15),
      piece('Body text again, with a hyphen-', 72, 580), piece('ated word.', 72, 567),
    ]);
    expect(blocks).toEqual([
      { kind: 'para', text: 'Annual report', size: 24, heading: 1 },
      { kind: 'para', text: 'The first line of a paragraph continues on the next line and ends here.', size: 11, heading: 0 },
      { kind: 'para', text: 'A second paragraph after a gap.', size: 11, heading: 0 },
      { kind: 'para', text: 'Results', size: 15, heading: 2 },
      { kind: 'para', text: 'Body text again, with a hyphenated word.', size: 11, heading: 0 },
    ]);
  });

  it('writes a valid package Word can open: parts, relationships, page breaks, pictures', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const bytes = await buildDocx([
      { width: 612, height: 792, blocks: [{ kind: 'para', text: 'Tom & Jerry <3', size: 11, heading: 0 }] },
      { width: 612, height: 792, blocks: [{ kind: 'image', png, width: 612, height: 792 }] },
    ], 'Test');
    const files = unzip(bytes);
    expect([...files.keys()].sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/media/page1.png', 'word/styles.xml']);
    const doc = files.get('word/document.xml')!.toString('utf8');
    expect(doc).toContain('Tom &amp; Jerry &lt;3');
    expect(doc.match(/w:type="page"/g)).toHaveLength(1);
    expect(doc).toContain('r:embed="rIdImg1"');
    expect(files.get('word/_rels/document.xml.rels')!.toString()).toContain('Target="media/page1.png"');
    expect(Buffer.compare(files.get('word/media/page1.png')!, Buffer.from(png))).toBe(0);
    // every XML part is balanced (a cheap well-formedness check; no XML parser in the test environment)
    for (const [name, data] of files) if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const s = data.toString('utf8').replace(/<\?xml[^>]*\?>/, '');
      const open = (s.match(/<[A-Za-z][^>]*[^/]>|<[A-Za-z]>/g) ?? []).length, close = (s.match(/<\/[^>]+>/g) ?? []).length;
      expect(open, name).toBe(close);
    }
  });

  it('exports plain text with page breaks', () => {
    expect(buildText([{ width: 1, height: 1, blocks: [{ kind: 'para', text: 'One', size: 11, heading: 0 }] }, { width: 1, height: 1, blocks: [{ kind: 'para', text: 'Two', size: 11, heading: 0 }] }]))
      .toBe('One\r\n\f\r\nTwo');
  });
});

describe('ZIP limits', () => {
  it('refuses more entries than the classic format holds instead of writing a corrupt archive', async () => {
    const { zip, ZipTooLargeError, ZIP_MAX_ENTRIES } = await import('../src/renderer/export/zip.js');
    const entries = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}`, data: new Uint8Array(0), store: true }));
    await expect(zip(entries)).rejects.toBeInstanceOf(ZipTooLargeError);
    await expect(zip(entries.slice(0, 3))).resolves.toBeInstanceOf(Uint8Array);
  });
});
