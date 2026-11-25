import { loadSource, pdfjs, type PDFPageProxy } from '../pdf.js';
import { buildDocx, buildText, reflow, type DocPage, type TextPiece } from './docx.js';

export type ExportKind = 'docx' | 'txt' | 'png' | 'jpg';

async function renderImage(page: PDFPageProxy, dpi: number, type: 'image/png' | 'image/jpeg'): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  // very large pages are capped so one image stays manageable
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(dpi / 72, 8000 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: null, canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Could not encode the page image'))), type, 0.9));
  canvas.width = 0; canvas.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: base.width, height: base.height };
}

/** The page's text as displayed (rotation applied, y up from the bottom), for reflow. */
async function pieces(page: PDFPageProxy): Promise<TextPiece[]> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const out: TextPiece[] = [];
  for (const it of tc.items) {
    if (!('str' in it) || !it.str) continue;
    const m = pdfjs.Util.transform(vp.transform, it.transform) as number[]; // y runs down
    out.push({ str: it.str, x: m[4]!, y: vp.height - m[5]!, size: Math.hypot(m[2]!, m[3]!) || Math.hypot(m[0]!, m[1]!), width: it.width, upright: Math.abs(m[1]!) < 0.01 && Math.abs(m[2]!) < 0.01 && m[0]! > 0 });
  }
  return out;
}

/** Turn the document (as it would be saved) into files of another format. */
export async function exportDocument(bytes: Uint8Array, title: string, kind: ExportKind, dpi: number, onStep: (s: string) => void): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const base = title.replace(/\.pdf$/i, '') || 'document';
  const src = await loadSource(bytes, title);
  try {
    const n = src.doc.numPages;
    if (kind === 'png' || kind === 'jpg') {
      const files = [];
      const width = String(n).length;
      for (let i = 1; i <= n; i++) {
        onStep(`Rendering page ${i} of ${n}…`);
        const img = await renderImage(await src.doc.getPage(i), dpi, kind === 'png' ? 'image/png' : 'image/jpeg');
        files.push({ name: n === 1 ? `${base}.${kind}` : `${base}-${String(i).padStart(width, '0')}.${kind}`, bytes: img.bytes });
      }
      return files;
    }
    const pages: DocPage[] = [];
    for (let i = 1; i <= n; i++) {
      onStep(`Reading page ${i} of ${n}…`);
      const page = await src.doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const blocks = reflow(await pieces(page));
      // a page without text (a scan, a drawing) comes along as a picture in Word, and is skipped in plain text
      if (!blocks.length && kind === 'docx') {
        const img = await renderImage(page, 150, 'image/png');
        pages.push({ width: vp.width, height: vp.height, blocks: [{ kind: 'image', png: img.bytes, width: img.width, height: img.height }] });
      } else pages.push({ width: vp.width, height: vp.height, blocks });
    }
    onStep('Writing the file…');
    if (kind === 'txt') return [{ name: `${base}.txt`, bytes: new TextEncoder().encode('﻿' + buildText(pages)) }];
    return [{ name: `${base}.docx`, bytes: await buildDocx(pages, base) }];
  } finally { void src.doc.loadingTask.destroy(); }
}
