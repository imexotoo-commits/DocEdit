import { useEffect, useRef, useState } from 'react';
import { parsePageRange } from '@docedit/core/page-range';
import type { PrintRequest } from '../shared/api.js';
import type { PageItem } from './model.js';
import type { LoadedSource } from './pdf.js';
import { clipFor, itemSize, placement } from './Viewer.js';

interface Props {
  title: string;
  pages: PageItem[];
  loaded: LoadedSource[];
  current: number;
  selection: Set<string>;
  onClose(message?: { kind: 'error' | 'info'; text: string }): void;
}

const DPI = 150;
const MAX_PIXELS = 24_000_000;

type Which = 'all' | 'current' | 'selected' | 'range';

export function PrintDialog({ title, pages, loaded, current, selection, onClose }: Props) {
  const [which, setWhich] = useState<Which>('all');
  const [range, setRange] = useState('');
  const [fit, setFit] = useState(true);
  const [orientation, setOrientation] = useState<PrintRequest['orientation']>('auto');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const cancelled = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);

  function chosen(): number[] {
    if (which === 'all') return pages.map((_, i) => i);
    if (which === 'current') return [current];
    if (which === 'selected') return pages.flatMap((p, i) => (selection.has(p.id) ? [i] : []));
    return parsePageRange(range, pages.length);
  }

  async function print() {
    let indices: number[];
    try { indices = chosen(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    if (indices.length === 0) { setError('No pages to print.'); return; }
    cancelled.current = false;
    setError('');
    const out: PrintRequest['pages'] = [];
    try {
      for (const [n, i] of indices.entries()) {
        if (cancelled.current) { onClose(); return; }
        setProgress([n, indices.length]);
        out.push(await renderForPrint(pages[i]!, loaded));
      }
      setProgress([indices.length, indices.length]);
      const res = await window.docedit.printPages({ title, pages: out, fit, orientation });
      if (res.ok) onClose({ kind: 'info', text: `Sent ${indices.length} page${indices.length === 1 ? '' : 's'} to the printer.` });
      else if ('cancelled' in res && res.cancelled) onClose();
      else onClose({ kind: 'error', text: `Printing failed: ${res.message}` });
    } catch (e) {
      onClose({ kind: 'error', text: `Printing failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const busy = progress !== null;
  return (
    <dialog ref={dialog} className="modal" onCancel={(e) => { e.preventDefault(); if (busy) cancelled.current = true; else onClose(); }} aria-labelledby="print-title">
      <h2 id="print-title">Print</h2>
      <fieldset disabled={busy}>
        <legend>Pages</legend>
        <label><input type="radio" checked={which === 'all'} onChange={() => setWhich('all')} /> All ({pages.length})</label>
        <label><input type="radio" checked={which === 'current'} onChange={() => setWhich('current')} /> Current page ({current + 1})</label>
        <label><input type="radio" checked={which === 'selected'} onChange={() => setWhich('selected')} /> Selected in the page list ({selection.size})</label>
        <label className="inline">
          <input type="radio" checked={which === 'range'} onChange={() => setWhich('range')} /> Pages
          <input type="text" value={range} placeholder="e.g. 1-3, 7" aria-label="Page range"
            onFocus={() => setWhich('range')} onChange={(e) => setRange(e.target.value)} />
        </label>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Size</legend>
        <label><input type="radio" checked={fit} onChange={() => setFit(true)} /> Fit to paper</label>
        <label><input type="radio" checked={!fit} onChange={() => setFit(false)} /> Actual size</label>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Orientation</legend>
        <label><input type="radio" checked={orientation === 'auto'} onChange={() => setOrientation('auto')} /> Match each page</label>
        <label><input type="radio" checked={orientation === 'portrait'} onChange={() => setOrientation('portrait')} /> Portrait</label>
        <label><input type="radio" checked={orientation === 'landscape'} onChange={() => setOrientation('landscape')} /> Landscape</label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {busy && <p className="muted" aria-live="polite">Preparing page {Math.min(progress[0] + 1, progress[1])} of {progress[1]}…</p>}
      <div className="modal-buttons">
        <button onClick={() => (busy ? (cancelled.current = true) : onClose())}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => void print()}>Print…</button>
      </div>
    </dialog>
  );
}

/** Draw one page at print resolution and return it as PNG bytes with its size in points. */
async function renderForPrint(item: PageItem, loaded: LoadedSource[]): Promise<PrintRequest['pages'][number]> {
  const size = itemSize(item, loaded);
  let scale = DPI / 72;
  if (size.width * size.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (size.width * size.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size.width * scale));
  canvas.height = Math.max(1, Math.round(size.height * scale));
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (item.kind === 'page') {
    const src = loaded[item.source]!;
    const page = await src.doc.getPage(item.page + 1);
    const viewport = page.getViewport({ scale, rotation: placement(item, loaded).rotation });
    // a cropped page: shift so only the visible window lands on the canvas
    const clip = clipFor(item, loaded, scale);
    await page.render({ canvas: null, canvasContext: ctx, viewport, intent: 'print', transform: clip ? [1, 0, 0, 1, -clip.x, -clip.y] : undefined }).promise;
  }
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode page image'))), 'image/png'));
  canvas.width = 0; canvas.height = 0;
  return { png: new Uint8Array(await blob.arrayBuffer()), widthPt: size.width, heightPt: size.height };
}
