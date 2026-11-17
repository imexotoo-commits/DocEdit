import { useEffect, useRef } from 'react';
import type { RecoverySummary } from '../shared/api.js';
import { useConfirm } from './ConfirmCard.js';

interface Props {
  items: RecoverySummary[];
  onRecover(id: string): void;
  onDiscard(id: string): void;
  onLater(): void;
}

export function RecoveryDialog({ items, onRecover, onDiscard, onLater }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useConfirm();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="modal wide" aria-labelledby="rec-title" onCancel={(e) => { e.preventDefault(); onLater(); }}>
      <h2 id="rec-title">Recover unsaved work?</h2>
      <p className="muted">Oakqueill closed before these changes were saved. Recovering opens them as unsaved changes; the original files on disk have not been modified.</p>
      <ul className="recovery-list">
        {items.map((it) => (
          <li key={it.id}>
            <div className="file-name">
              <strong>{it.title}</strong>
              <div className="muted">{it.pageCount} page{it.pageCount === 1 ? '' : 's'} · last change {new Date(it.updatedAt).toLocaleString()}{it.path ? ` · ${it.path}` : ' · never saved'}</div>
            </div>
            <button className="primary" onClick={() => onRecover(it.id)}>Recover</button>
            <button onClick={() => void confirm({ title: 'Discard these unsaved changes?', message: `The unsaved changes to “${it.title}” will be deleted permanently. The original file on disk is not affected.`, confirm: { label: 'Discard', danger: true } }).then((ok) => { if (ok) onDiscard(it.id); })}>Discard</button>
          </li>
        ))}
      </ul>
      <div className="modal-buttons"><button onClick={onLater}>Decide later</button></div>
    </dialog>
  );
}
