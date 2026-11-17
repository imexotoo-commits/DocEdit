import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createBlankPdf, extractText, getInfo, imagesToPdf, jpegOrientation, PAPER, textToPdf } from '../src/index.js';
import { NodeRasterizer } from '../src/node/index.js';
import { redPng } from './helpers.js';

/** 40x20 JPEG: left half red, right half blue. */
function jpeg(): Uint8Array {
  const c = createCanvas(40, 20), ctx = c.getContext('2d');
  ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 20, 20);
  ctx.fillStyle = '#00f'; ctx.fillRect(20, 0, 20, 20);
  return new Uint8Array(c.toBuffer('image/jpeg', 95));
}

/** Insert an APP1 Exif segment with only the orientation tag, right after SOI. */
function withOrientation(j: Uint8Array, o: number, little = false): Uint8Array {
  const tiff = little
    ? [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]
    : [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
  const body = [...'Exif'].map((c) => c.charCodeAt(0)).concat([0, 0], tiff);
  const len = body.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...body, ...j.subarray(2)]);
}

/** Dominant colour ('red' | 'blue' | 'white' | other) at a fractional point of a rendered page. */
async function colourAt(pdf: Uint8Array, fx: number, fy: number) {
  const r = await new NodeRasterizer().renderPage(pdf, 0, 0.5);
  const x = Math.floor(r.width * fx), y = Math.floor(r.height * fy), i = (y * r.width + x) * 4;
  const [R, G, B] = [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!];
  if (R > 200 && G < 80 && B < 80) return 'red';
  if (B > 200 && R < 80 && G < 80) return 'blue';
  if (R > 230 && G > 230 && B > 230) return 'white';
  return `rgb(${R},${G},${B})`;
}

describe('createBlankPdf', () => {
  it('makes the requested number of pages', async () => {
    const info = await getInfo(await createBlankPdf(3, [200, 300]));
    expect(info.pages.map((p) => [p.width, p.height])).toEqual([[200, 300], [200, 300], [200, 300]]);
    await expect(createBlankPdf(0)).rejects.toThrow(/at least one/);
  });
});

describe('imagesToPdf', () => {
  it('reads the EXIF orientation tag in both byte orders', () => {
    expect(jpegOrientation(jpeg())).toBe(1);
    expect(jpegOrientation(withOrientation(jpeg(), 6))).toBe(6);
    expect(jpegOrientation(withOrientation(jpeg(), 8, true))).toBe(8);
  });

  it('sizes pages to the image and applies EXIF orientation', async () => {
    const plain = await imagesToPdf([jpeg()]);
    expect((await getInfo(plain)).pages[0]).toMatchObject({ width: 30, height: 15 });
    expect([await colourAt(plain, 0.25, 0.5), await colourAt(plain, 0.75, 0.5)]).toEqual(['red', 'blue']);

    // 6 = turn clockwise to display: the stored left column ends up on top
    const six = await imagesToPdf([withOrientation(jpeg(), 6)]);
    expect((await getInfo(six)).pages[0]).toMatchObject({ width: 15, height: 30 });
    expect([await colourAt(six, 0.5, 0.25), await colourAt(six, 0.5, 0.75)]).toEqual(['red', 'blue']);

    const eight = await imagesToPdf([withOrientation(jpeg(), 8)]);
    expect([await colourAt(eight, 0.5, 0.25), await colourAt(eight, 0.5, 0.75)]).toEqual(['blue', 'red']);

    for (const o of [2, 3]) { // mirrored and upside down: left and right swap, shape kept
      const pdf = await imagesToPdf([withOrientation(jpeg(), o)]);
      expect([await colourAt(pdf, 0.25, 0.5), await colourAt(pdf, 0.75, 0.5)]).toEqual(['blue', 'red']);
    }
  });

  it('places images on paper with margins, turning the paper to match wide images', async () => {
    const pdf = await imagesToPdf([jpeg(), redPng()], { pageSize: [...PAPER.letter], margin: 36 });
    const info = await getInfo(pdf);
    expect(info.pages.map((p) => [p.width, p.height])).toEqual([[792, 612], [612, 792]]);
    // wide image fitted to the width inside the margins, centred vertically: white above and below
    expect(await colourAt(pdf, 0.3, 0.5)).toBe('red');
    expect(await colourAt(pdf, 0.3, 0.1)).toBe('white');
    const portrait = await imagesToPdf([jpeg()], { pageSize: [...PAPER.a4], orientation: 'portrait' });
    expect((await getInfo(portrait)).pages[0]!.height).toBeGreaterThan((await getInfo(portrait)).pages[0]!.width);
  });

  it('cover fills the area and clips the overflow to it', async () => {
    const pdf = await imagesToPdf([jpeg()], { pageSize: [400, 400], orientation: 'portrait', margin: 50, fit: 'cover' });
    expect(await colourAt(pdf, 0.2, 0.5)).toBe('red');
    expect(await colourAt(pdf, 0.8, 0.5)).toBe('blue');
    expect(await colourAt(pdf, 0.05, 0.5)).toBe('white'); // inside the margin: clipped
  });

  it('rejects files that are not JPEG or PNG', async () => {
    await expect(imagesToPdf([new TextEncoder().encode('GIF89a...')])).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
    await expect(imagesToPdf([])).rejects.toThrow(/at least one/);
  });
});

describe('textToPdf', () => {
  const dejavu = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')));

  it('wraps, paginates and keeps the words extractable', async () => {
    const para = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const text = Array.from({ length: 30 }, () => para).join('\n\n') + '\f' + 'After the form feed';
    const res = await textToPdf(text, { fontSize: 12 });
    expect(res.pageCount).toBeGreaterThan(3);
    expect(res.missingCharacters).toEqual([]);
    const pages = await extractText(res.pdf);
    expect(pages[0]).toContain('word0');
    expect(pages[0]).toContain('word59');
    expect(pages.at(-1)!.trim()).toBe('After the form feed');
  });

  it('breaks words longer than a line', async () => {
    const res = await textToPdf('x'.repeat(500), { pageSize: [300, 300], margin: 20, fontSize: 10 });
    const t = (await extractText(res.pdf))[0]!.replace(/\s+/g, '');
    expect(t).toBe('x'.repeat(500));
  });

  it('embeds a Unicode font and reports characters it cannot show', async () => {
    const res = await textToPdf('Grüße — Ελληνικά — Кириллица — 漢字', { font: dejavu });
    expect(res.missingCharacters.sort()).toEqual(['字', '漢']);
    const t = (await extractText(res.pdf))[0]!;
    expect(t).toContain('Ελληνικά');
    expect(t).toContain('Кириллица');
    const std = await textToPdf('Grüße Кириллица');
    expect(std.missingCharacters.length).toBeGreaterThan(0);
    expect((await extractText(std.pdf))[0]).toContain('Grüße');
  });

  it('rejects margins that leave no room', async () => {
    await expect(textToPdf('x', { pageSize: [100, 100], margin: 49 })).rejects.toThrow(/no room/);
  });
});
