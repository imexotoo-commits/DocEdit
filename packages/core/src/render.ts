/** A rendered page: RGBA pixels plus the matrix that maps PDF user space -> pixel space. */
export interface RasterPage {
  width: number; height: number;
  /** RGBA, row-major, top row first, already composited on white. */
  data: Uint8ClampedArray;
  /** [a,b,c,d,e,f]: pixel = (a*x + c*y + e, b*x + d*y + f) for user-space (x,y). Includes page rotation and scale. */
  transform: [number, number, number, number, number, number];
  /** pixels per point */ scale: number;
}

/**
 * Anything that can draw a PDF page to pixels. The core never imports a rendering backend so it stays portable:
 * Node uses `@docedit/core/node` (pdf.js + @napi-rs/canvas), the desktop app can plug in pdf.js on an OffscreenCanvas.
 */
export interface Rasterizer {
  renderPage(pdf: Uint8Array, pageIndex: number, scale: number): Promise<RasterPage>;
  close?(): Promise<void> | void;
}
