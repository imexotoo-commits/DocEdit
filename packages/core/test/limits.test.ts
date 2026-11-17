import { describe, expect, it } from 'vitest';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { createCmsSigner, getInfo, imagesToPdf, signPdf, splitPdf, verifySignatures, DocEditError, InvalidPdfError, PageRangeError } from '../src/index.js';
import { makePdf } from './helpers.js';

pkijs.setEngine('test', new pkijs.CryptoEngine({ name: 'test', crypto: globalThis.crypto as Crypto }));
const DAY = 86_400_000;

async function selfSigned(cn: string, notBefore: Date, notAfter: Date) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 + Math.floor(Math.random() * 1e9) });
  const name = [new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: cn }) })];
  cert.subject.typesAndValues.push(...name);
  cert.issuer.typesAndValues.push(...name);
  cert.notBefore.value = notBefore;
  cert.notAfter.value = notAfter;
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, 'SHA-256');
  return { der: new Uint8Array(cert.toSchema(true).toBER(false)), key: keys.privateKey };
}

describe('trust is checked at verification time', () => {
  it('does not trust an expired certificate because of a backdated signing time', async () => {
    const old = await selfSigned('Expired Key', new Date(Date.now() - 400 * DAY), new Date(Date.now() - 30 * DAY));
    const backdated = new Date(Date.now() - 100 * DAY); // inside the old validity, as the signer claims
    const signed = await signPdf(await makePdf(['x']), createCmsSigner(old.key, [old.der]), { date: backdated });
    const [r] = await verifySignatures(signed, { trusted: [old.der] });
    expect(r).toMatchObject({ integrity: 'valid', certificateValidAtSigning: true, trusted: false });
    expect(r!.trustDetail).toMatch(/only at the signing time/);
  });

  it('trusts a current self-signed certificate the user chose, whatever date the signer states', async () => {
    const me = await selfSigned('Current Key', new Date(Date.now() - 400 * DAY), new Date(Date.now() + 300 * DAY));
    const signed = await signPdf(await makePdf(['x']), createCmsSigner(me.key, [me.der]), { date: new Date(Date.now() - 100 * DAY) });
    const [r] = await verifySignatures(signed, { trusted: [me.der] });
    expect(r).toMatchObject({ integrity: 'valid', trusted: true });
    expect(r!.trustDetail).toBeUndefined();
  });
});

describe('signature box', () => {
  it.each([
    ['text in a coordinate', { x: 10, y: 10, width: '50 0 0 rg 0 0 999 999 re f' as unknown as number, height: 20 }],
    ['NaN', { x: Number.NaN, y: 10, width: 50, height: 20 }],
    ['a negative width', { x: 10, y: 10, width: -5, height: 20 }],
    ['a huge value', { x: 1e12, y: 10, width: 50, height: 20 }],
  ])('refuses %s', async (_n, rect) => {
    const me = await selfSigned('Box', new Date(Date.now() - DAY), new Date(Date.now() + DAY));
    await expect(signPdf(await makePdf(['x']), createCmsSigner(me.key, [me.der]), { page: 0, rect })).rejects.toBeInstanceOf(DocEditError);
  });

  it('refuses a fractional page', async () => {
    const me = await selfSigned('Box', new Date(Date.now() - DAY), new Date(Date.now() + DAY));
    await expect(signPdf(await makePdf(['x', 'y']), createCmsSigner(me.key, [me.der]), { page: 0.5 })).rejects.toBeInstanceOf(PageRangeError);
  });
});

describe('argument and structure checks', () => {
  it.each([0, -1, 1.5, Number.NaN])('splitPdf refuses %s pages per file', async (every) => {
    await expect(splitPdf(await makePdf(['a', 'b']), every)).rejects.toBeInstanceOf(PageRangeError);
  });

  it('refuses a document with no page tree with a clear error', async () => {
    const body = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n';
    const xref = body.length;
    const pdf = `${body}xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const err = await getInfo(new Uint8Array(Buffer.from(pdf, 'latin1'))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidPdfError);
  });

  it('refuses a PNG too large to decode, from its header', async () => {
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 20000);
    new DataView(png.buffer).setUint32(20, 20000);
    const err = await imagesToPdf([png]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocEditError);
    expect((err as DocEditError).code).toBe('IMAGE_TOO_LARGE');
  });
});
