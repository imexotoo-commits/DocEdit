import { describe, expect, it } from 'vitest';
import { safeMailto } from '../src/main/links.js';

describe('email links from documents', () => {
  it('keeps recipients, subject and body', () => {
    const r = safeMailto(new URL('mailto:a@example.com?subject=Hello%20there&cc=b@example.com&body=Line'));
    expect(r.dropped).toEqual([]);
    expect(r.href).toBe('mailto:a@example.com?subject=Hello%20there&cc=b%40example.com&body=Line');
  });

  it('drops attachment and other fields', () => {
    const r = safeMailto(new URL('mailto:a@example.com?attach=C:%5CUsers%5Cme%5Csecret.txt&Attachment=x&subject=Hi'));
    expect(r.dropped).toEqual(['attach', 'Attachment']);
    expect(r.href).toBe('mailto:a@example.com?subject=Hi');
    expect(r.href).not.toMatch(/attach/i);
  });

  it('leaves a plain address as it is', () => {
    expect(safeMailto(new URL('mailto:a@example.com')).href).toBe('mailto:a@example.com');
  });
});
