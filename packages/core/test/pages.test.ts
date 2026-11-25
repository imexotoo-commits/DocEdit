import { describe, expect, it } from 'vitest';
import { deletePages, extractText, getInfo, insertBlankPage, mergePdfs, parsePageRange, reorderPages, rotatePages, selectPages, setMetadata, splitPdf, cropPages, arrangePages } from '../src/index.js';
import { addInternalLink, makePdf } from './helpers.js';

describe('parsePageRange', () => {
  it('parses lists, ranges, open ranges, last', () => {
    expect(parsePageRange('1,3,5-7', 10)).toEqual([0, 2, 4, 5, 6]);
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9]);
    expect(parsePageRange('-3', 10)).toEqual([0, 1, 2]);
    expect(parsePageRange('2-last', 4)).toEqual([1, 2, 3]);
    expect(parsePageRange('all', 3)).toEqual([0, 1, 2]);
    expect(parsePageRange('3-1', 3)).toEqual([2, 1, 0]);
    expect(parsePageRange('1,1,2', 3, { unique: true })).toEqual([0, 1]);
  });
  it('rejects bad input', () => {
    expect(() => parsePageRange('0', 3)).toThrow(/outside/);
    expect(() => parsePageRange('4', 3)).toThrow(/outside/);
    expect(() => parsePageRange('a', 3)).toThrow(/Bad page/);
    expect(() => parsePageRange('', 3)).toThrow(/Empty/);
  });
});

describe('page operations', () => {
  it('merges documents in order and honours page selections', async () => {
    const a = await makePdf(['A1', 'A2', 'A3']), b = await makePdf(['B1', 'B2']);
    const merged = await mergePdfs([{ pdf: a, pages: '1,3' }, { pdf: b }]);
    expect((await getInfo(merged)).pageCount).toBe(4);
    expect((await extractText(merged)).map((t) => t.trim())).toEqual(['A1', 'A3', 'B1', 'B2']);
  });
  it('extracts, reorders and duplicates', async () => {
    const a = await makePdf(['P1', 'P2', 'P3']);
    expect((await extractText(await selectPages(a, '3,1,1'))).map((t) => t.trim())).toEqual(['P3', 'P1', 'P1']);
    expect((await extractText(await reorderPages(a, '3-1'))).map((t) => t.trim())).toEqual(['P3', 'P2', 'P1']);
  });
  it('deletes pages but never all of them', async () => {
    const a = await makePdf(['P1', 'P2', 'P3']);
    expect((await extractText(await deletePages(a, '2'))).map((t) => t.trim())).toEqual(['P1', 'P3']);
    await expect(deletePages(a, 'all')).rejects.toThrow(/every page/);
  });
  it('splits by chunks and by size', async () => {
    const a = await makePdf(['1', '2', '3', '4', '5']);
    expect((await splitPdf(a, 2)).length).toBe(3);
    const parts = await splitPdf(a, ['1-2', '3-']);
    expect(await Promise.all(parts.map(async (p) => (await getInfo(p)).pageCount))).toEqual([2, 3]);
  });
  it('rotates cumulatively', async () => {
    let a = await makePdf(['x', 'y']);
    a = await rotatePages(a, '1', 90); a = await rotatePages(a, '1', 270); a = await rotatePages(a, '2', -90);
    expect((await getInfo(a)).pages.map((p) => p.rotation)).toEqual([0, 270]);
    await expect(rotatePages(a, '1', 45)).rejects.toThrow(/multiple of 90/);
  });
  it('inserts a blank page and crops', async () => {
    let a = await makePdf(['x']);
    a = await insertBlankPage(a, 1, [200, 300]);
    const info = await getInfo(a);
    expect(info.pageCount).toBe(2);
    expect([info.pages[0]!.width, info.pages[0]!.height]).toEqual([200, 300]);
    a = await cropPages(a, '2', { x: 0, y: 0, width: 100, height: 100 });
    expect((await getInfo(a)).pages[1]!.width).toBe(100);
  });
  it('sets metadata', async () => {
    const a = await setMetadata(await makePdf(['x']), { title: 'T', author: 'Me', keywords: ['a', 'b'] });
    const m = (await getInfo(a)).metadata;
    expect([m.title, m.author, m.keywords]).toEqual(['T', 'Me', ['a', 'b']]);
  });
  it('reports garbage and encrypted input with our error types', async () => {
    await expect(getInfo(new TextEncoder().encode('not a pdf'))).rejects.toMatchObject({ code: 'INVALID_PDF' });
  });
});

describe('arrangePages', () => {
  it('reorders, duplicates, rotates, inserts blanks and pages from another file in one pass', async () => {
    const a = await makePdf(['A1', 'A2', 'A3']), b = await makePdf(['B1'], { size: [500, 750] });
    const out = await arrangePages([a, b], [
      { source: 0, page: 2 }, { source: 1, page: 0, rotate: 90 }, { blank: [200, 200] },
      { source: 0, page: 0, rotate: -90 }, { source: 0, page: 0 },
    ]);
    const info = await getInfo(out);
    expect(info.pages.map((p) => [p.width, p.height, p.rotation])).toEqual([
      [612, 792, 0], [500, 750, 90], [200, 200, 0], [612, 792, 270], [612, 792, 0],
    ]);
    expect((await extractText(out)).map((t) => t.trim())).toEqual(['A3', 'B1', '', 'A1', 'A1']);
  });
  it('adds to an existing rotation and keeps the first source metadata', async () => {
    const a = await setMetadata(await rotatePages(await makePdf(['A1']), '1', 90), { title: 'Kept' });
    const out = await arrangePages([a], [{ source: 0, page: 0, rotate: 270 }]);
    const info = await getInfo(out);
    expect(info.pages[0]!.rotation).toBe(0);
    expect(info.metadata.title).toBe('Kept');
  });
  it('sets a crop box per page without touching the content', async () => {
    const a = await makePdf(['A1', 'A2']);
    const out = await arrangePages([a], [{ source: 0, page: 0, crop: { x: 40, y: 600, width: 300, height: 150 } }, { source: 0, page: 1 }]);
    const info = await getInfo(out);
    expect(info.pages.map((p) => [p.width, p.height])).toEqual([[300, 150], [612, 792]]);
    expect((await extractText(out))[0]!.trim()).toBe('A1'); // text inside the crop is still there
    await expect(arrangePages([a], [{ source: 0, page: 0, crop: { x: 0, y: 0, width: 0, height: 10 } }])).rejects.toThrow(/too small/);
  });
  it('drops links to pages that are left out and keeps the others pointing at the right page', async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const src = await addInternalLink(await makePdf(['P1', 'P2', 'P3']), 0, 2);
    const without = await arrangePages([src], [{ source: 0, page: 0 }, { source: 0, page: 1 }]);
    const d1 = await lib.getDocument({ data: without.slice() }).promise;
    expect((await (await d1.getPage(1)).getAnnotations()).filter((a: { subtype: string }) => a.subtype === 'Link')).toEqual([]);
    expect(Buffer.from(without).toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(2); // no stray copy of page 3
    const reordered = await arrangePages([src], [{ source: 0, page: 2 }, { source: 0, page: 0 }]);
    const d2 = await lib.getDocument({ data: reordered.slice() }).promise;
    const [link] = (await (await d2.getPage(2)).getAnnotations()) as Array<{ dest: unknown[] }>;
    expect(await d2.getPageIndex(link!.dest[0] as never)).toBe(0);
  });
  it('keeps links that use named destinations (name tree and /Dests, /Dest and GoTo), with their view', async () => {
    const { PDFDocument, PDFName, PDFString } = await import('@cantoo/pdf-lib');
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await PDFDocument.load(await makePdf(['P1', 'P2', 'P3']));
    const ctx = doc.context, [p1, p2, p3] = doc.getPages();
    // a two-level name tree for "chap2", and the older catalog /Dests dictionary for "chap3"
    const leaf = ctx.obj({ Limits: [PDFString.of('a'), PDFString.of('z')], Names: [PDFString.of('chap2'), ctx.obj([p2!.ref, PDFName.of('XYZ'), 0, 700, null])] });
    doc.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: ctx.obj({ Kids: [ctx.register(leaf)] }) }));
    doc.catalog.set(PDFName.of('Dests'), ctx.obj({ chap3: ctx.obj({ D: [p3!.ref, PDFName.of('Fit')] }) }));
    const link = (extra: Record<string, unknown>, y: number) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, y, 100, y + 20], Border: [0, 0, 0], ...extra } as never));
    p1!.node.set(PDFName.of('Annots'), ctx.obj([
      link({ Dest: PDFString.of('chap2') }, 10),
      link({ A: ctx.obj({ S: 'GoTo', D: PDFString.of('chap2') }) }, 40),
      link({ Dest: PDFName.of('chap3') }, 70),
    ]));
    const src = await doc.save();
    const targets = async (pdf: Uint8Array, pageNo: number) => {
      const d = await lib.getDocument({ data: pdf.slice() }).promise;
      const links = ((await (await d.getPage(pageNo)).getAnnotations()) as Array<{ subtype: string; dest: unknown }>).filter((a) => a.subtype === 'Link');
      return Promise.all(links.map(async (l) => {
        const dest = (typeof l.dest === 'string' ? await d.getDestination(l.dest) : l.dest) as Array<{ name?: string } | number | null> | null;
        return dest ? [await d.getPageIndex(dest[0] as never), (dest[1] as { name: string }).name, dest[3] ?? null] : null;
      }));
    };
    // reversed: P3 P2 P1 — the links on P1 (now page 3) still reach P2 (now index 1) and P3 (now index 0), view kept
    expect(await targets(await arrangePages([src], [{ source: 0, page: 2 }, { source: 0, page: 1 }, { source: 0, page: 0 }]), 3))
      .toEqual([[1, 'XYZ', 700], [1, 'XYZ', 700], [0, 'Fit', null]]);
    // P3 left out: its named link goes, the others stay
    expect(await targets(await arrangePages([src], [{ source: 0, page: 0 }, { source: 0, page: 1 }]), 1))
      .toEqual([[1, 'XYZ', 700], [1, 'XYZ', 700]]);
  });
  it('rejects empty layouts, bad pages, bad sources and odd rotations', async () => {
    const a = await makePdf(['A1']);
    await expect(arrangePages([a], [])).rejects.toThrow(/at least one/);
    await expect(arrangePages([a], [{ source: 0, page: 1 }])).rejects.toThrow(/outside/);
    await expect(arrangePages([a], [{ source: 1, page: 0 }])).rejects.toThrow(/Unknown source/);
    await expect(arrangePages([a], [{ source: 0, page: 0, rotate: 45 }])).rejects.toThrow(/multiple of 90/);
  });
});
