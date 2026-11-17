/**
 * The Oakqueill viewer for PDFs opened in the browser: read, zoom, find, print and save.
 * Built from the desktop app's own viewer pieces (page list, page rendering, search, icons, styles); no editing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Viewer, fullSize, clipFor, itemSize, type Highlights, type ViewerHandle } from '../../desktop/src/renderer/Viewer.js';
import { PageCanvas, type PageLink } from '../../desktop/src/renderer/PageCanvas.js';
import { loadSource, PdfOpenError, type LoadedSource } from '../../desktop/src/renderer/pdf.js';
import { pagesForSource, type PageItem } from '../../desktop/src/renderer/model.js';
import { useSearch } from '../../desktop/src/renderer/useSearch.js';
import { SearchPanel } from '../../desktop/src/renderer/SearchPanel.js';
import { Icon, type IconName } from '../../desktop/src/renderer/icons.js';
import logo from '../../desktop/src/renderer/assets/logo.png';
import { sourceFromLocation } from './address.js';
import { readCapped, TooLargeError } from './download.js';
import { lastFitting, parseRange, printPixels, printScale, rangePixels, PRINT_BUDGET } from './print.js';

export { sourceFromLocation };

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
type Zoom = { mode: 'fit-width' | 'fit-page' | 'custom'; scale: number };

/** A readable file name: from Content-Disposition when the server gives one, else from the address. */
export function fileName(url: string, disposition: string | null): string {
  const star = disposition && /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  const plain = disposition && /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  let name = '';
  try { name = star ? decodeURIComponent(star[1]!) : plain ? plain[1]! : decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { /* keep empty */ }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'document.pdf';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function Button({ icon, label, title, onClick, pressed, disabled }: { icon: IconName; label: string; title: string; onClick(): void; pressed?: boolean; disabled?: boolean }) {
  return <button className="icon-btn" aria-label={label} title={title} onClick={onClick} aria-pressed={pressed} disabled={disabled}><Icon name={icon} /></button>;
}

export function ViewerApp() {
  const src = useMemo(() => sourceFromLocation(location.href), []);
  const [name, setName] = useState(src ? fileName(src.url, null) : 'PDF');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [error, setError] = useState<{ text: string; canBypass: boolean } | null>(null);
  const [askPassword, setAskPassword] = useState<string | null>(null); // the message to show, or null
  const [password, setPassword] = useState('');
  const [rotate, setRotate] = useState(0);
  const [zoom, setZoom] = useState<Zoom>({ mode: 'fit-width', scale: 1 });
  const [current, setCurrent] = useState(0);
  const [pageInput, setPageInput] = useState('1');
  const [side, setSide] = useState<'thumbs' | 'find' | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  /** a large document: which pages to print (as typed), and why the last try was refused */
  const [printAsk, setPrintAsk] = useState<{ range: string; error: string } | null>(null);
  const printCancel = useRef(false);
  /** this tab was not sent here by the browser for this address: the user decides whether to open it */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const viewer = useRef<ViewerHandle>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const startPage = useRef<number | null>(null);

  // the document as a list of pages (the desktop page model, without editing); "rotate view" turns them all
  const basePages = useMemo<PageItem[]>(() => (loaded ? pagesForSource(0, loaded.pages.length) : []), [loaded]);
  const pages = useMemo(() => basePages.map((p) => ({ ...p, rotate: rotate })), [basePages, rotate]);
  const sources = useMemo(() => (loaded ? [loaded] : []), [loaded]);
  const search = useSearch(pages, sources);

  // fetch the PDF (the browser usually has it cached already) and open it
  useEffect(() => {
    if (!src) { setError({ text: 'No PDF address was given.', canBypass: false }); return; }
    // only in its own tab: inside another page it would load with the user's sign-ins on that page's behalf
    if (window.top !== window) { setError({ text: 'Oakqueill PDF Viewer works only in its own browser tab.', canBypass: false }); return; }
    // stops the download when the page goes away or another address is opened
    const abort = new AbortController();
    void (async () => {
      // load only what the browser just sent this tab here for (see background.ts); anything else asks first
      const allowed = await chrome.runtime.sendMessage({ type: 'claim', url: src.url }).catch(() => false);
      if (allowed !== true) { setConfirmOpen(true); return; }
      try {
        const res = await fetch(src.url, { credentials: 'include', signal: abort.signal });
        if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}.`.replace(' .', '.'));
        setName(fileName(src.url, res.headers.get('content-disposition')));
        setBytes(await readCapped(res, undefined, abort.signal));
      } catch (e) {
        if (abort.signal.aborted) return;
        const local = src.url.startsWith('file:');
        // too large: the browser's own viewer (or saving the file) is the way to open it
        if (e instanceof TooLargeError) { setError({ text: `${e.message}${local ? ' Open it with the Oakqueill app instead.' : ' You can open it in the browser’s own viewer.'}`, canBypass: !local }); return; }
        setError({
          text: local
            ? 'This file on your computer cannot be read. To open local PDFs, turn on “Allow access to file URLs” for Oakqueill PDF Viewer on the browser’s extensions page.'
            : `This PDF could not be loaded again for viewing. ${e instanceof Error ? e.message : ''} Some PDFs are made for one request only (for example after submitting a form).`,
          canBypass: !local,
        });
      }
    })();
    return () => abort.abort();
  }, [src]);

  const open = useCallback(async (pw?: string) => {
    if (!bytes) return;
    try {
      const doc = await loadSource(bytes, name, pw);
      setLoaded((old) => { void old?.doc.destroy(); return doc; });
      setAskPassword(null); setPassword('');
      const info = await doc.doc.getMetadata().catch(() => null) as { info?: { Title?: string } } | null;
      document.title = info?.info?.Title?.trim() || name;
      // #page=N from the address: applied once the first fit has laid the pages out
      const m = /(?:^|&)page=(\d+)/.exec(src?.fragment ?? '');
      if (m) startPage.current = Number(m[1]) - 1;
    } catch (e) {
      if (e instanceof PdfOpenError && e.needsPassword) setAskPassword(pw === undefined ? '' : 'The password is not correct.');
      else setError({ text: e instanceof Error ? e.message : String(e), canBypass: true });
    }
  }, [bytes, name, src]);
  useEffect(() => { void open(); }, [bytes]);

  // zoom: fit width / fit page follow the window
  const computeFit = useCallback((mode: 'fit-width' | 'fit-page') => {
    const vp = viewer.current?.viewportSize();
    if (!vp || !pages.length || !loaded) return 1;
    if (mode === 'fit-width') return Math.max(0.1, vp.width / Math.max(...pages.map((p) => itemSize(p, sources).width)));
    const s = itemSize(pages[Math.min(current, pages.length - 1)]!, sources);
    return Math.max(0.1, Math.min(vp.width / s.width, vp.height / s.height));
  }, [pages, sources, current, loaded]);
  const refit = useCallback(() => setZoom((z) => (z.mode === 'custom' ? z : { mode: z.mode, scale: computeFit(z.mode) })), [computeFit]);
  useEffect(() => { refit(); }, [loaded, rotate, refit]);
  useEffect(() => {
    if (startPage.current === null || !loaded || !pages.length) return;
    const p = startPage.current;
    startPage.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => goTo(p)));
  }, [zoom.scale, loaded, pages.length]);
  const step = (dir: 1 | -1) => setZoom((z) => ({ mode: 'custom', scale: (dir > 0 ? ZOOM_STEPS.find((s) => s > z.scale + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z.scale - 0.001)) ?? z.scale }));
  const fit = (mode: 'fit-width' | 'fit-page') => setZoom({ mode, scale: computeFit(mode) });

  function goTo(i: number) {
    const n = Math.max(0, Math.min(pages.length - 1, i));
    viewer.current?.scrollToPage(n);
    setCurrent(n);
  }
  useEffect(() => { setPageInput(String(current + 1)); }, [current]);

  const highlights = useMemo<Highlights>(() => {
    const m: Highlights = new Map();
    search.hits.forEach((h, i) => { const l = m.get(h.pageId) ?? []; for (const rect of h.rects) l.push({ rect, active: i === search.active }); m.set(h.pageId, l); });
    return m;
  }, [search.hits, search.active]);
  function goHit(i: number) {
    const hit = search.hits[i];
    if (!hit) return;
    search.setActive(i);
    setCurrent(hit.pageIndex);
    if (hit.rects[0]) viewer.current?.scrollToRect(hit.pageIndex, hit.rects[0]); else viewer.current?.scrollToPage(hit.pageIndex);
  }
  function openFind() { setSide('find'); requestAnimationFrame(() => { searchInput.current?.focus(); searchInput.current?.select(); }); }

  async function onLink(link: PageLink) {
    if ('url' in link) {
      // web and email links open in a new tab; nothing else
      if (/^(https?:|mailto:)/i.test(link.url)) window.open(link.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!loaded) return;
    try {
      const explicit = typeof link.dest === 'string' ? await loaded.doc.getDestination(link.dest) : link.dest;
      const target = Array.isArray(explicit) ? explicit[0] : null;
      const index = typeof target === 'number' ? target : target && typeof target === 'object' ? await loaded.doc.getPageIndex(target as { num: number; gen: number }) : -1;
      if (index >= 0) goTo(index);
    } catch { /* a link to nowhere */ }
  }

  function download() {
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Pixels each page takes when printed (the budget is in pixels, so rotation does not matter). */
  const pagePixels = useMemo(() => (loaded ? loaded.pages.map((p) => printPixels(p.width, p.height)) : []), [loaded]);

  /** Print: asks for a page range when the whole document is over the print budget. */
  function print() {
    if (!loaded || printing) return;
    if (rangePixels(pagePixels, 0, pagePixels.length - 1) <= PRINT_BUDGET) { void printPages(0, pagePixels.length - 1); return; }
    setPrintAsk({ range: `1-${lastFitting(pagePixels, 0) + 1}`, error: '' });
  }
  function submitPrintRange(e: FormEvent) {
    e.preventDefault();
    if (!printAsk) return;
    const r = parseRange(printAsk.range, pagePixels.length);
    if (!r) { setPrintAsk({ ...printAsk, error: `Enter pages from 1 to ${pagePixels.length}, for example 1-20.` }); return; }
    if (rangePixels(pagePixels, r[0], r[1]) > PRINT_BUDGET) {
      setPrintAsk({ ...printAsk, error: `That is too much to print at once. From page ${r[0] + 1}, up to page ${lastFitting(pagePixels, r[0]) + 1} fits.` });
      return;
    }
    setPrintAsk(null);
    void printPages(r[0], r[1]);
  }

  /** Pages from..to rendered at 150 dpi (less for very large pages) into a print-only area, then the print dialog. */
  async function printPages(from: number, to: number) {
    if (!loaded) return;
    const root = document.getElementById('print-root')!;
    // every image address made for this job, released however the job ends
    const urls: string[] = [];
    const release = () => { for (const u of urls) URL.revokeObjectURL(u); urls.length = 0; root.replaceChildren(); };
    release();
    printCancel.current = false;
    const canvas = document.createElement('canvas');
    try {
      for (let i = from; i <= to; i++) {
        if (printCancel.current) break;
        setPrinting(`Preparing page ${i - from + 1} of ${to - from + 1} for printing…`);
        const page = await loaded.doc.getPage(i + 1);
        const g = loaded.pages[i]!;
        const vp = page.getViewport({ scale: printScale(g.width, g.height), rotation: (page.rotate + rotate) % 360 });
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d', { alpha: false })!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
        const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Could not prepare the page'))), 'image/png'));
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = document.createElement('img');
        img.src = url;
        await img.decode();
        root.append(img);
      }
    } catch (e) {
      canvas.width = 0; canvas.height = 0;
      release();
      setPrinting(null);
      setError({ text: `Could not print: ${e instanceof Error ? e.message : String(e)}`, canBypass: false });
      return;
    }
    canvas.width = 0; canvas.height = 0;
    setPrinting(null);
    if (printCancel.current) { release(); return; }
    window.addEventListener('afterprint', release, { once: true });
    window.print();
  }

  /** The browser's own viewer for this one address (for PDFs that cannot be loaded twice, or by choice). */
  async function useBrowserViewer() {
    if (!src || !/^https?:/.test(src.url)) return;
    const ok = await chrome.runtime.sendMessage({ type: 'bypass', url: src.url }).catch((e: unknown) => String(e));
    if (ok === true) location.replace(src.url);
    else setError({ text: `The browser’s own viewer could not be turned on for this address${typeof ok === 'string' && ok ? ` (${ok})` : ''}. You can still save the PDF from here.`, canBypass: false });
  }

  // keyboard: find, print, save, zoom, pages (the browser's own shortcuts would act on this page instead)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = (e.target as HTMLElement).closest('input, textarea, select');
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
      else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); print(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); download(); }
      else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); step(1); }
      else if (mod && e.key === '-') { e.preventDefault(); step(-1); }
      else if (mod && e.key === '0') { e.preventDefault(); setZoom({ mode: 'custom', scale: 1 }); }
      else if (!typing && !mod && (e.key === 'PageDown' || e.key === 'n')) { e.preventDefault(); goTo(current + 1); }
      else if (!typing && !mod && (e.key === 'PageUp' || e.key === 'p')) { e.preventDefault(); goTo(current - 1); }
      else if (!typing && !mod && e.key === 'Home') { e.preventDefault(); goTo(0); }
      else if (!typing && !mod && e.key === 'End') { e.preventDefault(); goTo(pages.length - 1); }
    };
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey) { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); } };
    addEventListener('keydown', onKey);
    addEventListener('wheel', onWheel, { passive: false });
    return () => { removeEventListener('keydown', onKey); removeEventListener('wheel', onWheel); };
  });

  const submitPage = (e: FormEvent) => { e.preventDefault(); const n = parseInt(pageInput, 10); if (n) goTo(n - 1); else setPageInput(String(current + 1)); };
  const has = !!loaded;

  return (
    <div className="app web-viewer">
      <header className="appbar">
        <div className="brand" title="Oakqueill PDF Viewer"><img src={logo} alt="" width={22} height={22} /><span className="file-title" title={name}>{name}</span></div>
        <div className="spacer" />
        {has && (
          <div className="view-controls" role="toolbar" aria-label="View">
            <form onSubmit={submitPage}>
              <label className="page-nav"><span className="sr-only">Page number</span>
                <input value={pageInput} onChange={(e) => setPageInput(e.target.value.slice(0, 6))} onBlur={() => setPageInput(String(current + 1))} inputMode="numeric" aria-label="Page number" />
                <span>/ {pages.length}</span>
              </label>
            </form>
            <span className="sep" />
            <Button icon="minus" label="Zoom out" title="Zoom out (Ctrl+-)" onClick={() => step(-1)} />
            <span className="zoom-label" aria-live="polite">{Math.round(zoom.scale * 100)}%</span>
            <Button icon="plus" label="Zoom in" title="Zoom in (Ctrl+=)" onClick={() => step(1)} />
            <Button icon="fitWidth" label="Fit width" title="Fit width" onClick={() => fit('fit-width')} pressed={zoom.mode === 'fit-width'} />
            <Button icon="fitPage" label="Fit page" title="Fit page" onClick={() => fit('fit-page')} pressed={zoom.mode === 'fit-page'} />
            <Button icon="rotateRight" label="Rotate view" title="Rotate the view (the file is not changed)" onClick={() => setRotate((r) => (r + 90) % 360)} />
            <span className="sep" />
            <Button icon="find" label="Find" title="Find in document (Ctrl+F)" onClick={() => (side === 'find' ? setSide(null) : openFind())} pressed={side === 'find'} />
            <Button icon="sidebar" label="Page thumbnails" title="Page thumbnails" onClick={() => setSide((s) => (s === 'thumbs' ? null : 'thumbs'))} pressed={side === 'thumbs'} />
            <span className="sep" />
            <Button icon="print" label="Print" title="Print (Ctrl+P)" onClick={print} disabled={!!printing || !!printAsk} />
            <Button icon="download" label="Save" title="Save a copy (Ctrl+S)" onClick={download} />
          </div>
        )}
        {src && /^https?:/.test(src.url) && (
          <div className="more">
            <Button icon="more" label="More" title="More" onClick={() => setMenu((m) => !m)} pressed={menu} />
            {menu && (
              <div className="context-menu more-menu" role="menu">
                <button role="menuitem" onClick={() => { setMenu(false); void useBrowserViewer(); }}><span className="cm-label">Open in the browser’s own viewer</span></button>
              </div>
            )}
          </div>
        )}
      </header>

      {printing && <div className="notice info" role="status"><span>{printing}</span><button onClick={() => { printCancel.current = true; }}>Cancel</button></div>}
      {printAsk && (
        <form className="notice info print-range" onSubmit={submitPrintRange}>
          <span>This document is too large to print at once. Print pages</span>
          <input value={printAsk.range} onChange={(e) => setPrintAsk({ range: e.target.value.slice(0, 20), error: '' })} aria-label="Pages to print" autoFocus />
          <button className="primary" type="submit">Print</button>
          <button type="button" onClick={() => setPrintAsk(null)}>Cancel</button>
          {printAsk.error && <span className="form-error" role="alert">{printAsk.error}</span>}
        </form>
      )}

      {confirmOpen && src ? (
        <main className="empty">
          <div className="empty-card">
            <img className="empty-logo" src={logo} alt="" />
            <h1>Open this PDF?</h1>
            <p>This viewer was opened directly, not by visiting the PDF. Open it only if you expected this address:</p>
            <p className="address">{src.url}</p>
            <div className="row center"><button className="primary" onClick={() => location.replace(src.url)}>Open the PDF</button></div>
          </div>
        </main>
      ) : error ? (
        <main className="empty">
          <div className="empty-card">
            <img className="empty-logo" src={logo} alt="" />
            <h1>Cannot show this PDF</h1>
            <p>{error.text}</p>
            {error.canBypass && <button className="primary" onClick={() => void useBrowserViewer()}>Open in the browser’s own viewer</button>}
          </div>
        </main>
      ) : askPassword !== null ? (
        <main className="empty">
          <form className="empty-card" onSubmit={(e) => { e.preventDefault(); void open(password); }}>
            <h1>Password needed</h1>
            <p>“{name}” is password-protected. The password is used only to show it here.</p>
            <input type="password" className="pw" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" autoComplete="current-password" />
            {askPassword && <p className="form-error" role="alert">{askPassword}</p>}
            <div className="row center"><button className="primary" type="submit">Open</button></div>
          </form>
        </main>
      ) : !loaded ? (
        <main className="empty"><p className="muted loading">Opening {name}…</p></main>
      ) : (
        <main className="workspace">
          {side && (
            <aside className="sidebar">
              {side === 'find'
                ? <SearchPanel ref={searchInput} search={search} pageLabel={(i) => String(i + 1)} onGo={goHit} />
                : (
                  <div className="thumbs web-thumbs">
                    {pages.map((item, i) => {
                      const s = 150 / Math.max(fullSize(item, sources).width, fullSize(item, sources).height);
                      return (
                        <button key={item.id} className={`thumb${i === current ? ' current selected' : ''}`} onClick={() => goTo(i)} aria-label={`Page ${i + 1}`} aria-current={i === current ? 'page' : undefined}>
                          <PageCanvas doc={loaded.doc} pageIndex={i} rotation={((loaded.pages[i]?.rotate ?? 0) + rotate) % 360} scale={s}
                            width={Math.round(fullSize(item, sources).width * s)} height={Math.round(fullSize(item, sources).height * s)} clip={clipFor(item, sources, s)} />
                          <span className="thumb-label">{i + 1}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
            </aside>
          )}
          <Viewer ref={viewer} pages={pages} loaded={sources} scale={zoom.scale} onCurrentPage={setCurrent} onResize={refit} highlights={highlights} onLink={(l) => void onLink(l)} />
        </main>
      )}
    </div>
  );
}
