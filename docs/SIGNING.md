# Signing

Two different things share the word "sign". The UI must make the difference obvious.

## 1. Visual signature (implemented: `addVisualSignature`)
A drawn/scanned image or typed name placed on the page. It is just page content. It proves nothing about who placed it and anyone can alter the PDF afterwards. Fine for "I agree" on a form; label it as such in the UI. Signature pad / saved signatures / "place and resize" are app work.

## 2. Cryptographic digital signature (implemented: `signPdf`, `createCmsSigner`, `verifySignatures`)

**Status (2026-11-12).** Signing writes an incremental update with a signature field (invisible, or a visible box with name and date), `/SubFilter /ETSI.CAdES.detached`, a 16 KB `/Contents` reservation and a fixed-width `/ByteRange`. The CMS (PKI.js on WebCrypto) carries content-type, message-digest and ESS signing-certificate-v2; no signing-time attribute (PAdES puts the time in `/M`). The app signs with a `.p12/.pfx` file read in the main process by node-forge (legacy 3DES/RC2 files work); the key is imported as non-extractable, used once, and the password is not kept. Verification reports integrity, certificate validity at the claimed time, trust and later changes separately. **Trust:** nothing is trusted by default; the user marks certificates as trusted (stored as DER under app data) after confirming them with the owner. The question is asked by the main process, which reads the certificate's name, expiry and SHA-256 fingerprint itself. Trust is checked at the time of verification, not at the signer's stated `/M` time, which is unproven and could be backdated into an expired certificate's validity; such a signature reads as not trusted, with the reason. A trusted self-signed certificate counts directly while it is valid; other certificates need a chain to a trusted one. Tests: valid, tampered, two successive signatures, trusted/untrusted/expired, OpenSSL `cms -verify` cross-check, legacy `.p12`.
**Not yet:** RFC 3161 timestamps (detected, not verified), LTV data (B-LT/B-LTA), revocation checks (OCSP/CRL), certification signatures (DocMDP) and distinguishing permitted later changes, OS certificate stores and smart cards, ECDSA keys from `.p12` (RSA only).
Goal: PAdES baseline B-B first (the open European standard, ETSI EN 319 142), which also covers the general PDF signature model in ISO 32000-2 §12.8.

### How a signature is stored (public standard)
- An **incremental update** is appended to the file (the original bytes are never rewritten, so earlier signatures stay valid).
- A signature **field** (widget annotation, optionally with a visible appearance) points to a **signature dictionary** `/Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached` containing `/ByteRange [0 a b c]`, `/Contents <hex placeholder>`, `/M` (date), `/Reason`, `/Location`, `/ContactInfo`, `/Name`.
- `/ByteRange` lists the byte ranges of the file that are signed: everything except the hex `/Contents` string itself.
- `/Contents` holds a DER **CMS SignedData** (RFC 5652), detached, over those bytes, including the signing certificate chain and signed attributes (content-type, message-digest, signing-time, **ESS signing-certificate-v2** for CAdES).

### Implementation plan
1. `prepareSignature(pdf, opts)`: append the incremental update with a fixed-size zero `/Contents` placeholder (reserve ~16 KB so a timestamp token still fits), compute the real `/ByteRange` (patch the numbers in place, padded to constant width).
2. Hash the two byte ranges (SHA-256). Pass the data to the injected `Signer` (`sign(data) → CMS DER`); the library does not hold keys. Signers to provide in the app: PKCS#12 file (use a vetted CMS library, e.g. PKI.js (BSD-3) or node-forge (BSD-3/GPL dual, use BSD) ), OS keystore, smart card/PKCS#11, cloud HSM.
3. Write the CMS hex into `/Contents`, verify length fits, save.
4. Visible signature: build the appearance stream (reuse `addVisualSignature` drawing code) and attach it to the widget.

### Verification (`verifySignatures`)
Parse every `/Sig`; recompute digests over `/ByteRange`; verify the CMS signature and the message-digest attribute; validate the certificate chain against a trust store (OS or bundled), check validity period and revocation (OCSP/CRL) when online; report one of: valid, valid-but-unknown-signer, invalid, document-modified-after-signing (bytes exist after the last `/ByteRange` end that are not a permitted update). Show *why* in plain language.

### Later
- RFC 3161 trusted timestamps (B-T), embedding validation data (B-LT, B-LTA).
- Certification signatures with permitted-change levels (DocMDP).
- Never auto-trust self-signed certificates; make the trust decision explicit and visible.

### Tests to write with the implementation
Round-trip: sign then verify valid; flip one byte → invalid; append content after signing → "modified"; two successive signatures both valid; signature survives our own merge/rotate? (No: any edit invalidates earlier signatures except via incremental update; the UI must warn before editing a signed file.)
