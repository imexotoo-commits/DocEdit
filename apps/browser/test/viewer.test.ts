import { describe, expect, it } from 'vitest';
import { fileName, sourceFromLocation } from '../src/ViewerApp.js';
import { MAX_PAGE_PIXELS, MAX_SIDE, PRINT_BUDGET, lastFitting, parseRange, printPixels, printScale, rangePixels } from '../src/print.js';

const V = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/viewer.html?file=';

describe('browser viewer: which PDF, and what it is called', () => {
  it('reads the address the redirect rule leaves raw, query and fragment included', () => {
    expect(sourceFromLocation(`${V}https://example.org/a/report.pdf?x=1&y=2#page=3`)).toEqual({ url: 'https://example.org/a/report.pdf?x=1&y=2', fragment: 'page=3' });
    expect(sourceFromLocation(`${V}file:///C:/Users/me/Doc%20one.pdf`)).toEqual({ url: 'file:///C:/Users/me/Doc%20one.pdf', fragment: '' });
    expect(sourceFromLocation(`${V}https%3A%2F%2Fexample.org%2Fx.pdf`)?.url).toBe('https://example.org/x.pdf'); // an encoded one too
  });
  it('refuses anything but web and local files', () => {
    expect(sourceFromLocation(`${V}javascript:alert(1)`)).toBeNull();
    expect(sourceFromLocation(`${V}data:application/pdf;base64,JVBERi0=`)).toBeNull();
    expect(sourceFromLocation(`${V}chrome://settings`)).toBeNull();
    expect(sourceFromLocation('chrome-extension://x/viewer.html')).toBeNull();
  });
  it('treats malformed encoding as no address instead of failing', () => {
    expect(() => sourceFromLocation(`${V}https%3A%2F%2Fexample.org%2F%E0%A4%A.pdf`)).not.toThrow();
    expect(sourceFromLocation(`${V}https%3A%2F%2Fexample.org%2F%E0%A4%A.pdf`)).toBeNull();
    expect(sourceFromLocation(`${V}file%3A%2F%2F%2F%ZZ`)).toBeNull();
  });
  it('names the file from Content-Disposition, else from the address, safely', () => {
    expect(fileName('https://x/dl?id=7', 'inline; filename="Quarterly report.pdf"')).toBe('Quarterly report.pdf');
    expect(fileName('https://x/dl', "attachment; filename*=UTF-8''Zo%C3%AB%20%C3%85ngstr%C3%B6m.pdf")).toBe('Zoë Ångström.pdf');
    expect(fileName('https://x/files/Tax%20form%202026.pdf?t=1', null)).toBe('Tax form 2026.pdf');
    expect(fileName('https://x/download', null)).toBe('download.pdf');
    expect(fileName('https://x/', 'inline; filename="..\\evil:name.pdf"')).toBe('.._evil_name.pdf');
  });
});

describe('browser viewer: how much printing may render', () => {
  it('prints ordinary pages at 150 dpi and very large ones smaller', () => {
    expect(printScale(612, 792)).toBeCloseTo(150 / 72);
    const s = printScale(14400, 14400); // a 200-inch poster
    expect(14400 * s).toBeLessThanOrEqual(MAX_SIDE);
    expect(printPixels(14400, 14400)).toBeLessThanOrEqual(MAX_PAGE_PIXELS + 2 * 4097);
    expect(printPixels(1, 200000)).toBeLessThanOrEqual(MAX_SIDE * 2);
  });
  it('finds how many pages fit the budget and checks ranges', () => {
    const letter = printPixels(612, 792);
    const pages = Array(400).fill(letter);
    const last = lastFitting(pages, 0);
    expect(rangePixels(pages, 0, last)).toBeLessThanOrEqual(PRINT_BUDGET);
    expect(rangePixels(pages, 0, last + 1)).toBeGreaterThan(PRINT_BUDGET);
    expect(lastFitting(pages.slice(0, 10), 0)).toBe(9);
    expect(lastFitting(pages, 390)).toBe(399);
  });
  it('reads page ranges', () => {
    expect(parseRange('3-10', 20)).toEqual([2, 9]);
    expect(parseRange(' 5 ', 20)).toEqual([4, 4]);
    expect(parseRange('2–4', 20)).toEqual([1, 3]);
    expect(parseRange('0-3', 20)).toBeNull();
    expect(parseRange('5-3', 20)).toBeNull();
    expect(parseRange('1-21', 20)).toBeNull();
    expect(parseRange('1,3', 20)).toBeNull();
  });
});
