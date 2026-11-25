import { describe, expect, it } from 'vitest';
import { decryptPdf, extractText, getInfo, isEncrypted, protectPdf } from '../src/index.js';
import { deepText, makePdf } from './helpers.js';

async function pdfjsOpen(bytes: Uint8Array, password?: string) {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return lib.getDocument({ data: bytes.slice(), ...(password !== undefined ? { password } : {}) }).promise;
}

describe('password protection', () => {
  it('encrypts so the content needs the password, in another reader and in the bytes', async () => {
    const plain = await makePdf(['TOP-SECRET-BODY text']);
    const enc = await protectPdf(plain, { userPassword: 'correct horse', ownerPassword: 'battery staple' });
    expect(await isEncrypted(enc)).toBe(true);
    expect(await isEncrypted(plain)).toBe(false);
    await expect(pdfjsOpen(enc)).rejects.toMatchObject({ name: 'PasswordException' });
    await expect(pdfjsOpen(enc, 'wrong')).rejects.toMatchObject({ name: 'PasswordException' });
    const opened = await pdfjsOpen(enc, 'correct horse');
    const items = (await (await opened.getPage(1)).getTextContent()).items as Array<{ str: string }>;
    expect(items.map((i) => i.str).join('')).toContain('TOP-SECRET-BODY');
    expect(deepText(enc)).not.toContain('TOP-SECRET-BODY');
    expect(deepText(enc)).toContain('/V 5'); // AES-256
  });

  it('opens with the user or owner password, reports wrong and missing passwords', async () => {
    const enc = await protectPdf(await makePdf(['Body']), { userPassword: 'u-pass', ownerPassword: 'o-pass' });
    await expect(getInfo(enc)).rejects.toMatchObject({ code: 'ENCRYPTED' });
    await expect(decryptPdf(enc, 'nope')).rejects.toMatchObject({ code: 'BAD_PASSWORD' });
    for (const pw of ['u-pass', 'o-pass']) {
      const dec = await decryptPdf(enc, pw);
      expect(await isEncrypted(dec)).toBe(false);
      expect((await extractText(dec))[0]!.trim()).toBe('Body');
    }
  });

  it('restrictions without an open password: opens freely, permissions recorded', async () => {
    const enc = await protectPdf(await makePdf(['Body']), { permissions: { copying: false, printing: 'none' } });
    expect(await isEncrypted(enc)).toBe(true);
    expect((await getInfo(enc)).pageCount).toBe(1); // no password needed
    const lib = await pdfjsOpen(enc);
    const perms = await lib.getPermissions();
    expect(perms).not.toBeNull();
    const { PermissionFlag } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    expect(perms).not.toContain(PermissionFlag.COPY);
    expect(perms).not.toContain(PermissionFlag.PRINT);
  });

  it('refuses meaningless options', async () => {
    const p = await makePdf(['x']);
    await expect(protectPdf(p, {})).rejects.toMatchObject({ code: 'BAD_OPTIONS' });
    await expect(protectPdf(p, { userPassword: 'same', ownerPassword: 'same' })).rejects.toMatchObject({ code: 'BAD_OPTIONS' });
  });
});
