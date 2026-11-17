import { useEffect, useRef, useState } from 'react';
import type { InspectionItem, HiddenCategory } from '@docedit/core';

const INFO: Record<HiddenCategory, { title: string; effect: string }> = {
  metadata: { title: 'Document properties and metadata', effect: 'Author, title, dates, producing software and XMP metadata are removed.' },
  attachments: { title: 'Attached files', effect: 'Files embedded in the document are removed.' },
  comments: { title: 'Comments and markup', effect: 'Notes, highlights, drawings and other comments disappear from the pages.' },
  scripts: { title: 'Scripts and actions', effect: 'Scripts, and actions that start programs, send data or open other files, are removed. Buttons or calculations that relied on them stop working.' },
  forms: { title: 'Form fields', effect: 'Fields are flattened: their current values stay visible as page content but can no longer be edited.' },
  private: { title: 'Thumbnails and application data', effect: 'Stored page previews and data private to other programs are removed.' },
  revisions: { title: 'Earlier versions kept in the file', effect: 'Earlier saved versions inside the file are dropped (this happens whenever a sanitized copy is written).' },
  hiddenLayers: { title: 'Hidden layers', effect: 'Content on layers that are switched off. It cannot be removed automatically: removing the layer switch would show it. Redact the affected pages instead.' },
};

interface Props {
  inspect(): Promise<InspectionItem[]>;
  run(remove: HiddenCategory[]): Promise<{ saved: string | null; remaining: InspectionItem[] }>;
  onClose(): void;
}

export function SanitizeDialog({ inspect, run, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<InspectionItem[] | null>(null);
  const [chosen, setChosen] = useState<Set<HiddenCategory>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ saved: string | null; remaining: InspectionItem[] } | null>(null);

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    inspect().then((found) => { setItems(found); setChosen(new Set(found.filter((i) => i.removable).map((i) => i.category))); }, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function go() {
    setBusy(true); setError('');
    try { setDone(await run([...chosen])); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const toggle = (c: HiddenCategory) => setChosen((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  return (
    <dialog ref={ref} className="modal wide" aria-labelledby="san-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <h2 id="san-title">Remove hidden information</h2>
      {!items && !error && <p className="muted">Inspecting the document…</p>}
      {items && !done && (
        <>
          <p className="small">The document as it would be saved now (including your unsaved changes) was inspected. Choose what to remove; the result is saved as a <strong>new copy</strong>.</p>
          {items.length === 0 && <p>No hidden information was found in the inspected categories.</p>}
          <ul className="sanitize-list">
            {items.map((i) => (
              <li key={i.category}>
                <label className={i.removable ? '' : 'disabled'}>
                  <input type="checkbox" disabled={!i.removable || busy} checked={i.removable && chosen.has(i.category)} onChange={() => toggle(i.category)} />
                  <span><strong>{INFO[i.category].title}</strong> <span className="muted">({i.count})</span>
                    <span className="small block">{INFO[i.category].effect}</span>
                    {i.examples.length > 0 && <span className="small muted block">{i.examples.join(' · ')}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="small muted">Not inspected: text hidden by colour or covered by images, content outside the visible page area, and descriptions in the document structure. Use redaction for content you can see on the page.</p>
        </>
      )}
      {done && (
        <>
          {done.saved ? <p>Saved the cleaned copy to <strong>{done.saved}</strong>.</p> : <p className="muted">Not saved.</p>}
          {done.remaining.length > 0 && <p className="small">Still present (not removable or not chosen): {done.remaining.map((i) => INFO[i.category].title).join(', ')}.</p>}
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons">
        <button onClick={onClose} disabled={busy}>{done ? 'Close' : 'Cancel'}</button>
        {items && !done && <button className="primary" disabled={busy || chosen.size === 0} onClick={() => void go()}>{busy ? 'Working…' : 'Remove and save copy…'}</button>}
      </div>
    </dialog>
  );
}
