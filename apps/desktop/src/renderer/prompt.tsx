import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { ConfirmCard } from './ConfirmCard.js';
import type { AskAnswer, AskOptions } from '../shared/prompt.js';

declare global {
  interface Window { oakPrompt: { options(): Promise<AskOptions | null>; ready(height: number): void; answer(a: AskAnswer): void } }
}

function Prompt() {
  const [o, setO] = useState<AskOptions | null>(null);
  useEffect(() => { void window.oakPrompt.options().then(setO); }, []);
  useEffect(() => {
    if (!o) return;
    document.title = o.title;
    requestAnimationFrame(() => window.oakPrompt.ready(document.getElementById('root')!.getBoundingClientRect().height));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') window.oakPrompt.answer(o.cancel === null ? 'confirm' : 'cancel'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [o]);
  if (!o) return null;
  return <div role="alertdialog" aria-labelledby="confirm-title" aria-describedby={o.message ? 'confirm-message' : undefined}><ConfirmCard o={o} onAnswer={(a) => window.oakPrompt.answer(a)} /></div>;
}

document.body.classList.add('prompt-window');
createRoot(document.getElementById('root')!).render(<StrictMode><Prompt /></StrictMode>);
