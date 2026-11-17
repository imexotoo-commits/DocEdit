import { useEffect, useRef, useState } from 'react';
import { parsePageRange } from '@docedit/core/page-range';
import type { Margins } from './cropMath.js';

const UNITS = { mm: 72 / 25.4, in: 72, pt: 1 } as const;
type Unit = keyof typeof UNITS;

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return ref;
}

export function CropDialog({ count, onApply, onRemove, onClose }: {
  count: number;
  /** margins in points as seen on screen */
  onApply(m: Margins): string | null;
  onRemove(): void;
  onClose(): void;
}) {
  const ref = useModal();
  const [unit, setUnit] = useState<Unit>('mm');
  const [v, setV] = useState({ top: '10', right: '10', bottom: '10', left: '10' });
  const [error, setError] = useState('');
  const field = (k: keyof typeof v, label: string) => (
    <label>{label} <input type="number" min={0} step="any" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
  );
  function apply() {
    const pt = (s: string) => Number(s) * UNITS[unit];
    const m = { top: pt(v.top), right: pt(v.right), bottom: pt(v.bottom), left: pt(v.left) };
    if (Object.values(m).some((x) => !(x >= 0))) { setError('Margins must be zero or more.'); return; }
    const err = onApply(m);
    if (err) setError(err); else onClose();
  }
  return (
    <dialog ref={ref} className="modal" aria-labelledby="crop-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="crop-title">Crop {count} page{count === 1 ? '' : 's'}</h2>
      <p className="muted">Hides the page edges by changing the visible area, measured from the edges as you see them. The hidden content stays in the file; to remove content, use redaction.</p>
      <fieldset className="grid2">
        {field('top', 'Top')}{field('bottom', 'Bottom')}{field('left', 'Left')}{field('right', 'Right')}
        <label>Unit <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}><option value="mm">millimetres</option><option value="in">inches</option><option value="pt">points</option></select></label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons">
        <button onClick={() => { onRemove(); onClose(); }}>Remove crop</button>
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={apply}>Crop</button>
      </div>
    </dialog>
  );
}

/** Returns the page groups (0-based indices into the current page list). */
export function SplitDialog({ pageCount, onSplit, onClose }: { pageCount: number; onSplit(groups: number[][]): void; onClose(): void }) {
  const ref = useModal();
  const [mode, setMode] = useState<'every' | 'ranges'>('every');
  const [every, setEvery] = useState('1');
  const [ranges, setRanges] = useState('');
  const [error, setError] = useState('');

  function groups(): number[][] {
    if (mode === 'every') {
      const n = parseInt(every, 10);
      if (!(n >= 1)) throw new Error('Enter a number of pages of 1 or more.');
      return Array.from({ length: Math.ceil(pageCount / n) }, (_, i) => Array.from({ length: Math.min(n, pageCount - i * n) }, (_, k) => i * n + k));
    }
    const parts = ranges.split(';').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Enter at least one range, for example 1-3; 4-10.');
    return parts.map((p) => parsePageRange(p, pageCount));
  }
  let preview = '';
  try { const g = groups(); preview = `${g.length} file${g.length === 1 ? '' : 's'}: ${g.slice(0, 6).map((x) => x.length).join(', ')}${g.length > 6 ? ', …' : ''} pages`; } catch { /* shown on submit */ }

  return (
    <dialog ref={ref} className="modal" aria-labelledby="split-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="split-title">Split into separate files</h2>
      <fieldset>
        <label><input type="radio" checked={mode === 'every'} onChange={() => setMode('every')} /> Every <input type="number" min={1} value={every} onFocus={() => setMode('every')} onChange={(e) => setEvery(e.target.value)} style={{ width: 70 }} /> pages</label>
        <label className="inline"><input type="radio" checked={mode === 'ranges'} onChange={() => setMode('ranges')} /> Ranges
          <input type="text" value={ranges} placeholder="1-3; 4-10; 11-" onFocus={() => setMode('ranges')} onChange={(e) => setRanges(e.target.value)} aria-label="Ranges, one file per range, separated by semicolons" />
        </label>
      </fieldset>
      <p className="muted">{preview || ' '}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => { try { onSplit(groups()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>Choose folder…</button>
      </div>
    </dialog>
  );
}
