import { useEffect, useRef, useState } from 'react';
import type { SavedSignature } from '../shared/api.js';
import { bytesToB64 } from './edits.js';
import { useConfirm } from './ConfirmCard.js';

export interface ChosenSignature { image?: { base64: string; format: 'png' | 'jpg' }; typedName?: string; caption?: string }

/**
 * Choose, draw, type or import a visual signature. The result is placed on a page as an image or
 * text; it is labelled as a visual signature because it carries no cryptographic proof.
 */
export function SignatureDialog({ kind = 'signature', onChosen, onClose }: { kind?: 'signature' | 'initials'; onChosen(sig: ChosenSignature): void; onClose(): void }) {
  const initials = kind === 'initials';
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useConfirm();
  const pad = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'saved' | 'draw' | 'type' | 'image'>('draw');
  const [saved, setSaved] = useState<SavedSignature[]>([]);
  const [typed, setTyped] = useState('');
  const [image, setImage] = useState<ChosenSignature['image']>();
  const [caption, setCaption] = useState(!initials);
  const [remember, setRemember] = useState(true);
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState('');
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { void window.docedit.signaturesList().then((all) => { const s = all.filter((x) => (x.kind ?? 'signature') === kind); setSaved(s); if (s.length) setMode('saved'); }, () => {}); }, [kind]);

  function clearPad() {
    const c = pad.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setDrawn(false);
  }
  function pt(e: React.PointerEvent) { const b = pad.current!.getBoundingClientRect(); return { x: (e.clientX - b.left) * (pad.current!.width / b.width), y: (e.clientY - b.top) * (pad.current!.height / b.height) }; }
  function down(e: React.PointerEvent) { (e.target as Element).setPointerCapture(e.pointerId); last.current = pt(e); }
  function move(e: React.PointerEvent) {
    if (!last.current) return;
    const p = pt(e), ctx = pad.current!.getContext('2d')!;
    ctx.strokeStyle = '#0d1a73'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p; setDrawn(true);
  }

  /** The drawn strokes, trimmed to their bounding box, as a transparent PNG. */
  async function padImage(): Promise<ChosenSignature['image']> {
    const c = pad.current!, ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]! > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 <= x0) return undefined;
    const pad2 = 6, w = x1 - x0 + 1 + pad2 * 2, h = y1 - y0 + 1 + pad2 * 2;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    out.getContext('2d')!.drawImage(c, x0 - pad2, y0 - pad2, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode'))), 'image/png'));
    return { base64: bytesToB64(new Uint8Array(await blob.arrayBuffer())), format: 'png' };
  }

  async function importImage() {
    const files = await window.docedit.pickFiles('images');
    if (!files?.[0]) return;
    try { setImage(await window.docedit.readImage(files[0].path)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function choose(sig: Omit<ChosenSignature, 'caption'>) {
    if (remember && mode !== 'saved') await window.docedit.signaturesSave({ name: sig.typedName || (initials ? 'Initials' : 'Signature'), kind, image: sig.image, typedName: sig.typedName }).catch(() => {});
    onChosen({ ...sig, caption: caption ? `Signed ${new Date().toISOString().slice(0, 10)}` : undefined });
  }

  async function ok() {
    setError('');
    if (mode === 'draw') { const img = await padImage(); if (!img) { setError('Draw your signature first.'); return; } await choose({ image: img }); }
    else if (mode === 'type') { if (!typed.trim()) { setError(initials ? 'Type your initials first.' : 'Type your name first.'); return; } await choose({ typedName: typed.trim() }); }
    else if (mode === 'image') { if (!image) { setError('Choose an image first.'); return; } await choose({ image }); }
  }

  return (
    <dialog ref={dialog} className="modal wide" aria-labelledby="sig-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="sig-title">{initials ? 'Initials' : 'Visual signature'}</h2>
      <p className="muted small">A picture of a signature placed on the page. It does not prove who signed or that the document was not changed afterwards.</p>
      <div className="seg" role="tablist">
        {(['saved', 'draw', 'type', 'image'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} disabled={m === 'saved' && !saved.length} onClick={() => setMode(m)}>
            {m === 'saved' ? `Saved (${saved.length})` : m === 'draw' ? 'Draw' : m === 'type' ? 'Type' : 'Image'}
          </button>
        ))}
      </div>
      {mode === 'saved' && (
        <div className="sig-list">
          {saved.map((s) => (
            <div key={s.id} className="sig-item">
              <button className="sig-pick" onClick={() => void choose({ image: s.image, typedName: s.typedName })} aria-label={`Use ${s.name}`}>
                {s.image ? <img src={`data:image/${s.image.format === 'png' ? 'png' : 'jpeg'};base64,${s.image.base64}`} alt="" /> : <span className="sig-typed">{s.typedName}</span>}
              </button>
              <button aria-label={`Delete ${s.name}`} onClick={() => void confirm({ title: 'Delete this saved signature?', message: `“${s.name}” will be removed from this computer. Documents you already signed keep it.`, confirm: { label: 'Delete', danger: true } }).then((ok) => { if (ok) void window.docedit.signaturesDelete(s.id).then(() => setSaved((l) => l.filter((x) => x.id !== s.id))); })}>Delete</button>
            </div>
          ))}
        </div>
      )}
      {mode === 'draw' && (
        <div>
          <canvas ref={pad} width={560} height={180} className="sig-pad" onPointerDown={down} onPointerMove={move} onPointerUp={() => { last.current = null; }} aria-label="Signature drawing area" />
          <div className="row"><button onClick={clearPad} disabled={!drawn}>Clear</button></div>
        </div>
      )}
      {mode === 'type' && <input type="text" className="sig-type" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={initials ? 'Your initials' : 'Your name'} aria-label={initials ? 'Your initials' : 'Your name'} autoFocus />}
      {mode === 'image' && (
        <div className="row">
          <button onClick={() => void importImage()}>Choose image…</button>
          {image && <img className="sig-preview" src={`data:image/${image.format === 'png' ? 'png' : 'jpeg'};base64,${image.base64}`} alt="Chosen signature" />}
        </div>
      )}
      <div className="row">
        {!initials && <label><input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} /> Add “Signed” and today's date underneath</label>}
        {mode !== 'saved' && <label><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep for next time (on this computer)</label>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons">
        <button onClick={onClose}>Cancel</button>
        {mode !== 'saved' && <button className="primary" onClick={() => void ok()}>Place on page…</button>}
      </div>
    </dialog>
  );
}

/** A small reusable text prompt (note text, text box, link target). */
export function TextPrompt({ title, label, initial = '', multiline, hint, password, onOk, onClose }: { title: string; label: string; initial?: string; multiline?: boolean; hint?: string; password?: boolean; onOk(v: string): string | null; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [v, setV] = useState(initial);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const submit = () => { const err = onOk(v); if (err) setError(err); else onClose(); };
  return (
    <dialog ref={dialog} className="modal" aria-labelledby="prompt-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="prompt-title">{title}</h2>
      <label className="stack">{label}
        {multiline
          ? <textarea rows={4} value={v} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }} />
          : <input type={password ? 'password' : 'text'} autoComplete={password ? 'current-password' : undefined} value={v} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />}
      </label>
      {hint && <p className="muted small">{hint}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons"><button onClick={onClose}>Cancel</button><button className="primary" onClick={submit}>OK</button></div>
    </dialog>
  );
}
