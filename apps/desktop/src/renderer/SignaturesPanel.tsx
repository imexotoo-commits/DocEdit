import type { SignatureReport } from '@docedit/core';

/**
 * The document-level verdict: it needs integrity AND established coverage; trust is only added on top
 * of a valid status, so an unconfirmed or invalid signature can never read as "trusted".
 */
export function signatureHeadline(r: Pick<SignatureReport, 'status' | 'trusted'>): ['ok' | 'warn' | 'bad', string] {
  if (r.status === 'invalid') return ['bad', 'Signature is not valid'];
  if (r.status === 'indeterminate') return ['warn', 'Signature cannot be confirmed for this document'];
  return r.trusted ? ['ok', 'Valid signature from a trusted signer'] : ['warn', 'Valid signature, signer not trusted'];
}

/** Verification results, one card per signature, with integrity, trust and later changes shown separately. */
export function SignaturesPanel({ reports, dirty, onTrust, onUntrust }: {
  reports: SignatureReport[] | null; dirty: boolean;
  onTrust(r: SignatureReport): void; onUntrust(r: SignatureReport): void;
}) {
  if (!reports) return <div className="panel-empty">Checking signatures…</div>;
  if (!reports.length) return <div className="panel-empty">This document has no certificate signatures.</div>;
  return (
    <div className="sig-panel">
      {dirty && <p className="callout small">These results are for the file as it was opened. Saving your changes will invalidate the signatures.</p>}
      {reports.map((r, i) => {
        const headline = signatureHeadline(r);
        return (
          <section key={i} className={`sig-card ${headline[0]}`} aria-label={`Signature ${i + 1}`}>
            <h3>{headline[1]}</h3>
            <dl>
              <dt>Signed by</dt><dd>{r.signerName || 'unknown'}{r.certificate && !r.certificate.selfSigned ? <span className="muted"> · issued by {r.certificate.issuer}</span> : r.certificate ? <span className="muted"> · self-signed</span> : null}</dd>
              {r.claimedTime && <><dt>Signing time</dt><dd>{r.claimedTime.toLocaleString()} <span className="muted small">(as stated by the signer{r.timestamp === 'present-not-verified' ? '; a timestamp is attached but not checked yet' : ''})</span></dd></>}
              {r.reason && <><dt>Reason</dt><dd>{r.reason}</dd></>}
              {r.location && <><dt>Location</dt><dd>{r.location}</dd></>}
              <dt>Document integrity</dt><dd>{r.integrity === 'valid' ? '✓ The signed content has not been changed.' : `✗ ${r.integrityDetail ?? 'The signed content was changed or the signature is damaged.'}`}</dd>
              <dt>What was signed</dt><dd>{r.coverage === 'whole-file' ? '✓ The whole document as it is now.' : r.coverage === 'earlier-revision' ? '✓ A complete earlier version of the document.' : `⚠ ${r.coverageDetail ?? 'Not established.'}`}</dd>
              <dt>Later changes</dt><dd>{r.changedAfterSigning ? '⚠ The file was changed after this signature (for example, another signature or edits were added). The signature still covers the earlier version.' : '✓ No changes after signing.'}</dd>
              <dt>Certificate</dt><dd>{r.certificate ? `${r.certificateValidAtSigning ? '✓ Valid' : '✗ Not valid'} at the signing time (valid ${r.certificate.notBefore.toLocaleDateString()} – ${r.certificate.notAfter.toLocaleDateString()}).` : 'No certificate found.'}</dd>
              <dt>Trust</dt><dd>{r.trusted ? '✓ You have marked this signer (or its issuer) as trusted.' : r.trustDetail ? `Not trusted: ${r.trustDetail}` : 'Not trusted: Oakqueill trusts only certificates you have chosen to trust. Check the certificate with its owner before trusting it.'}</dd>
            </dl>
            {r.certificate && r.status === 'valid' && (
              r.trusted
                ? <button onClick={() => onUntrust(r)}>Stop trusting this certificate</button>
                : <button onClick={() => onTrust(r)}>Trust this certificate…</button>
            )}
          </section>
        );
      })}
    </div>
  );
}
