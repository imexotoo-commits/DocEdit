import { useEffect, useRef, type ReactNode } from 'react';
import type { Settings } from '../shared/settings.js';

/** App preferences. Every change applies and is saved at once. */
export function SettingsDialog({ settings, onChange, onClose }: { settings: Settings; onChange(patch: Partial<Settings>): void; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const choice = <K extends keyof Settings>(k: K, options: Array<[Settings[K], string, ReactNode?]>) => (
    <div className="choice-list" role="radiogroup">
      {options.map(([v, label, note]) => (
        <label key={String(v)} className={settings[k] === v ? 'on' : ''}>
          <input type="radio" name={k} checked={settings[k] === v} onChange={() => onChange({ [k]: v } as Partial<Settings>)} />
          <span><strong>{label}</strong>{note && <span className="small muted block">{note}</span>}</span>
        </label>
      ))}
    </div>
  );
  return (
    <dialog ref={ref} className="modal wide settings" aria-labelledby="settings-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="settings-title">Settings</h2>

      <section>
        <h3>Appearance</h3>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {([['system', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark']] as const).map(([v, l]) => (
            <button key={v} role="radio" aria-checked={settings.theme === v} className={settings.theme === v ? 'on' : ''} onClick={() => onChange({ theme: v })}>{l}</button>
          ))}
        </div>
      </section>

      <section>
        <h3>Opening documents</h3>
        <div className="row">
          <label>Zoom <select value={settings.defaultZoom} onChange={(e) => onChange({ defaultZoom: e.target.value as Settings['defaultZoom'] })}>
            <option value="fit-width">Fit width</option><option value="fit-page">Fit page</option><option value="actual">Actual size (100%)</option>
          </select></label>
          <label>Tools shown <select value={settings.openTab} onChange={(e) => onChange({ openTab: e.target.value as Settings['openTab'] })}>
            <option value="comment">Comment</option><option value="pages">Pages</option><option value="protect">Sign &amp; Protect</option><option value="document">Document</option>
          </select></label>
        </div>
      </section>

      <section>
        <h3>Recent files</h3>
        <label className="check"><input type="checkbox" checked={settings.rememberRecent} onChange={(e) => onChange({ rememberRecent: e.target.checked })} /> Remember recently opened files</label>
        <p className="small muted">Listed under File › Open Recent, on the start screen and in the Windows jump list. Turning this off clears the list.</p>
      </section>

      <section>
        <h3>Redaction</h3>
        {choice('redaction', [
          ['copy', 'Save the redacted result as a new copy', 'Recommended. The original file stays as it is.'],
          ['in-place', 'Apply to the open document', null],
        ])}
        {settings.redaction === 'in-place' && (
          <p className="setting-warning" role="note">Redactions then replace the pages you are viewing and can’t be undone. The file on disk keeps the content until you save over it.</p>
        )}
      </section>

      <section>
        <h3>Crash recovery</h3>
        <label className="check-row"><input type="checkbox" checked={settings.recovery} onChange={(e) => onChange({ recovery: e.target.checked })} />
          <span>Keep a copy of unsaved changes, so they can be recovered if Oakqueill closes unexpectedly<span className="small muted block">Stored only on this computer, and deleted once you save or discard the changes. Never kept for password-protected documents.</span></span>
        </label>
      </section>

      <div className="modal-buttons"><button className="primary" onClick={onClose}>Done</button></div>
    </dialog>
  );
}
