import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { applyEdits, countRevisions, extractText, inspectDocument, sanitizeDocument } from '../src/index.js';
import { deepText } from './helpers.js';

/** A file with something in every category, plus an incremental update that left an old title behind. */
async function dirty(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Visible body text', { x: 50, y: 700, size: 20, font });
  doc.setAuthor('x');
  const ctx = doc.context;
  // plain literal strings, so the raw-byte checks below can see them
  const info = ctx.lookup(ctx.trailerInfo.Info) as PDFDict;
  info.set(PDFName.of('Author'), PDFString.of('Hidden Author Name'));
  info.set(PDFName.of('Title'), PDFString.of('Internal title'));
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream('<x:xmpmeta>XMP-SECRET-PACKET</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
  await doc.attach(new TextEncoder().encode('ATTACHED-SECRET-CONTENT'), 'notes.txt', { mimeType: 'text/plain' });
  // comment, script link, document script, open action, thumbnail, piece info, hidden layer
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('COMMENT-SECRET') }));
  const jsLink = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 50, 150, 70], A: { S: 'JavaScript', JS: PDFString.of('app.alert("SCRIPT-SECRET")') } }));
  const webLink = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 80, 150, 100], A: { S: 'URI', URI: PDFString.of('https://example.org/') } }));
  page.node.set(PDFName.of('Annots'), ctx.obj([note, jsLink, webLink]));
  const jsAction = ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("DOCSCRIPT-SECRET")') }));
  // the attachment is added to this same name dictionary when the file is saved
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('init'), jsAction] }) }));
  doc.catalog.set(PDFName.of('OpenAction'), ctx.obj({ S: 'Launch', F: PDFString.of('calc.exe') }));
  page.node.set(PDFName.of('Thumb'), ctx.register(ctx.stream('thumb', {})));
  doc.catalog.set(PDFName.of('PieceInfo'), ctx.obj({ App: { Private: PDFString.of('PRIVATE-APP-SECRET') } }));
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Draft notes') }));
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [ocg], D: { OFF: [ocg] } }));
  const form = doc.getForm();
  const tf = form.createTextField('ssn'); tf.addToPage(page, { x: 50, y: 300, width: 200, height: 20 }); tf.setText('FORM-SECRET-123');
  let bytes = await doc.save({ useObjectStreams: false });
  // incremental update: a new Info object replaces the old one, the old title stays in the file
  const s = Buffer.from(bytes).toString('latin1');
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(s)![1]);
  const size = Number(/\/Size (\d+)/.exec(s.slice(s.lastIndexOf('trailer')))![1]);
  const root = /\/Root (\d+ 0 R)/.exec(s.slice(s.lastIndexOf('trailer')))![1];
  const off = bytes.length;
  const obj = `${size} 0 obj\n<< /Title (Newer title) >>\nendobj\n`;
  const xref = off + obj.length;
  const tail = `${obj}xref\n${size} 1\n${String(off).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${size + 1} /Root ${root} /Info ${size} 0 R /Prev ${prev} >>\nstartxref\n${xref}\n%%EOF\n`;
  bytes = new Uint8Array([...bytes, ...new TextEncoder().encode(tail)]);
  void applyEdits;
  return bytes;
}

describe('inspect and sanitize', () => {
  it('finds every category, including earlier revisions and hidden layers', async () => {
    const pdf = await dirty();
    expect(countRevisions(pdf)).toBe(2);
    const found = Object.fromEntries((await inspectDocument(pdf)).map((i) => [i.category, i]));
    expect(Object.keys(found).sort()).toEqual(['attachments', 'comments', 'forms', 'hiddenLayers', 'metadata', 'private', 'revisions', 'scripts']);
    expect(found.metadata!.examples.join()).toContain('XMP metadata');
    expect(found.attachments!.examples).toContain('notes.txt');
    expect(found.scripts!.examples.join(' | ')).toMatch(/JavaScript action.*document script “init”.*open action \(Launch\)/s);
    expect(found.hiddenLayers).toMatchObject({ examples: ['Draft notes'], removable: false });
  });

  it('removes what was chosen, from the bytes too, and keeps the visible page', async () => {
    const pdf = await dirty();
    const before = deepText(pdf);
    for (const s of ['Hidden Author Name', 'XMP-SECRET', 'ATTACHED-SECRET-CONTENT', 'COMMENT-SECRET', 'SCRIPT-SECRET', 'DOCSCRIPT-SECRET', 'calc.exe', 'PRIVATE-APP-SECRET', 'Internal title', 'Newer title']) expect(before).toContain(s);
    const out = await sanitizeDocument(pdf, ['metadata', 'attachments', 'comments', 'scripts', 'forms', 'private', 'revisions']);
    const raw = deepText(out);
    for (const s of ['Hidden Author Name', 'XMP-SECRET', 'ATTACHED-SECRET-CONTENT', 'COMMENT-SECRET', 'SCRIPT-SECRET', 'DOCSCRIPT-SECRET', 'calc.exe', 'PRIVATE-APP-SECRET', 'Internal title', 'Newer title', 'notes.txt']) expect(raw, s).not.toContain(s);
    expect(countRevisions(out)).toBe(1);
    const left = (await inspectDocument(out)).map((i) => i.category);
    expect(left).toEqual(['hiddenLayers']); // reported, never silently "removed"
    const page = (await extractText(out))[0]!;
    expect(page).toContain('Visible body text');
    expect(page).toContain('FORM-SECRET-123'); // a flattened field keeps its visible value
    // the harmless web link survives; the script link does not
    expect(raw).toContain('https://example.org/');
  });

  it('only removes the chosen categories and refuses to fake hidden-layer removal', async () => {
    const pdf = await dirty();
    const out = await sanitizeDocument(pdf, ['metadata']);
    const left = (await inspectDocument(out)).map((i) => i.category).sort();
    expect(left).toEqual(['attachments', 'comments', 'forms', 'hiddenLayers', 'private', 'scripts']);
    await expect(sanitizeDocument(pdf, ['hiddenLayers'])).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});
