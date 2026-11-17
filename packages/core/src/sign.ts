import { StandardFonts, rgb } from '@cantoo/pdf-lib';
import { loadDoc, saveDoc } from './document.js';
import { drawImageFitted, type ImageBytes } from './stamp.js';
import type { Pdf, Rect } from './types.js';
import { assertImageSize } from './guard.js';

export interface VisualSignature {
  page: number; rect: Rect;
  /** A drawn or scanned signature image (PNG with transparency recommended). */
  image?: ImageBytes;
  /** Or a typed signature rendered in an italic face. */
  typedName?: string;
  /** Optional small caption under the signature, e.g. "Signed 2026-11-12". */
  caption?: string;
}

/**
 * VISUAL signature: draws a signature image or typed name on the page. It is a picture, NOT a cryptographic signature:
 * it proves nothing about who signed or whether the document changed afterwards. See docs/SIGNING.md.
 */
export async function addVisualSignature(pdf: Pdf, sig: VisualSignature): Promise<Pdf> {
  if (!sig.image && !sig.typedName) throw new Error('Provide an image or a typedName');
  const doc = await loadDoc(pdf);
  const page = doc.getPage(sig.page);
  const captionH = sig.caption ? 10 : 0;
  const box = { ...sig.rect, y: sig.rect.y + captionH, height: sig.rect.height - captionH };
  if (sig.image) {
    assertImageSize(sig.image.bytes);
    drawImageFitted(page, await (sig.image.format === 'png' ? doc.embedPng(sig.image.bytes) : doc.embedJpg(sig.image.bytes)), box);
  } else if (sig.typedName) {
    const font = await doc.embedFont(StandardFonts.TimesRomanItalic);
    let size = box.height * 0.7;
    while (size > 6 && font.widthOfTextAtSize(sig.typedName, size) > box.width) size -= 1;
    page.drawText(sig.typedName, { x: box.x, y: box.y + (box.height - size) / 2, size, font, color: rgb(0.05, 0.1, 0.45) });
  }
  if (sig.caption) {
    const f = await doc.embedFont(StandardFonts.Helvetica);
    page.drawLine({ start: { x: sig.rect.x, y: sig.rect.y + captionH }, end: { x: sig.rect.x + sig.rect.width, y: sig.rect.y + captionH }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(sig.caption, { x: sig.rect.x, y: sig.rect.y + 1, size: 7, font: f, color: rgb(0.3, 0.3, 0.3) });
  }
  return saveDoc(doc);
}
