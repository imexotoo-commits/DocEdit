/**
 * Whether a PDF carries a digital signature, judged from its bytes: every signature dictionary has a /ByteRange entry, in
 * plain text (it has to be readable to check the signature). pdf.js stopped listing signature fields it has nothing to draw
 * (invisible ones, or ones without an appearance), so asking it would miss signatures that saving would invalidate.
 */
const NEEDLE = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65]; // "/ByteRange"

export function hasDigitalSignature(bytes: Uint8Array): boolean {
  const last = bytes.length - NEEDLE.length;
  for (let i = 0; i <= last; i++) {
    if (bytes[i] !== 0x2f) continue;
    let k = 1;
    while (k < NEEDLE.length && bytes[i + k] === NEEDLE[k]) k++;
    if (k === NEEDLE.length) return true;
  }
  return false;
}
