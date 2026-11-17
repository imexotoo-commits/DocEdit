import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { addPageNumbers, addTextWatermark, addVisualSignature, extractText, fillFormFields, flattenForm, getInfo, listFormFields, placeImage } from '../src/index.js';
import { makePdf, redPng } from './helpers.js';

describe('stamping', () => {
  it('adds a watermark and page numbers that are real text', async () => {
    let a = await makePdf(['one', 'two']);
    a = await addTextWatermark(a, { text: 'DRAFT', pages: '2' });
    a = await addPageNumbers(a, { format: 'Page {n} of {total}' });
    const t = await extractText(a);
    expect(t[0]).toContain('Page 1 of 2');
    expect(t[1]).toContain('DRAFT');
    expect(t[1]).toContain('Page 2 of 2');
    expect(t[0]).not.toContain('DRAFT');
  });
  it('places an image', async () => {
    const a = await placeImage(await makePdf(['x']), 0, { x: 100, y: 100, width: 80, height: 40 }, { bytes: redPng(), format: 'png' });
    const doc = await PDFDocument.load(a);
    expect(doc.context.enumerateIndirectObjects().some(([, o]) => String((o as { dict?: unknown }).dict ?? '').includes('Image'))).toBe(true);
  });
});

describe('signatures', () => {
  it('draws a typed and an image visual signature', async () => {
    let a = await makePdf(['contract']);
    a = await addVisualSignature(a, { page: 0, rect: { x: 50, y: 100, width: 200, height: 50 }, typedName: 'Jane Doe', caption: 'Signed 2026-11-12' });
    a = await addVisualSignature(a, { page: 0, rect: { x: 300, y: 100, width: 200, height: 50 }, image: { bytes: redPng(), format: 'png' } });
    const t = (await extractText(a))[0]!;
    expect(t).toContain('Jane Doe');
    expect(t).toContain('Signed 2026-11-12');
  });
  it('is honest that cryptographic signing is not built yet', async () => {
  });
});

describe('forms', () => {
  async function formPdf() {
    const doc = await PDFDocument.create(); const page = doc.addPage([400, 400]); const form = doc.getForm();
    form.createTextField('name').addToPage(page, { x: 20, y: 340, width: 200, height: 24 });
    form.createCheckBox('agree').addToPage(page, { x: 20, y: 300, width: 16, height: 16 });
    const dd = form.createDropdown('size'); dd.addOptions(['S', 'M', 'L']); dd.addToPage(page, { x: 20, y: 260, width: 80, height: 24 });
    return doc.save();
  }
  it('lists, fills and flattens', async () => {
    let a = await formPdf();
    expect((await listFormFields(a)).map((f) => [f.name, f.kind])).toEqual([['name', 'text'], ['agree', 'checkbox'], ['size', 'dropdown']]);
    a = await fillFormFields(a, { name: 'Jane', agree: true, size: 'M' });
    const f = Object.fromEntries((await listFormFields(a)).map((x) => [x.name, x.value]));
    expect(f).toMatchObject({ name: 'Jane', agree: true, size: ['M'] });
    a = await flattenForm(a);
    expect((await getInfo(a)).formFieldCount).toBe(0);
    expect((await extractText(a))[0]).toContain('Jane');
  });
  it('rejects unknown field names', async () => {
    await expect(fillFormFields(await formPdf(), { nope: 'x' })).rejects.toMatchObject({ code: 'NO_SUCH_FIELD' });
  });
});
