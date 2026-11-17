import { useEffect, useRef, useState } from 'react';
import type { ExportKind } from './export/run.js';

const KINDS: Array<[ExportKind, string, string]> = [
  ['docx', 'Word document (.docx)', 'Editable text. Paragraphs and headings are rebuilt from the page; columns, tables and exact layout are approximated. Pages without text (scans) are included as pictures.'],
  ['txt', 'Plain text (.txt)', 'Just the text, page by page.'],
  ['png', 'Images, PNG', 'One picture per page. Sharp, larger files.'],
  ['jpg', 'Images, JPEG', 'One picture per page. Smaller files, good for scans and photos.'],
];

/** Export the document to another format. The PDF itself is not changed. */
export function ExportDialog({ protectedDoc, run, onClose }: { protectedDoc: boolean; run(kind: ExportKind, dpi: number, onStep: (s: string) => void): Promise<string | null>; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<ExportKind>('docx');
  const [dpi, setDpi] = useState(150);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  async function go() {
    setError('');
    try { const done = await run(kind, dpi, setStep); if (done) onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setStep(null); }
  }
  return (
    <dialog ref={ref} className="modal wide" aria-labelledby="export-title" onCancel={(e) => { e.preventDefault(); if (!step) onClose(); }}>
      <h2 id="export-title">Export</h2>
      <p className="small muted">Save the document in another format. Pending changes are included; the PDF itself stays as it is.</p>
      <div className="choice-list" role="radiogroup">
        {KINDS.map(([k, label, note]) => (
          <label key={k} className={kind === k ? 'on' : ''}>
            <input type="radio" name="export-kind" checked={kind === k} disabled={!!step} onChange={() => setKind(k)} />
            <span><strong>{label}</strong><span className="small muted block">{note}</span></span>
          </label>
        ))}
      </div>
      {(kind === 'png' || kind === 'jpg') && (
        <div className="row"><label>Resolution <select value={dpi} disabled={!!step} onChange={(e) => setDpi(Number(e.target.value))}>
          <option value={96}>Screen (96 dpi)</option><option value={150}>Standard (150 dpi)</option><option value={300}>Print (300 dpi)</option>
        </select></label></div>
      )}
      {protectedDoc && <p className="setting-warning">This document is password-protected. The exported {kind === 'docx' ? 'Word file' : kind === 'txt' ? 'text' : 'images'} will not be.</p>}
      {step && <p className="muted" aria-live="polite">{step}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons">
        <button onClick={onClose} disabled={!!step}>Cancel</button>
        <button className="primary" disabled={!!step} onClick={() => void go()}>Export…</button>
      </div>
    </dialog>
  );
}
