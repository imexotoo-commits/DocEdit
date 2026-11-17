import { describe, expect, it } from 'vitest';
import { applyRedactions, checkRedactionCoverage, rotatePages, extractText, findRedactionMarks, findText, getInfo, verifyRedaction } from '../src/index.js';
import { NodeRasterizer } from '../src/node/index.js';
import { addInternalLink, makePdf, redPng, text, deepText } from './helpers.js';

describe('text search', () => {
  it('finds literal text with a rectangle near where it was drawn', async () => {
    const pdf = await makePdf(['hello SECRET-123 world', 'nothing here']);
    const m = await findText(pdf, 'secret-123');
    expect(m).toHaveLength(1);
    expect(m[0]!.page).toBe(0);
    const r = m[0]!.rects[0]!;
    expect(r.x).toBeGreaterThan(50);              // starts after "hello "
    expect(r.y).toBeLessThan(700); expect(r.y + r.height).toBeGreaterThan(700);
    expect((await findText(pdf, /SECRET-\d+/))).toHaveLength(1);
    expect(await findText(pdf, 'absent')).toEqual([]);
  });
});

describe('redaction', () => {
  it('removes the text for good, paints a box, keeps other pages, leaves no bytes behind', async () => {
    const secret = 'TOPSECRETVALUE42';
    let pdf = await makePdf([`Account ${secret} end`, 'page two stays selectable']);
    pdf = await addInternalLink(pdf, 1, 0);       // page 2 links to the page being redacted
    const ras = new NodeRasterizer();
    try {
      const marks = await findRedactionMarks(pdf, secret);
      expect(marks.length).toBeGreaterThan(0);
      const out = await applyRedactions(pdf, marks, ras, { dpi: 100 });

      expect((await getInfo(out)).pageCount).toBe(2);
      expect(await verifyRedaction(out, [secret, 'Account'])).toEqual([]);           // page 1 has no text at all now
      expect((await extractText(out))[1]).toContain('page two stays selectable');   // untouched page still text
      expect(deepText(out)).not.toContain(secret);                                      // nothing in the raw bytes either
      expect(text(out)).not.toContain('/Link');                                      // link to the redacted page was dropped

      // the box really is black where the text was
      const r = await ras.renderPage(out, 0, 100 / 72);
      const [a, b, c, d, e, f] = r.transform; const m = marks[0]!.rect;
      const cx = m.x + m.width / 2, cy = m.y + m.height / 2;
      const px = Math.round(a * cx + c * cy + e), py = Math.round(b * cx + d * cy + f);
      const o = (py * r.width + px) * 4;
      expect([r.data[o], r.data[o + 1], r.data[o + 2]]).toEqual([0, 0, 0]);
    } finally { await ras.close(); }
  });

  it('maps marks correctly on a rotated page', async () => {
    const secret = 'ROTATEDSECRET';
    const pdf = await rotatePages(await makePdf([`x ${secret} y`]), '1', 90);
    const ras = new NodeRasterizer();
    try {
      const marks = await findRedactionMarks(pdf, secret);
      const out = await applyRedactions(pdf, marks, ras, { dpi: 100 });
      expect(await verifyRedaction(out, [secret])).toEqual([]);
      const r = await ras.renderPage(out, 0, 100 / 72);
      expect(r.width).toBeCloseTo(792 * 100 / 72, -1);                      // landscape after the 90 degree turn
      // use the ORIGINAL page's mapping to find where the box must be, then check it is black in the output
      const src = await ras.renderPage(pdf, 0, 100 / 72);
      const [a, b, c, d, e, f] = src.transform; const m = marks[0]!.rect;
      const px = Math.round(a * (m.x + m.width / 2) + c * (m.y + m.height / 2) + e), py = Math.round(b * (m.x + m.width / 2) + d * (m.y + m.height / 2) + f);
      const o = (py * r.width + px) * 4;
      expect([r.data[o], r.data[o + 1], r.data[o + 2]]).toEqual([0, 0, 0]);
    } finally { await ras.close(); }
  });

  it('proves a cosmetic black box is NOT redaction (why this module exists)', async () => {
    const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
    const pdf = await makePdf(['hidden under a box']);
    const doc = await PDFDocument.load(pdf);
    doc.getPage(0).drawRectangle({ x: 40, y: 690, width: 400, height: 40, color: rgb(0, 0, 0) });
    const boxed = await doc.save();
    expect(await verifyRedaction(boxed, ['hidden under a box'])).toHaveLength(1);   // text still extractable
  });

  it('returns the input untouched when there are no marks, and rejects marks off the document', async () => {
    const pdf = await makePdf(['x']); const ras = new NodeRasterizer();
    expect(await applyRedactions(pdf, [], ras)).toBe(pdf);
    await expect(applyRedactions(pdf, [{ page: 3, rect: { x: 0, y: 0, width: 1, height: 1 } }], ras)).rejects.toThrow(/page 4/);
    await ras.close();
  });
});

describe('redaction coverage check', () => {
  const ras = () => new NodeRasterizer();

  it('passes for real redactions on rotated, cropped and image-only pages (positive control)', async () => {
    const { PDFDocument, degrees, StandardFonts } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([612, 792]); p1.drawText('Rotated secret 42', { x: 60, y: 600, size: 24, font }); p1.setRotation(degrees(90));
    const p2 = doc.addPage([612, 792]); p2.drawText('Cropped secret 43', { x: 150, y: 500, size: 24, font }); p2.setCropBox(100, 100, 400, 600);
    const p3 = doc.addPage([400, 400]); const img = await doc.embedPng(redPng()); p3.drawImage(img, { x: 0, y: 0, width: 400, height: 400 });
    const pdf = await doc.save();
    const marks = [...await findRedactionMarks(pdf, /secret 4\d/), { page: 2, rect: { x: 100, y: 100, width: 150, height: 80 } }];
    expect(marks.map((m) => m.page)).toEqual([0, 1, 2]);
    const out = await applyRedactions(pdf, marks, ras());
    expect(await checkRedactionCoverage(pdf, out, marks, ras())).toEqual([]);
  });

  it('fails when only part of a mark is covered, even if its centre is black', async () => {
    const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
    const pdf = await makePdf(['Partially hidden secret']);
    const marks = await findRedactionMarks(pdf, 'Partially hidden secret');
    const r = marks[0]!.rect;
    const fake = await PDFDocument.load(pdf);
    fake.getPage(0).drawRectangle({ x: r.x + r.width * 0.4, y: r.y, width: r.width * 0.2, height: r.height, color: rgb(0, 0, 0) });
    const problems = await checkRedactionCoverage(pdf, await fake.save(), marks, ras());
    expect(problems[0]).toMatchObject({ reason: 'not-covered' });
    expect(problems[0]!.uncovered).toBeGreaterThan(100);
  });

  it('fails for marks that are not on the page', async () => {
    const pdf = await makePdf(['x']);
    const marks = [{ page: 0, rect: { x: -500, y: -500, width: 100, height: 100 } }];
    // applying refuses such a mark outright; the independent check still reports it against any result
    await expect(applyRedactions(pdf, marks, ras())).rejects.toThrow(/outside the visible page/);
    const out = await applyRedactions(pdf, [{ page: 0, rect: { x: 10, y: 10, width: 50, height: 50 } }], ras());
    expect(await checkRedactionCoverage(pdf, out, marks, ras())).toEqual([{ mark: 0, page: 0, reason: 'off-page' }]);
  });
});
