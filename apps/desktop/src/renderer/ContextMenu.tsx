import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons.js';

export type MenuItem =
  | { label: string; onClick(): void; icon?: IconName; shortcut?: string; disabled?: boolean; danger?: boolean }
  | 'separator';

/** A right-click menu in Oakqueill's style. Arrow keys move, Enter chooses, Escape or a click elsewhere closes. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  // where the focus was, so Copy and Paste act on that text box and not on the menu
  const before = useRef(document.activeElement as HTMLElement | null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const real = items.flatMap((it, i) => (it !== 'separator' && !it.disabled ? [i] : []));

  // keep the whole menu on screen
  useLayoutEffect(() => {
    const b = ref.current!.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, innerWidth - b.width - 4)), top: Math.max(4, y + b.height > innerHeight - 4 ? y - b.height : y) });
    ref.current!.focus();
  }, [x, y]);

  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const close = () => onClose();
    addEventListener('pointerdown', away, true);
    addEventListener('blur', close);
    addEventListener('resize', close);
    addEventListener('wheel', close, { passive: true });
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('blur', close); removeEventListener('resize', close); removeEventListener('wheel', close); };
  }, [onClose]);

  const choose = (i: number) => {
    const it = items[i];
    if (!it || it === 'separator' || it.disabled) return;
    onClose();
    before.current?.focus({ preventScroll: true });
    it.onClick();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const at = real.indexOf(active);
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(real[(at + 1) % real.length] ?? -1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(real[(at - 1 + real.length) % real.length] ?? -1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (active >= 0) choose(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
  };

  return (
    <div ref={ref} className="context-menu" role="menu" tabIndex={-1} style={pos} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it === 'separator'
        ? <div key={i} className="cm-sep" role="separator" />
        : (
          <button key={i} role="menuitem" disabled={it.disabled} className={`${it.danger ? 'danger ' : ''}${i === active ? 'active' : ''}`}
            onPointerEnter={() => setActive(it.disabled ? -1 : i)} onClick={() => choose(i)}>
            <span className="cm-icon">{it.icon && <Icon name={it.icon} size={16} />}</span>
            <span className="cm-label">{it.label}</span>
            {it.shortcut && <span className="cm-key">{it.shortcut}</span>}
          </button>
        ))}
    </div>
  );
}
