import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { applyEdits, applyRedactions, findRedactionMarks, getInfo, inspectDocument, sanitizeDocument, verifyRedaction, verifySignatures, InvalidPdfError } from '../src/index.js';
import { NodeRasterizer } from '../src/node/index.js';
import { makePdf, deepText } from './helpers.js';

const latin1 = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));

describe('cross-reference limits', () => {
  it.each([
    ['field width', '/Type/XRef/W[1 99999999999 1]/Size 2'],
    ['size', '/Type/XRef/W[1 2 1]/Size 4000000000'],
    ['index', '/Type/XRef/W[1 2 1]/Size 2/Index [0 4000000000]'],
  ])('refuses an implausible %s quickly instead of looping', async (_n, dict) => {
    const base = Buffer.from(await makePdf(['hello'])).toString('latin1');
    const t = Date.now();
    await expect(getInfo(latin1(`${base}\n7 0 obj<<${dict}>>\nstream\n\nendstream\nendobj\n`))).rejects.toBeInstanceOf(InvalidPdfError);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

async function withActions(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const ctx = doc.context;
  const js = ctx.obj({ S: 'JavaScript', JS: PDFString.of('PWNED-NEXT') });
  const open = ctx.obj({ S: 'GoTo', D: [page.ref, PDFName.of('Fit')], Next: js });
  doc.catalog.set(PDFName.of('OpenAction'), open);
  const item = ctx.register(ctx.obj({ Title: PDFString.of('b'), A: { S: 'JavaScript', JS: PDFString.of('PWNED-OUTLINE') } }));
  const root = ctx.register(ctx.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
  (ctx.lookup(item, PDFDict)).set(PDFName.of('Parent'), root);
  doc.catalog.set(PDFName.of('Outlines'), root);
  return doc.save({ useObjectStreams: false });
}

describe('hidden actions', () => {
  it('reports and removes JavaScript chained behind an open action and in bookmarks', async () => {
    const bytes = await withActions();
    const items = await inspectDocument(bytes);
    expect(items.find((i) => i.category === 'scripts')?.examples.join(' ')).toMatch(/open action[\s\S]*bookmark|bookmark[\s\S]*open action/);
    const clean = await sanitizeDocument(bytes, ['scripts']);
    const t = Buffer.from(clean).toString('latin1');
    expect(t).not.toContain('PWNED-NEXT');
    expect(t).not.toContain('PWNED-OUTLINE');
    expect((await inspectDocument(clean)).find((i) => i.category === 'scripts')).toBeUndefined();
  });
});

describe('redaction beyond the marked pages', () => {
  it('removes annotations carrying a secret from unmarked pages and verify reports leftovers', async () => {
    const secret = 'ZEBRA-4242';
    let pdf = await makePdf([`Number ${secret}`, 'page two']);
    pdf = await applyEdits(pdf, [{ type: 'annotation', page: 1, annotation: { kind: 'note', at: { x: 50, y: 50 }, text: `copy of ${secret}` } }]);
    const marks = await findRedactionMarks(pdf, secret);
    expect(marks.every((m) => m.page === 0)).toBe(true);
    const ras = new NodeRasterizer();
    try {
      const plain = await applyRedactions(pdf, marks, ras);
      expect((await verifyRedaction(plain, [secret])).some((l) => l.where === 'annotation' && l.page === 1)).toBe(true);
      const scrubbed = await applyRedactions(pdf, marks, ras, { secrets: [secret] });
      expect(await verifyRedaction(scrubbed, [secret])).toEqual([]);
      expect((await deepText(scrubbed)).includes(secret)).toBe(false);
    } finally { await ras.close(); }
  });
  it('rejects a NaN rectangle and a fractional page instead of silently skipping', async () => {
    const pdf = await makePdf(['x']);
    const ras = new NodeRasterizer();
    try {
      await expect(applyRedactions(pdf, [{ page: 0, rect: { x: NaN, y: 0, width: 1, height: 1 } }], ras)).rejects.toThrow();
      await expect(applyRedactions(pdf, [{ page: 0.5, rect: { x: 0, y: 0, width: 1, height: 1 } }], ras)).rejects.toThrow();
    } finally { await ras.close(); }
  });
});

describe('signature report', () => {
  it('reports a signature with a non-numeric ByteRange as invalid instead of throwing', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const ctx = doc.context;
    const sig = ctx.register(ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, PDFName.of('x'), 1, 2], Contents: PDFString.of('') }));
    const field = ctx.register(ctx.obj({ FT: 'Sig', T: PDFString.of('S'), V: sig, Subtype: 'Widget', Rect: [0, 0, 0, 0], F: 132 }));
    doc.getPage(0).node.set(PDFName.of('Annots'), ctx.obj([field]));
    doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field], SigFlags: 3 }));
    const reports = await verifySignatures(await doc.save({ useObjectStreams: false }));
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]!.status).toBe('invalid');
  });
});
