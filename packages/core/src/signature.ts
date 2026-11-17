/**
 * Certificate-based (cryptographic) signatures: PAdES baseline B-B style (ETSI EN 319 142-1) on the
 * ISO 32000-2 §12.8 model. A signature is an incremental update: a signature field whose /V dictionary
 * has /ByteRange (the signed bytes: the whole file except the /Contents hex string) and /Contents (a
 * detached CMS SignedData, RFC 5652, with the ESS signing-certificate-v2 attribute, RFC 5035).
 * Keys never enter this module: a Signer produces the CMS. createCmsSigner builds one from a WebCrypto key.
 */
import { assertSafeStructure } from './guard.js';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from '@cantoo/pdf-lib';
import { DocEditError, PageRangeError } from './errors.js';
import { checkSignedRevision } from './revision.js';
import type { Pdf, Rect } from './types.js';

const OID = {
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47', timeStampToken: '1.2.840.113549.1.9.16.2.14',
  commonName: '2.5.4.3', organization: '2.5.4.10',
};

/** Space reserved for the CMS (bytes). 16 KB leaves room for long chains and, later, a timestamp. */
const CONTENTS_BYTES = 16384;
const BR_PLACEHOLDER = 9_999_999_999;

let engineSet = false;
function engine(): pkijs.ICryptoEngine {
  if (!engineSet) {
    pkijs.setEngine('docedit', new pkijs.CryptoEngine({ name: 'docedit', crypto: globalThis.crypto as Crypto }));
    engineSet = true;
  }
  return pkijs.getCrypto(true);
}

const subtle = () => globalThis.crypto.subtle;
const sha256 = async (d: BufferSource) => new Uint8Array(await subtle().digest('SHA-256', d));
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

// ---------------------------------------------------------------- signer

/** Something that can produce a detached CMS SignedData over bytes (software key, smart card, cloud HSM...). */
export interface Signer {
  /** DER-encoded CMS SignedData (ContentInfo) over `data` (the bytes covered by /ByteRange). */
  sign(data: Uint8Array): Promise<Uint8Array>;
  /** Name for the signature dictionary, usually the certificate's common name. */
  name?: string;
}

/**
 * A Signer for a WebCrypto private key (RSA PKCS#1 v1.5 or ECDSA, SHA-256) and its certificate chain
 * (DER, signer first). Signed attributes: content-type, message-digest, signing-certificate-v2.
 */
export function createCmsSigner(privateKey: CryptoKey, chainDer: Uint8Array[]): Signer {
  if (!chainDer.length) throw new DocEditError('A signing certificate is required', 'BAD_SIGNER');
  const crypto = engine();
  const chain = chainDer.map((d) => pkijs.Certificate.fromBER(ab(d)));
  const cert = chain[0]!;
  return {
    name: certName(cert),
    async sign(data) {
      const digest = await sha256(ab(data));
      const certHash = await sha256(ab(chainDer[0]!));
      // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }, ESSCertIDv2 with the default SHA-256
      const essV2 = new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: ab(certHash) })] })] })] });
      const signed = new pkijs.SignedData({
        version: 1,
        encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
        signerInfos: [new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
              new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: ab(digest) })] }),
              new pkijs.Attribute({ type: OID.signingCertificateV2, values: [essV2] }),
            ],
          }),
        })],
        certificates: chain,
      });
      await signed.sign(privateKey, 0, 'SHA-256', undefined, crypto);
      const info = new pkijs.ContentInfo({ contentType: OID.signedData, content: signed.toSchema(true) });
      return new Uint8Array(info.toSchema().toBER(false));
    },
  };
}

// ---------------------------------------------------------------- signing

export interface CryptoSignOptions {
  /** page for a visible signature box; without rect the signature is invisible */
  page?: number;
  rect?: Rect;
  reason?: string;
  location?: string;
  contact?: string;
  /** date written as /M (the claimed signing time); default now */
  date?: Date;
  /** an appearance drawn in the box (PNG/JPEG); otherwise a text block with name and date */
  fieldName?: string;
}

/** Largest coordinate accepted for a signature box (PDF's practical page limit is 14,400 points). */
const MAX_COORD = 14400;

const pdfDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return PDFString.of(`D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`);
};

/**
 * Sign the document as an incremental update. Earlier bytes (and earlier signatures) are left untouched.
 * Encrypted documents are refused (decrypt first, or sign before protecting).
 */
export async function signPdf(pdf: Pdf, signer: Signer, opts: CryptoSignOptions = {}): Promise<Pdf> {
  let doc: PDFDocument;
  assertSafeStructure(pdf);
  try { doc = await PDFDocument.load(pdf, { forIncrementalUpdate: true, updateMetadata: false, ignoreEncryption: true }); }
  catch (e) { throw new DocEditError(`Not a readable PDF: ${e instanceof Error ? e.message : String(e)}`, 'INVALID_PDF'); }
  if (doc.isEncrypted) throw new DocEditError('Signing protected documents is not supported; remove the password first.', 'ENCRYPTED');
  const snapshot = doc.takeSnapshot();
  const ctx = doc.context;
  const pageIndex = opts.page ?? 0;
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.getPageCount()) throw new PageRangeError(`Page ${pageIndex + 1} is outside 1-${doc.getPageCount()}`);
  const page = doc.getPage(pageIndex);

  const placeholder = '0'.repeat(CONTENTS_BYTES * 2);
  const sig: Record<string, unknown> = {
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'ETSI.CAdES.detached',
    ByteRange: [0, BR_PLACEHOLDER, BR_PLACEHOLDER, BR_PLACEHOLDER],
    Contents: PDFHexString.of(placeholder),
    M: pdfDate(opts.date ?? new Date()),
  };
  if (signer.name) sig.Name = PDFHexString.fromText(signer.name);
  if (opts.reason) sig.Reason = PDFHexString.fromText(opts.reason);
  if (opts.location) sig.Location = PDFHexString.fromText(opts.location);
  if (opts.contact) sig.ContactInfo = PDFHexString.fromText(opts.contact);
  const sigRef = ctx.register(ctx.obj(sig as never));

  // the field: a widget on the page, listed in the form (created if absent); SigFlags 3 = signatures exist, append only
  let acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const acroRef = doc.catalog.get(PDFName.of('AcroForm'));
  if (!acro) { acro = ctx.obj({ Fields: [] }) as PDFDict; doc.catalog.set(PDFName.of('AcroForm'), ctx.register(acro)); snapshot.markRefForSave(ctx.trailerInfo.Root as PDFRef); }
  else if (acroRef instanceof PDFRef) snapshot.markRefForSave(acroRef);
  else snapshot.markRefForSave(ctx.trailerInfo.Root as PDFRef);
  let fields = acro.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) { fields = ctx.obj([]) as PDFArray; acro.set(PDFName.of('Fields'), fields); }
  const existing = fields.size();
  const r = opts.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  // the box is written into a content stream as text: only plain, plausible numbers
  const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!num(r.x, -MAX_COORD, MAX_COORD) || !num(r.y, -MAX_COORD, MAX_COORD) || !num(r.width, 0, MAX_COORD) || !num(r.height, 0, MAX_COORD)) {
    throw new DocEditError('The signature box is not a valid rectangle.', 'INVALID_ARGUMENT');
  }
  const widget: Record<string, unknown> = {
    Type: 'Annot', Subtype: 'Widget', FT: 'Sig', F: 132, // print + locked
    T: PDFHexString.fromText(opts.fieldName ?? `Signature${existing + 1}`),
    V: sigRef, P: page.ref, Rect: [r.x, r.y, r.x + r.width, r.y + r.height],
  };
  if (r.width > 0 && r.height > 0) {
    // a simple visible appearance: name and date in the box
    const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
    const line = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
    const size = Math.max(6, Math.min(12, r.height / 4));
    const text = [`Digitally signed by ${signer.name ?? 'unknown'}`, `Date: ${(opts.date ?? new Date()).toISOString().slice(0, 19).replace('T', ' ')} UTC`, ...(opts.reason ? [`Reason: ${opts.reason}`] : [])];
    const ops = `q 0.95 0.97 1 rg 0 0 ${r.width} ${r.height} re f 0.2 0.3 0.6 RG 1 w 0.5 0.5 ${r.width - 1} ${r.height - 1} re S Q BT /F1 ${size} Tf 0.1 0.15 0.35 rg ` +
      text.map((t, i) => `1 0 0 1 4 ${r.height - (i + 1) * size * 1.25} Tm (${line(t)}) Tj`).join(' ') + ' ET';
    const ap = ctx.register(ctx.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, r.width, r.height], Resources: { Font: { F1: font } } }));
    widget.AP = { N: ap };
  }
  const widgetRef = ctx.register(ctx.obj(widget as never));
  fields.push(widgetRef);
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const annotsRef = page.node.get(PDFName.of('Annots'));
  if (annots) { annots.push(widgetRef); if (annotsRef instanceof PDFRef) snapshot.markRefForSave(annotsRef); }
  else page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));
  snapshot.markRefForSave(page.ref);

  const update = await doc.saveIncremental(snapshot, { useObjectStreams: false });
  // the update's offsets assume it follows the original bytes directly
  const prefix = pdf;
  const out = new Uint8Array(prefix.length + update.length);
  out.set(prefix); out.set(update, prefix.length);

  // locate our placeholder in the update and fix the byte range around it
  const text = new TextDecoder('latin1').decode(out);
  const contentsAt = text.indexOf(`<${placeholder}>`, prefix.length);
  const brToken = `[ 0 ${BR_PLACEHOLDER} ${BR_PLACEHOLDER} ${BR_PLACEHOLDER} ]`;
  const brAt = text.indexOf(brToken, prefix.length);
  if (contentsAt < 0 || brAt < 0) throw new DocEditError('Could not prepare the signature placeholder', 'SIGN_FAILED');
  const a = contentsAt, b = contentsAt + placeholder.length + 2, c = out.length - b;
  const br = `[ 0 ${a} ${b} ${c}`.padEnd(brToken.length - 1, ' ') + ']';
  out.set(new TextEncoder().encode(br), brAt);
  const signedBytes = new Uint8Array(a + c);
  signedBytes.set(out.subarray(0, a)); signedBytes.set(out.subarray(b), a);
  const cms = await signer.sign(signedBytes);
  if (cms.length > CONTENTS_BYTES) throw new DocEditError('The signature is too large for the reserved space', 'SIGN_FAILED');
  const hex = Array.from(cms, (x) => x.toString(16).padStart(2, '0')).join('');
  out.set(new TextEncoder().encode(hex), a + 1);
  return out;
}

// ---------------------------------------------------------------- verification

export interface CertificateInfo { subject: string; issuer: string; serial: string; notBefore: Date; notAfter: Date; selfSigned: boolean; der: Uint8Array }

export interface SignatureReport {
  field: string;
  signerName: string;
  /** /M of the signature dictionary: claimed by the signer, not proven (no timestamp verified) */
  claimedTime: Date | null;
  reason?: string;
  location?: string;
  /** the signed bytes are unchanged and the CMS signature matches the certificate */
  integrity: 'valid' | 'invalid';
  integrityDetail?: string;
  /** the certificate was valid at the claimed time */
  certificateValidAtSigning: boolean;
  /**
   * chains to one of the trusted certificates given to verifySignatures, checked at the time of verification
   * (the signer's stated time is not proven); null when none were given
   */
  trusted: boolean | null;
  /** why a chain to a trusted certificate does not count (for example, it is valid only at the stated time) */
  trustDetail?: string;
  /** the file was changed after this signature (later incremental updates exist) */
  changedAfterSigning: boolean;
  /** the signed bytes end exactly at the end of a saved version (%%EOF) of the file */
  coversRevision: boolean;
  /**
   * what the signed bytes cover: the whole file, a complete earlier version (later updates were appended),
   * or nothing that can be established as a complete version of the document
   */
  coverage: 'whole-file' | 'earlier-revision' | 'not-established';
  coverageDetail?: string;
  /**
   * the document-level verdict: 'valid' needs both CMS integrity and established coverage;
   * 'indeterminate' when the CMS checks out but coverage is not established. Trust is reported separately.
   */
  status: 'valid' | 'invalid' | 'indeterminate';
  timestamp: 'none' | 'present-not-verified';
  certificate: CertificateInfo | null;
}

export interface VerifyOptions {
  /** trust anchors (DER certificates); a signature is "trusted" when its chain reaches one of these */
  trusted?: Uint8Array[];
}

export async function verifySignatures(pdf: Pdf, opts: VerifyOptions = {}): Promise<SignatureReport[]> {
  const crypto = engine();
  let doc: PDFDocument;
  assertSafeStructure(pdf);
  try { doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false }); }
  catch (e) { throw new DocEditError(`Not a readable PDF: ${e instanceof Error ? e.message : String(e)}`, 'INVALID_PDF'); }
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const out: SignatureReport[] = [];
  const total = trimmedLength(pdf);
  const trustedDer = opts.trusted ?? [];
  const trusted = trustedDer.map((d) => pkijs.Certificate.fromBER(ab(d)));

  const visit = (list: PDFArray | undefined, prefix: string, depth: number) => {
    if (!list || depth > 32) return;
    for (let i = 0; i < list.size(); i++) {
      const f = list.lookup(i);
      const fieldRef = list.get(i);
      if (!(f instanceof PDFDict)) continue;
      const t = f.get(PDFName.of('T'));
      const name = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
      const full = name ? (prefix ? `${prefix}.${name}` : name) : prefix;
      const v = f.lookup(PDFName.of('V'));
      const ft = f.get(PDFName.of('FT'));
      // the object that holds the signature dictionary: its own, or the field's when /V is written inline
      const vRef = f.get(PDFName.of('V'));
      const holder = vRef instanceof PDFRef ? vRef : fieldRef instanceof PDFRef ? fieldRef : null;
      if (ft instanceof PDFName && ft.decodeText() === 'Sig' && v instanceof PDFDict) pending.push([full, v, holder ? { num: holder.objectNumber, gen: holder.generationNumber } : null]);
      visit(f.lookupMaybe(PDFName.of('Kids'), PDFArray), full, depth + 1);
    }
  };
  const pending: Array<[string, PDFDict, { num: number; gen: number } | null]> = [];
  visit(acro?.lookupMaybe(PDFName.of('Fields'), PDFArray), '', 0);

  for (const [field, v, holder] of pending) {
    const str = (k: string) => { const x = v.get(PDFName.of(k)); return x instanceof PDFString || x instanceof PDFHexString ? x.decodeText() : undefined; };
    const report: SignatureReport = {
      field, signerName: str('Name') ?? '', claimedTime: parsePdfDate(str('M')), reason: str('Reason'), location: str('Location'),
      integrity: 'invalid', certificateValidAtSigning: false, trusted: trusted.length ? false : null,
      changedAfterSigning: false, coversRevision: false, coverage: 'not-established', status: 'invalid', timestamp: 'none', certificate: null,
    };
    out.push(report);
    const brArr = v.lookupMaybe(PDFName.of('ByteRange'), PDFArray);
    const br = brArr ? Array.from({ length: brArr.size() }, (_, k) => { const n = brArr.lookup(k); return n instanceof PDFNumber ? n.asNumber() : NaN; }) : [];
    const [a0, a1, b0, b1] = br as [number, number, number, number];
    if (br.length !== 4 || !br.every(Number.isInteger) || a0 !== 0 || a1 <= 0 || b0 <= a1 || b1 < 0 || b0 + b1 > pdf.length) { report.integrityDetail = 'The signed byte range is malformed.'; continue; }
    // the gap must be exactly the hex /Contents string
    const gap = new TextDecoder('latin1').decode(pdf.subarray(a1, b0));
    if (!/^<[0-9a-fA-F]*>$/.test(gap)) { report.integrityDetail = 'The signed byte range does not exclude exactly the signature value.'; continue; }
    // ... and it must be this signature's own value, not some other hex string in the file
    const own = v.lookup(PDFName.of('Contents'));
    const contents = hexToBytes(gap.slice(1, -1));
    if (!(own instanceof PDFHexString) || !sameBytes(own.asBytes(), contents)) { report.integrityDetail = 'The signed byte range does not point at this signature’s value.'; continue; }
    // coverage: the signed bytes must be a complete, consistent version that contains this very signature
    const revision = checkSignedRevision(pdf, b0 + b1, holder, [a1, b0]);
    report.coversRevision = revision.ok;
    report.changedAfterSigning = b0 + b1 < total;
    if (!revision.ok) {
      report.coverage = 'not-established';
      report.coverageDetail = `${revision.reason} It is unclear what was signed.`;
    } else report.coverage = report.changedAfterSigning ? 'earlier-revision' : 'whole-file';
    const der = contents.subarray(0, derLength(contents));
    let signed: pkijs.SignedData;
    try {
      const info = pkijs.ContentInfo.fromBER(ab(der));
      if (info.contentType !== OID.signedData) throw new Error('not SignedData');
      signed = new pkijs.SignedData({ schema: info.content });
    } catch { report.integrityDetail = 'The signature value is not a valid CMS structure.'; continue; }
    const data = new Uint8Array(a1 + b1);
    data.set(pdf.subarray(0, a1)); data.set(pdf.subarray(b0, b0 + b1), a1);
    try {
      const res = await signed.verify({ signer: 0, data: ab(data), extendedMode: true, checkChain: false }, crypto);
      report.integrity = res.signatureVerified ? 'valid' : 'invalid';
      if (!res.signatureVerified) report.integrityDetail = res.message || 'The document was changed or the signature does not match.';
      const cert = res.signerCertificate ?? null;
      if (cert) {
        const certDer = new Uint8Array(cert.toSchema().toBER(false));
        const selfSigned = cert.subject.isEqual(cert.issuer) && await cert.verify(undefined, crypto).catch(() => false);
        report.certificate = { subject: certName(cert), issuer: rdnName(cert.issuer), serial: hex(cert.serialNumber.valueBlock.valueHexView), notBefore: cert.notBefore.value, notAfter: cert.notAfter.value, selfSigned, der: certDer };
        if (!report.signerName) report.signerName = report.certificate.subject;
        const when = report.claimedTime ?? new Date();
        report.certificateValidAtSigning = when >= cert.notBefore.value && when <= cert.notAfter.value;
        if (trusted.length) {
          // checked now, not at the stated /M: that date is the signer's own claim and could be backdated into an
          // expired certificate's validity (a verified timestamp would be needed to rely on an earlier time)
          // the signer's own certificate chosen as trusted (typical for self-signed ones, which the chain engine does not
          // accept as an anchor unless they are CA certificates) counts while it is valid; otherwise a chain must reach one
          const pinned = trustedDer.some((t) => sameBytes(t, certDer));
          const validAt = (at: Date) => at >= cert.notBefore.value && at <= cert.notAfter.value;
          const chainAt = async (at: Date) => (pinned && validAt(at)) || !!(await signed.verify({ signer: 0, data: ab(data), checkChain: true, trustedCerts: trusted, checkDate: at, extendedMode: true }, crypto).catch(() => null))?.signerCertificateVerified;
          report.trusted = await chainAt(new Date());
          if (!report.trusted && report.claimedTime && await chainAt(report.claimedTime)) {
            report.trustDetail = 'The certificate chain was valid only at the signing time the signer states, not today (for example, a certificate has expired). That time is not proven, so the signer is not shown as trusted.';
          }
        }
      }
    } catch (e) {
      report.integrity = 'invalid';
      report.integrityDetail = e instanceof Error ? e.message : String(e);
    }
    const unsigned = signed.signerInfos[0]?.unsignedAttrs?.attributes ?? [];
    if (unsigned.some((x) => x.type === OID.timeStampToken)) report.timestamp = 'present-not-verified';
  }
  for (const r of out) r.status = r.integrity !== 'valid' ? 'invalid' : r.coverage === 'not-established' ? 'indeterminate' : 'valid';
  return out;
}

// ---------------------------------------------------------------- helpers

function certName(c: pkijs.Certificate): string { return rdnName(c.subject); }
function rdnName(n: pkijs.RelativeDistinguishedNames): string {
  const get = (oid: string) => n.typesAndValues.find((t) => t.type === oid)?.value.valueBlock.value as string | undefined;
  return get(OID.commonName) ?? get(OID.organization) ?? n.typesAndValues.map((t) => String(t.value.valueBlock.value)).join(', ');
}
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function hexToBytes(h: string): Uint8Array { const out = new Uint8Array(h.length >> 1); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; }

/** Length of the DER element at the start (the hex string is zero-padded after it). */
function derLength(b: Uint8Array): number {
  if (b.length < 2) return b.length;
  const l = b[1]!;
  if (l < 0x80) return 2 + l;
  const n = l & 0x7f;
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + b[2 + i]!;
  return Math.min(b.length, 2 + n + len);
}

/** File length without trailing whitespace and NUL padding. */
function trimmedLength(b: Uint8Array): number {
  let n = b.length;
  while (n > 0 && [0x0a, 0x0d, 0x20, 0x00, 0x09].includes(b[n - 1]!)) n--;
  return n;
}

function parsePdfDate(s?: string): Date | null {
  const m = s && /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/.exec(s);
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz] = m;
  let t = Date.UTC(+y!, +mo - 1, +d, +h, +mi, +se);
  if (tz && tz !== 'Z') { const sign = tz[0] === '-' ? -1 : 1; const hh = +tz.slice(1, 3), mm = +(tz.replace(/'/g, '').slice(3, 5) || '0'); t -= sign * (hh * 60 + mm) * 60000; }
  return new Date(t);
}
