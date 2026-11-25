import { describe, expect, it } from 'vitest';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCmsSigner, listFormFields, signPdf, verifySignatures } from '../src/index.js';
import { makePdf } from './helpers.js';

pkijs.setEngine('test', new pkijs.CryptoEngine({ name: 'test', crypto: globalThis.crypto as Crypto }));
const DAY = 86_400_000;

interface Made { cert: pkijs.Certificate; der: Uint8Array; key: CryptoKey }
async function makeCert(cn: string, o: { issuer?: Made; ca?: boolean; notBefore?: Date; notAfter?: Date } = {}): Promise<Made> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 + Math.floor(Math.random() * 1e9) });
  const name = (n: string) => [new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: n }) })];
  cert.subject.typesAndValues.push(...name(cn));
  if (o.issuer) cert.issuer = o.issuer.cert.subject; else cert.issuer.typesAndValues.push(...name(cn));
  cert.notBefore.value = o.notBefore ?? new Date(Date.now() - DAY);
  cert.notAfter.value = o.notAfter ?? new Date(Date.now() + 365 * DAY);
  cert.extensions = [];
  if (o.ca) cert.extensions.push(new pkijs.Extension({ extnID: '2.5.29.19', critical: true, extnValue: new pkijs.BasicConstraints({ cA: true }).toSchema().toBER(false), parsedValue: new pkijs.BasicConstraints({ cA: true }) }));
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(o.issuer?.key ?? keys.privateKey, 'SHA-256');
  return { cert, der: new Uint8Array(cert.toSchema(true).toBER(false)), key: keys.privateKey };
}

const openssl = ['C:/Program Files/Git/mingw64/bin/openssl.exe', '/usr/bin/openssl', '/usr/local/bin/openssl'].find((p) => existsSync(p));

describe('certificate signatures', () => {
  it('signs as an incremental update that verifies, and another reader sees the field', async () => {
    const me = await makeCert('Alex Signer');
    const base = await makePdf(['Contract text', 'Page two']);
    const signed = await signPdf(base, createCmsSigner(me.key, [me.der]), { reason: 'I approve', location: 'Testville', page: 1, rect: { x: 50, y: 50, width: 220, height: 50 } });
    expect(Buffer.from(signed.subarray(0, base.length)).equals(Buffer.from(base))).toBe(true); // original bytes untouched
    const [r] = await verifySignatures(signed);
    expect(r).toMatchObject({ integrity: 'valid', signerName: 'Alex Signer', reason: 'I approve', location: 'Testville', changedAfterSigning: false, coversRevision: true, certificateValidAtSigning: true, trusted: null, timestamp: 'none' });
    expect(r!.certificate).toMatchObject({ subject: 'Alex Signer', selfSigned: true });
    // another reader sees the field: pdf-lib's own reading lists it as a signature. (pdf.js 6 leaves out signature fields it has
    // nothing to draw, so it can no longer be the second reader here.)
    const fields = await listFormFields(signed);
    expect(fields.some((f) => f.kind === 'signature')).toBe(true);
  });

  it('detects any change to the signed bytes', async () => {
    const me = await makeCert('Alex Signer');
    const signed = await signPdf(await makePdf(['Pay 100 EUR']), createCmsSigner(me.key, [me.der]));
    const tampered = signed.slice();
    const at = Buffer.from(tampered).indexOf('%PDF') + 7; // inside the header line: harmless for readers, still signed
    tampered[at] = tampered[at]! ^ 1;
    const [r] = await verifySignatures(tampered);
    expect(r!.integrity).toBe('invalid');
  });

  it('keeps an earlier signature valid when a second one is added, and reports the later change', async () => {
    const a = await makeCert('First Signer'), b = await makeCert('Second Signer');
    const once = await signPdf(await makePdf(['Agreement']), createCmsSigner(a.key, [a.der]));
    const twice = await signPdf(once, createCmsSigner(b.key, [b.der]));
    const [first, second] = await verifySignatures(twice);
    expect(first).toMatchObject({ signerName: 'First Signer', integrity: 'valid', changedAfterSigning: true, coversRevision: true });
    expect(second).toMatchObject({ signerName: 'Second Signer', integrity: 'valid', changedAfterSigning: false });
  });

  it('separates trust from integrity: trusted, untrusted and expired certificates', async () => {
    const root = await makeCert('Test Root CA', { ca: true });
    const other = await makeCert('Unrelated CA', { ca: true });
    const leaf = await makeCert('Pat Employee', { issuer: root });
    const signed = await signPdf(await makePdf(['Memo']), createCmsSigner(leaf.key, [leaf.der, root.der]));
    const [ok] = await verifySignatures(signed, { trusted: [root.der] });
    expect(ok).toMatchObject({ integrity: 'valid', trusted: true });
    expect(ok!.certificate).toMatchObject({ subject: 'Pat Employee', issuer: 'Test Root CA', selfSigned: false });
    const [untrusted] = await verifySignatures(signed, { trusted: [other.der] });
    expect(untrusted).toMatchObject({ integrity: 'valid', trusted: false });

    const old = await makeCert('Expired Key', { notBefore: new Date(Date.now() - 400 * DAY), notAfter: new Date(Date.now() - 30 * DAY) });
    const [expired] = await verifySignatures(await signPdf(await makePdf(['x']), createCmsSigner(old.key, [old.der])));
    expect(expired).toMatchObject({ integrity: 'valid', certificateValidAtSigning: false });
  });

  it.skipIf(!openssl)('produces CMS that OpenSSL verifies independently', async () => {
    const me = await makeCert('Alex Signer');
    const signed = await signPdf(await makePdf(['Cross-check']), createCmsSigner(me.key, [me.der]));
    const text = Buffer.from(signed).toString('latin1');
    const [, a1, b0, b1] = /\/ByteRange \[\s*(\d+) (\d+) (\d+) (\d+)/.exec(text)!.slice(1).map(Number) as [number, number, number, number];
    const hex = text.slice(a1 + 1, b0 - 1).replace(/(00)+$/, '');
    const dir = mkdtempSync(join(tmpdir(), 'docedit-sig-'));
    try {
      writeFileSync(join(dir, 'sig.der'), Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex'));
      writeFileSync(join(dir, 'data.bin'), Buffer.concat([signed.subarray(0, a1), signed.subarray(b0, b0 + b1)]));
      const out = execFileSync(openssl!, ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(dir, 'sig.der'), '-content', join(dir, 'data.bin'), '-noverify', '-out', join(dir, 'out.bin')], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      void out;
    } catch (e) {
      throw new Error(`OpenSSL rejected the signature: ${(e as { stderr?: Buffer }).stderr?.toString() ?? e}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('gives a document-level verdict only when the signed bytes cover a complete version', async () => {
    const me = await makeCert('Alex Signer');
    const signer = createCmsSigner(me.key, [me.der]);
    const signed = await signPdf(await makePdf(['Coverage']), signer);
    const [whole] = await verifySignatures(signed);
    expect(whole).toMatchObject({ status: 'valid', coverage: 'whole-file', integrity: 'valid' });

    const twice = await signPdf(signed, signer);
    const [earlier, later] = await verifySignatures(twice);
    expect(earlier).toMatchObject({ status: 'valid', coverage: 'earlier-revision', changedAfterSigning: true });
    expect(later).toMatchObject({ status: 'valid', coverage: 'whole-file' });

    // a byte range that stops short of the end of the version, signed correctly by the key holder:
    // the CMS is valid, but what it covers is not a complete document version
    const text = Buffer.from(signed).toString('latin1');
    const m = /\/ByteRange (\[\s*0 (\d+) (\d+) (\d+)\s*\])/.exec(text)!;
    const [token, a1, b0, b1] = [m[1]!, Number(m[2]), Number(m[3]), Number(m[4])];
    const short = b1 - 7; // leaves "%%EOF" outside the signed bytes
    const patched = signed.slice();
    patched.set(new TextEncoder().encode(`[ 0 ${a1} ${b0} ${short}`.padEnd(token.length - 1, ' ') + ']'), m.index + '/ByteRange '.length);
    const data = new Uint8Array(a1 + short);
    data.set(patched.subarray(0, a1)); data.set(patched.subarray(b0, b0 + short), a1);
    const cms = await signer.sign(data);
    const hexCms = Array.from(cms, (x) => x.toString(16).padStart(2, '0')).join('').padEnd(b0 - a1 - 2, '0');
    patched.set(new TextEncoder().encode(hexCms), a1 + 1);
    const [odd] = await verifySignatures(patched, { trusted: [me.der] });
    expect(odd).toMatchObject({ integrity: 'valid', coverage: 'not-established', status: 'indeterminate' });

    // malformed byte ranges are invalid outright
    for (const bad of [`[ 0 ${a1} ${a1} ${b1}`, `[ 5 ${a1} ${b0} ${b1}`, `[ 0 ${a1 - 2} ${b0} ${b1}`]) {
      const t = signed.slice();
      t.set(new TextEncoder().encode(bad.padEnd(token.length - 1, ' ') + ']'), m.index + '/ByteRange '.length);
      const [r] = await verifySignatures(t);
      expect(r, bad).toMatchObject({ status: 'invalid' });
    }
  });

  it('does not take an end-of-file marker as proof: the signed version must be structurally whole', async () => {
    const me = await makeCert('Alex Signer');
    const signer = createCmsSigner(me.key, [me.der]);
    const signed = await signPdf(await makePdf(['Structure']), signer);
    const text = Buffer.from(signed).toString('latin1');
    /** Re-sign the (tampered) bytes under the same byte range, so the CMS itself is valid again. */
    const resign = async (bytes: Uint8Array) => {
      const m = /\/ByteRange \[\s*0 (\d+) (\d+) (\d+)\s*\]/.exec(Buffer.from(bytes).toString('latin1'))!;
      const [a1, b0, b1] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const data = new Uint8Array(a1 + b1);
      data.set(bytes.subarray(0, a1)); data.set(bytes.subarray(b0, b0 + b1), a1);
      const cms = await signer.sign(data);
      bytes.set(new TextEncoder().encode(Array.from(cms, (x) => x.toString(16).padStart(2, '0')).join('').padEnd(b0 - a1 - 2, '0')), a1 + 1);
      return bytes;
    };
    const patch = (from: string, to: string) => {
      expect(to.length).toBe(from.length);
      const at = text.lastIndexOf(from);
      expect(at).toBeGreaterThan(0);
      const t = signed.slice(); t.set(new TextEncoder().encode(to), at); return t;
    };

    // 1. still "startxref … %%EOF" at the end, but it points at the middle of an object, not a cross-reference
    const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)!;
    const wrong = '1'.padStart(sx[1]!.length, '0');
    const [pointer] = await verifySignatures(await resign(patch(`startxref\n${sx[1]}`, `startxref\n${wrong}`)), { trusted: [me.der] });
    expect(pointer).toMatchObject({ integrity: 'valid', coverage: 'not-established', status: 'indeterminate' });

    // 2. a consistent version whose cross-reference marks the signature's own dictionary as free:
    //    the signature cannot be resolved in what it signed
    const sigObj = Number(/(\d+) 0 obj\s*<<[^]*?\/ByteRange/.exec(text.slice(text.lastIndexOf(' obj', text.indexOf('/ByteRange')) - 12))![1]);
    const table = text.slice(text.lastIndexOf('\nxref'));
    const sub = new RegExp(String.raw`
${sigObj} (\d+)
(\d{10} \d{5} n )`).exec(table)!;
    const freed = await resign(patch(sub[0], sub[0].replace(sub[2]!, '0000000000 00000 f ')));
    const [unresolved] = await verifySignatures(freed, { trusted: [me.der] });
    expect(unresolved).toMatchObject({ integrity: 'valid', coverage: 'not-established', status: 'indeterminate' });
    expect(unresolved!.coverageDetail).toMatch(/signature dictionary/);

    // and the untouched file is still fully valid and trusted
    const [ok] = await verifySignatures(signed, { trusted: [me.der] });
    expect(ok).toMatchObject({ status: 'valid', coverage: 'whole-file', integrity: 'valid' });
  });

  it('refuses protected documents', async () => {
    const { protectPdf } = await import('../src/index.js');
    const me = await makeCert('Alex Signer');
    const enc = await protectPdf(await makePdf(['x']), { userPassword: 'secret-pass' });
    await expect(signPdf(enc, createCmsSigner(me.key, [me.der]))).rejects.toMatchObject({ code: 'ENCRYPTED' });
  });
});
