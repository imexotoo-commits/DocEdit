/**
 * Signing keys and trust decisions for the main process.
 * - PKCS#12 (.p12/.pfx) files are read with node-forge (BSD-3-Clause), which also handles the legacy
 *   3DES/RC2 encryption many exported files use. The key is imported into WebCrypto as non-extractable,
 *   used for one signature and then dropped; the password is never stored or logged.
 * - Trusted certificates are certificates the user explicitly chose to trust, kept as DER files under
 *   the app-data folder. Nothing is trusted by default (no self-signed or system certificates).
 */
import forge from 'node-forge';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCmsSigner, type Signer } from '@docedit/core';

export async function signerFromPkcs12(p12: Uint8Array, password: string): Promise<Signer & { subject: string }> {
  let parsed: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(p12).toString('binary')));
    parsed = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/mac|password|invalid/i.test(msg)) throw new Error('The certificate password is not correct, or the file is damaged.');
    throw new Error('This file is not a certificate file Oakqueill can read (expected .p12 or .pfx).');
  }
  const SHROUDED = forge.pki.oids.pkcs8ShroudedKeyBag!, KEY = forge.pki.oids.keyBag!, CERT = forge.pki.oids.certBag!;
  const keyBags: forge.pkcs12.Bag[] = [
    ...(parsed.getBags({ bagType: SHROUDED })[SHROUDED] ?? []),
    ...(parsed.getBags({ bagType: KEY })[KEY] ?? []),
  ];
  const certBags: forge.pkcs12.Bag[] = parsed.getBags({ bagType: CERT })[CERT] ?? [];
  const key = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new Error('The certificate file contains no usable private key. Only RSA keys are supported for now.');
  const certs = certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  // the signing certificate is the one whose public key matches the private key
  const signerCert = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals?.(key.n)) ?? certs[0];
  if (!signerCert) throw new Error('The certificate file contains no certificate.');
  const now = new Date();
  if (now > signerCert.validity.notAfter) throw new Error(`This certificate expired on ${signerCert.validity.notAfter.toISOString().slice(0, 10)}.`);
  const der = (c: forge.pki.Certificate) => new Uint8Array(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(), 'binary'));
  const chain = [signerCert, ...certs.filter((c) => c !== signerCert)].map(der);
  const pkcs8 = Buffer.from(forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key))).getBytes(), 'binary');
  const cryptoKey = await globalThis.crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  pkcs8.fill(0);
  const subject = (signerCert.subject.getField('CN')?.value as string | undefined) ?? signerCert.subject.attributes.map((a: { value?: unknown }) => String(a.value)).join(', ');
  return { ...createCmsSigner(cryptoKey, chain), subject };
}

export class TrustStore {
  constructor(private readonly dir: string) {}
  async list(): Promise<Uint8Array[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    return Promise.all(names.filter((n) => /^[a-f0-9]{64}\.der$/.test(n)).map(async (n) => new Uint8Array(await readFile(join(this.dir, n)))));
  }
  private file(der: Uint8Array) { return join(this.dir, `${createHash('sha256').update(der).digest('hex')}.der`); }
  async add(der: Uint8Array) { await mkdir(this.dir, { recursive: true, mode: 0o700 }); await writeFile(this.file(der), der, { mode: 0o600 }); }
  async remove(der: Uint8Array) { await rm(this.file(der), { force: true }); }
  async has(der: Uint8Array) { return (await readdir(this.dir).catch(() => [] as string[])).includes(this.file(der).split(/[\\/]/).pop()!); }
}

/** What the trust question shows: read here from the certificate itself, not taken from the page. */
export function describeCertificate(der: Uint8Array): { subject: string; issuer: string; selfSigned: boolean; validTo: string; fingerprint: string } {
  let cert: forge.pki.Certificate;
  try { cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(der).toString('binary')))); }
  catch { throw new Error('That is not a certificate Oakqueill can read.'); }
  const name = (n: forge.pki.Certificate['subject']) => (n.getField('CN')?.value as string | undefined) ?? (n.getField('O')?.value as string | undefined) ?? n.attributes.map((a: { value?: unknown }) => String(a.value)).join(', ');
  const fingerprint = createHash('sha256').update(der).digest('hex').toUpperCase().match(/../g)!.join(':');
  return { subject: name(cert.subject), issuer: name(cert.issuer), selfSigned: cert.isIssuer(cert), validTo: cert.validity.notAfter.toISOString().slice(0, 10), fingerprint };
}
