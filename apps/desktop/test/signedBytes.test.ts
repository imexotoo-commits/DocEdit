import { describe, expect, it } from 'vitest';
import { hasDigitalSignature } from '../src/renderer/signedBytes.js';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('spotting a digital signature from the bytes', () => {
  it('finds /ByteRange wherever it is', () => {
    expect(hasDigitalSignature(bytes('<< /Type /Sig /ByteRange [0 100 200 50] /Contents <00> >>'))).toBe(true);
    expect(hasDigitalSignature(bytes('/ByteRange'))).toBe(true);
    expect(hasDigitalSignature(bytes(`${'x'.repeat(10_000)}/ByteRange [0 1 2 3]`))).toBe(true);
  });
  it('does not take other text for a signature', () => {
    expect(hasDigitalSignature(bytes('%PDF-1.7 << /Type /Page >>'))).toBe(false);
    expect(hasDigitalSignature(bytes('/ByteRang'))).toBe(false);
    expect(hasDigitalSignature(bytes('ByteRange without the slash'))).toBe(false);
    expect(hasDigitalSignature(bytes('/Byte /Range //ByteRang'))).toBe(false);
    expect(hasDigitalSignature(new Uint8Array(0))).toBe(false);
  });
  it('copes with a slash right before the needle and with a large file', () => {
    expect(hasDigitalSignature(bytes('//ByteRange'))).toBe(true);
    const big = new Uint8Array(30_000_000); big.fill(0x2f); // all slashes: the worst case for the search
    expect(hasDigitalSignature(big)).toBe(false);
  });
});
