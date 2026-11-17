import { useEffect, useRef, useState } from 'react';
import type { OpenedFile, ScanDevice } from '../shared/api.js';
import { useConfirm } from './ConfirmCard.js';

interface Page { path: string; url: string; width: number; height: number }

/** Scan pages with a scanner or multifunction printer (Windows scanning, WIA) and make a PDF of them. */
export function ScanDialog({ onCreated, onClose }: { onCreated(file: OpenedFile): void; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirm = useConfirm();
  const [devices, setDevices] = useState<ScanDevice[] | null>(null);
  const [device, setDevice] = useState('');
  const [mode, setMode] = useState<'color' | 'gray' | 'bw'>('color');
  const [dpi, setDpi] = useState(200);
  const [feeder, setFeeder] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);

  async function refresh() {
    setDevices(null); setError('');
    const res = await window.docedit.scanDevices();
    if (!res.ok) { setDevices([]); setError(res.message); return; }
    setDevices(res.devices);
    setDevice((d) => (res.devices.some((x) => x.id === d) ? d : res.devices[0]?.id ?? ''));
  }
  useEffect(() => { void refresh(); }, []);

  async function scanNow() {
    setError(''); setBusy('Scanning… (the scanner may show its own progress window)');
    try {
      const res = await window.docedit.scan({ deviceId: device, dpi, mode, feeder });
      let files: string[];
      if (res.ok) files = res.files;
      else {
        setError(res.message);
        // the scanner stopped part-way: the pages before the problem are offered, never added silently
        if (!res.partial?.length || !(await confirm({ title: 'Keep the pages scanned before the problem?', message: `${res.message}

You can keep the ${res.partial.length} page${res.partial.length === 1 ? '' : 's'} scanned so far and scan the rest afterwards.`, kind: 'warning', confirm: { label: 'Keep them' }, cancel: 'Discard' }))) return;
        files = res.partial;
      }
      const added: Page[] = [];
      for (const path of files) {
        const img = await window.docedit.readImage(path);
        const url = `data:image/png;base64,${img.base64}`;
        const size = await new Promise<{ w: number; h: number }>((ok) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok({ w: 0, h: 0 }); i.src = url; });
        if (size.w) added.push({ path, url, width: size.w, height: size.h });
      }
      setPages((p) => [...p, ...added]);
    } finally { setBusy(null); }
  }

  async function create() {
    if (!pages.length) return;
    setBusy('Making the PDF…'); setError('');
    try {
      // the page size follows the scan: pixels at the chosen resolution, so A4 stays A4
      const first = pages[0]!;
      const res = await window.docedit.createDocument({ kind: 'images', paths: pages.map((p) => p.path), options: { pageSize: [first.width * 72 / dpi, first.height * 72 / dpi], margin: 0, fit: 'contain', orientation: 'auto' } });
      if (!res.ok) { setError(res.message); return; }
      await window.docedit.scanClear();
      onCreated(res.file);
    } finally { setBusy(null); }
  }

  async function close() {
    if (pages.length && !(await confirm({ title: 'Discard the scanned pages?', message: `${pages.length} scanned page${pages.length === 1 ? '' : 's'} will be thrown away.`, confirm: { label: 'Discard', danger: true } }))) return;
    void window.docedit.scanClear();
    onClose();
  }

  return (
    <dialog ref={ref} className="modal xwide" aria-labelledby="scan-title" onCancel={(e) => { e.preventDefault(); if (!busy) void close(); }}>
      <h2 id="scan-title">Scan to PDF</h2>
      <div className="split-pane">
        <div>
          {devices === null ? <p className="muted">Looking for scanners…</p> : devices.length === 0 ? (
            <div className="callout"><p><strong>No scanner found.</strong></p><p>Switch the scanner or printer on, make sure Windows can see it (Settings › Bluetooth &amp; devices › Printers &amp; scanners), then refresh.</p></div>
          ) : (
            <label className="stack">Scanner <select value={device} disabled={!!busy} onChange={(e) => setDevice(e.target.value)}>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          )}
          <div className="row"><button onClick={() => void refresh()} disabled={!!busy}>Refresh list</button></div>
          <fieldset className="grid2">
            <label className="stack">Colour <select value={mode} disabled={!!busy} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="color">Colour</option><option value="gray">Greyscale</option><option value="bw">Black and white</option></select></label>
            <label className="stack">Resolution <select value={dpi} disabled={!!busy} onChange={(e) => setDpi(Number(e.target.value))}><option value={150}>150 dpi</option><option value={200}>200 dpi</option><option value={300}>300 dpi</option><option value={600}>600 dpi</option></select></label>
          </fieldset>
          <label><input type="checkbox" checked={feeder} disabled={!!busy} onChange={(e) => setFeeder(e.target.checked)} /> Use the document feeder (scans every page in it)</label>
          <div className="row"><button className="primary" disabled={!!busy || !device} onClick={() => void scanNow()}>{pages.length ? 'Scan more' : 'Scan'}</button></div>
          {busy && <p className="muted" aria-live="polite">{busy}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="preview-pane">
          <strong>{pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'}` : 'Scanned pages appear here'}</strong>
          <div className="preview-grid">
            {pages.map((p, i) => (
              <figure key={p.path} className="scan-page">
                <img src={p.url} alt={`Scanned page ${i + 1}`} />
                <figcaption>{i + 1} <button aria-label={`Remove page ${i + 1}`} disabled={!!busy} onClick={() => setPages((l) => l.filter((x) => x !== p))}>Remove</button></figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
      <div className="modal-buttons">
        <button onClick={() => void close()} disabled={!!busy}>Cancel</button>
        <button className="primary" disabled={!!busy || !pages.length} onClick={() => void create()}>Create PDF</button>
      </div>
    </dialog>
  );
}
