import { describe, expect, it } from 'vitest';
import { pdfAddress, pdfResponseAddress, type PdfResponse } from '../src/intercept.js';

const page = (over: Partial<PdfResponse> & { contentType?: string; disposition?: string } = {}): PdfResponse => ({
  url: 'https://example.org/docs/report.pdf', method: 'GET', type: 'main_frame',
  headers: [
    ...(over.contentType !== undefined ? [{ name: 'Content-Type', value: over.contentType }] : [{ name: 'Content-Type', value: 'application/pdf' }]),
    ...(over.disposition ? [{ name: 'Content-Disposition', value: over.disposition }] : []),
  ],
  ...Object.fromEntries(Object.entries(over).filter(([k]) => !['contentType', 'disposition'].includes(k))),
});

describe('Firefox: which page loads the viewer takes over', () => {
  it('takes a page the server answers as a PDF', () => {
    expect(pdfResponseAddress(page())).toBe('https://example.org/docs/report.pdf');
    expect(pdfResponseAddress(page({ contentType: 'application/pdf; charset=binary' }))).toBe('https://example.org/docs/report.pdf');
    expect(pdfResponseAddress(page({ contentType: 'APPLICATION/PDF' }))).toBe('https://example.org/docs/report.pdf');
    expect(pdfResponseAddress(page({ contentType: 'application/x-pdf' }))).toBe('https://example.org/docs/report.pdf');
  });

  it('takes plain bytes only when the address ends in .pdf', () => {
    expect(pdfResponseAddress(page({ contentType: 'application/octet-stream' }))).toBe('https://example.org/docs/report.pdf');
    expect(pdfResponseAddress(page({ contentType: 'binary/octet-stream', url: 'https://example.org/a.PDF?x=1#p=2' }))).toBe('https://example.org/a.PDF?x=1');
    expect(pdfResponseAddress(page({ contentType: 'application/octet-stream', url: 'https://example.org/download?id=7' }))).toBeNull();
    expect(pdfResponseAddress(page({ contentType: 'application/octet-stream', url: 'https://example.org/x.pdf.exe' }))).toBeNull();
  });

  it('leaves downloads, other methods, frames and non-web addresses alone', () => {
    expect(pdfResponseAddress(page({ disposition: 'attachment; filename="r.pdf"' }))).toBeNull();
    expect(pdfResponseAddress(page({ disposition: 'ATTACHMENT' }))).toBeNull();
    expect(pdfResponseAddress(page({ disposition: 'inline; filename="r.pdf"' }))).toBe('https://example.org/docs/report.pdf');
    expect(pdfResponseAddress(page({ method: 'POST' }))).toBeNull();
    expect(pdfResponseAddress(page({ type: 'sub_frame' }))).toBeNull();
    expect(pdfResponseAddress(page({ type: 'xmlhttprequest' }))).toBeNull();
    expect(pdfResponseAddress(page({ url: 'file:///Users/me/a.pdf' }))).toBeNull();
    expect(pdfResponseAddress(page({ url: 'ftp://example.org/a.pdf' }))).toBeNull();
    expect(pdfResponseAddress(page({ url: 'javascript:alert(1)' }))).toBeNull();
  });

  it('leaves other content types alone, and a response with no headers', () => {
    expect(pdfResponseAddress(page({ contentType: 'text/html' }))).toBeNull();
    expect(pdfResponseAddress(page({ contentType: 'application/pdfx' }))).toBeNull();
    expect(pdfResponseAddress({ url: 'https://example.org/a.pdf', method: 'GET', type: 'main_frame', headers: [] })).toBeNull();
  });
});

describe('Safari: which addresses the viewer takes over', () => {
  it('takes web addresses whose path ends in .pdf, in any case, keeping the query', () => {
    expect(pdfAddress('https://example.org/a.pdf')).toBe('https://example.org/a.pdf');
    expect(pdfAddress('http://example.org/dir/A.PDF?token=1#page=4')).toBe('http://example.org/dir/A.PDF?token=1');
  });

  it('leaves everything else to Safari', () => {
    expect(pdfAddress('https://example.org/a.pdf.html')).toBeNull();
    expect(pdfAddress('https://example.org/download?file=a.pdf')).toBeNull();
    expect(pdfAddress('file:///Users/me/a.pdf')).toBeNull();
    expect(pdfAddress('https://example.org/pdf')).toBeNull();
    expect(pdfAddress('not an address')).toBeNull();
  });
});
