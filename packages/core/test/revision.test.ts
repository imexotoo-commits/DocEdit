import { describe, expect, it } from 'vitest';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { createCmsSigner, signPdf, verifySignatures } from '../src/index.js';
import { contentsSpan } from '../src/revision.js';
import { makePdf } from './helpers.js';

pkijs.setEngine('rev', new pkijs.CryptoEngine({ name: 'rev', crypto: globalThis.crypto as Crypto }));

async function signer() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2; cert.serialNumber = new asn1js.Integer({ value: 42 });
  const n = [new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: 'Rev Tester' }) })];
  cert.subject.typesAndValues.push(...n); cert.issuer.typesAndValues.push(...n);
  cert.notBefore.value = new Date(Date.now() - 86_400_000); cert.notAfter.value = new Date(Date.now() + 86_400_000);
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey); await cert.sign(keys.privateKey, 'SHA-256');
  return createCmsSigner(keys.privateKey, [new Uint8Array(cert.toSchema(true).toBER(false))]);
}

const latin = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const enc = (s: string) => new TextEncoder().encode(s);

describe('signed revision: reachability and the exact /Contents value', () => {
  it('a signature that is not part of the form it signed is indeterminate, even if a later update adds it', async () => {
    const sign = await signer();
    const signed = await signPdf(await makePdf(['Reachable']), sign);
    const text = latin(signed);
    // in the signed version, the form lists an object that does not exist instead of the signature field
    const fieldsAt = text.lastIndexOf('/Fields [ ');
    const m = /\/Fields \[ (\d+) 0 R \]/.exec(text.slice(fieldsAt))!;
    const formNum = Number(/(\d+) 0 obj\s*<<\s*$/.exec(text.slice(0, fieldsAt))![1]);
    const bogus = '9'.repeat(m[1]!.length);
    const tampered = signed.slice();
    tampered.set(enc(`/Fields [ ${bogus} 0 R ]`), fieldsAt);
    // re-sign the tampered signed bytes, so the CMS is valid again
    const br = /\/ByteRange \[\s*0 (\d+) (\d+) (\d+)\s*\]/.exec(text)!;
    const [a1, b0, b1] = [Number(br[1]), Number(br[2]), Number(br[3])];
    const data = new Uint8Array(a1 + b1); data.set(tampered.subarray(0, a1)); data.set(tampered.subarray(b0, b0 + b1), a1);
    const cms = await sign.sign(data);
    tampered.set(enc(Array.from(cms, (x) => x.toString(16).padStart(2, '0')).join('').padEnd(b0 - a1 - 2, '0')), a1 + 1);
    // a later, unsigned update puts the field back into the form, so a reader of the final file sees it
    const root = /\/Root (\d+ \d+ R)/.exec(text.slice(text.lastIndexOf('trailer')))![1];
    const prev = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1];
    const objAt = tampered.length;
    const obj = `${formNum} 0 obj\n<< /Fields [ ${m[1]} 0 R ] /SigFlags 3 >>\nendobj\n`;
    const xrefAt = objAt + obj.length;
    const update = `${obj}xref\n${formNum} 1\n${String(objAt).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${Number(m[1]) + 1} /Root ${root} /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    const final = new Uint8Array(tampered.length + update.length);
    final.set(tampered); final.set(enc(update), tampered.length);
    const [r] = await verifySignatures(final);
    expect(r).toMatchObject({ integrity: 'valid', coverage: 'not-established', status: 'indeterminate' });
    expect(r!.coverageDetail).toMatch(/not part of the form/);
  });

  it('finds the dictionary’s own /Contents value by tokens, and refuses anything ambiguous', () => {
    const span = (s: string) => { const r = contentsSpan(enc(s), 0); return r && s.slice(r.start, r.end); };
    expect(span('<< /Type /Sig /Contents <0A0B> /ByteRange [0 1 2 3] >>')).toBe('<0A0B>');
    // look-alikes before it: a comment, a literal string with brackets and escapes, a nested dictionary with its own /Contents
    expect(span('<< % /Contents <FF>\n /Reason (a \\) /Contents <EE> \\( (nested) ) /Prop_Build << /Contents <DD> >> /Ref 12 0 R /Contents <0C> >>')).toBe('<0C>');
    expect(span('<< /Contents <0A> /Contents <0B> >>')).toBeNull(); // twice
    expect(span('<< /Contents (text) >>')).toBeNull(); // not a hex string
    expect(span('<< /Type /Sig >>')).toBeNull(); // none
    expect(span('[ /Contents <0A> ]')).toBeNull(); // not a dictionary
  });
});
