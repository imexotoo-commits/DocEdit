import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signPdf, verifySignatures, createBlankPdf } from '@docedit/core';
import { signerFromPkcs12, TrustStore } from '../src/main/certificates.js';

const openssl = ['C:/Program Files/Git/mingw64/bin/openssl.exe', '/usr/bin/openssl', '/usr/local/bin/openssl'].find((p) => existsSync(p));

/** A key, a self-signed certificate and a .p12 made by OpenSSL with its default (legacy 3DES/RC2) encryption. */
function makeP12(dir: string, cn: string, password: string): Uint8Array {
  const run = (...a: string[]) => execFileSync(openssl!, a, { stdio: 'pipe', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-subj', `/CN=${cn}`, '-days', '30');
  run('pkcs12', '-export', '-inkey', join(dir, 'k.pem'), '-in', join(dir, 'c.pem'), '-out', join(dir, 'p.p12'), '-passout', `pass:${password}`);
  return new Uint8Array(readFileSync(join(dir, 'p.p12')));
}

describe.skipIf(!openssl)('PKCS#12 signing keys', () => {
  it('reads a legacy-encrypted .p12, signs, and the signature verifies; wrong passwords are refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'docedit-p12-'));
    try {
      const p12 = makeP12(dir, 'Robin Tester', 'pa55word');
      await expect(signerFromPkcs12(p12, 'nope')).rejects.toThrow(/password is not correct/);
      const signer = await signerFromPkcs12(p12, 'pa55word');
      expect(signer.subject).toBe('Robin Tester');
      const signed = await signPdf(await createBlankPdf(1), signer, { reason: 'Test' });
      const [r] = await verifySignatures(signed);
      expect(r).toMatchObject({ integrity: 'valid', signerName: 'Robin Tester', trusted: null });

      // trusting the certificate changes only the trust result
      const store = new TrustStore(join(dir, 'trust'));
      await store.add(r!.certificate!.der);
      const [t] = await verifySignatures(signed, { trusted: await store.list() });
      expect(t).toMatchObject({ integrity: 'valid', trusted: true });
      await store.remove(r!.certificate!.der);
      expect(await store.list()).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
