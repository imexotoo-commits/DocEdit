import { useEffect, useRef, useState } from 'react';
import type { ProtectOptions } from '@docedit/core';

/** Set, change or remove password protection. Nothing here is stored; the passwords live in memory until saved. */
export function ProtectDialog({ current, onApply, onClose }: { current: ProtectOptions | null; onApply(p: ProtectOptions | null): void; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open1, setOpen1] = useState('');
  const [open2, setOpen2] = useState('');
  const [restrict, setRestrict] = useState(!!current?.permissions);
  const [owner, setOwner] = useState('');
  const [perm, setPerm] = useState({ print: current?.permissions?.printing !== 'none', copy: current?.permissions?.copying ?? true, modify: current?.permissions?.modifying ?? true, annotate: current?.permissions?.annotating ?? true, fill: current?.permissions?.fillingForms ?? true });
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);

  function apply() {
    if (open1 !== open2) { setError('The two passwords are different.'); return; }
    if (!open1 && !restrict) { setError('Enter a password to open the document, or choose restrictions.'); return; }
    if (open1 && open1.length < 6) { setError('Use at least 6 characters (longer passphrases are much stronger).'); return; }
    if (restrict && owner && owner === open1) { setError('The permissions password must differ from the open password.'); return; }
    onApply({
      userPassword: open1 || undefined,
      ownerPassword: restrict ? owner || undefined : undefined,
      permissions: restrict ? { printing: perm.print ? 'highResolution' : 'none', copying: perm.copy, modifying: perm.modify, annotating: perm.annotate, fillingForms: perm.fill } : undefined,
    });
    onClose();
  }

  const box = (k: keyof typeof perm, label: string) => <label><input type="checkbox" checked={perm[k]} onChange={(e) => setPerm({ ...perm, [k]: e.target.checked })} /> {label}</label>;
  return (
    <dialog ref={ref} className="modal wide" aria-labelledby="protect-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="protect-title">Password protection</h2>
      <p className="small muted">Applied when you save, using AES-256 encryption. {current ? 'This document is currently protected.' : 'This document is not protected.'} Oakqueill does not store passwords; if you forget the password, the document cannot be opened.</p>
      <fieldset>
        <legend>Password to open</legend>
        <label className="stack">Password <input type="password" autoComplete="new-password" value={open1} onChange={(e) => setOpen1(e.target.value)} /></label>
        <label className="stack">Repeat password <input type="password" autoComplete="new-password" value={open2} onChange={(e) => setOpen2(e.target.value)} /></label>
      </fieldset>
      <fieldset>
        <label><input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} /> Restrict what others may do</label>
        {restrict && (
          <>
            <div className="grid2 small">{box('print', 'Print')}{box('copy', 'Copy text and images')}{box('modify', 'Change the document')}{box('annotate', 'Add comments')}{box('fill', 'Fill in forms')}</div>
            <label className="stack">Password to change restrictions (optional) <input type="password" autoComplete="new-password" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
            <p className="small muted">Restrictions are honoured by well-behaved programs but are not a security barrier on their own; only the open password encrypts the content against reading.</p>
          </>
        )}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-buttons">
        {current && <button onClick={() => { onApply(null); onClose(); }}>Remove protection</button>}
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={apply}>Apply</button>
      </div>
    </dialog>
  );
}
