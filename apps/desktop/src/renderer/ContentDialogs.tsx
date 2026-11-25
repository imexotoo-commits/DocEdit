import { useEffect, useRef, useState } from 'react';
import type { Corner } from '@docedit/core';
import type { PageItem } from './model.js';
import { toSlots } from './model.js';
import { newId } from './model.js';
import { resolveEdits, type PageScope, type PendingEdit } from './edits.js';
import { loadSource, type LoadedSource } from './pdf.js';
import { PageCanvas } from './PageCanvas.js';
import { parsePageRange } from '@docedit/core/page-range';

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return ref;
}

// ---------------------------------------------------------------- document properties

export interface Meta { title: string; author: string; subject: string; keywords: string }

export function PropertiesDialog({ current, onApply, onClose }: { current: Meta; onApply(m: Meta): void; onClose(): void }) {
  const ref = useModal();
  const [m, setM] = useState<Meta>(current);
  const row = (k: keyof Meta, label: string, hint?: string) => (
    <label className="stack">{label}
      <input type="text" value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} placeholder={hint} />
    </label>
  );
  const changed = (Object.keys(m) as Array<keyof Meta>).filter((k) => m[k] !== current[k]);
  return (
    <dialog ref={ref} className="modal wide" aria-labelledby="props-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="props-title">Document properties</h2>
      <fieldset>
        {row('title', 'Title')}{row('author', 'Author')}{row('subject', 'Subject')}{row('keywords', 'Keywords', 'separated by commas')}
      </fieldset>
      <div className="callout">
        <p><strong>Will be saved:</strong></p>
        {changed.length === 0 ? <p className="muted">No changes.</p> : (
          <table className="kv"><tbody>{changed.map((k) => (
            <tr key={k}><th>{k}</th><td>{m[k] ? `“${m[k]}”` : <em>(removed)</em>}</td></tr>
          ))}</tbody></table>
        )}
        <p className="muted">The modification date is set to the time of saving.</p>
      </div>
      <div className="modal-buttons">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!changed.length} onClick={() => { onApply(m); onClose(); }}>Apply</button>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------- headers, footers, watermark, Bates

const CORNERS: Corner[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const CORNER_LABEL: Record<Corner, string> = { 'top-left': 'Header left', 'top-center': 'Header centre', 'top-right': 'Header right', 'bottom-left': 'Footer left', 'bottom-center': 'Footer centre', 'bottom-right': 'Footer right' };

interface FurnitureProps {
  pages: PageItem[];
  sources: Uint8Array[];
  selection: Set<string>;
  onApply(edits: PendingEdit[]): void;
  onClose(): void;
}

export function FurnitureDialog({ pages, sources, selection, onApply, onClose }: FurnitureProps) {
  const ref = useModal();
  const [scopeKind, setScopeKind] = useState<'all' | 'selected' | 'range'>('all');
  const [range, setRange] = useState('');
  const [wmText, setWmText] = useState('');
  const [wmOpacity, setWmOpacity] = useState(25);
  const [wmAngle, setWmAngle] = useState(45);
  const [texts, setTexts] = useState<Record<Corner, string>>({ 'top-left': '', 'top-center': '', 'top-right': '', 'bottom-left': '', 'bottom-center': 'Page {page} of {total}', 'bottom-right': '' });
  const [size, setSize] = useState(10);
  const [margin, setMargin] = useState(28);
  const [startPage, setStartPage] = useState(1);
  const [bates, setBates] = useState({ prefix: '', start: 1, digits: 6, suffix: '' });
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ src: LoadedSource; count: number } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const usesBates = Object.values(texts).some((t) => t.includes('{bates}'));

  function scope(): PageScope {
    if (scopeKind === 'all') return 'all';
    if (scopeKind === 'selected') return pages.filter((p) => selection.has(p.id)).map((p) => p.id);
    return parsePageRange(range, pages.length, { unique: true }).map((i) => pages[i]!.id);
  }

  function build(): PendingEdit[] {
    const s = scope();
    if (Array.isArray(s) && !s.length) throw new Error('No pages chosen.');
    const out: PendingEdit[] = [];
    if (wmText.trim()) out.push({ id: newId(), type: 'watermark', pages: s, text: wmText.trim(), opacity: wmOpacity / 100, angle: wmAngle });
    const items = CORNERS.filter((c) => texts[c].trim()).map((c) => ({ position: c, text: texts[c].trim() }));
    if (items.length) out.push({ id: newId(), type: 'furniture', pages: s, items, size, margin, startPage, bates: usesBates ? bates : undefined });
    return out;
  }

  // live preview: the first pages of the document with these settings, produced by the real code
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const edits = build();
        const n = Math.min(4, pages.length);
        const first = pages.slice(0, n);
        const total = String(pages.length);
        // the preview has only n pages: write the real total into the text
        const fixed = edits.map((e) => (e.type === 'furniture' ? { ...e, items: e.items.map((it) => ({ ...it, text: it.text.replaceAll('{total}', total) })) } : e));
        const res = await window.docedit.previewEdits({ sources, slots: toSlots(first), edits: resolveEdits(first, fixed, null) });
        if (!live) return;
        if (!res.ok) { setPreviewError(res.message); return; }
        const src = await loadSource(res.bytes, 'preview');
        if (!live) { void src.doc.loadingTask.destroy(); return; }
        setPreview((old) => { void old?.src.doc.loadingTask.destroy(); return { src, count: n }; });
        setPreviewError('');
      } catch (e) { if (live) setPreviewError(e instanceof Error ? e.message : String(e)); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [wmText, wmOpacity, wmAngle, texts, size, margin, startPage, bates, scopeKind, range]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { void preview?.src.doc.loadingTask.destroy(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function apply() {
    try {
      const edits = build();
      if (!edits.length) { setError('Enter a watermark or at least one header or footer.'); return; }
      onApply(edits);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <dialog ref={ref} className="modal xwide" aria-labelledby="furn-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="furn-title">Headers, footers and watermark</h2>
      <div className="split-pane">
        <div>
          <fieldset>
            <legend>Apply to</legend>
            <label><input type="radio" checked={scopeKind === 'all'} onChange={() => setScopeKind('all')} /> All pages</label>
            <label><input type="radio" checked={scopeKind === 'selected'} onChange={() => setScopeKind('selected')} /> Selected pages ({selection.size})</label>
            <label className="inline"><input type="radio" checked={scopeKind === 'range'} onChange={() => setScopeKind('range')} /> Pages
              <input type="text" value={range} placeholder="e.g. 2-" onFocus={() => setScopeKind('range')} onChange={(e) => setRange(e.target.value)} /></label>
          </fieldset>
          <fieldset>
            <legend>Headers and footers</legend>
            <p className="muted small">Use {'{page}'}, {'{total}'}, {'{date}'} and {'{bates}'} in the text.</p>
            <div className="grid3">
              {CORNERS.map((c) => (
                <label key={c} className="stack small">{CORNER_LABEL[c]}
                  <input type="text" value={texts[c]} onChange={(e) => setTexts({ ...texts, [c]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="row">
              <label>Size <input type="number" min={6} max={36} value={size} onChange={(e) => setSize(Number(e.target.value) || 10)} /></label>
              <label>Margin (pt) <input type="number" min={6} max={144} value={margin} onChange={(e) => setMargin(Number(e.target.value) || 28)} /></label>
              <label>First page number <input type="number" value={startPage} onChange={(e) => setStartPage(parseInt(e.target.value, 10) || 1)} /></label>
            </div>
          </fieldset>
          {usesBates && (
            <fieldset>
              <legend>Bates numbering</legend>
              <div className="row">
                <label>Prefix <input type="text" value={bates.prefix} onChange={(e) => setBates({ ...bates, prefix: e.target.value })} style={{ width: 90 }} /></label>
                <label>Start <input type="number" min={0} value={bates.start} onChange={(e) => setBates({ ...bates, start: parseInt(e.target.value, 10) || 0 })} /></label>
                <label>Digits <input type="number" min={1} max={12} value={bates.digits} onChange={(e) => setBates({ ...bates, digits: Math.min(12, Math.max(1, parseInt(e.target.value, 10) || 6)) })} /></label>
                <label>Suffix <input type="text" value={bates.suffix} onChange={(e) => setBates({ ...bates, suffix: e.target.value })} style={{ width: 70 }} /></label>
              </div>
              <p className="muted small">Numbers count up over the chosen pages in document order.</p>
            </fieldset>
          )}
          <fieldset>
            <legend>Watermark</legend>
            <label className="stack">Text <input type="text" value={wmText} placeholder="e.g. DRAFT" onChange={(e) => setWmText(e.target.value)} /></label>
            <div className="row">
              <label>Opacity <input type="range" min={5} max={100} value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} /> {wmOpacity}%</label>
              <label>Angle <input type="number" min={-90} max={90} value={wmAngle} onChange={(e) => setWmAngle(Number(e.target.value))} />°</label>
            </div>
          </fieldset>
        </div>
        <div className="preview-pane" aria-label="Preview">
          <div className="muted small">Preview of the first pages</div>
          {previewError && <p className="form-error">{previewError}</p>}
          <div className="preview-grid">
            {preview && Array.from({ length: preview.count }, (_, i) => {
              const g = preview.src.pages[i]!;
              const scale = 150 / Math.max(g.width, g.height);
              return <PageCanvas key={`${i}-${preview.src.doc.fingerprints[0]}`} doc={preview.src.doc} pageIndex={i} rotation={g.rotate} scale={scale} width={Math.round(g.width * scale)} height={Math.round(g.height * scale)} />;
            })}
          </div>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={apply}>Apply</button>
      </div>
    </dialog>
  );
}
