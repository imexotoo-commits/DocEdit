/**
 * Password protection (ISO 32000-2 7.6, standard security handler). Encryption uses AES-256 (V5/R6),
 * the only method ISO 32000-2 still recommends. Passwords are only ever held in memory for the call.
 */
import { assertSafeStructure } from './guard.js';
import { PDFDocument } from '@cantoo/pdf-lib';
import { loadDoc, saveDoc } from './document.js';
import { DocEditError } from './errors.js';
import { pruneUnreachable } from './redact.js';
import type { Pdf } from './types.js';

export interface Permissions {
  printing?: 'none' | 'lowResolution' | 'highResolution';
  copying?: boolean;
  modifying?: boolean;
  annotating?: boolean;
  fillingForms?: boolean;
  contentAccessibility?: boolean;
  documentAssembly?: boolean;
}

export interface ProtectOptions {
  /** needed to open the document; omit (or empty) to allow opening without a password */
  userPassword?: string;
  /** needed to change permissions; defaults to a random one when only permissions are set */
  ownerPassword?: string;
  permissions?: Permissions;
}

/** True when the file uses encryption (whether or not a password is needed to open it). */
export async function isEncrypted(pdf: Pdf): Promise<boolean> {
  assertSafeStructure(pdf);
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  return doc.isEncrypted;
}

/** A decrypted copy, given the user or owner password ('' works for files that only restrict permissions). */
export async function decryptPdf(pdf: Pdf, password: string): Promise<Pdf> {
  const doc = await loadDoc(pdf, { password });
  // the loaded document keeps its security handler and would be encrypted again on save: drop both
  const ctx = doc.context as typeof doc.context & { security?: unknown };
  ctx.security = undefined;
  delete (ctx.trailerInfo as { Encrypt?: unknown }).Encrypt;
  pruneUnreachable(doc);
  return saveDoc(doc);
}

/** Encrypt with AES-256. Requires a user password or permissions (otherwise there is nothing to protect). */
export async function protectPdf(pdf: Pdf, o: ProtectOptions): Promise<Pdf> {
  const user = o.userPassword ?? '';
  if (!user && !o.permissions) throw new DocEditError('Set a password to open the document, or restrictions to apply.', 'BAD_OPTIONS');
  if (user && o.ownerPassword !== undefined && o.ownerPassword === user) throw new DocEditError('Use a different password for changing permissions than for opening.', 'BAD_OPTIONS');
  const doc = await loadDoc(pdf);
  const owner = o.ownerPassword || randomPassword();
  doc.encrypt({
    userPassword: user,
    ownerPassword: owner,
    algorithm: 'AES-256',
    permissions: {
      printing: o.permissions?.printing === 'none' ? undefined : (o.permissions?.printing ?? 'highResolution'),
      copying: o.permissions?.copying ?? true,
      modifying: o.permissions?.modifying ?? true,
      annotating: o.permissions?.annotating ?? true,
      fillingForms: o.permissions?.fillingForms ?? true,
      contentAccessibility: o.permissions?.contentAccessibility ?? true,
      documentAssembly: o.permissions?.documentAssembly ?? true,
    },
  } as never);
  return saveDoc(doc);
}

function randomPassword(): string {
  const b = new Uint8Array(24);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
