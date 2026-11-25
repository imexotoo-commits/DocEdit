import { createCanvas } from '@napi-rs/canvas';
import { openPdfjs } from '../text.js';
import type { RasterPage, Rasterizer } from '../render.js';

/** Node rasterizer: pdf.js draws onto an @napi-rs/canvas. Keeps the last document open so many pages of one file are fast. */
export class NodeRasterizer implements Rasterizer {
  private cache?: { bytes: Uint8Array; doc: Awaited<ReturnType<typeof openPdfjs>> };

  async renderPage(pdf: Uint8Array, pageIndex: number, scale: number): Promise<RasterPage> {
    if (this.cache?.bytes !== pdf) {
      await this.close();
      this.cache = { bytes: pdf, doc: await openPdfjs(pdf) };
    }
    const page = await this.cache!.doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    await page.render({ canvas: null, canvasContext: ctx as never, viewport }).promise;
    const img = ctx.getImageData(0, 0, width, height);
    return { width, height, data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), transform: viewport.transform as RasterPage['transform'], scale };
  }

  async close(): Promise<void> {
    if (this.cache) { await this.cache.doc.loadingTask.destroy(); this.cache = undefined; }
  }
}
