import { useEffect, useRef, useState } from 'react';
import type { OpenedFile } from '../shared/api.js';
import { loadSource } from './pdf.js';

type Listed = { id: string; name: string; folder: string; modified: number; size: number };

/** First page of a PDF as a small picture, made in this window with pdf.js. */
function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const file = await window.docedit.remarkableOpen(id);
        const src = await loadSource(file.bytes, file.name);
        const page = await src.doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 96 / Math.max(base.width, base.height) * 1.5 });
        const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext('2d', { alpha: false })!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        void src.doc.destroy();
        if (!cancelled) setUrl(c.toDataURL('image/png'));
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [id]);
  return <div className="rm-thumb">{url ? <img src={url} alt="" /> : <span className="muted small">{failed ? 'No preview' : '…'}</span>}</div>;
}

/** PDFs exported from reMarkable into the folder chosen in Settings, newest first. */
export function RemarkableDialog({ folder, onOpen, onChooseFolder, onClose }: { folder: string | null; onOpen(file: OpenedFile): void; onChooseFolder(): Promise<void>; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<Listed[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  async function load() {
    setFiles(null); setError('');
    if (!folder) { setFiles([]); return; }
    const res = await window.docedit.remarkableList();
    if (res.ok) setFiles(res.files); else { setFiles([]); setError(res.message); }
  }
  useEffect(() => { void load(); }, [folder]);
  async function open(f: Listed) {
    try { onOpen(await window.docedit.remarkableOpen(f.id)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  const shown = (files ?? []).filter((f) => !filter || f.name.toLowerCase().includes(filter.toLowerCase()));
  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <dialog ref={ref} className="modal xwide" aria-labelledby="rm-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="rm-title">From reMarkable</h2>
      {!folder ? (
        <div className="callout">
          <p><strong>Choose the folder you save reMarkable exports to.</strong></p>
          <p>In the reMarkable app, open a notebook or document, choose <em>Share</em> or <em>Export</em>, then <em>PDF</em>, and save it into one folder (for example <em>Documents\reMarkable</em>). If you use reMarkable’s OneDrive, Google Drive or Dropbox integration, choose the synced folder on this computer; new exports then show up here by themselves.</p>
          <div className="row"><button className="primary" onClick={() => void onChooseFolder()}>Choose folder…</button></div>
        </div>
      ) : (
        <>
          <div className="rm-bar">
            <span className="small muted rm-folder" title={folder}>{folder}</span>
            <input type="search" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by name" />
            <button onClick={() => void load()}>Refresh</button>
            <button onClick={() => void onChooseFolder()}>Change folder…</button>
          </div>
          {files === null ? <p className="muted">Reading the folder…</p>
            : !shown.length ? <p className="muted">{filter ? 'No PDF matches that name.' : 'No PDFs in this folder yet. Export from reMarkable into it, then refresh.'}</p>
            : (
              <ul className="rm-list">
                {shown.map((f, i) => (
                  <li key={f.id}>
                    <button className="rm-item" onClick={() => void open(f)} title={f.folder ? `${f.folder}\${f.name}` : f.name}>
                      {i < 24 ? <Thumb id={f.id} /> : <div className="rm-thumb" />}
                      <span className="rm-name">{f.name.replace(/\.pdf$/i, '')}</span>
                      <span className="small muted">{when(f.modified)}{f.folder ? ` · ${f.folder}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons"><button onClick={onClose}>Close</button></div>
    </dialog>
  );
}
