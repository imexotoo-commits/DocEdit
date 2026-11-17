import { useEffect, useRef, useState } from 'react';
import type { CreateRequest, OpenedFile, PickedFile } from '../shared/api.js';

export type NewKind = 'blank' | 'images' | 'text' | 'office';

const SIZES: Record<string, [number, number]> = {
  Letter: [612, 792], Legal: [612, 1008], A4: [595.28, 841.89], A5: [419.53, 595.28],
};

interface Props {
  kind: NewKind;
  onCreated(file: OpenedFile, note?: string): void;
  onClose(): void;
}

export function NewDocumentDialog({ kind: initialKind, onCreated, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<NewKind>(initialKind);
  const [paper, setPaper] = useState('Letter');
  const [landscape, setLandscape] = useState(false);
  const [count, setCount] = useState(1);
  const [images, setImages] = useState<PickedFile[]>([]);
  const [imageSize, setImageSize] = useState<'image' | string>('image');
  const [margin, setMargin] = useState(36);
  const [fit, setFit] = useState<'contain' | 'cover' | 'stretch'>('contain');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [text, setText] = useState('');
  const [textName, setTextName] = useState('');
  const [fontSize, setFontSize] = useState(11);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [office, setOffice] = useState<{ available: boolean; path: string | null } | null>(null);
  const [officeFile, setOfficeFile] = useState<PickedFile | null>(null);

  useEffect(() => { if (kind === 'office' && !office) void window.docedit.officeConverter().then(setOffice); }, [kind, office]);

  useEffect(() => { dialog.current?.showModal(); }, []);
  // starting from images opens the picker straight away (once, even if effects run twice in development)
  const autoPicked = useRef(false);
  useEffect(() => { if (initialKind === 'images' && !autoPicked.current) { autoPicked.current = true; void addImages(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addImages() {
    const picked = await window.docedit.pickFiles('images');
    if (picked) setImages((list) => [...list, ...picked]);
  }

  async function loadText() {
    const picked = await window.docedit.pickFiles('text');
    if (!picked?.[0]) return;
    try {
      setText(await window.docedit.readTextFile(picked[0].path));
      setTextName(picked[0].name.replace(/\.[^.]*$/, '') + '.pdf');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  function move(i: number, d: -1 | 1) {
    setImages((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  }

  const paperSize = (): [number, number] => {
    const [w, h] = SIZES[paper]!;
    return landscape ? [h, w] : [w, h];
  };

  async function create() {
    let req: CreateRequest;
    if (kind === 'blank') {
      if (!(count >= 1 && count <= 1000)) { setError('Choose between 1 and 1000 pages.'); return; }
      req = { kind: 'blank', count, size: paperSize() };
    } else if (kind === 'images') {
      if (images.length === 0) { setError('Add at least one image.'); return; }
      req = { kind: 'images', paths: images.map((i) => i.path), options: { pageSize: imageSize === 'image' ? 'image' : SIZES[imageSize]!, margin, fit, orientation } };
    } else if (kind === 'office') {
      if (!officeFile) { setError('Choose a document first.'); return; }
      setBusy(true); setError('');
      try {
        const res = await window.docedit.convertOffice(officeFile.path);
        if (!res.ok) { setError(res.message); return; }
        onCreated(res.file, 'Converted with LibreOffice. Check the layout before saving: fonts that are not installed are replaced, and some formatting can differ from the original program.');
      } finally { setBusy(false); }
      return;
    } else {
      if (!text.trim()) { setError('Type or load some text first.'); return; }
      req = { kind: 'text', text, name: textName || undefined, options: { pageSize: paperSize(), margin, fontSize } };
    }
    setBusy(true); setError('');
    try {
      const res = await window.docedit.createDocument(req);
      if (!res.ok) { setError(res.message); return; }
      const missing = res.missingCharacters ?? [];
      onCreated(res.file, missing.length
        ? `The font cannot show ${missing.length} character${missing.length === 1 ? '' : 's'} (${missing.slice(0, 12).join(' ')}${missing.length > 12 ? ' …' : ''}); they appear as “?”.`
        : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const paperFields = (
    <>
      <label>Paper <select value={paper} onChange={(e) => setPaper(e.target.value)}>{Object.keys(SIZES).map((s) => <option key={s}>{s}</option>)}</select></label>
      <label><input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} /> Landscape</label>
    </>
  );

  return (
    <dialog ref={dialog} className="modal wide" aria-labelledby="new-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <h2 id="new-title">New document</h2>
      <div className="seg" role="tablist" aria-label="Start from">
        {(['blank', 'images', 'text', 'office'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {k === 'blank' ? 'Blank pages' : k === 'images' ? 'Images' : k === 'text' ? 'Text' : 'Office document'}
          </button>
        ))}
      </div>

      <fieldset disabled={busy}>
        {kind === 'blank' && (
          <>
            <label>Pages <input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(parseInt(e.target.value, 10) || 0)} /></label>
            {paperFields}
          </>
        )}

        {kind === 'images' && (
          <>
            <div className="file-list" aria-label="Images, in page order">
              {images.length === 0 && <div className="muted">No images yet. JPEG and PNG files are supported.</div>}
              {images.map((img, i) => (
                <div key={`${img.path}-${i}`} className="file-row">
                  <span className="file-name" title={img.path}>{i + 1}. {img.name}</span>
                  <button aria-label={`Move ${img.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button aria-label={`Move ${img.name} down`} disabled={i === images.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button aria-label={`Remove ${img.name}`} onClick={() => setImages((l) => l.filter((_, k) => k !== i))}>×</button>
                </div>
              ))}
            </div>
            <div><button onClick={() => void addImages()}>Add images…</button></div>
            <label>Page size
              <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                <option value="image">Same as each image</option>
                {Object.keys(SIZES).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {imageSize !== 'image' && (
              <>
                <label>Orientation
                  <select value={orientation} onChange={(e) => setOrientation(e.target.value as typeof orientation)}>
                    <option value="auto">Match each image</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option>
                  </select>
                </label>
                <label>Margin (pt) <input type="number" min={0} max={200} value={margin} onChange={(e) => setMargin(Math.max(0, parseInt(e.target.value, 10) || 0))} /></label>
                <label>Image fit
                  <select value={fit} onChange={(e) => setFit(e.target.value as typeof fit)}>
                    <option value="contain">Whole image</option><option value="cover">Fill page (crop edges)</option><option value="stretch">Stretch to fill</option>
                  </select>
                </label>
              </>
            )}
          </>
        )}

        {kind === 'office' && (
          <>
            {office === null && <div className="muted">Looking for an office converter…</div>}
            {office && !office.available && (
              <div className="callout">
                <p><strong>No office converter is installed.</strong></p>
                <p>Oakqueill converts Word, Excel and PowerPoint files (and their OpenDocument equivalents) using LibreOffice, a free office suite, if it is installed on this computer.</p>
                <p>Alternatively, open the document in the program that made it, save or export it as PDF, and open that PDF here.</p>
              </div>
            )}
            {office?.available && (
              <>
                <div className="muted">Converter: {office.path}</div>
                <div className="file-row">
                  <span className="file-name">{officeFile ? officeFile.name : 'No document chosen'}</span>
                  <button onClick={() => void window.docedit.pickFiles('office').then((f) => { if (f?.[0]) setOfficeFile(f[0]); })}>Choose document…</button>
                </div>
                <div className="muted">Macros in the document are not run, and linked content from the internet is not fetched.</div>
              </>
            )}
          </>
        )}

        {kind === 'text' && (
          <>
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type or paste text, or load a text file" aria-label="Text" />
            <div><button onClick={() => void loadText()}>Load text file…</button></div>
            {paperFields}
            <label>Font size <input type="number" min={6} max={72} value={fontSize} onChange={(e) => setFontSize(Math.min(72, Math.max(6, parseInt(e.target.value, 10) || 11)))} /></label>
            <label>Margin (pt) <input type="number" min={18} max={144} value={margin} onChange={(e) => setMargin(Math.max(18, parseInt(e.target.value, 10) || 36))} /></label>
          </>
        )}
      </fieldset>

      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted">The new document opens for review; nothing is written to disk until you save it.</p>
      <div className="modal-buttons">
        <button onClick={() => { if (busy && kind === 'office') window.docedit.cancelConvert(); else onClose(); }} disabled={busy && kind !== 'office'}>{busy && kind === 'office' ? 'Stop' : 'Cancel'}</button>
        <button className="primary" onClick={() => void create()} disabled={busy || (kind === 'office' && !office?.available)}>{busy ? (kind === 'office' ? 'Converting…' : 'Creating…') : kind === 'office' ? 'Convert' : 'Create'}</button>
      </div>
    </dialog>
  );
}
