import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { BadPasswordError, EncryptedPdfError, InvalidPdfError } from './errors.js';
import type { DocumentInfo, Metadata, Pdf } from './types.js';
import { assertSafeStructure } from './guard.js';

/**
 * Load bytes into a pdf-lib document, mapping failures to our error types. Encrypted files are decrypted
 * with `password`; files that only restrict permissions (empty user password) open without one.
 */
export async function loadDoc(pdf: Pdf, opts: { password?: string } = {}): Promise<PDFDocument> {
  assertSafeStructure(pdf);
  const load = (password?: string) => PDFDocument.load(pdf, { ignoreEncryption: false, updateMetadata: false, ...(password !== undefined ? { password } : {}) });
  let doc: PDFDocument;
  try {
    doc = await load(opts.password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/password incorrect/i.test(msg)) throw new BadPasswordError();
    if (/encrypt/i.test(msg)) {
      if (opts.password === undefined) {
        try { return assertPageTree(await load('')); } catch (inner) { if (inner instanceof InvalidPdfError) throw inner; /* a real password is needed */ }
      }
      throw new EncryptedPdfError();
    }
    throw new InvalidPdfError(e);
  }
  return assertPageTree(doc);
}

/** pdf-lib loads files with no usable catalog or page tree and fails later with raw TypeErrors; refuse them here. */
function assertPageTree(doc: PDFDocument): PDFDocument {
  try {
    if (!(doc.catalog.lookup(PDFName.of('Pages')) instanceof PDFDict)) throw new Error('the document has no page tree');
    doc.getPageCount();
  } catch (e) {
    throw new InvalidPdfError(e);
  }
  return doc;
}

export async function saveDoc(doc: PDFDocument, opts: { objectStreams?: boolean } = {}): Promise<Pdf> {
  return doc.save({ useObjectStreams: opts.objectStreams ?? true, updateFieldAppearances: false });
}

export async function getInfo(pdf: Pdf): Promise<DocumentInfo> {
  const doc = await loadDoc(pdf);
  const pages = doc.getPages().map((p, index) => {
    const { width, height } = p.getCropBox(); // the visible area: CropBox if set, else MediaBox
    const r = ((p.getRotation().angle % 360) + 360) % 360;
    return { index, width, height, rotation: r as 0 | 90 | 180 | 270 };
  });
  let formFieldCount = 0;
  try { formFieldCount = doc.getForm().getFields().length; } catch { /* no form */ }
  return { pageCount: pages.length, pages, metadata: readMetadata(doc), formFieldCount };
}

export function readMetadata(doc: PDFDocument): Metadata {
  const kw = doc.getKeywords();
  return {
    title: doc.getTitle(), author: doc.getAuthor(), subject: doc.getSubject(),
    keywords: kw ? kw.split(/[,;]\s*/).filter(Boolean) : undefined,
    creator: doc.getCreator(), producer: doc.getProducer(),
    creationDate: doc.getCreationDate(), modificationDate: doc.getModificationDate(),
  };
}

/** Set only the keys present in `meta`. Pass an empty string to clear a text field. */
export async function setMetadata(pdf: Pdf, meta: Metadata): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  if (meta.title !== undefined) doc.setTitle(meta.title);
  if (meta.author !== undefined) doc.setAuthor(meta.author);
  if (meta.subject !== undefined) doc.setSubject(meta.subject);
  if (meta.keywords !== undefined) doc.setKeywords([meta.keywords.join(', ')]); // pdf-lib joins with spaces; we want a comma list
  if (meta.creator !== undefined) doc.setCreator(meta.creator);
  if (meta.producer !== undefined) doc.setProducer(meta.producer);
  if (meta.creationDate) doc.setCreationDate(meta.creationDate);
  doc.setModificationDate(meta.modificationDate ?? new Date());
  return saveDoc(doc);
}
