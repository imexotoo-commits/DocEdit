import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AskAnswer, AskOptions } from '../shared/prompt.js';
import { Icon, type IconName } from './icons.js';

const ICON: Record<NonNullable<AskOptions['kind']>, IconName> = { question: 'info', info: 'info', warning: 'warning', danger: 'warning' };

/** The body of every confirmation: icon, title, message, optional detail box and the answer buttons. */
export function ConfirmCard({ o, onAnswer, autoFocus = true }: { o: AskOptions; onAnswer(a: AskAnswer): void; autoFocus?: boolean }) {
  const kind = o.kind ?? (o.confirm.danger ? 'danger' : 'question');
  const cancelLabel = o.cancel === undefined ? 'Cancel' : o.cancel;
  const safe = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLButtonElement>(null);
  // a destructive answer never gets the focus, so Enter does the harmless thing
  useEffect(() => { if (autoFocus) (((o.confirm.danger || o.focusCancel) && safe.current) || main.current)?.focus(); }, [o, autoFocus]);
  return (
    <div className={`confirm ${kind}`}>
      <div className="confirm-head">
        <span className="confirm-icon" aria-hidden="true"><Icon name={ICON[kind]} size={20} /></span>
        <h2 id="confirm-title">{o.title}</h2>
      </div>
      {o.message && <div id="confirm-message" className="confirm-message">{o.message.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>}
      {o.detail && <pre className="confirm-detail">{o.detail}</pre>}
      <div className="confirm-buttons">
        {o.extra && <button className={o.extra.danger ? 'danger-text' : ''} onClick={() => onAnswer('extra')}>{o.extra.label}</button>}
        <span className="spacer" />
        {cancelLabel !== null && <button ref={safe} onClick={() => onAnswer('cancel')}>{cancelLabel}</button>}
        <button ref={main} className={o.confirm.danger ? 'danger-fill' : 'primary'} onClick={() => onAnswer('confirm')}>{o.confirm.label}</button>
      </div>
    </div>
  );
}

type Ask = (o: AskOptions) => Promise<AskAnswer>;
const AskContext = createContext<Ask>(async () => 'cancel');

/** ask() for any component: shows one ConfirmCard at a time in a modal dialog and resolves with the answer. */
export function AskProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ o: AskOptions; resolve(a: AskAnswer): void } | null>(null);
  const queue = useRef<Array<{ o: AskOptions; resolve(a: AskAnswer): void }>>([]);
  const ask = useCallback<Ask>((o) => new Promise((resolve) => {
    const item = { o, resolve };
    setCurrent((c) => { if (c) { queue.current.push(item); return c; } return item; });
  }), []);
  const answer = (a: AskAnswer) => {
    current?.resolve(a);
    setCurrent(queue.current.shift() ?? null);
  };
  return (
    <AskContext.Provider value={ask}>
      {children}
      {current && <AskDialog key={queue.current.length + current.o.title} o={current.o} onAnswer={answer} />}
    </AskContext.Provider>
  );
}

function AskDialog({ o, onAnswer }: { o: AskOptions; onAnswer(a: AskAnswer): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal confirm-modal" role="alertdialog" aria-labelledby="confirm-title" aria-describedby={o.message ? 'confirm-message' : undefined}
      onCancel={(e) => { e.preventDefault(); onAnswer(o.cancel === null ? 'confirm' : 'cancel'); }}>
      <ConfirmCard o={o} onAnswer={onAnswer} />
    </dialog>
  );
}

export const useAsk = () => useContext(AskContext);

/** Yes/no shorthand: true only for the main answer. */
export function useConfirm() {
  const ask = useAsk();
  return useCallback(async (o: AskOptions) => (await ask(o)) === 'confirm', [ask]);
}
