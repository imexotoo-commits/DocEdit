// Frames of the portable exe's splash: an 8-bit quill writing a line of ink across the "Unpacking…" screen.
// The portable wrapper (build-portable.mjs) shows frame N of FRAME_COUNT as unpacking reaches N/FRAME_COUNT, so the
// line doubles as a progress bar. Drawn here in code on a pixel grid, onto build/portable-splash-base.bmp (the text).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FRAME_COUNT = 40;

const CELL = 3; // screen pixels per art pixel
const C = {
  cream: [0xf3, 0xea, 0xd7], shade: [0xc9, 0xb2, 0x7c], shaft: [0x7a, 0x5a, 0x2e], gold: [0xe6, 0xb4, 0x48], goldDark: [0xa8, 0x7a, 0x22],
  nib: [0x2a, 0x2a, 0x2a], nibLight: [0x6a, 0x6a, 0x6a], ink: [0x6c, 0xc1, 0x96], outline: [0x08, 0x1f, 0x16],
};

/** The quill as a 34×26 grid of colours (null = empty), with the nib's tip at TIP. */
function quill() {
  const W = 34, H = 26;
  const g = Array.from({ length: H }, () => Array(W).fill(null));
  const px = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
  // the shaft runs diagonally from the feather's tip (top right) to the nib (bottom left)
  const lit = [1, 2, 3, 4, 5, 5, 6, 6, 5, 5, 4, 3, 2, 1];   // vane above the shaft
  const shaded = [0, 1, 1, 2, 2, 3, 3, 3, 3, 2, 2, 2, 1, 0]; // vane below it
  for (let i = 0; i < lit.length; i++) {
    const x = 30 - i, y = 1 + i;
    for (let k = 1; k <= lit[i]; k++) px(x - k, y, C.cream);
    for (let k = 1; k <= shaded[i]; k++) px(x + k, y, C.shade);
    px(x, y, C.shaft);
  }
  for (const [x, y] of [[22, 6], [21, 8], [25, 5]]) px(x, y, null); // barb notches
  px(16, 15, C.shaft); px(15, 16, C.shaft);
  px(14, 17, C.gold); px(15, 17, C.goldDark); px(13, 18, C.gold); px(14, 18, C.goldDark);
  px(12, 19, C.nib); px(13, 19, C.nibLight); px(11, 20, C.nib); px(12, 20, C.nib); px(10, 21, C.nib);
  // a dark outline round the whole shape, as 8-bit sprites have
  const out = g.map((r) => r.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => g[y + b]?.[x + a])) out[y][x] = C.outline;
  }
  return { cells: out, tip: [10, 21] };
}

/** The handwriting: one ink cell per column, in humps grouped into words, from START to END (grid columns). */
const START = 22, END = 134, BASELINE = 33;
const HUMP = [0, -1, -2, -1];
const WORDS = [13, 8, 16, 10, 14, 9, 12, 11]; // letters' worth of columns per word, a 3-column space between words
function inkAt(x) {
  let at = START;
  for (const len of WORDS) {
    if (x < at) return null;
    if (x < at + len) return BASELINE + HUMP[(x - at) % 4];
    at += len + 3;
  }
  return x <= END ? BASELINE + HUMP[(x - at) % 4] : null;
}

function readBmp(path) {
  const b = readFileSync(path);
  if (b.toString('latin1', 0, 2) !== 'BM' || b.readUInt16LE(28) !== 24) throw new Error(`${path}: expected a 24-bit BMP`);
  const offset = b.readUInt32LE(10), width = b.readInt32LE(18), height = b.readInt32LE(22);
  if (height <= 0) throw new Error(`${path}: expected a bottom-up BMP`);
  const stride = Math.ceil((width * 3) / 4) * 4;
  return { width, height, stride, header: b.subarray(0, offset), pixels: Buffer.from(b.subarray(offset, offset + stride * height)) };
}

/** Writes FRAME_COUNT BMPs (f00.bmp …) into `dir`. */
export function writeSplashFrames(dir, basePath) {
  const base = readBmp(basePath);
  const { cells, tip } = quill();
  const fill = (img, gx, gy, rgb) => {
    for (let dy = 0; dy < CELL; dy++) for (let dx = 0; dx < CELL; dx++) {
      const x = gx * CELL + dx, y = gy * CELL + dy;
      if (x < 0 || y < 0 || x >= base.width || y >= base.height) continue;
      const o = (base.height - 1 - y) * base.stride + x * 3; // bottom-up, BGR
      img[o] = rgb[2]; img[o + 1] = rgb[1]; img[o + 2] = rgb[0];
    }
  };
  const files = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const img = Buffer.from(base.pixels);
    const reach = START + Math.round(((END - START) * f) / (FRAME_COUNT - 1));
    for (let x = START; x <= reach; x++) { const y = inkAt(x); if (y != null) fill(img, x, y, C.ink); }
    // the nib rests on the line where it is writing (between words, on the baseline)
    const nibY = inkAt(reach) ?? BASELINE;
    const ox = reach - tip[0], oy = nibY - tip[1];
    cells.forEach((row, y) => row.forEach((c, x) => { if (c) fill(img, ox + x, oy + y, c); }));
    const name = `f${String(f).padStart(2, '0')}.bmp`;
    writeFileSync(join(dir, name), Buffer.concat([base.header, img]));
    files.push(name);
  }
  return files;
}
