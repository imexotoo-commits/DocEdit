import { PDFFont, PDFPage, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { loadDoc, saveDoc } from './document.js';
import { parsePageRange } from './pageRange.js';
import type { Color, Pdf, Rect } from './types.js';
import { assertImageSize } from './guard.js';

export interface WatermarkOptions {
  text: string; pages?: string; size?: number; color?: Color; opacity?: number;
  /** degrees counter-clockwise, default 45 */ angle?: number;
}

/** Centered diagonal text on the chosen pages. Drawn on top of page content. */
export async function addTextWatermark(pdf: Pdf, o: WatermarkOptions): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = o.size ?? 60, angle = o.angle ?? 45;
  const [r, g, b] = o.color ?? [0.6, 0.6, 0.6];
  for (const i of parsePageRange(o.pages ?? 'all', doc.getPageCount(), { unique: true })) {
    const page = doc.getPage(i);
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(o.text, size), th = font.heightAtSize(size);
    const rad = (angle * Math.PI) / 180;
    // place so the text box centre lands on the page centre
    const x = width / 2 - (tw / 2) * Math.cos(rad) + (th / 3) * Math.sin(rad);
    const y = height / 2 - (tw / 2) * Math.sin(rad) - (th / 3) * Math.cos(rad);
    page.drawText(o.text, { x, y, size, font, color: rgb(r, g, b), opacity: o.opacity ?? 0.3, rotate: degrees(angle) });
  }
  return saveDoc(doc);
}

export interface PageNumberOptions {
  pages?: string; start?: number; /** "Page {n} of {total}" */ format?: string;
  position?: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';
  size?: number; margin?: number; color?: Color;
}

export async function addPageNumbers(pdf: Pdf, o: PageNumberOptions = {}): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  const font: PDFFont = await doc.embedFont(StandardFonts.Helvetica);
  const size = o.size ?? 10, margin = o.margin ?? 28, fmt = o.format ?? '{n}', pos = o.position ?? 'bottom-center';
  const [r, g, b] = o.color ?? [0, 0, 0];
  const total = doc.getPageCount();
  for (const i of parsePageRange(o.pages ?? 'all', total, { unique: true })) {
    const page = doc.getPage(i);
    const label = fmt.replace('{n}', String((o.start ?? 1) + i)).replace('{total}', String(total));
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(label, size);
    const x = pos.endsWith('left') ? margin : pos.endsWith('right') ? width - margin - tw : (width - tw) / 2;
    const y = pos.startsWith('top') ? height - margin : margin;
    page.drawText(label, { x, y, size, font, color: rgb(r, g, b) });
  }
  return saveDoc(doc);
}

export type ImageBytes = { bytes: Uint8Array; format: 'png' | 'jpg' };

/** Place an image into `rect` (user space) on one page, preserving aspect ratio and centering inside the rect. */
export async function placeImage(pdf: Pdf, pageIndex: number, rect: Rect, image: ImageBytes, opacity = 1): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  assertImageSize(image.bytes);
  drawImageFitted(doc.getPage(pageIndex), await (image.format === 'png' ? doc.embedPng(image.bytes) : doc.embedJpg(image.bytes)), rect, opacity);
  return saveDoc(doc);
}

export function drawImageFitted(page: PDFPage, img: { width: number; height: number }, rect: Rect, opacity = 1): void {
  const s = Math.min(rect.width / img.width, rect.height / img.height);
  const w = img.width * s, h = img.height * s;
  page.drawImage(img as never, { x: rect.x + (rect.width - w) / 2, y: rect.y + (rect.height - h) / 2, width: w, height: h, opacity });
}
