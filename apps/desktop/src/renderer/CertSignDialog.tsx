import { useEffect, useRef, useState } from 'react';
import type { PickedFile } from '../shared/api.js';

export interface CertSignRequest { p12Path: string; password: string; reason: string; location: string; visible: boolean }

/** Sign the document with a certificate from a .p12/.pfx file. */
export function CertSignDialog({ warnings, run, onClose }: { warnings: string[]; run(req: CertSignRequest): Promise<string | null>; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);

  async function go() {
    if (!file) { setError('Choose a certificate file.'); return; }
    setBusy(true); setError('');
    try {
      const err = await run({ p12Path: file.path, password, reason: reason.trim(), location: location.trim(), visible });
      if (err) setError(err); else onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setPassword(''); }
  }

  return (
    <dialog ref={ref} className="modal wide" aria-labelledby="csign-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <h2 id="csign-title">Sign with a certificate</h2>
      <p className="small muted">A digital signature proves who signed (as far as others trust the certificate) and shows any later change. It is saved as a new signed copy.</p>
      {warnings.map((w) => <p key={w} className="callout small">{w}</p>)}
      <fieldset disabled={busy}>
        <div className="file-row">
          <span className="file-name">{file ? file.name : 'No certificate chosen'}</span>
          <button onClick={() => void window.docedit.pickFiles('certificate').then((f) => { if (f?.[0]) setFile(f[0]); })}>Choose .p12 / .pfx…</button>
        </div>
        <label className="stack">Certificate password <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label className="stack">Reason (optional) <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I approve this document" /></label>
        <label className="stack">Location (optional) <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        <label><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Show a signature box on the current page</label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons">
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button className="primary" disabled={busy || !file} onClick={() => void go()}>{busy ? 'Signing…' : 'Sign and save copy…'}</button>
      </div>
    </dialog>
  );
}
