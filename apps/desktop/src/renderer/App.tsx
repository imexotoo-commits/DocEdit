import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { MenuCommand, OpenedFile, RecoverySummary, SavedSignature } from '../shared/api.js';
import { RecoveryDialog } from './RecoveryDialog.js';
import { fillValues, resolveEdits, type OutlineNode, type PendingEdit, type Rect } from './edits.js';
import { loadOutlineNodes } from './Outline.js';
import {
  commit, commitState, createEditor, dropAt, duplicate, insertAfter, isDirty, lastIndexOf, newId, nudge, pagesForSource,
  isUnchangedLayout, redo, remove, restoreEditor, rotate, setCrop, toSlots, undo, type Editor, type PageItem, type SourceFile,
} from './model.js';
import { Outline } from './Outline.js';
import type { PageLink } from './PageCanvas.js';
import { loadSource, type LoadedSource } from './pdf.js';
import { NewDocumentDialog, type NewKind } from './NewDocumentDialog.js';
import { PrintDialog } from './PrintDialog.js';
import { CropDialog, SplitDialog } from './OrganizeDialogs.js';
import { FurnitureDialog, PropertiesDialog, type Meta } from './ContentDialogs.js';
import { ChangesPanel } from './ChangesPanel.js';
import { BookmarksEditor } from './BookmarksEditor.js';
import { FormsPanel, loadForm, type FormInfo } from './FormsPanel.js';
import { EditLayer, DRAW_TOOLS, type Drawn, type Tool } from './EditLayer.js';
import { SignatureDialog, TextPrompt, type ChosenSignature } from './SignatureDialog.js';
import { fromScreenPoint, fromScreenRect, textUnder } from './textGeometry.js';
import { cropFromMargins } from './cropMath.js';
import { SearchPanel } from './SearchPanel.js';
import { Thumbnails } from './Thumbnails.js';
import { pageText, useSearch } from './useSearch.js';
import { RedactDialog } from './RedactDialog.js';
import { SanitizeDialog } from './SanitizeDialog.js';
import { ProtectDialog } from './ProtectDialog.js';
import { CertSignDialog, type CertSignRequest } from './CertSignDialog.js';
import { SignaturesPanel } from './SignaturesPanel.js';
import type { SignatureReport } from '@docedit/core';
import { PdfOpenError } from './pdf.js';
import type { HiddenCategory, InspectionItem } from '@docedit/core';
import { redact } from './redaction.js';
import { itemSize, placement, Viewer, type Highlights, type ViewerHandle } from './Viewer.js';
import { Icon, type IconName } from './icons.js';
import { useConfirm } from './ConfirmCard.js';
import { latestOnly } from './latest.js';
import { ContextMenu, type MenuItem } from './ContextMenu.js';
import { SettingsDialog } from './SettingsDialog.js';
import { ExportDialog } from './ExportDialog.js';
import { ScanDialog } from './ScanDialog.js';
import { exportDocument, type ExportKind } from './export/run.js';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings.js';
import logo from './assets/logo.png';

type Zoom = { mode: 'fit-width' | 'fit-page' | 'custom'; scale: number };
type Notice = { kind: 'error' | 'info'; text: string } | null;
type SidebarTab = 'pages' | 'outline' | 'search' | 'changes' | 'forms' | 'signatures';

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');


type RibbonTab = 'comment' | 'pages' | 'protect' | 'document';
/** The tools each tab holds (a tool can be on two tabs: Text is on Comment and in Fill & sign). */
const TAB_TOOLS: Record<RibbonTab, Tool[]> = {
  comment: ['highlight', 'underline', 'strikeout', 'note', 'freetext', 'square', 'circle', 'ink', 'link'],
  pages: [],
  protect: ['signature', 'initials', 'freetext', 'check', 'cross', 'dot', 'box', 'line', 'redact'],
  document: [],
};
const TAB_OF_TOOL = (t: Tool): RibbonTab => (TAB_TOOLS.protect.includes(t) && !TAB_TOOLS.comment.includes(t) ? 'protect' : 'comment');
const MARK_BUTTONS: Array<[Tool, IconName, string]> = [
  ['freetext', 'text', 'Text: drag or click to add text'], ['cross', 'cross', 'Cross mark: click to place, drag to size'], ['check', 'check', 'Tick: click to place, drag to size'],
  ['dot', 'dot', 'Dot: click to place, drag to size'], ['box', 'box', 'Box: click to place, drag to size'], ['line', 'line', 'Line: drag from start to end'],
];
const RIBBON_TABS: Array<[RibbonTab, string]> = [['comment', 'Comment'], ['pages', 'Pages'], ['protect', 'Sign & Protect'], ['document', 'Document']];
const COMMENT_TOOLS: Array<[Tool, IconName, string, string]> = [
  ['select', 'select', 'Select', 'Select text and pending changes (Escape)'],
  ['highlight', 'highlight', 'Highlight', 'Highlight the selected text, or text you select next'],
  ['underline', 'underline', 'Underline', 'Underline text'],
  ['strikeout', 'strike', 'Strike', 'Strike through text'],
  ['note', 'note', 'Note', 'Click to add a note'],
  ['freetext', 'textBox', 'Text box', 'Drag to add a text box'],
  ['square', 'rect', 'Rectangle', 'Drag to draw a rectangle'],
  ['circle', 'ellipse', 'Ellipse', 'Drag to draw an ellipse'],
  ['ink', 'draw', 'Draw', 'Draw freehand'],
  ['link', 'link', 'Link', 'Drag over an area to make it a link'],
];

interface ButtonProps { icon: IconName; label: string; title: string; onClick(): void; disabled?: boolean; pressed?: boolean; danger?: boolean; /** hidden in narrow windows (still in the menu and on its shortcut) */ wide?: boolean }
/** Icon-only button for the title bar; the label is its accessible name. */
function IconButton({ icon, label, title, onClick, disabled, pressed, wide }: ButtonProps) {
  return <button className={wide ? 'icon-btn wide-only' : 'icon-btn'} aria-label={label} title={title} onClick={onClick} disabled={disabled} aria-pressed={pressed}><Icon name={icon} /></button>;
}
/** Icon and label button for the tool strip. */
function ToolButton({ icon, label, title, onClick, disabled, pressed, danger }: ButtonProps) {
  return <button className={danger ? 'tool-btn danger' : 'tool-btn'} title={title} onClick={onClick} disabled={disabled} aria-pressed={pressed}><Icon name={icon} /><span>{label}</span></button>;
}

export function App() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loaded, setLoaded] = useState<LoadedSource[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState<Zoom>({ mode: 'fit-width', scale: 1 });
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState('');
  const [tab, setTab] = useState<SidebarTab>('pages');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  // scanning is offered only when Windows sees a scanner
  const [scannerPresent, setScannerPresent] = useState(false);
  useEffect(() => { void window.docedit.scannerPresent().then(setScannerPresent, () => {}); return window.docedit.onScannerPresent(setScannerPresent); }, []);
  useEffect(() => { void window.docedit.getSettings().then(setSettingsState, () => {}); return window.docedit.onSettings(setSettingsState); }, []);
  const changeSettings = (patch: Partial<Settings>) => { setSettingsState((s) => ({ ...s, ...patch })); void window.docedit.setSettings(patch).then(setSettingsState); };
  const [printing, setPrinting] = useState(false);
  const [creating, setCreating] = useState<NewKind | null>(null);
  const [organizing, setOrganizing] = useState<'crop' | 'split' | 'properties' | 'furniture' | 'sanitize' | 'protect' | 'cert-sign' | null>(null);
  const [sigReports, setSigReports] = useState<SignatureReport[] | null>(null);
  const [fileMeta, setFileMeta] = useState<Meta>({ title: '', author: '', subject: '', keywords: '' });
  const confirm = useConfirm();
  const [tool, setTool] = useState<Tool>('select');
  const [ribbon, setRibbon] = useState<RibbonTab>('comment');
  // a tool picked from the menu or a shortcut brings its group into view; leaving a tab puts its armed tool down,
  // so a drag on the page never draws with a tool that is not on screen
  function pickRibbon(id: RibbonTab) {
    if (tool !== 'select' && !TAB_TOOLS[id].includes(tool)) { setTool('select'); setSelectedEdit(null); }
    setRibbon(id);
  }
  useEffect(() => { if (tool !== 'select') setRibbon((r) => (TAB_TOOLS[r].includes(tool) ? r : TAB_OF_TOOL(tool))); }, [tool]);
  const [redacting, setRedacting] = useState(false);
  const [form, setForm] = useState<FormInfo | null>(null);
  const [selectedEdit, setSelectedEdit] = useState<string | null>(null);
  const [signature, setSignature] = useState<ChosenSignature | null>(null);
  const [initials, setInitials] = useState<ChosenSignature | null>(null);
  const [askSignature, setAskSignature] = useState<null | 'signature' | 'initials'>(null);
  const [savedSigs, setSavedSigs] = useState<SavedSignature[]>([]);
  const reloadSigs = () => void window.docedit.signaturesList().then(setSavedSigs, () => {});
  useEffect(reloadSigs, []);
  const latestSig = (kind: 'signature' | 'initials') => savedSigs.find((s) => (s.kind ?? 'signature') === kind);
  /** Use a saved signature or initials straight away: the next click on a page places it. */
  function useSaved(kind: 'signature' | 'initials', s: SavedSignature) {
    const chosen = { image: s.image, typedName: s.typedName, caption: kind === 'signature' ? `Signed ${new Date().toISOString().slice(0, 10)}` : undefined };
    if (kind === 'signature') setSignature(chosen); else setInitials(chosen);
    setTool(kind);
    setNotice({ kind: 'info', text: `Click or drag on a page to place your ${kind}. Press Escape to cancel.` });
  }
  async function deleteSaved(kind: 'signature' | 'initials', s: SavedSignature) {
    if (!(await confirm({ title: `Delete your saved ${kind}?`, message: `It is removed from this computer. Documents you already signed keep it.`, confirm: { label: 'Delete', danger: true } }))) return;
    await window.docedit.signaturesDelete(s.id).catch(() => {});
    if (tool === kind) setTool('select');
    reloadSigs();
  }
  const [prompt, setPrompt] = useState<{ title: string; label: string; initial?: string; multiline?: boolean; hint?: string; password?: boolean; onOk(v: string): string | null } | null>(null);
  const [recoverable, setRecoverable] = useState<RecoverySummary[]>([]);
  const viewer = useRef<ViewerHandle>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const warnedLossy = useRef(false);

  const pages = editor?.history.present.pages ?? [];
  const dirty = editor ? isDirty(editor) : false;
  const search = useSearch(pages, loaded);

  const highlights = useMemo<Highlights>(() => {
    const m: Highlights = new Map();
    search.hits.forEach((h, i) => {
      const list = m.get(h.pageId) ?? [];
      for (const rect of h.rects) list.push({ rect, active: i === search.active });
      m.set(h.pageId, list);
    });
    return m;
  }, [search.hits, search.active]);

  /** "3", or "3 (iii)" when the file labels that page differently. */
  const pageLabel = useCallback((i: number) => {
    const item = pages[i];
    const label = item?.kind === 'page' ? loaded[item.source]?.labels?.[item.page] : undefined;
    return label && label !== String(i + 1) ? `${i + 1} (${label})` : String(i + 1);
  }, [pages, loaded]);

  useEffect(() => {
    window.docedit.setDocumentState({ title: editor?.title ?? '', dirty });
  }, [editor?.title, dirty]);

  useEffect(() => { setPageInput(pages.length ? String(current + 1) : ''); }, [current, pages.length]);

  // ---------- crash recovery ----------
  /** how many sources of each recovery session main already has */
  const sentSources = useRef(new Map<string, number>());
  const liveRecoveryId = useRef<string | null>(null);
  liveRecoveryId.current = editor?.recoveryId ?? null;

  const clearRecovery = useCallback((id: string) => {
    if (!sentSources.current.has(id)) return;
    sentSources.current.delete(id);
    void window.docedit.recoveryClear(id).catch(() => {});
  }, []);

  // while there are unsaved changes, keep a snapshot a second after the last edit
  useEffect(() => {
    if (!editor) return;
    const id = editor.recoveryId;
    // protected documents are never written to disk unencrypted
    if (!dirty || editor.protection || !settings.recovery) { clearRecovery(id); return; }
    const t = setTimeout(() => {
      const sent = sentSources.current.get(id) ?? 0;
      window.docedit.recoverySave({
        id, title: editor.title, path: editor.path, pages: editor.history.present.pages,
        edits: editor.history.present.edits, outline: editor.history.present.outline,
        newSources: editor.sources.slice(sent).map((s) => s.bytes), firstNewSource: sent,
      }).then(() => {
        sentSources.current.set(id, Math.max(sentSources.current.get(id) ?? 0, editor.sources.length));
        if (liveRecoveryId.current !== id) clearRecovery(id); // the document was closed meanwhile
      }, (e: unknown) => console.warn('recovery snapshot failed', e));
    }, 1000);
    return () => clearTimeout(t);
  }, [editor, dirty, clearRecovery, settings.recovery]);

  // a document that is replaced or closed no longer needs its snapshot
  useEffect(() => {
    const id = editor?.recoveryId;
    return () => { if (id) clearRecovery(id); };
  }, [editor?.recoveryId, clearRecovery]);

  useEffect(() => { void window.docedit.recoveryList().then(setRecoverable, () => {}); }, []);

  async function recover(id: string) {
    if (!(await confirmDiscard())) return;
    setBusy('Recovering…');
    try {
      const rec = await window.docedit.recoveryLoad(id);
      const loadedSources = await Promise.all(rec.sources.map((b, i) => loadSource(b, i === 0 ? rec.title : `source ${i + 1}`)));
      const sources: SourceFile[] = rec.sources.map((bytes, i) => ({ path: i === 0 ? rec.path : null, name: i === 0 ? rec.title : `source ${i + 1}`, bytes, pageCount: loadedSources[i]!.pages.length }));
      const ed = restoreEditor(rec, sources);
      loaded.forEach((l) => void l.doc.destroy());
      sentSources.current.set(id, sources.length);
      setLoaded(loadedSources);
      setEditor(ed);
      setSelection(new Set([ed.history.present.pages[0]!.id]));
      setCurrent(0);
      setRecoverable((list) => list.filter((r) => r.id !== id));
      setNotice({ kind: 'info', text: `Recovered unsaved changes to ${rec.title}. Save to keep them.` + (rec.originalChanged ? ' Note: the original file was changed after these edits were made; saving will replace it.' : '') });
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not recover: ${errText(e)}` });
    } finally { setBusy(null); }
  }

  // ---------- zoom ----------
  const computeFit = useCallback((mode: 'fit-width' | 'fit-page'): number => {
    const vp = viewer.current?.viewportSize();
    if (!vp || pages.length === 0) return 1;
    if (mode === 'fit-width') {
      const widest = Math.max(...pages.map((p) => itemSize(p, loaded).width));
      return Math.max(0.1, vp.width / widest);
    }
    const s = itemSize(pages[Math.min(current, pages.length - 1)]!, loaded);
    return Math.max(0.1, Math.min(vp.width / s.width, vp.height / s.height));
  }, [pages, loaded, current]);

  const refit = useCallback(() => {
    setZoom((z) => {
      if (z.mode === 'custom') return z;
      const scale = computeFit(z.mode);
      return Math.abs(scale - z.scale) < 0.001 ? z : { mode: z.mode, scale };
    });
  }, [computeFit]);

  useEffect(() => { refit(); }, [loaded, pages.length, refit]);

  function stepZoom(dir: 1 | -1) {
    setZoom((z) => {
      const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z.scale + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z.scale - 0.001);
      return { mode: 'custom', scale: next ?? z.scale };
    });
  }

  // ---------- documents ----------
  async function confirmDiscard(): Promise<boolean> {
    return !dirty || confirm({ title: 'Discard unsaved changes?', message: `The changes to “${editor?.title ?? 'this document'}” have not been saved and will be lost.`, kind: 'warning', confirm: { label: 'Discard changes', danger: true } });
  }

  /** Open a document in this window. `reopen` keeps the view as it is (after saving, or when the content was replaced). */
  async function replaceDocument(file: OpenedFile, keepPage = 0, protection: Editor['protection'] = null, reopen = false) {
    setBusy(`Opening ${file.name}…`);
    try {
      let src;
      try { src = await loadSource(file.bytes, file.name); }
      catch (e) {
        if (e instanceof PdfOpenError && e.needsPassword) { askPassword(file, keepPage); return; }
        throw e;
      }
      loaded.forEach((l) => void l.doc.destroy());
      const ed: Editor = { ...createEditor({ path: file.path, name: file.name, bytes: file.bytes, pageCount: src.pages.length }), protection };
      setLoaded([src]);
      setEditor(ed);
      const page = Math.min(keepPage, ed.history.present.pages.length - 1);
      setSelection(new Set([ed.history.present.pages[page]!.id]));
      setCurrent(page);
      warnedLossy.current = false;
      if (!reopen) {
        setZoom((z) => (settings.defaultZoom === 'actual' ? { mode: 'custom', scale: 1 } : { mode: settings.defaultZoom, scale: z.scale }));
        setRibbon(settings.openTab);
      }
      requestAnimationFrame(() => viewer.current?.scrollToPage(page));
      setNotice(protection ? { kind: 'info', text: 'This document is password-protected. Saving keeps the protection. Crash recovery is off for it, so its content is never written to disk unencrypted.' } : null);
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e) });
    } finally { setBusy(null); }
  }

  /** Ask for the password of a protected file, decrypt it in memory and open it; the password is kept only to re-encrypt on save. */
  function askPassword(file: OpenedFile, keepPage: number, error?: string) {
    setPrompt({
      title: 'Password needed', label: `Password for “${file.name}”`, password: true, hint: error,
      onOk: (pw) => {
        if (!pw) return 'Enter the password.';
        void window.docedit.decrypt(file.bytes, pw).then((res) => {
          if (res.ok) void replaceDocument({ ...file, bytes: res.bytes }, keepPage, { userPassword: pw });
          else if (res.code === 'BAD_PASSWORD') askPassword(file, keepPage, res.message);
          else setNotice({ kind: 'error', text: res.message });
        });
        return null;
      },
    });
  }

  async function openViaDialog() {
    if (!(await confirmDiscard())) return;
    try {
      const files = await window.docedit.openDialog(false);
      if (files?.[0]) await replaceDocument(files[0]);
    } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }

  /** Adds pages of other PDFs at a gap in the page list (n = end). */
  async function insertFiles(files: OpenedFile[], beforeIndex: number) {
    if (!editor || files.length === 0) return;
    setBusy('Adding pages…');
    try {
      const newLoaded: LoadedSource[] = [];
      for (const f of files) newLoaded.push(await loadSource(f.bytes, f.name));
      const base = editor.sources.length;
      const items = newLoaded.flatMap((l, i) => pagesForSource(base + i, l.pages.length));
      const sources = [...editor.sources, ...files.map((f, i) => ({ path: f.path, name: f.name, bytes: f.bytes, pageCount: newLoaded[i]!.pages.length }))];
      setLoaded((l) => [...l, ...newLoaded]);
      setEditor((ed) => ed && commit({ ...ed, sources }, insertAfter(ed.history.present.pages, beforeIndex - 1, items)));
      setSelection(new Set(items.map((p) => p.id)));
      setNotice({ kind: 'info', text: `Added ${items.length} page${items.length === 1 ? '' : 's'} from ${files.map((f) => f.name).join(', ')}.` });
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e) });
    } finally { setBusy(null); }
  }

  async function insertViaDialog() {
    if (!editor) return;
    try {
      const files = await window.docedit.openDialog(true);
      if (files) await insertFiles(files, lastIndexOf(pages, selection) + 1 || pages.length);
    } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }

  async function readDropped(files: File[]): Promise<OpenedFile[]> {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdfs.length < files.length) setNotice({ kind: 'error', text: 'Only PDF files can be dropped here.' });
    return Promise.all(pdfs.map((f) => window.docedit.openDropped(f)));
  }

  async function save(saveAs: boolean): Promise<boolean> {
    if (!editor) return false;
    if (!saveAs && editor.path && !dirty) return true;
    const notes = loaded.map((l) => l.notes);
    const lost = [
      notes.some((n) => n.formFields) && 'fillable form fields (their current values stay on the page)',
    ].filter(Boolean);
    const signed = notes.some((n) => n.signatures);
    const pendingMarks = editor.history.present.edits.filter((e) => e.type === 'redact').length;
    if (pendingMarks && !(await confirm({ title: 'Save without applying redactions?', kind: 'warning', confirm: { label: 'Save anyway' },
      message: `This document has ${pendingMarks} redaction mark${pendingMarks === 1 ? '' : 's'} that have not been applied. Saving does not remove the marked content, and the marks are discarded after saving.\n\nTo remove the content, use Apply redactions; it saves a separate redacted copy.` }))) return false;
    const rebuilt = !isUnchangedLayout(pages, editor.sources);
    // any saved change rewrites the file, which breaks existing certificate signatures
    const breaksSignature = signed && (rebuilt || editor.history.present.edits.length > 0 || !!editor.protectionChanged);
    if (((rebuilt && lost.length) || breaksSignature) && !warnedLossy.current) {
      const msg = [
        rebuilt && lost.length ? `Saving page changes does not keep ${lost.join(' or ')} yet.` : '',
        breaksSignature ? 'This document has a digital signature. Saving your changes will make that signature invalid. To keep it, save the changes as a separate copy with Save As and leave this file as it is.' : '',
      ].filter(Boolean).join('\n\n');
      if (!(await confirm({ title: breaksSignature ? 'Saving will invalidate the signature' : 'Some content will not be kept', message: msg, kind: 'warning', confirm: { label: 'Save anyway', danger: breaksSignature } }))) return false;
      warnedLossy.current = true;
    }
    setBusy('Saving…');
    try {
      const state = editor.history.present;
      // bookmarks follow their pages: when pages were rearranged, carry the file's own bookmarks over
      const outline = state.outline ?? (rebuilt && loaded[0]?.notes.outline ? await loadOutlineNodes(loaded[0].doc, pages, 0) : null);
      const res = await window.docedit.save({
        sources: editor.sources.map((s) => s.bytes),
        slots: toSlots(pages),
        edits: resolveEdits(pages, state.edits, outline),
        protect: editor.protection ?? null,
        path: saveAs ? null : editor.path,
        suggestedName: editor.title.toLowerCase().endsWith('.pdf') ? editor.title : `${editor.title || 'Untitled'}.pdf`,
      });
      if (!res.ok) {
        if (!res.cancelled) setNotice({ kind: 'error', text: `Could not save: ${res.message} The original file was not changed.` });
        return false;
      }
      await replaceDocument({ ...res.file, bytes: res.editBytes }, current, editor.protection ?? null, true);
      setNotice({ kind: 'info', text: `Saved ${res.file.name}.` });
      return true;
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not save: ${errText(e)}` });
      return false;
    } finally { setBusy(null); }
  }

  async function closeDocument() {
    if (!editor || !(await confirmDiscard())) return;
    loaded.forEach((l) => void l.doc.destroy());
    setEditor(null); setLoaded([]); setSelection(new Set()); setCurrent(0); setNotice(null);
  }

  // ---------- page edits ----------
  function edit(fn: (pages: PageItem[]) => PageItem[]) {
    setEditor((ed) => ed && commit(ed, fn(ed.history.present.pages)));
  }

  function deleteSelected() {
    if (selection.size >= pages.length) { setNotice({ kind: 'error', text: 'A document needs at least one page.' }); return; }
    const after = pages.find((p, i) => i > lastIndexOf(pages, selection) && !selection.has(p.id))
      ?? [...pages].reverse().find((p) => !selection.has(p.id));
    edit((ps) => remove(ps, selection));
    if (after) setSelection(new Set([after.id]));
  }

  function duplicateSelected() {
    const res = duplicate(pages, selection);
    edit(() => res.pages);
    setSelection(new Set(res.newIds));
  }

  function insertBlank() {
    const at = lastIndexOf(pages, selection);
    const ref = pages[at] ?? pages[pages.length - 1];
    const size = ref ? itemSize(ref, loaded) : { width: 612, height: 792 };
    const blank: PageItem = { id: newId(), kind: 'blank', width: Math.round(size.width), height: Math.round(size.height), rotate: 0 };
    edit((ps) => insertAfter(ps, at < 0 ? ps.length - 1 : at, [blank]));
    setSelection(new Set([blank.id]));
  }

  /** Before exporting pages: unapplied redaction marks are not part of an export, so say so. */
  async function confirmExportWithMarks(): Promise<boolean> {
    const n = editor?.history.present.edits.filter((e) => e.type === 'redact').length ?? 0;
    return !n || confirm({ title: 'Export without applying redactions?', kind: 'warning', confirm: { label: 'Export anyway' },
      message: `This document has ${n} redaction mark${n === 1 ? '' : 's'} that have not been applied. The exported pages still contain the marked content.\n\nUse Apply redactions first to remove it.` });
  }

  async function extractSelected() {
    if (!editor) return;
    const chosen = pages.flatMap((p, i) => (selection.has(p.id) ? [i] : []));
    if (!chosen.length || !(await confirmExportWithMarks())) return;
    try {
      const base = editor.title.replace(/\.pdf$/i, '');
      // the pages as they would be saved now (pending notes, form values, headers...), kept in memory only
      const doc = await currentBytes();
      const res = await window.docedit.save({ sources: [doc], slots: chosen.map((i) => ({ source: 0, page: i })), path: null, suggestedName: `${base} (pages).pdf`, protect: editor.protection ?? null });
      if (res.ok) setNotice({ kind: 'info', text: `Saved ${chosen.length} page${chosen.length === 1 ? '' : 's'} to ${res.file.name}. This document is unchanged.` });
      else if (!res.cancelled) setNotice({ kind: 'error', text: `Could not save: ${res.message}` });
    } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }

  async function split(groups: number[][]) {
    if (!editor) return;
    setOrganizing(null);
    if (!(await confirmExportWithMarks())) return;
    setBusy('Splitting…');
    try {
      const doc = await currentBytes(); // includes pending edits; kept in memory, outputs encrypted for protected documents
      const res = await window.docedit.saveSplit({ sources: [doc], parts: groups.map((g) => g.map((i) => ({ source: 0, page: i }))), baseName: editor.title, protect: editor.protection ?? null });
      if (res.ok) setNotice({ kind: 'info', text: `Saved ${res.files.length} files to ${res.folder}. This document is unchanged.` });
      else if (!res.cancelled) setNotice({ kind: 'error', text: `Could not split: ${res.message}` });
    } catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setBusy(null); }
  }

  /** Add pending content edits as one undoable step. */
  function addEdits(edits: PendingEdit[]) {
    setEditor((ed) => ed && commitState(ed, { ...ed.history.present, edits: [...ed.history.present.edits, ...edits] }));
  }

  // the file's own properties, so the dialog starts from them
  useEffect(() => {
    const doc = loaded[0]?.doc;
    if (!doc) return;
    void doc.getMetadata().then((md) => {
      const info = (md.info ?? {}) as Record<string, unknown>;
      const str = (k: string) => (typeof info[k] === 'string' ? (info[k] as string) : '');
      setFileMeta({ title: str('Title'), author: str('Author'), subject: str('Subject'), keywords: str('Keywords') });
    }, () => {});
  }, [loaded]);

  /** Properties as they will be saved: the file's, overridden by pending metadata edits. */
  const effectiveMeta = useMemo<Meta>(() => {
    let m = { ...fileMeta };
    for (const e of editor?.history.present.edits ?? []) {
      if (e.type !== 'metadata') continue;
      m = { title: e.meta.title ?? m.title, author: e.meta.author ?? m.author, subject: e.meta.subject ?? m.subject, keywords: e.meta.keywords ? e.meta.keywords.join(', ') : m.keywords };
    }
    return m;
  }, [fileMeta, editor?.history.present.edits]);

  // ---------- review tools ----------
  const author = 'Oakqueill user';
  const edits = editor?.history.present.edits ?? [];

  function updateEdits(fn: (list: PendingEdit[]) => PendingEdit[]) {
    setEditor((ed) => ed && commitState(ed, { ...ed.history.present, edits: fn(ed.history.present.edits) }));
  }

  /** Rectangles (user space, grouped by page) under the current text selection in the viewer. */
  function selectionByPage(): Map<string, Rect[]> {
    const out = new Map<string, Rect[]>();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return out;
    for (let r = 0; r < sel.rangeCount; r++) {
      for (const cr of Array.from(sel.getRangeAt(r).getClientRects())) {
        if (cr.width < 1 || cr.height < 1) continue;
        const el = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
        const pageEl = el?.closest('.viewer-page') as HTMLElement | null;
        const inner = pageEl?.querySelector('.page-inner') as HTMLElement | null;
        const item = pages.find((p) => p.id === pageEl?.dataset.pageId);
        if (!pageEl || !inner || !item) continue;
        const b = inner.getBoundingClientRect();
        const { view, rotation } = placement(item, loaded);
        const list = out.get(item.id) ?? [];
        list.push(fromScreenRect({ x: cr.left - b.left, y: cr.top - b.top, width: cr.width, height: cr.height }, view, rotation, zoom.scale));
        out.set(item.id, list);
      }
    }
    return out;
  }

  function applyMarkup(kind: 'highlight' | 'underline' | 'strikeout'): boolean {
    const byPage = selectionByPage();
    if (!byPage.size) return false;
    const created: PendingEdit[] = [...byPage].map(([pageId, rects]) => ({ id: newId(), type: 'annotation', pageId, author, annotation: { kind, rects: mergeLineRects(rects) } }));
    addEdits(created);
    window.getSelection()?.removeAllRanges();
    setSelectedEdit(created[0]!.id);
    return true;
  }

  // ---------- right-click menus ----------
  /** Mark the selected text for redaction; with `now`, go straight on to applying it (Settings: into the open document). */
  function redactSelection(now = false) {
    const byPage = selectionByPage();
    if (!byPage.size) return;
    const created = [...byPage].flatMap(([pageId, rects]) => mergeLineRects(rects).map((rect) => ({ id: newId(), type: 'redact' as const, pageId, rect })));
    addEdits(created);
    window.getSelection()?.removeAllRanges();
    if (now) setRedacting(true);
    else setNotice({ kind: 'info', text: `Marked ${created.length} area${created.length === 1 ? '' : 's'} for redaction. Review them, then use Apply redactions.` });
    // remember the text under each mark, so the result can be checked for it
    for (const m of created) {
      const item = pages.find((p) => p.id === m.pageId);
      if (item?.kind !== 'page' || !loaded[item.source]) continue;
      void pageText(loaded[item.source]!, item.page).then((pt) => {
        const text = textUnder(pt, m.rect);
        if (text) setEditor((ed) => ed && { ...ed, history: { ...ed.history, present: { ...ed.history.present, edits: ed.history.present.edits.map((x) => (x.id === m.id ? { ...x, text } : x)) } } });
      });
    }
  }

  async function addBookmarkFor(pageId: string) {
    if (!editor || !loaded[0]) return;
    const tree = outlineTree ?? await loadOutlineNodes(loaded[0].doc, pages, 0);
    const at = pages.findIndex((p) => p.id === pageId);
    setPrompt({ title: 'Add bookmark', label: 'Title', initial: `Page ${at + 1}`, onOk: (v) => {
      if (!v.trim()) return 'Type a title.';
      // top-level bookmarks stay in page order
      const pos = (n: OutlineNode) => (n.pageId ? pages.findIndex((p) => p.id === n.pageId) : -1);
      const i = tree.findIndex((n) => pos(n) > at);
      const node = { id: newId(), title: v.trim(), pageId, children: [] };
      setOutline(i < 0 ? [...tree, node] : [...tree.slice(0, i), node, ...tree.slice(i)]);
      setTab('outline');
      return null;
    } });
  }

  /** The point under the pointer in a page's own coordinates. */
  function pagePoint(pageEl: HTMLElement, x: number, y: number) {
    const item = pages.find((p) => p.id === pageEl.dataset.pageId);
    const inner = pageEl.querySelector('.page-inner') as HTMLElement | null;
    if (!item || !inner) return null;
    const b = inner.getBoundingClientRect();
    const { view, rotation } = placement(item, loaded);
    return { item, at: fromScreenPoint(x - b.left, y - b.top, view, rotation, zoom.scale) };
  }

  // Page-list menu actions run after the right-click has selected the page, so they look up the current
  // functions (which see the new selection) instead of the ones from when the menu was built.
  const pageActions = useRef({ duplicateSelected, insertBlank, extractSelected, deleteSelected, rotate: (d: 'left' | 'right') => handlers[`rotate-${d}`]() });
  pageActions.current = { duplicateSelected, insertBlank, extractSelected, deleteSelected, rotate: (d) => handlers[`rotate-${d}`]() };

  function menuFor(t: HTMLElement, x: number, y: number): MenuItem[] {
    const cmd = (c: 'cut' | 'copy' | 'paste' | 'selectAll') => () => window.docedit.editCommand(c);
    // text boxes in the app's own forms and panels
    const field = t.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    if (field && !(field instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'color', 'file', 'button'].includes(field.type))) {
      const secret = field instanceof HTMLInputElement && field.type === 'password';
      const picked = (field.selectionEnd ?? 0) > (field.selectionStart ?? 0);
      field.focus();
      return [
        { label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', onClick: cmd('cut'), disabled: secret || !picked || field.readOnly },
        { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onClick: cmd('copy'), disabled: secret || !picked },
        { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', onClick: cmd('paste'), disabled: field.readOnly },
        'separator',
        { label: 'Select all', shortcut: 'Ctrl+A', onClick: () => field.select() },
      ];
    }
    if (!editor) return [];
    // a page in the page list
    const thumb = t.closest('.thumb') as HTMLElement | null;
    if (thumb) {
      const i = [...document.querySelectorAll('.thumbs .thumb')].indexOf(thumb);
      const p = pages[i];
      if (p && !selection.has(p.id)) setSelection(new Set([p.id]));
      const n = p && selection.has(p.id) ? selection.size : 1;
      const what = n > 1 ? `${n} pages` : 'page';
      return [
        { label: `Rotate ${what} left`, icon: 'rotateLeft', shortcut: 'Shift+R', onClick: () => pageActions.current.rotate('left') },
        { label: `Rotate ${what} right`, icon: 'rotateRight', shortcut: 'R', onClick: () => pageActions.current.rotate('right') },
        { label: `Duplicate ${what}`, icon: 'duplicate', shortcut: 'Ctrl+D', onClick: () => pageActions.current.duplicateSelected() },
        { label: 'Insert blank page after', icon: 'blankPage', onClick: () => pageActions.current.insertBlank() },
        'separator',
        { label: `Save ${what} as a new PDF…`, icon: 'extract', onClick: () => void pageActions.current.extractSelected() },
        { label: 'Add bookmark here…', icon: 'bookmark', onClick: () => p && void addBookmarkFor(p.id) },
        'separator',
        { label: `Delete ${what}`, icon: 'trash', shortcut: 'Del', danger: true, onClick: () => pageActions.current.deleteSelected(), disabled: n >= pages.length },
      ];
    }
    // a pending change drawn on a page
    const pend = t.closest('[data-edit-id]') as HTMLElement | null;
    const pe = pend && edits.find((e) => e.id === pend.dataset.editId);
    if (pe) {
      setSelectedEdit(pe.id);
      const textual = pe.type === 'annotation' && (pe.annotation.kind === 'note' || pe.annotation.kind === 'freetext');
      return [
        ...(textual ? [{ label: 'Edit text…', icon: 'textBox' as const, onClick: () => editText(pe) }, 'separator' as const] : []),
        ...(pe.type === 'redact' ? [{ label: `Apply redactions (${marks.length})…`, icon: 'redact' as const, danger: true, onClick: () => setRedacting(true) }, 'separator' as const] : []),
        { label: pe.type === 'redact' ? 'Remove redaction mark' : 'Delete', icon: 'trash', shortcut: 'Del', danger: true, onClick: () => removeEdit(pe.id) },
      ];
    }
    // the page itself
    const pageEl = t.closest('.viewer-page') as HTMLElement | null;
    if (pageEl) {
      const picked = !!window.getSelection()?.toString().trim();
      const spot = pagePoint(pageEl, x, y);
      return [
        { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onClick: cmd('copy'), disabled: !picked },
        'separator',
        { label: 'Highlight text', icon: 'highlight', onClick: () => applyMarkup('highlight'), disabled: !picked },
        { label: 'Underline text', icon: 'underline', onClick: () => applyMarkup('underline'), disabled: !picked },
        { label: 'Strike through text', icon: 'strike', onClick: () => applyMarkup('strikeout'), disabled: !picked },
        // redacting straight into the open document (Settings) gets a one-step command
        ...(settings.redaction === 'in-place' ? [{ label: 'Redact text now…', icon: 'redact' as const, danger: true, onClick: () => redactSelection(true), disabled: !picked }] : []),
        { label: 'Mark text for redaction', icon: 'redact', onClick: () => redactSelection(), disabled: !picked },
        ...(settings.redaction === 'in-place' ? [{ label: 'Redact an area…', icon: 'redact' as const, onClick: () => chooseTool('redact') }] : []),
        'separator',
        { label: 'Add note here…', icon: 'note', onClick: () => spot && drawn(spot.item.id, { tool: 'note', at: spot.at }) },
        { label: 'Add bookmark to this page…', icon: 'bookmark', onClick: () => spot && void addBookmarkFor(spot.item.id) },
        'separator',
        { label: 'Select all text on this page', onClick: () => { const tl = pageEl.querySelector('.textLayer'); if (tl) { const r = document.createRange(); r.selectNodeContents(tl); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } } },
      ];
    }
    return [];
  }

  function openMenu(e: React.MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('.context-menu')) return;
    e.preventDefault();
    const items = menuFor(t, e.clientX, e.clientY);
    setMenu(items.length ? { x: e.clientX, y: e.clientY, items } : null);
  }

  function chooseTool(t: Tool) {
    if ((t === 'highlight' || t === 'underline' || t === 'strikeout') && applyMarkup(t)) return; // selected text: mark it right away
    if (t === 'signature' || t === 'initials') {
      const s = latestSig(t);
      if (s) { useSaved(t, s); return; }
      if (!(t === 'signature' ? signature : initials)) { setAskSignature(t); return; }
    }
    setTool(t);
    setSelectedEdit(null);
  }

  // with a markup tool active, every finished text selection is marked
  useEffect(() => {
    if (tool !== 'highlight' && tool !== 'underline' && tool !== 'strikeout') return;
    const onUp = () => setTimeout(() => { applyMarkup(tool); }, 0);
    document.addEventListener('pointerup', onUp);
    return () => document.removeEventListener('pointerup', onUp);
  });

  function drawn(pageId: string, d: Drawn) {
    const add = (e: PendingEdit) => { addEdits([e]); setSelectedEdit(e.id); };
    if (d.tool === 'note') {
      setPrompt({ title: 'Note', label: 'Note text', multiline: true, onOk: (v) => { if (!v.trim()) return 'Type a note.'; add({ id: newId(), type: 'annotation', pageId, author, annotation: { kind: 'note', at: d.at, text: v.trim() } }); return null; } });
    } else if (d.tool === 'freetext') {
      setPrompt({ title: 'Text box', label: 'Text', multiline: true, onOk: (v) => { if (!v.trim()) return 'Type some text.'; add({ id: newId(), type: 'annotation', pageId, author, annotation: { kind: 'freetext', rect: d.rect, text: v.trim(), size: 12 } }); return null; } });
    } else if (d.tool === 'square' || d.tool === 'circle') {
      add({ id: newId(), type: 'annotation', pageId, author, annotation: { kind: d.tool, rect: d.rect, width: 2 } });
    } else if (d.tool === 'ink') {
      add({ id: newId(), type: 'annotation', pageId, author, annotation: { kind: 'ink', paths: [d.path], width: 2 } });
    } else if (d.tool === 'link') {
      setPrompt({
        title: 'Link', label: 'Page number or web address', hint: `Type a page number (1-${pages.length}), a web address or an email address.`,
        onOk: (v) => {
          const t = v.trim();
          if (/^\d+$/.test(t)) {
            const n = parseInt(t, 10);
            if (n < 1 || n > pages.length) return `Choose a page from 1 to ${pages.length}.`;
            add({ id: newId(), type: 'link', pageId, rect: d.rect, target: { pageId: pages[n - 1]!.id } });
            return null;
          }
          const url = /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t) ? `mailto:${t}` : /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
          try { const u = new URL(url); if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return 'Only web and email addresses can be linked.'; add({ id: newId(), type: 'link', pageId, rect: d.rect, target: { url: u.href } }); return null; }
          catch { return 'That is not a page number or a valid address.'; }
        },
      });
    } else if (d.tool === 'redact') {
      const item = pages.find((p) => p.id === pageId);
      const id = newId();
      add({ id, type: 'redact', pageId, rect: d.rect });
      // remember the text under the mark, so the result can be checked for it
      if (item?.kind === 'page' && loaded[item.source]) {
        void pageText(loaded[item.source]!, item.page).then((pt) => {
          const text = textUnder(pt, d.rect);
          if (text) setEditor((ed) => ed && { ...ed, history: { ...ed.history, present: { ...ed.history.present, edits: ed.history.present.edits.map((x) => (x.id === id ? { ...x, text } : x)) } } });
        });
      }
    } else if ((d.tool === 'signature' && signature) || (d.tool === 'initials' && initials)) {
      const s = (d.tool === 'signature' ? signature : initials)!;
      add({ id: newId(), type: 'signature', pageId, rect: d.rect, image: s.image, typedName: s.typedName, caption: s.caption });
      setTool('select');
      setNotice(null);
    } else if (d.tool === 'line') {
      add({ id: newId(), type: 'mark', pageId, mark: { shape: 'line', from: d.from, to: d.to } });
    } else if (d.tool === 'check' || d.tool === 'cross' || d.tool === 'dot' || d.tool === 'box') {
      add({ id: newId(), type: 'mark', pageId, mark: { shape: d.tool, rect: d.rect } }); // the tool stays on for the next mark
    }
  }

  function editText(e: PendingEdit) {
    if (e.type !== 'annotation' || (e.annotation.kind !== 'note' && e.annotation.kind !== 'freetext')) return;
    const a = e.annotation;
    setPrompt({ title: a.kind === 'note' ? 'Note' : 'Text box', label: 'Text', multiline: true, initial: a.text, onOk: (v) => {
      if (!v.trim()) return 'Type some text, or remove it instead.';
      updateEdits((list) => list.map((x) => (x.id === e.id ? { ...e, annotation: { ...a, text: v.trim() } } : x)));
      return null;
    } });
  }

  // ---------- forms and bookmarks ----------
  useEffect(() => {
    setForm(null);
    const doc = loaded[0]?.doc;
    if (doc && loaded[0]!.notes.formFields && editor) void loadForm(doc, editor.sources[0]!.bytes).then(setForm, () => setForm({ fields: [], xfa: false }));
  }, [loaded]);
  const pendingValues = useMemo(() => fillValues(edits), [edits]);

  function setFieldValue(name: string, value: string | boolean | string[]) {
    updateEdits((list) => {
      const i = list.findIndex((e) => e.type === 'fill');
      if (i < 0) return [...list, { id: newId(), type: 'fill', values: { [name]: value } }];
      const e = list[i] as Extract<PendingEdit, { type: 'fill' }>;
      return list.map((x, k) => (k === i ? { ...e, values: { ...e.values, [name]: value } } : x));
    });
  }

  function revealField(name: string) {
    const f = form?.fields.find((x) => x.name === name);
    if (!f) return;
    const i = pages.findIndex((p) => p.kind === 'page' && p.source === 0 && p.page === f.page);
    if (i >= 0 && i !== current) goToPage(i);
  }

  async function saveFlattened() {
    if (!editor) return;
    try {
      const res = await window.docedit.save({
        sources: editor.sources.map((s) => s.bytes), slots: toSlots(pages),
        edits: [...resolveEdits(pages, editor.history.present.edits, editor.history.present.outline), { type: 'flatten' }],
        path: null, suggestedName: editor.title.replace(/\.pdf$/i, '') + ' (flattened).pdf',
        protect: editor.protection ?? null,
      });
      if (res.ok) setNotice({ kind: 'info', text: `Saved a flattened copy as ${res.file.name}. This document still has editable fields.` });
      else if (!res.cancelled) setNotice({ kind: 'error', text: `Could not save: ${res.message}` });
    } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }

  const outlineTree = editor?.history.present.outline ?? null;
  async function startEditingBookmarks() {
    if (!editor || !loaded[0]) return;
    const nodes = await loadOutlineNodes(loaded[0].doc, pages, 0);
    setEditor((ed) => ed && commitState(ed, { ...ed.history.present, outline: nodes }));
  }
  function setOutline(tree: OutlineNode[]) { setEditor((ed) => ed && commitState(ed, { ...ed.history.present, outline: tree })); }
  function renameBookmark(node: OutlineNode, apply: (title: string) => void) {
    setPrompt({ title: 'Bookmark', label: 'Title', initial: node.title, onOk: (v) => { if (!v.trim()) return 'Type a title.'; apply(v.trim()); return null; } });
  }

  // ---------- redaction ----------
  const marks = edits.filter((e): e is Extract<PendingEdit, { type: 'redact' }> => e.type === 'redact');

  function markSearchHits() {
    const q = search.query.trim();
    const created: PendingEdit[] = search.hits.flatMap((h) => h.rects.map((r) => ({
      id: newId(), type: 'redact' as const, pageId: h.pageId, text: h.text || q,
      rect: { x: r.x - 1, y: r.y - 1, width: r.width + 2, height: r.height + 2 },
    })));
    addEdits(created);
    setNotice({ kind: 'info', text: `Added ${created.length} pending redaction mark${created.length === 1 ? '' : 's'}. Review them on the pages, then use Apply redactions.` });
  }

  async function runRedaction(dpi: number, onStep: (s: string) => void) {
    if (!editor) throw new Error('No document');
    const state = editor.history.present;
    onStep('Preparing the document…');
    const laid = await window.docedit.previewEdits({ sources: editor.sources.map((s) => s.bytes), slots: toSlots(pages), edits: resolveEdits(pages, state.edits, state.outline) });
    if (!laid.ok) throw new Error(laid.message);
    const index = new Map(pages.map((p, i) => [p.id, i]));
    const live = marks.filter((m) => index.has(m.pageId));
    const res = await redact(laid.bytes, live.map((m) => ({ page: index.get(m.pageId)!, rect: m.rect })), live.flatMap((m) => (m.text ? [m.text] : [])), dpi, onStep);
    if (!res.bytes) return { checks: res.checks, saved: null, cancelled: false };
    if (settings.redaction === 'in-place') {
      // the verified result replaces what is open; nothing is written until the user saves
      onStep('Applying to the open document…');
      await replaceDocument({ path: editor.path, name: editor.title, bytes: res.bytes }, current, editor.protection ?? null, true);
      setEditor((ed) => ed && { ...ed, sourceChanged: true });
      setNotice({ kind: 'info', text: 'Redactions applied to this document. Save to keep them: the file on disk still has the removed content until you do.' });
      return { checks: res.checks, saved: null, applied: true, cancelled: false };
    }
    onStep('Choose where to save the redacted copy…');
    const saved = await window.docedit.saveCopy({ bytes: res.bytes, suggestedName: `${editor.title.replace(/\.pdf$/i, '')} (redacted).pdf`, notOver: editor.sources.flatMap((s) => (s.path ? [s.path] : [])), protect: editor.protection ?? null });
    if (!saved.ok && !saved.cancelled) throw new Error(saved.message ?? 'Could not save');
    return { checks: res.checks, saved: saved.ok ? saved.path : null, cancelled: false };
  }

  /** Export to Word, text or images; resolves with the first written path, or null when cancelled. */
  async function runExport(kind: ExportKind, dpi: number, onStep: (s: string) => void): Promise<string | null> {
    if (!editor || !(await confirmExportWithMarks())) return null;
    onStep('Preparing the document…');
    const files = await exportDocument(await currentBytes(), editor.title, kind, dpi, onStep);
    onStep(files.length > 1 ? 'Choose a folder for the page images…' : 'Choose where to save…');
    const res = await window.docedit.saveExport({ files, kind });
    if (!res.ok) { if (res.cancelled) return null; throw new Error(res.message); }
    setNotice({ kind: 'info', text: res.paths.length === 1 ? `Exported to ${res.paths[0]}.` : `Exported ${res.paths.length} page images to ${res.paths[0]!.replace(/[\\/][^\\/]+$/, '')}.` });
    return res.paths[0]!;
  }

  /** The document exactly as Save would write it now. */
  async function currentBytes(): Promise<Uint8Array> {
    if (!editor) throw new Error('No document');
    const state = editor.history.present;
    const res = await window.docedit.previewEdits({ sources: editor.sources.map((s) => s.bytes), slots: toSlots(pages), edits: resolveEdits(pages, state.edits, state.outline) });
    if (!res.ok) throw new Error(res.message);
    return res.bytes;
  }

  async function runSanitize(remove: HiddenCategory[]) {
    const res = await window.docedit.sanitize(await currentBytes(), remove);
    if (!res.ok) throw new Error(res.message);
    const saved = await window.docedit.saveCopy({ bytes: res.bytes, suggestedName: `${editor!.title.replace(/\.pdf$/i, '')} (clean).pdf`, notOver: editor!.sources.flatMap((s) => (s.path ? [s.path] : [])), protect: editor!.protection ?? null });
    if (!saved.ok && !saved.cancelled) throw new Error(saved.message ?? 'Could not save');
    return { saved: saved.ok ? saved.path : null, remaining: res.remaining as InspectionItem[] };
  }

  // ---------- certificate signatures ----------
  const hasSignatures = !!loaded[0]?.notes.signatures;
  // A check that finishes after the document changed, or after a newer check started, must not show its verdict
  // (or its error) on what is open now.
  const verification = useRef(latestOnly());
  const verifyOpened = useCallback(() => {
    const live = verification.current.start();
    const bytes = editor?.sources[0]?.bytes;
    if (!bytes || !loaded[0]?.notes.signatures) { setSigReports(null); return; }
    setSigReports(null);
    void window.docedit.verifySignatures(bytes).then(
      (r) => { if (live()) setSigReports(r as SignatureReport[]); },
      (e) => { if (live()) setNotice({ kind: 'error', text: `Could not check signatures: ${errText(e)}` }); },
    );
  }, [editor?.sources, loaded]);
  useEffect(() => { verifyOpened(); return () => verification.current.cancel(); }, [verifyOpened]);
  // trust changes re-check whatever document is open by then, never the one open when the button was pressed
  const verifyNow = useRef(verifyOpened);
  verifyNow.current = verifyOpened;

  function signWarnings(): string[] {
    const w: string[] = [];
    if (hasSignatures && dirty) w.push('This document already has signatures. Signing it with your unsaved changes will invalidate them; save or undo your changes first to keep them valid.');
    return w;
  }

  async function runCertSign(req: CertSignRequest): Promise<string | null> {
    if (!editor) return 'No document';
    if (editor.protection) return 'Remove password protection before signing: encrypting afterwards would break the signature.';
    const bytes = await currentBytes();
    const item = pages[current];
    let rect: { x: number; y: number; width: number; height: number } | undefined;
    if (req.visible && item) {
      const { view } = placement(item, loaded);
      rect = { x: view[0]! + 36, y: view[1]! + 36, width: 220, height: 50 };
    }
    const res = await window.docedit.certSign({ pdf: bytes, p12Path: req.p12Path, password: req.password, reason: req.reason, location: req.location, page: current, rect });
    if (!res.ok) return res.message;
    const saved = await window.docedit.saveCopy({ bytes: res.bytes, suggestedName: `${editor.title.replace(/\.pdf$/i, '')} (signed).pdf`, notOver: [] });
    if (!saved.ok) return saved.cancelled ? null : saved.message ?? 'Could not save';
    // open the signed copy, so what you see is what was signed
    const f = await window.docedit.openWritten(saved.path);
    await replaceDocument(f);
    setTab('signatures');
    setNotice({ kind: 'info', text: `Signed by ${res.signer} and saved as ${f.name}. Any change to this file from now on will show up when the signature is checked.` });
    return null;
  }

  function removeEdit(id: string) { updateEdits((list) => list.filter((x) => x.id !== id)); if (selectedEdit === id) setSelectedEdit(null); }

  function revealEdit(e: PendingEdit) {
    setSelectedEdit(e.id);
    if ('pageId' in e) { const i = pages.findIndex((p) => p.id === e.pageId); if (i >= 0) goToPage(i); }
  }

  // Delete removes the selected pending edit; Escape returns to the select tool
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest('input, textarea, select, dialog, .thumbs')) return;
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedEdit) { ev.preventDefault(); removeEdit(selectedEdit); }
      else if (ev.key === 'Escape') { setTool('select'); setSelectedEdit(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function goToPage(index: number) {
    const i = Math.max(0, Math.min(pages.length - 1, index));
    viewer.current?.scrollToPage(i);
    setCurrent(i);
  }

  // ---------- search, bookmarks and links ----------
  function goHit(i: number) {
    const hit = search.hits[i];
    if (!hit) return;
    search.setActive(i);
    setCurrent(hit.pageIndex);
    if (hit.rects[0]) viewer.current?.scrollToRect(hit.pageIndex, hit.rects[0]);
    else viewer.current?.scrollToPage(hit.pageIndex);
  }

  function openFind() {
    setTab('search');
    requestAnimationFrame(() => { searchInput.current?.focus(); searchInput.current?.select(); });
  }

  /** Resolve a pdf.js destination of a source document to a position in the current page list. */
  async function goToDest(dest: unknown, source: number) {
    const src = loaded[source];
    if (!src) return;
    try {
      const explicit = typeof dest === 'string' ? await src.doc.getDestination(dest) : dest;
      const target = Array.isArray(explicit) ? explicit[0] : null;
      const pageIndex = typeof target === 'number' ? target
        : target && typeof target === 'object' ? await src.doc.getPageIndex(target as { num: number; gen: number }) : -1;
      const at = pages.findIndex((p) => p.kind === 'page' && p.source === source && p.page === pageIndex);
      if (at >= 0) goToPage(at);
      else setNotice({ kind: 'info', text: pageIndex >= 0 ? 'The page this link points to has been removed from the document.' : 'This link does not point to a page in the document.' });
    } catch {
      setNotice({ kind: 'error', text: 'This link points to a destination that does not exist.' });
    }
  }

  function openUrl(url: string) {
    void window.docedit.openExternal(url).catch((e) => setNotice({ kind: 'error', text: errText(e) }));
  }

  function onLink(link: PageLink, fromPage: number) {
    if ('url' in link) openUrl(link.url);
    else {
      const item = pages[fromPage];
      void goToDest(link.dest, item?.kind === 'page' ? item.source : 0);
    }
  }

  // ---------- menu commands (registered once, always calling the latest handler) ----------
  const handlers: Record<MenuCommand, () => void> = {
    'new-blank': () => setCreating('blank'),
    'new-images': () => setCreating('images'),
    'new-text': () => setCreating('text'),
    'new-office': () => setCreating('office'),
    'open': () => void openViaDialog(),
    'insert-file': () => void insertViaDialog(),
    'save': () => void save(false),
    'save-as': () => void save(true),
    'print': () => setPrinting(true),
    'close-document': closeDocument,
    'undo': () => setEditor((ed) => ed && undo(ed)),
    'redo': () => setEditor((ed) => ed && redo(ed)),
    'find': openFind,
    'find-next': () => { if (search.hits.length) goHit((search.active + 1) % search.hits.length); else openFind(); },
    'find-prev': () => { if (search.hits.length) goHit((search.active - 1 + search.hits.length) % search.hits.length); else openFind(); },
    'zoom-in': () => stepZoom(1),
    'zoom-out': () => stepZoom(-1),
    'zoom-reset': () => setZoom({ mode: 'custom', scale: 1 }),
    settings: () => setShowSettings(true),
    export: () => { if (editor) setExporting(true); },
    'new-scan': () => setScanning(true),
    'fit-width': () => setZoom({ mode: 'fit-width', scale: computeFit('fit-width') }),
    'fit-page': () => setZoom({ mode: 'fit-page', scale: computeFit('fit-page') }),
    'rotate-left': () => edit((ps) => rotate(ps, selection, -90)),
    'rotate-right': () => edit((ps) => rotate(ps, selection, 90)),
    'delete-pages': deleteSelected,
    'duplicate-pages': duplicateSelected,
    'insert-blank': insertBlank,
    'crop': () => setOrganizing('crop'),
    'split': () => setOrganizing('split'),
    'properties': () => setOrganizing('properties'),
    'furniture': () => setOrganizing('furniture'),
    'sanitize': () => setOrganizing('sanitize'),
    'protect': () => setOrganizing('protect'),
    'cert-sign': () => setOrganizing('cert-sign'),
    'extract': () => void extractSelected(),
    'save-then-close-window': () => void save(false).then((ok) => window.docedit.closeWindowAfterSave(ok)),
  };
  const latest = useRef(handlers);
  latest.current = handlers;
  const latestReplace = useRef(replaceDocument);
  latestReplace.current = replaceDocument;
  useEffect(() => window.docedit.onMenu((cmd) => {
    const needsDoc = !['open', 'undo', 'redo', 'new-blank', 'new-images', 'new-text', 'new-office'].includes(cmd);
    if (needsDoc && !editor && cmd !== 'save-then-close-window') return;
    latest.current[cmd]();
  }), [editor]);

  useEffect(() => {
    const off = window.docedit.onOpenFile((f) => {
      if ('error' in f) setNotice({ kind: 'error', text: f.error });
      else void latestReplace.current(f);
    });
    window.docedit.ready();
    return off;
  }, []);

  // Ctrl+wheel zooms the document view.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey && editor) { e.preventDefault(); stepZoom(e.deltaY < 0 ? 1 : -1); } };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [editor]);

  // Dropping a PDF anywhere outside the page list opens it.
  async function dropOnWindow(e: DragEvent) {
    e.preventDefault();
    if (!e.dataTransfer.files.length || !(await confirmDiscard())) return;
    try {
      const files = await readDropped([...e.dataTransfer.files]);
      if (files[0]) await replaceDocument(files[0]);
    } catch (err) { setNotice({ kind: 'error', text: errText(err) }); }
  }

  const zoomLabel = useMemo(() => `${Math.round(zoom.scale * 100)}%`, [zoom.scale]);
  const canUndo = !!editor?.history.past.length, canRedo = !!editor?.history.future.length;
  const has = !!editor;

  return (
    <div className="app" onContextMenu={openMenu} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={dropOnWindow}>
      <header className="appbar">
        <div className="brand" title="Oakqueill PDF Editor"><img src={logo} alt="" width={22} height={22} /><span>Oakqueill</span></div>
        <div className="quick" role="toolbar" aria-label="File">
          <IconButton icon="new" label="New" title="New document (Ctrl+N)" onClick={() => setCreating('blank')} />
          <IconButton icon="open" label="Open" title="Open (Ctrl+O)" onClick={() => void openViaDialog()} />
          <IconButton icon="save" label="Save" title="Save (Ctrl+S) · Save As is Ctrl+Shift+S" onClick={() => void save(false)} disabled={!has} />
          <IconButton icon="print" label="Print" wide title="Print (Ctrl+P)" onClick={() => setPrinting(true)} disabled={!has} />
          <span className="sep wide-only" />
          <IconButton icon="undo" label="Undo" wide title="Undo (Ctrl+Z)" onClick={handlers.undo} disabled={!canUndo} />
          <IconButton icon="redo" label="Redo" wide title="Redo (Ctrl+Y)" onClick={handlers.redo} disabled={!canRedo} />
        </div>
        {has && (
          <nav className="ribbon-tabs" role="tablist" aria-label="Tool groups">
            {RIBBON_TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={ribbon === id} className={ribbon === id ? 'on' : ''} onClick={() => pickRibbon(id)}>{label}</button>
            ))}
          </nav>
        )}
        <div className="spacer" />
        {has && (
          <div className="view-controls" role="toolbar" aria-label="View">
            <form onSubmit={(e) => {
              e.preventDefault();
              const typed = pageInput.trim();
              // a page label from the file (e.g. "iv") is used only when what was typed is not a plain number
              const byLabel = /^\d+$/.test(typed) ? -1 : pages.findIndex((p) => p.kind === 'page' && loaded[p.source]?.labels?.[p.page]?.toLowerCase() === typed.toLowerCase());
              const n = byLabel >= 0 ? byLabel + 1 : parseInt(typed, 10);
              if (n) goToPage(n - 1); else setPageInput(String(current + 1));
            }}>
              <label className="page-nav">
                <span className="sr-only">Page number</span>
                <input value={pageInput} disabled={!has} onChange={(e) => setPageInput(e.target.value.slice(0, 16))} onBlur={() => setPageInput(pages.length ? String(current + 1) : '')} inputMode="numeric" aria-label="Page number" />
                <span>/ {pages.length || '–'}{has && pageLabel(current).includes('(') ? ' ' + pageLabel(current).slice(pageLabel(current).indexOf('(')) : ''}</span>
              </label>
            </form>
            <span className="sep" />
            <IconButton icon="minus" label="Zoom out" title="Zoom out (Ctrl+-)" onClick={() => stepZoom(-1)} />
            <span className="zoom-label" aria-live="polite">{zoomLabel}</span>
            <IconButton icon="plus" label="Zoom in" title="Zoom in (Ctrl+=)" onClick={() => stepZoom(1)} />
            <IconButton icon="fitWidth" label="Fit width" wide title="Fit width (Ctrl+1)" onClick={handlers['fit-width']} pressed={zoom.mode === 'fit-width'} />
            <IconButton icon="fitPage" label="Fit page" wide title="Fit page (Ctrl+2)" onClick={handlers['fit-page']} pressed={zoom.mode === 'fit-page'} />
          </div>
        )}
        <IconButton icon="settings" label="Settings" title="Settings (Ctrl+,)" onClick={() => setShowSettings(true)} />
      </header>
      {has && (
        <div className="toolbar tools" role="toolbar" aria-label={RIBBON_TABS.find(([id]) => id === ribbon)![1]}>
          {ribbon === 'comment' && (
            <div className="group">
              {COMMENT_TOOLS.map(([t, icon, label, title]) => (
                <ToolButton key={t} icon={icon} label={label} title={title} pressed={tool === t} onClick={() => chooseTool(t)} />
              ))}
            </div>
          )}
          {ribbon === 'pages' && (
            <>
              <div className="group">
                <ToolButton icon="rotateLeft" label="Rotate left" title="Rotate selected pages left (Shift+R)" onClick={handlers['rotate-left']} />
                <ToolButton icon="rotateRight" label="Rotate right" title="Rotate selected pages right (R)" onClick={handlers['rotate-right']} />
                <ToolButton icon="crop" label="Crop" title="Crop selected pages (Ctrl+Shift+C)" onClick={() => setOrganizing('crop')} />
              </div>
              <div className="group">
                <ToolButton icon="blankPage" label="Blank page" title="Insert a blank page after the selection (Ctrl+Shift+B)" onClick={insertBlank} />
                <ToolButton icon="insertFile" label="Insert file" title="Insert pages from another PDF (Ctrl+I)" onClick={() => void insertViaDialog()} />
                <ToolButton icon="duplicate" label="Duplicate" title="Duplicate selected pages (Ctrl+D)" onClick={duplicateSelected} />
              </div>
              <div className="group">
                <ToolButton icon="extract" label="Extract" title="Save the selected pages as a new PDF (Ctrl+E)" onClick={() => void extractSelected()} />
                <ToolButton icon="split" label="Split" title="Split into several PDFs" onClick={() => setOrganizing('split')} disabled={pages.length < 2} />
              </div>
              <div className="group">
                <ToolButton icon="trash" label="Delete" title="Delete selected pages (Delete)" onClick={deleteSelected} disabled={selection.size >= pages.length} danger />
              </div>
            </>
          )}
          {ribbon === 'protect' && (
            <>
              <div className="group fill-sign" aria-label="Fill and sign">
                {(['signature', 'initials'] as const).map((k) => {
                  const s = latestSig(k);
                  return s
                    ? <span key={k} className={`sig-chip${tool === k ? ' on' : ''}`}>
                        <button className="sig-chip-use" aria-pressed={tool === k} title={`Place your ${k}`} aria-label={`Place your ${k}`} onClick={() => useSaved(k, s)}>
                          {s.image ? <img src={`data:image/${s.image.format === 'png' ? 'png' : 'jpeg'};base64,${s.image.base64}`} alt="" /> : <span className="sig-typed">{s.typedName}</span>}
                        </button>
                        <button className="sig-chip-x" title={`Delete your saved ${k}`} aria-label={`Delete your saved ${k}`} onClick={() => void deleteSaved(k, s)}><Icon name="cross" size={14} /></button>
                      </span>
                    : <ToolButton key={k} icon="plus2" label={k === 'signature' ? 'Add signature' : 'Add initials'} title={`Create your ${k}; it is kept on this computer for next time`} pressed={tool === k} onClick={() => setAskSignature(k)} />;
                })}
              </div>
              <div className="group marks" aria-label="Marks">
                {MARK_BUTTONS.map(([t, icon, title]) => (
                  <button key={t} className="tool-btn icon-only" title={title} aria-label={title.split(':')[0]} aria-pressed={tool === t} onClick={() => chooseTool(t)}><Icon name={icon} /></button>
                ))}
              </div>
              <div className="group">
                <ToolButton icon="certificate" label="Sign digitally" title="Sign with a certificate (.p12/.pfx)" onClick={() => setOrganizing('cert-sign')} />
              </div>
              <div className="group">
                <ToolButton icon="redact" label="Redact" title="Drag over areas to mark them for permanent removal" pressed={tool === 'redact'} onClick={() => chooseTool('redact')} />
                <ToolButton icon="sanitize" label="Sanitize" title="Find and remove metadata, attachments, comments, scripts and other hidden information" onClick={() => setOrganizing('sanitize')} />
                <ToolButton icon="lock" label={editor?.protection ? 'Protected' : 'Password'} title="Protect with a password" pressed={!!editor?.protection} onClick={() => setOrganizing('protect')} />
              </div>
            </>
          )}
          {ribbon === 'document' && (
            <>
            <div className="group">
              <ToolButton icon="info" label="Properties" title="Title, author, subject, keywords" onClick={() => setOrganizing('properties')} />
              <ToolButton icon="headerFooter" label="Header/Footer" title="Headers, footers, page numbers, Bates numbers, watermark" onClick={() => setOrganizing('furniture')} />
            </div>
            <div className="group">
              <ToolButton icon="export" label="Export" title="Save as Word, text or images" onClick={() => setExporting(true)} />
            </div>
            </>
          )}
          <div className="spacer" />
          {marks.length > 0 && (
            <button className="apply-redactions" onClick={() => setRedacting(true)} title="Remove the marked content permanently, into a new copy"><Icon name="redact" />Apply redactions ({marks.length})</button>
          )}
        </div>
      )}

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {editor ? (
        <main className="workspace">
          <aside className="sidebar">
            <div className="tabs" role="tablist" aria-label="Sidebar">
              {(['pages', 'outline', 'search', 'changes', ...(form?.fields.some((f) => !['signature', 'button', 'other'].includes(f.type)) ? ['forms' as const] : []), ...(hasSignatures ? ['signatures' as const] : [])] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => (t === 'search' ? openFind() : setTab(t))}>
                  {t === 'pages' ? 'Pages' : t === 'outline' ? 'Bookmarks' : t === 'search' ? 'Search' : t === 'forms' ? 'Form' : t === 'signatures' ? 'Signatures' : `Changes${edits.length ? ` (${edits.length})` : ''}`}
                </button>
              ))}
            </div>
            {tab === 'outline' && loaded[0] && (outlineTree
              ? <BookmarksEditor tree={outlineTree} pages={pages} currentPage={current} onChange={setOutline} onGo={goToPage} onRename={renameBookmark} />
              : <>
                  <div className="bm-actions"><button onClick={() => void startEditingBookmarks()}>Edit bookmarks</button></div>
                  <Outline doc={loaded[0].doc} onDest={(d) => void goToDest(d, 0)} onUrl={openUrl} />
                </>)}
            {tab === 'signatures' && <SignaturesPanel reports={sigReports} dirty={dirty}
              // the question is asked by the main process, which reads the certificate itself
              onTrust={(r) => { const c = r.certificate; if (c) void window.docedit.trustCertificate(c.der, true).then((ok) => { if (ok) verifyNow.current(); }); }}
              onUntrust={(r) => { if (r.certificate) void window.docedit.trustCertificate(r.certificate.der, false).then(() => verifyNow.current()); }} />}
            {tab === 'forms' && <FormsPanel form={form} pending={pendingValues} onChange={setFieldValue} onReveal={(f) => revealField(f.name)} onSaveFlattened={() => void saveFlattened()} />}
            {tab === 'changes' && <ChangesPanel edits={edits} pages={pages} selected={selectedEdit} onSelect={revealEdit} onEditText={editText} onDelete={(e) => removeEdit(e.id)} />}
            {tab === 'search' && <SearchPanel ref={searchInput} search={search} pageLabel={pageLabel} onGo={goHit} onMarkAll={markSearchHits} />}
            {tab === 'pages' && <div className="sidebar-head">{selection.size > 1 ? `${selection.size} pages selected` : `${pages.length} page${pages.length === 1 ? '' : 's'}`}</div>}
            {tab === 'pages' && <Thumbnails
              pages={pages}
              loaded={loaded}
              pageLabel={pageLabel}
              selection={selection}
              currentIndex={current}
              onSelect={(ids) => setSelection(ids)}
              onActivate={goToPage}
              onDrop={(gap) => edit((ps) => dropAt(ps, selection, gap))}
              onDropFiles={(files, gap) => void readDropped(files).then((f) => insertFiles(f, gap)).catch((e) => setNotice({ kind: 'error', text: errText(e) }))}
              onKeyCommand={(cmd) => {
                if (cmd === 'delete') deleteSelected();
                else if (cmd === 'rotate-left') handlers['rotate-left']();
                else if (cmd === 'rotate-right') handlers['rotate-right']();
                else edit((ps) => nudge(ps, selection, cmd === 'nudge-up' ? -1 : 1));
              }}
            />}
          </aside>
          <Viewer ref={viewer} pages={pages} loaded={loaded} scale={zoom.scale} onCurrentPage={setCurrent} onResize={refit} highlights={highlights} onLink={tool === 'select' ? onLink : undefined}
            overlay={({ item, view, rotation, scale, width, height }) => (
              <EditLayer pageId={item.id} view={view} rotation={rotation} scale={scale} width={width} height={height}
                edits={edits.filter((e) => 'pageId' in e && e.pageId === item.id)} tool={tool}
                fieldMarks={item.kind === 'page' && item.source === 0 && form ? form.fields.filter((f) => f.page === item.page && f.name in pendingValues).map((f) => ({ name: f.name, rect: { x: f.rect[0], y: f.rect[1], width: f.rect[2] - f.rect[0], height: f.rect[3] - f.rect[1] }, value: pendingValues[f.name]! })) : undefined}
                onFieldClick={(name) => { setTab('forms'); requestAnimationFrame(() => (document.querySelector(`[data-field="${CSS.escape(name)}"] input, [data-field="${CSS.escape(name)}"] select, [data-field="${CSS.escape(name)}"] textarea`) as HTMLElement | null)?.focus()); }}
                selectedEdit={selectedEdit} onSelectEdit={setSelectedEdit} onDrawn={(d) => drawn(item.id, d)} />
            )} />
        </main>
      ) : (
        <main className="empty">
          <div className="empty-card">
            <img className="empty-logo" src={logo} alt="" />
            <h1>Oakqueill PDF Editor</h1>
            <p>Open a PDF to read it and organize its pages.</p>
            <button className="primary" onClick={() => void openViaDialog()}>Open a PDF…</button>
            <p className="hint">or drop a PDF file anywhere in this window</p>
            <div className="empty-new">
              <span className="muted">Start a new PDF:</span>
              <button onClick={() => setCreating('blank')}>Blank pages</button>
              <button onClick={() => setCreating('images')}>From images</button>
              <button onClick={() => setCreating('text')}>From text</button>
              <button onClick={() => setCreating('office')}>From Word/Office</button>
              {scannerPresent && <button onClick={() => setScanning(true)}>From scanner</button>}
            </div>
          </div>
        </main>
      )}

      {recoverable.length > 0 && (
        <RecoveryDialog items={recoverable}
          onRecover={(id) => { const rest = recoverable.filter((r) => r.id !== id); setRecoverable([]); void recover(id).then(() => setRecoverable(rest)); }}
          onDiscard={(id) => { void window.docedit.recoveryClear(id).catch(() => {}); setRecoverable((l) => l.filter((r) => r.id !== id)); }}
          onLater={() => setRecoverable([])} />
      )}
      {creating && (
        <NewDocumentDialog kind={creating} onClose={() => setCreating(null)}
          onCreated={async (file, note) => {
            if (!(await confirmDiscard())) return;
            setCreating(null);
            void replaceDocument(file).then(() => setNotice(note ? { kind: 'info', text: note } : { kind: 'info', text: 'New document created. Save it to keep it.' }));
          }} />
      )}
      {organizing === 'crop' && editor && (
        <CropDialog count={[...selection].filter((id) => pages.some((p) => p.id === id && p.kind === 'page')).length}
          onApply={(m) => {
            let failed = 0;
            const next = setCrop(pages, selection, (p) => {
              const g = loaded[p.source]?.pages[p.page];
              const c = g ? cropFromMargins(g.view, placement(p, loaded).rotation, m) : null;
              if (!c) failed++;
              return c ?? p.crop ?? null;
            });
            if (failed) return `The margins are larger than ${failed === 1 ? 'a selected page' : `${failed} of the selected pages`}.`;
            edit(() => next);
            return null;
          }}
          onRemove={() => edit((ps) => setCrop(ps, selection, () => null))}
          onClose={() => setOrganizing(null)} />
      )}
      {redacting && editor && (
        <RedactDialog inPlace={settings.redaction === 'in-place'} markCount={marks.length} pageCount={new Set(marks.map((m) => m.pageId)).size}
          run={runRedaction} onClose={() => setRedacting(false)}
          onOpenResult={(path) => { setRedacting(false); void confirmDiscard().then((ok) => { if (ok) void window.docedit.openWritten(path).then((f) => replaceDocument(f), (e) => setNotice({ kind: 'error', text: errText(e) })); }); }} />
      )}
      {askSignature && (
        <SignatureDialog kind={askSignature} onClose={() => setAskSignature(null)} onChosen={(s) => { const k = askSignature; if (k === 'initials') setInitials(s); else setSignature(s); setAskSignature(null); reloadSigs(); setTool(k); setNotice({ kind: 'info', text: `Click or drag on a page to place your ${k}. Press Escape to cancel.` }); }} />
      )}
      {prompt && <TextPrompt {...prompt} onClose={() => setPrompt(null)} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {exporting && editor && <ExportDialog protectedDoc={!!editor.protection} run={runExport} onClose={() => setExporting(false)} />}
      {scanning && <ScanDialog onClose={() => setScanning(false)} onCreated={(file) => { void confirmDiscard().then((ok) => { setScanning(false); if (ok) void replaceDocument(file).then(() => setNotice({ kind: 'info', text: 'Scanned document created. Save it to keep it.' })); }); }} />}
      {showSettings && <SettingsDialog settings={settings} onChange={changeSettings} onClose={() => setShowSettings(false)} />}
      {organizing === 'cert-sign' && editor && <CertSignDialog warnings={signWarnings()} run={runCertSign} onClose={() => setOrganizing(null)} />}
      {organizing === 'protect' && editor && (
        <ProtectDialog current={(editor.protection ?? null) as never} onClose={() => setOrganizing(null)}
          onApply={(p) => setEditor((ed) => ed && { ...ed, protection: p as Editor['protection'], protectionChanged: true })} />
      )}
      {organizing === 'sanitize' && editor && (
        <SanitizeDialog inspect={async () => (await window.docedit.inspect(await currentBytes())) as InspectionItem[]} run={runSanitize} onClose={() => setOrganizing(null)} />
      )}
      {organizing === 'properties' && editor && (
        <PropertiesDialog current={effectiveMeta} onClose={() => setOrganizing(null)}
          onApply={(m) => addEdits([{ id: newId(), type: 'metadata', meta: { title: m.title, author: m.author, subject: m.subject, keywords: m.keywords.split(/[,;]/).map((k) => k.trim()).filter(Boolean) } }])} />
      )}
      {organizing === 'furniture' && editor && (
        <FurnitureDialog pages={pages} sources={editor.sources.map((s) => s.bytes)} selection={selection} onApply={addEdits} onClose={() => setOrganizing(null)} />
      )}
      {organizing === 'split' && editor && <SplitDialog pageCount={pages.length} onSplit={(g) => void split(g)} onClose={() => setOrganizing(null)} />}
      {printing && editor && (
        <PrintDialog title={editor.title} pages={pages} loaded={loaded} current={current} selection={selection}
          onClose={(msg) => { setPrinting(false); if (msg) setNotice(msg); }} />
      )}
      {busy && <div className="busy" role="status">{busy}</div>}
    </div>
  );
}

/** Merge rectangles that sit on the same line and touch, so a highlighted phrase is one box per line. */
function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => b.y - a.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last.y - r.y) < Math.min(last.height, r.height) * 0.5 && Math.abs(last.height - r.height) < Math.max(last.height, r.height) * 0.5;
    if (last && sameLine && r.x <= last.x + last.width + 4) {
      const x0 = Math.min(last.x, r.x), x1 = Math.max(last.x + last.width, r.x + r.width);
      const y0 = Math.min(last.y, r.y), y1 = Math.max(last.y + last.height, r.y + r.height);
      out[out.length - 1] = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    } else out.push(r);
  }
  return out;
}
