import { useEffect, useRef, useState } from 'react';
import type { RedactionCheck } from './redaction.js';

interface Props {
  /** apply to the open document instead of saving a copy (Settings) */
  inPlace?: boolean;
  markCount: number;
  pageCount: number;
  run(dpi: number, onStep: (s: string) => void): Promise<{ checks: RedactionCheck[]; saved: string | null; applied?: boolean; cancelled: boolean }>;
  onOpenResult(path: string): void;
  onClose(): void;
}

/** Apply pending redaction marks to a new copy, then show the verification results. */
export function RedactDialog({ inPlace, markCount, pageCount, run, onOpenResult, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [dpi, setDpi] = useState(200);
  const [step, setStep] = useState<string | null>(null);
  const [result, setResult] = useState<{ checks: RedactionCheck[]; saved: string | null; applied?: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);

  async function go() {
    setError(''); setResult(null);
    try {
      const r = await run(dpi, setStep);
      if (!r.cancelled) setResult(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setStep(null); }
  }

  const failed = result && result.checks.some((c) => !c.ok);
  // only the text check failed: the words were removed where marked but also appear somewhere without a mark
  const elsewhere = failed && result.checks.filter((c) => !c.ok).every((c) => c.label === 'Redacted text cannot be extracted' || c.label === 'Redacted text is not in the file bytes');
  return (
    <dialog ref={ref} className="modal wide" aria-labelledby="redact-title" onCancel={(e) => { e.preventDefault(); if (!step) onClose(); }}>
      <h2 id="redact-title">Apply redactions</h2>
      {!result && (
        <>
          {inPlace
            ? <p>{markCount} mark{markCount === 1 ? '' : 's'} on {pageCount} page{pageCount === 1 ? '' : 's'} will be permanently removed <strong>in this document</strong>. This can’t be undone; the file on disk changes only when you save.</p>
            : <p>{markCount} mark{markCount === 1 ? '' : 's'} on {pageCount} page{pageCount === 1 ? '' : 's'} will be permanently removed in a <strong>new copy</strong>. This document stays as it is.</p>}
          <div className="callout small">
            <p>On each page with a mark, the whole page is replaced by a picture with the marked areas blacked out. On those pages:</p>
            <ul>
              <li>text can no longer be selected, searched or read aloud;</li>
              <li>comments, links and form fields are removed.</li>
            </ul>
            <p>{inPlace ? 'The result' : 'The copy'} also leaves out bookmarks and document properties. Pages without marks are kept as they are.</p>
          </div>
          <label>Picture quality <select value={dpi} disabled={!!step} onChange={(e) => setDpi(Number(e.target.value))}>
            <option value={150}>Standard (150 dpi)</option><option value={200}>High (200 dpi)</option><option value={300}>Very high (300 dpi, larger file)</option>
          </select></label>
        </>
      )}
      {step && <p className="muted" aria-live="polite">{step}</p>}
      {result && (
        <>
          <ul className="checks" aria-label="Verification">
            {result.checks.map((c) => (
              <li key={c.label} className={c.ok ? 'ok' : 'bad'}><span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> {c.label}{c.detail ? <span className="muted small"> — {c.detail}</span> : null}</li>
            ))}
          </ul>
          {failed
            ? elsewhere
              ? <p className="form-error">Nothing was changed: the marked text also appears in places without a redaction mark. Mark those too (Search, then “Mark all for redaction”) and apply again.</p>
              : <p className="form-error">Verification failed, so nothing was changed. Please report this document; you can try a higher picture quality or larger marks.</p>
            : result.applied ? <p>Applied to this document. <strong>Save</strong> to keep it; until then the file on disk still has the removed content.</p>
            : result.saved ? <p>Saved the redacted copy to <strong>{result.saved}</strong>.</p> : <p className="muted">Verified, but not saved (cancelled).</p>}
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons">
        {result?.saved && !failed && <button onClick={() => onOpenResult(result.saved!)}>Open redacted copy</button>}
        <button onClick={onClose} disabled={!!step}>{result ? 'Close' : 'Cancel'}</button>
        {!result && <button className="primary danger-fill" disabled={!!step} onClick={() => void go()}>{inPlace ? 'Redact' : 'Redact and save copy…'}</button>}
      </div>
    </dialog>
  );
}
