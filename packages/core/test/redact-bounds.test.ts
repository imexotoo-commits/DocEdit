import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { applyRedactions, checkRedactionCoverage, rotatePages, PageRangeError } from '../src/index.js';
import { NodeRasterizer } from '../src/node/index.js';

async function croppedPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([612, 792]);
  p.drawText('Inside 12345', { x: 150, y: 500, size: 24, font });
  p.drawText('Outside 67890', { x: 20, y: 40, size: 12, font });
  p.setCropBox(100, 100, 400, 600);
  return doc.save();
}

describe('redaction marks must hide something', () => {
  it.each([
    ['far off the page', { x: 5000, y: 5000, width: 50, height: 20 }],
    ['inside the media box but outside the crop box', { x: 10, y: 30, width: 60, height: 20 }],
    ['with zero width', { x: 150, y: 500, width: 0, height: 20 }],
    ['with negative height', { x: 150, y: 500, width: 50, height: -20 }],
  ])('refuses a mark %s', async (_n, rect) => {
    const ras = new NodeRasterizer();
    try {
      await expect(applyRedactions(await croppedPage(), [{ page: 0, rect }], ras, { dpi: 72 })).rejects.toBeInstanceOf(PageRangeError);
    } finally { await ras.close(); }
  });

  it('accepts and fully covers valid marks on cropped and rotated pages', async () => {
    const ras = new NodeRasterizer();
    try {
      for (const pdf of [await croppedPage(), await rotatePages(await croppedPage(), '1', 90)]) {
        const marks = [{ page: 0, rect: { x: 145, y: 495, width: 160, height: 32 } }];
        const out = await applyRedactions(pdf, marks, ras, { dpi: 100 });
        expect(await checkRedactionCoverage(pdf, out, marks, ras)).toEqual([]);
      }
    } finally { await ras.close(); }
  });
});
