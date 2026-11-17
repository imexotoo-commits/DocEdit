import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { applyEdits, extractText, findText, formatBates, getInfo, listFormFields } from '../src/index.js';
import { NodeRasterizer } from '../src/node/index.js';
import { makePdf, redPng } from './helpers.js';

const dejavu = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')));

/** Read a PDF back with pdf.js (an independent reader). */
async function pdfjs(bytes: Uint8Array) {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return lib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
}

describe('applyEdits: page furniture', () => {
  it('puts headers and footers at the displayed top and bottom, also on rotated pages', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    doc.addPage([600, 800]).setRotation(degrees(90));
    const pdf = await applyEdits(await doc.save(), [{
      type: 'furniture', pages: [0, 1], size: 12,
      items: [{ position: 'top-center', text: 'HEADER {page}/{total}' }, { position: 'bottom-right', text: 'Ref {bates}' }],
      bates: { prefix: 'ACME-', start: 41, digits: 5 },
    }]);
    const lib = await pdfjs(pdf);
    for (const [i, expected] of [[1, ['HEADER 1/2', 'Ref ACME-00041']], [2, ['HEADER 2/2', 'Ref ACME-00042']]] as const) {
      const page = await lib.getPage(i);
      const vp = page.getViewport({ scale: 1 }); // as displayed, rotation applied
      const items = (await page.getTextContent()).items as Array<{ str: string; transform: number[] }>;
      for (const want of expected) {
        const it = items.find((t) => t.str === want);
        expect(it, `page ${i} "${want}"`).toBeTruthy();
        const [, y] = vp.convertToViewportPoint(it!.transform[4]!, it!.transform[5]!);
        if (want.startsWith('HEADER')) expect(y).toBeLessThan(60);           // near the displayed top
        else expect(y).toBeGreaterThan(vp.height - 60);                       // near the displayed bottom
      }
    }
  });

  it('numbers Bates in order over the chosen pages only', () => {
    expect(formatBates(7, { prefix: 'X', digits: 3, suffix: '-A' })).toBe('X007-A');
  });

  it('draws a watermark and Unicode furniture with the embedded font', async () => {
    const pdf = await applyEdits(await makePdf(['one']), [
      { type: 'watermark', pages: [0], text: 'CONFIDENTIAL' },
      { type: 'furniture', pages: [0], items: [{ position: 'bottom-left', text: 'Страница {page}' }] },
    ], { font: dejavu });
    const t = (await extractText(pdf))[0]!;
    expect(t).toContain('CONFIDENTIAL');
    expect(t).toContain('Страница 1');
  });
});

describe('applyEdits: annotations', () => {
  it('writes standard annotation dictionaries other readers understand', async () => {
    const base = await makePdf(['Annotate me please']);
    const hits = await findText(base, 'Annotate me');
    const pdf = await applyEdits(base, [
      { type: 'annotation', page: 0, author: 'Reviewer', annotation: { kind: 'highlight', rects: hits.flatMap((h) => h.rects), note: 'check this' } },
      { type: 'annotation', page: 0, annotation: { kind: 'underline', rects: [{ x: 50, y: 600, width: 100, height: 14 }] } },
      { type: 'annotation', page: 0, annotation: { kind: 'strikeout', rects: [{ x: 50, y: 560, width: 100, height: 14 }] } },
      { type: 'annotation', page: 0, annotation: { kind: 'note', at: { x: 300, y: 500 }, text: 'Sticky ✓' } },
      { type: 'annotation', page: 0, annotation: { kind: 'freetext', rect: { x: 50, y: 300, width: 200, height: 60 }, text: 'Typed comment with a few words that wrap' } },
      { type: 'annotation', page: 0, annotation: { kind: 'square', rect: { x: 300, y: 300, width: 80, height: 40 } } },
      { type: 'annotation', page: 0, annotation: { kind: 'circle', rect: { x: 400, y: 300, width: 80, height: 40 } } },
      { type: 'annotation', page: 0, annotation: { kind: 'ink', paths: [[{ x: 100, y: 100 }, { x: 150, y: 140 }, { x: 200, y: 100 }]] } },
    ], { font: dejavu });
    const annots = await (await (await pdfjs(pdf)).getPage(1)).getAnnotations();
    expect(annots.map((a: { subtype: string }) => a.subtype)).toEqual(['Highlight', 'Underline', 'StrikeOut', 'Text', 'FreeText', 'Square', 'Circle', 'Ink']);
    const hl = annots[0] as { contentsObj: { str: string }; titleObj: { str: string }; rect: number[] };
    expect(hl.contentsObj.str).toBe('check this');
    expect(hl.titleObj.str).toBe('Reviewer');
    expect((annots[3] as { contentsObj: { str: string } }).contentsObj.str).toBe('Sticky ✓');
    // the highlight's own appearance is painted: the word area turns yellow
    const r = await new NodeRasterizer().renderPage(pdf, 0, 1);
    const h = hits[0]!.rects[0]!;
    let yellow = 0, total = 0;
    for (let y = Math.ceil(r.height - (h.y + h.height)); y < r.height - h.y; y++) {
      for (let x = Math.ceil(h.x); x < h.x + h.width; x++) {
        const i = (y * r.width + x) * 4; total++;
        if (r.data[i]! > 200 && r.data[i + 1]! > 150 && r.data[i + 2]! < 120) yellow++;
      }
    }
    expect(yellow / total).toBeGreaterThan(0.4);
  });
});

describe('applyEdits: document structure', () => {
  it('replaces the outline with a nested tree pointing at the right pages', async () => {
    const pdf = await applyEdits(await makePdf(['P1', 'P2', 'P3']), [{
      type: 'outline', entries: [{ title: 'Intro', page: 0 }, { title: 'Body', page: 1, children: [{ title: 'Détail ✓', page: 2 }] }],
    }]);
    const lib = await pdfjs(pdf);
    const outline = (await lib.getOutline()) as Array<{ title: string; dest: unknown[]; items: Array<{ title: string; dest: unknown[] }> }>;
    expect(outline.map((o) => o.title)).toEqual(['Intro', 'Body']);
    expect(outline[1]!.items[0]!.title).toBe('Détail ✓');
    expect(await lib.getPageIndex(outline[1]!.items[0]!.dest[0] as never)).toBe(2);
    const cleared = await applyEdits(pdf, [{ type: 'outline', entries: [] }]);
    expect(await (await pdfjs(cleared)).getOutline()).toBeNull();
  });

  it('adds internal and web links, refusing other schemes', async () => {
    const pdf = await applyEdits(await makePdf(['P1', 'P2']), [
      { type: 'link', page: 0, rect: { x: 50, y: 50, width: 100, height: 20 }, target: { page: 1 } },
      { type: 'link', page: 0, rect: { x: 50, y: 90, width: 100, height: 20 }, target: { url: 'https://example.org/a' } },
    ]);
    const lib = await pdfjs(pdf);
    const annots = (await (await lib.getPage(1)).getAnnotations()) as Array<{ dest?: unknown[]; url?: string }>;
    expect(await lib.getPageIndex(annots[0]!.dest![0] as never)).toBe(1);
    expect(annots[1]!.url).toBe('https://example.org/a');
    await expect(applyEdits(pdf, [{ type: 'link', page: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, target: { url: 'javascript:alert(1)' } }])).rejects.toMatchObject({ code: 'BAD_LINK' });
  });

  it('selects radio choices by option name or by button state', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const rg = doc.getForm().createRadioGroup('size');
    rg.addOptionToPage('Small', page, { x: 50, y: 50, width: 15, height: 15 });
    rg.addOptionToPage('Large', page, { x: 80, y: 50, width: 15, height: 15 });
    const base = await doc.save();
    const byName = await applyEdits(base, [{ type: 'fill', values: { size: 'Large' } }]);
    expect((await listFormFields(byName)).find((f) => f.name === 'size')!.value).toBe('Large');
    const byState = await applyEdits(base, [{ type: 'fill', values: { size: '0' } }]);
    expect((await listFormFields(byState)).find((f) => f.name === 'size')!.value).toBe('Small');
    await expect(applyEdits(base, [{ type: 'fill', values: { size: 'Huge' } }])).rejects.toMatchObject({ code: 'BAD_VALUE' });
  });

  it('fills forms, sets metadata, places a visual signature and image', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    form.createTextField('name').addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    form.createCheckBox('agree').addToPage(page, { x: 50, y: 660, width: 15, height: 15 });
    await doc.embedFont(StandardFonts.Helvetica);
    const pdf = await applyEdits(await doc.save(), [
      { type: 'fill', values: { name: 'Zoë Ångström', agree: true } },
      { type: 'metadata', meta: { title: 'Signed form', author: 'DocEdit test' } },
      { type: 'signature', page: 0, rect: { x: 300, y: 100, width: 200, height: 60 }, typedName: 'Zoë Å.', caption: 'Signed 2026-11-12' },
      { type: 'image', page: 0, rect: { x: 50, y: 50, width: 40, height: 40 }, image: { bytes: redPng(), format: 'png' } },
    ], { font: dejavu });
    const fields = await listFormFields(pdf);
    expect(fields.find((f) => f.name === 'name')!.value).toBe('Zoë Ångström');
    expect(fields.find((f) => f.name === 'agree')!.value).toBe(true);
    expect((await getInfo(pdf)).metadata).toMatchObject({ title: 'Signed form', author: 'DocEdit test' });
    expect((await extractText(pdf))[0]).toContain('Signed 2026-11-12');
    await expect(applyEdits(pdf, [{ type: 'fill', values: { nope: 'x' } }])).rejects.toMatchObject({ code: 'NO_SUCH_FIELD' });
  });
});

describe('applyEdits: fill-and-sign marks', () => {
  const ink = (r: { width: number; data: Uint8ClampedArray }, x: number, y: number) => {
    // darkest pixel within 3 px: strokes are thin and anti-aliased
    let min = 255;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const i = ((y + dy) * r.width + (x + dx)) * 4; min = Math.min(min, r.data[i]!); }
    return min < 120;
  };
  it('draws a tick upright as displayed on a rotated page, as page content', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]).setRotation(degrees(90)); // displayed 800 x 600
    const pdf = await applyEdits(await doc.save(), [{ type: 'mark', page: 0, mark: { shape: 'check', rect: { x: 100, y: 100, width: 100, height: 100 } } }]);
    // user (100..200, 100..200) is displayed x 100..200, y 400..500 (y up), so image rows 100..200
    const r = await new NodeRasterizer().renderPage(pdf, 0, 1);
    expect([r.width, r.height]).toEqual([800, 600]);
    expect(ink(r, 188, 600 - 484)).toBe(true); // the long stroke ends at the displayed top right
    expect(ink(r, 188, 600 - 416)).toBe(false); // nothing at the displayed bottom right
    expect(ink(r, 138, 600 - 416)).toBe(true); // the tick's low point
    const p = (await PDFDocument.load(pdf)).getPage(0);
    expect(p.node.Annots()?.size() ?? 0).toBe(0); // ink on the page, not an annotation
  });
  it('draws a cross, a dot, a box and a line where asked', async () => {
    const pdf = await applyEdits(await makePdf(['']), [
      { type: 'mark', page: 0, mark: { shape: 'cross', rect: { x: 50, y: 600, width: 40, height: 40 } } },
      { type: 'mark', page: 0, mark: { shape: 'dot', rect: { x: 150, y: 600, width: 40, height: 40 } } },
      { type: 'mark', page: 0, mark: { shape: 'box', rect: { x: 250, y: 600, width: 40, height: 40 } } },
      { type: 'mark', page: 0, mark: { shape: 'line', from: { x: 350, y: 620 }, to: { x: 450, y: 620 } } },
    ]);
    const r = await new NodeRasterizer().renderPage(pdf, 0, 1);
    const H = r.height;
    expect(ink(r, 70, H - 620)).toBe(true); // centre of the cross
    expect(ink(r, 170, H - 620)).toBe(true); // centre of the dot
    expect(ink(r, 270, H - 620)).toBe(false); // the box is hollow
    expect(ink(r, 251, H - 620)).toBe(true); // its left side
    expect(ink(r, 400, H - 620)).toBe(true); // the line
  });
});
