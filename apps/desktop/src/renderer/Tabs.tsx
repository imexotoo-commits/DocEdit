import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MenuCommand, OpenedFile } from '../shared/api.js';
import { App, type TabHandle } from './App.js';
import { closeTab, nextTab, type TabEntry } from './tabsModel.js';

type Info = { title: string; dirty: boolean; hasDoc: boolean; path: string | null };

let nextId = 1;

/**
 * The window: a row of document tabs over one editor (App) per tab. Each editor keeps its own document, history and
 * view; the ones not shown stay loaded but hidden, so switching is instant. Window-level matters live here: the menu goes
 * to the active tab, files from the system or the recent list open in a new tab when the current one shows a document,
 * and the window title and the close question count the unsaved tabs.
 */
export function Tabs() {
  const [tabs, setTabs] = useState<TabEntry[]>(() => [{ id: nextId++ }]);
  const [active, setActive] = useState(tabs[0]!.id);
  const [info, setInfo] = useState<Record<number, Info>>({});
  const handles = useRef(new Map<number, TabHandle>());
  /** tabs promised a file that is still opening, so a second file does not go to the same empty tab */
  const promised = useRef(new Set<number>());
  const now = useRef({ tabs, active, info });
  now.current = { tabs, active, info };

  const addTab = useCallback((file?: OpenedFile, notice?: string) => {
    const id = nextId++;
    setTabs((t) => [...t, { id, initialFile: file, initialNotice: notice }]);
    setActive(id);
  }, []);

  /** A file already open in a tab: that tab is shown instead of opening it twice. */
  const showIfOpen = useCallback((path: string | null) => {
    if (!path) return false;
    const want = path.toLowerCase();
    const { tabs: t, info: i } = now.current;
    const hit = t.find((x) => i[x.id]?.path?.toLowerCase() === want);
    if (hit) setActive(hit.id);
    return !!hit;
  }, []);

  /** A document from outside the tabs: its tab if it is open already, else the active tab when empty, else a new tab. */
  const open = useCallback((file: OpenedFile) => {
    if (showIfOpen(file.path)) return;
    const { active: a, info: i } = now.current;
    const h = handles.current.get(a);
    if (h && !i[a]?.hasDoc && !promised.current.has(a)) { promised.current.add(a); h.open(file); }
    else addTab(file);
  }, [addTab, showIfOpen]);

  const close = useCallback(async (id: number) => {
    const h = handles.current.get(id);
    if (h && !(await h.close())) return; // the user kept the document
    promised.current.delete(id);
    const { tabs: t, active: a } = now.current;
    if (t.length === 1) return; // the last tab stays, showing the start screen
    const res = closeTab(t, a, id);
    setTabs(res.tabs);
    setActive(res.active);
  }, []);

  /** Before the window closes: saves every tab with unsaved changes, showing each in turn. */
  const saveAll = useCallback(async () => {
    for (const t of now.current.tabs) {
      if (!now.current.info[t.id]?.dirty) continue;
      setActive(t.id);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const ok = await handles.current.get(t.id)?.save();
      if (!ok) { window.docedit.closeWindowAfterSave(false); return; }
    }
    window.docedit.closeWindowAfterSave(true);
  }, []);

  useEffect(() => window.docedit.onMenu((cmd: MenuCommand) => {
    const { tabs: t, active: a } = now.current;
    switch (cmd) {
      case 'new-tab': addTab(); return;
      case 'next-tab': setActive(nextTab(t, a, 1)); return;
      case 'prev-tab': setActive(nextTab(t, a, -1)); return;
      case 'close-document': void close(a); return;
      case 'save-then-close-window': void saveAll(); return;
      default: handles.current.get(a)?.menu(cmd);
    }
  }), [addTab, close, saveAll]);

  useEffect(() => {
    const off = window.docedit.onOpenFile((f) => {
      if ('error' in f) handles.current.get(now.current.active)?.notify(f.error);
      else open(f);
    });
    window.docedit.ready();
    return off;
  }, [open]);

  // the window title shows the active tab; the close question counts every tab with unsaved changes
  useEffect(() => {
    const a = info[active];
    const unsaved = tabs.filter((t) => info[t.id]?.dirty).length;
    window.docedit.setDocumentState({ title: a?.hasDoc ? a.title : '', dirty: !!a?.dirty, unsaved });
  }, [info, active, tabs]);

  const report = useCallback((id: number, i: Info) => {
    if (i.hasDoc) promised.current.delete(id);
    setInfo((old) => (old[id]?.title === i.title && old[id]?.dirty === i.dirty && old[id]?.hasDoc === i.hasDoc && old[id]?.path === i.path ? old : { ...old, [id]: i }));
  }, []);

  // one stable registration callback per tab, so a tab's editor registers once
  const registrations = useRef(new Map<number, (h: TabHandle | null) => void>());
  const registerFor = (id: number) => {
    let f = registrations.current.get(id);
    if (!f) {
      f = (h) => { if (h) handles.current.set(id, h); else { handles.current.delete(id); registrations.current.delete(id); } };
      registrations.current.set(id, f);
    }
    return f;
  };

  const showBar = tabs.length > 1 || !!info[active]?.hasDoc;
  const onTabKey = (e: KeyboardEvent, id: number) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(id); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const to = nextTab(tabs, id, e.key === 'ArrowRight' ? 1 : -1);
      setActive(to);
      requestAnimationFrame(() => document.getElementById(`doc-tab-${to}`)?.focus());
    }
  };

  return (
    <div className="tabbed">
      {showBar && (
        <div className="tabbar" role="tablist" aria-label="Open documents">
          {tabs.map((t) => {
            const i = info[t.id];
            const title = i?.hasDoc ? i.title : 'New tab';
            const on = t.id === active;
            return (
              <div key={t.id} id={`doc-tab-${t.id}`} role="tab" aria-selected={on} aria-controls={`doc-pane-${t.id}`} tabIndex={on ? 0 : -1}
                className={`doc-tab${on ? ' active' : ''}`} title={i?.dirty ? `${title} (unsaved changes)` : title}
                onClick={() => setActive(t.id)} onKeyDown={(e) => onTabKey(e, t.id)}
                onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); void close(t.id); } }}>
                {i?.dirty && <span className="doc-tab-dirty" aria-label="unsaved changes">●</span>}
                <span className="doc-tab-title">{title}</span>
                <button className="doc-tab-close" tabIndex={-1} aria-label={`Close ${title}`} title="Close tab (Ctrl+W)"
                  onClick={(e) => { e.stopPropagation(); void close(t.id); }}>×</button>
              </div>
            );
          })}
          <button className="doc-tab-new" aria-label="New tab" title="New tab (Ctrl+T)" onClick={() => addTab()}>+</button>
        </div>
      )}
      {tabs.map((t) => (
        <div key={t.id} id={`doc-pane-${t.id}`} role="tabpanel" className="tab-pane" hidden={t.id !== active}>
          <App active={t.id === active} first={t.id === tabs[0]!.id && !t.initialFile} initialFile={t.initialFile} initialNotice={t.initialNotice}
            register={registerFor(t.id)}
            onInfo={(i) => report(t.id, i)} openElsewhere={addTab} showIfOpen={showIfOpen} />
        </div>
      ))}
    </div>
  );
}
