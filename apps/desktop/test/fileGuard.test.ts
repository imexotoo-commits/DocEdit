import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { isInsideDir, parseDocumentState } from '../src/main/fileGuard.js';

const DIR = '/Applications/Oakqueill.app/Contents/Resources/app.asar/dist/renderer';
const url = (p: string) => pathToFileURL(p).href;

describe('the page may load files from its own folder only', () => {
  it('allows the app page and its assets', () => {
    expect(isInsideDir(DIR, url(`${DIR}/index.html`))).toBe(true);
    expect(isInsideDir(DIR, url(`${DIR}/assets/main.js`))).toBe(true);
    expect(isInsideDir(DIR, url(`${DIR}/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap`))).toBe(true);
  });

  it('refuses other local files', () => {
    expect(isInsideDir(DIR, 'file:///etc/hosts')).toBe(false);
    expect(isInsideDir(DIR, 'file:///Users/someone/Documents/secret.pdf')).toBe(false);
  });

  it('refuses ../ escapes, plain and escaped', () => {
    expect(isInsideDir(DIR, `file://${DIR}/../../../../../../etc/passwd`)).toBe(false);
    expect(isInsideDir(DIR, `file://${DIR}/%2e%2e/%2e%2e/main/main.js`)).toBe(false);
    expect(isInsideDir(DIR, `file://${DIR}/..%2f..%2fetc/passwd`)).toBe(false);
  });

  it('does not treat a folder with the same prefix as inside', () => {
    expect(isInsideDir(DIR, url(`${DIR}-evil/index.html`))).toBe(false);
    expect(isInsideDir(DIR, url('/Applications/Oakqueill.app/Contents/Resources/app.asar/dist/main/main.js'))).toBe(false);
  });

  it('refuses a network share and malformed addresses', () => {
    expect(isInsideDir(DIR, 'file://evil-host/share/index.html')).toBe(false);
    expect(isInsideDir(DIR, 'file:///%zz')).toBe(false);
    expect(isInsideDir(DIR, 'not a url')).toBe(false);
  });

  it('leaves other schemes to the content security policy', () => {
    expect(isInsideDir(DIR, 'https://example.com/')).toBe(true);
    expect(isInsideDir(DIR, 'data:text/plain,hi')).toBe(true);
  });
});

describe('what the page says about its document is reduced to safe values', () => {
  it('keeps a well-formed report', () => {
    expect(parseDocumentState({ title: 'Report.pdf', dirty: true, unsaved: 2 })).toEqual({ title: 'Report.pdf', dirty: true, unsaved: 2 });
    expect(parseDocumentState({ title: 'Report.pdf', dirty: false })).toEqual({ title: 'Report.pdf', dirty: false, unsaved: 0 });
  });

  it.each([undefined, null, 42, 'x', [], () => 1, { title: { a: 1 }, dirty: 'yes' }, { title: 5, dirty: 1 }])('survives %j without throwing', (bad) => {
    const s = parseDocumentState(bad);
    expect(typeof s.title).toBe('string');
    expect(s.dirty === true || s.dirty === false).toBe(true);
    expect(s.dirty).toBe(false);
    expect(s.unsaved).toBe(0);
  });

  it('keeps the unsaved count a small whole number', () => {
    expect(parseDocumentState({ unsaved: -5 }).unsaved).toBe(0);
    expect(parseDocumentState({ unsaved: 2.9 }).unsaved).toBe(2);
    expect(parseDocumentState({ unsaved: 1e12 }).unsaved).toBe(1000);
    expect(parseDocumentState({ unsaved: NaN }).unsaved).toBe(0);
    expect(parseDocumentState({ unsaved: '3' }).unsaved).toBe(0);
  });

  it('shortens an absurd title', () => {
    expect(parseDocumentState({ title: 'a'.repeat(100_000), dirty: false }).title.length).toBe(300);
  });
});
