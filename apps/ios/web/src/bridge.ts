/**
 * window.docedit for iOS. The desktop renderer talks to the app only through this interface (shared/api.ts). Here the
 * PDF work runs in a Web Worker inside the web view, small stores live in the web view's own storage, and only things
 * that need the system (file pickers, saving, printing, opening links) go to Swift.
 */
import type { CreateRequest, CreateResult, DocEditApi, MenuCommand, OpenedFile, PickedFile, RecentFile, RecoveredDocument, RecoverySnapshot, RecoverySummary, SaveRequest, SaveResult, SavedSignature } from '../../../desktop/src/shared/api.js';
import { DEFAULT_SETTINGS, type Settings } from '../../../desktop/src/shared/settings.js';
import type { CoreOps } from './coreWorker.js';
import { fromBase64, hasNative, native, toBase64 } from './native.js';
import { idbDelete, idbGet, idbKeys, idbPut, lsGet, lsSet } from './store.js';
import fontUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';

export const JOB_TIMEOUT_MS = 120_000;
const MAX_BLANK_PAGES = 1000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;

// ---- the document worker ----
interface Pending { id: number; op: string; args: unknown[]; ok(v: unknown): void; fail(e: Error): void; timer?: number; sent: number }
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function startWorker(): Worker {
  const w = new Worker(new URL('./coreWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: { message: string; code?: string; name?: string } }>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    done(job);
    if (e.data.ok) job.ok(e.data.value);
    else {
      const err = Object.assign(new Error(e.data.error?.message ?? 'The document could not be processed.'), { code: e.data.error?.code });
      job.fail(err);
    }
  };
  w.onerror = () => {
    if (worker !== w) return;
    worker = null;
    for (const job of [...pending.values()]) { done(job); job.fail(new Error('Oakqueill could not process this document: the document worker stopped (the file may be too large or damaged).')); }
  };
  return w;
}
function done(job: Pending) { if (job.timer) clearTimeout(job.timer); pending.delete(job.id); }
function send(job: Pending) {
  worker ??= startWorker();
  job.sent++;
  job.timer = window.setTimeout(() => timedOut(job), JOB_TIMEOUT_MS);
  pending.set(job.id, job);
  worker.postMessage({ id: job.id, op: job.op, args: job.args });
}
function timedOut(job: Pending) {
  done(job);
  job.fail(new Error(`Oakqueill stopped working on this document after ${JOB_TIMEOUT_MS / 1000} seconds. The file may be damaged or made to stall PDF readers.`));
  const others = [...pending.values()];
  for (const o of others) { if (o.timer) clearTimeout(o.timer); pending.delete(o.id); }
  worker?.terminate();
  worker = null;
  for (const o of others) { if (o.sent < 2) send(o); else o.fail(new Error('Oakqueill could not finish this document because the document worker had to be restarted.')); }
}
function run<K extends keyof CoreOps>(op: K, ...args: Parameters<CoreOps[K]>): ReturnType<CoreOps[K]> {
  return new Promise((ok, fail) => send({ id: nextId++, op, args, ok, fail, sent: 0 })) as ReturnType<CoreOps[K]>;
}

let font: Promise<Uint8Array> | null = null;
const bundledFont = () => (font ??= fetch(fontUrl).then(async (r) => new Uint8Array(await r.arrayBuffer())));

// ---- picked files (kept in memory for this session, like the desktop's approved paths) ----
const picked = new Map<string, Uint8Array>();
const iosPath = (token: string) => `ios:${token}`;
const tokenOf = (path: string | null) => (path && path.startsWith('ios:') ? path.slice(4) : null);
const baseName = (n: string) => n.replace(/^.*[\\/]/, '');

function checkPdf(name: string, bytes: Uint8Array) {
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`“${name}” is ${(bytes.length / 1048576).toFixed(0)} MB; files over ${MAX_FILE_BYTES / 1048576} MB are not supported yet.`);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (!head.includes('%PDF-')) throw new Error(`“${name}” is not a PDF file.`);
}

interface NativeFile { token: string; name: string; base64: string }
function toOpened(f: NativeFile): OpenedFile {
  const bytes = fromBase64(f.base64);
  checkPdf(f.name, bytes);
  return { path: iosPath(f.token), name: f.name, bytes };
}

// ---- event channels ----
const menuHandlers = new Set<(c: MenuCommand) => void>();
const openHandlers = new Set<(f: OpenedFile | { error: string }) => void>();
const settingsHandlers = new Set<(s: Settings) => void>();
let queuedOpens: Array<OpenedFile | { error: string }> = [];
let ready = false;

export const emitMenu = (cmd: MenuCommand) => menuHandlers.forEach((h) => h(cmd));
/** Swift calls this when the system hands the app a PDF (Files, share sheet, "Open in"). */
export function deliverOpened(file: NativeFile | { error: string }) {
  let item: OpenedFile | { error: string };
  try { item = 'error' in file ? file : toOpened(file); if (!('error' in item)) noteRecent(item); } catch (e) { item = { error: e instanceof Error ? e.message : String(e) }; }
  if (ready && openHandlers.size) openHandlers.forEach((h) => h(item)); else queuedOpens.push(item);
}

const settingsNow = (): Settings => ({ ...DEFAULT_SETTINGS, ...lsGet<Partial<Settings>>('settings', {}) });


// ---- recent files: kept in the web view's storage; a file is reopened through its token, which lasts for this run of the app ----
const MAX_RECENT = 10;
const recentNow = (): RecentFile[] => (settingsNow().rememberRecent ? lsGet<RecentFile[]>('recent', []) : []);
const recentHandlers = new Set<(l: RecentFile[]) => void>();
function setRecent(list: RecentFile[]) { lsSet('recent', list); recentHandlers.forEach((h) => h(list)); }
function noteRecent(file: { path: string | null; name: string }) {
  if (!file.path || !settingsNow().rememberRecent) return;
  setRecent([{ path: file.path, name: file.name, folder: '', openedAt: Date.now() }, ...recentNow().filter((r) => r.path !== file.path)].slice(0, MAX_RECENT));
}

// ---- recovery ----
interface RecoveryRecord { manifest: Omit<RecoverySnapshot, 'newSources' | 'firstNewSource'> & { updatedAt: number }; sources: Uint8Array[] }
const rkey = (id: string) => `r:${id}`;

const unavailable = (what: string) => ({ ok: false as const, message: `${what} is not available on iOS yet.` });

const api: DocEditApi = {
  async openDialog(multi) {
    const files = await native<NativeFile[] | null>('pickPdfs', { multi });
    const opened = files ? files.map(toOpened) : null;
    opened?.forEach(noteRecent);
    return opened;
  },
  async openDropped(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    checkPdf(file.name, bytes);
    return { path: null, name: file.name, bytes };
  },
  async save(req: SaveRequest): Promise<SaveResult> {
    try {
      const plain = await run('layout', req.sources, req.slots as never, (req.edits ?? []) as never, await bundledFont());
      const bytes = req.protect ? await run('protectPdf', plain, req.protect as never) : plain;
      const existing = tokenOf(req.path);
      let token = existing, name = req.path ? baseName(req.suggestedName) : req.suggestedName;
      if (existing) {
        const r = await native<{ ok: boolean; message?: string }>('writeFile', { token: existing, base64: toBase64(bytes) });
        if (!r.ok) return { ok: false, cancelled: false, message: r.message ?? 'The file could not be written.' };
      } else {
        const r = await native<{ ok: boolean; cancelled?: boolean; token?: string; name?: string; message?: string }>('saveFile', { name: req.suggestedName, base64: toBase64(bytes) });
        if (!r.ok) return r.cancelled ? { ok: false, cancelled: true } : { ok: false, cancelled: false, message: r.message ?? 'The file could not be saved.' };
        token = r.token ?? null; name = r.name ?? name;
      }
      const saved = { path: token ? iosPath(token) : null, name, bytes };
      noteRecent(saved);
      return { ok: true, file: saved, editBytes: plain };
    } catch (err) {
      return { ok: false, cancelled: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
  async decrypt(pdf, password) {
    try { return { ok: true, bytes: await run('decryptPdf', pdf, String(password)) }; }
    catch (err) {
      const code = (err as { code?: string }).code ?? 'FAILED';
      const message = code === 'BAD_PASSWORD' ? 'The password is not correct.'
        : code === 'INVALID_PDF' ? 'This file uses a kind of protection Oakqueill cannot open (for example certificate-based encryption).'
        : err instanceof Error ? err.message : String(err);
      return { ok: false, code, message };
    }
  },
  inspect: (pdf) => run('inspectDocument', pdf) as Promise<unknown[]>,
  async sanitize(pdf, remove) {
    try {
      const r = await run('sanitizeChecked', pdf, remove as never);
      if (r.left.length) return { ok: false, message: `Could not remove everything chosen (still found: ${r.left.join(', ')}). No copy was made.` };
      return { ok: true, bytes: r.bytes, remaining: r.remaining };
    } catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err) }; }
  },
  async saveCopy(req) {
    try {
      const bytes = req.protect ? await run('protectPdf', req.bytes, req.protect as never) : req.bytes;
      const r = await native<{ ok: boolean; cancelled?: boolean; token?: string; message?: string }>('saveFile', { name: req.suggestedName, base64: toBase64(bytes) });
      if (!r.ok) return { ok: false, cancelled: !!r.cancelled, message: r.message };
      return { ok: true, path: iosPath(r.token ?? req.suggestedName) };
    } catch (err) { return { ok: false, cancelled: false, message: err instanceof Error ? err.message : String(err) }; }
  },
  async openWritten(path) {
    const token = tokenOf(path);
    if (!token) throw new Error('That file was not written in this session.');
    const f = await native<NativeFile>('readFile', { token });
    const opened = toOpened(f);
    noteRecent(opened);
    return opened;
  },
  async previewEdits(req) {
    try { return { ok: true, bytes: await run('layout', req.sources, req.slots as never, req.edits as never, await bundledFont()) }; }
    catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err) }; }
  },
  async saveSplit(req) {
    try {
      const files: Array<{ name: string; base64: string }> = [];
      for (let i = 0; i < req.parts.length; i++) {
        const plain = await run('layout', req.sources, req.parts[i] as never, [], await bundledFont());
        const bytes = req.protect ? await run('protectPdf', plain, req.protect as never) : plain;
        files.push({ name: `${req.baseName}-${String(i + 1).padStart(String(req.parts.length).length, '0')}.pdf`, base64: toBase64(bytes) });
      }
      const r = await native<{ ok: boolean; cancelled?: boolean; folder?: string; files?: string[]; message?: string }>('saveFolder', { files });
      if (!r.ok) return r.cancelled ? { ok: false, cancelled: true } : { ok: false, cancelled: false, message: r.message ?? 'The files could not be saved.' };
      return { ok: true, folder: r.folder ?? '', files: r.files ?? files.map((f) => f.name) };
    } catch (err) { return { ok: false, cancelled: false, message: err instanceof Error ? err.message : String(err) }; }
  },
  setDocumentState(state) { document.title = `${state.dirty ? '• ' : ''}${state.title ? state.title + ' — ' : ''}Oakqueill`; },
  closeWindowAfterSave() { /* a single window: nothing to close */ },
  onMenu(handler) { menuHandlers.add(handler); return () => { menuHandlers.delete(handler); }; },
  onOpenFile(handler) { openHandlers.add(handler); return () => { openHandlers.delete(handler); }; },
  ready() {
    ready = true;
    const q = queuedOpens; queuedOpens = [];
    for (const item of q) openHandlers.forEach((h) => h(item));
  },
  async openExternal(url) { return (await native<boolean>('openExternal', { url: String(url) })) === true; },
  editCommand(cmd) { document.execCommand(cmd === 'selectAll' ? 'selectAll' : cmd); },
  async pickFiles(kind) {
    const files = await native<Array<{ token: string; name: string; base64: string }> | null>('pickFiles', { kind });
    if (!files) return null;
    return files.map((f): PickedFile => {
      const bytes = fromBase64(f.base64);
      picked.set(iosPath(f.token), bytes);
      return { path: iosPath(f.token), name: f.name, size: bytes.length };
    });
  },
  async certSign() { return unavailable('Signing with a certificate'); },
  verifySignatures: (pdf) => run('verifySignatures', pdf, { trusted: [] } as never) as Promise<unknown[]>,
  async trustCertificate() { return false; },
  async officeConverter() { return { available: false, path: null }; },
  async convertOffice() { return { ok: false, message: 'Converting office documents is not available on iOS. Export a PDF from the app that made the document and open that.' }; },
  cancelConvert() { /* nothing runs */ },
  async readTextFile(path) {
    const b = picked.get(path);
    if (!b) throw new Error('That file was not chosen in this session.');
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    return new TextDecoder('utf-8').decode(b.subarray(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0));
  },
  listFormFields: (pdf) => run('listFormFields', pdf) as never,
  async readImage(path) {
    const b = picked.get(path);
    if (!b) throw new Error('That file was not chosen in this session.');
    if (b.length > 3 * 1024 * 1024) throw new Error('Choose an image smaller than 3 MB for a signature.');
    const png = b[0] === 0x89 && b[1] === 0x50, jpg = b[0] === 0xff && b[1] === 0xd8;
    if (!png && !jpg) throw new Error('Choose a JPEG or PNG image.');
    return { base64: toBase64(b), format: png ? 'png' : 'jpg' };
  },
  async signaturesList() { return lsGet<SavedSignature[]>('signatures', []); },
  async signaturesSave(sig) {
    const saved: SavedSignature = { ...sig, id: crypto.randomUUID(), createdAt: Date.now() };
    lsSet('signatures', [...lsGet<SavedSignature[]>('signatures', []), saved]);
    return saved;
  },
  async signaturesDelete(id) { lsSet('signatures', lsGet<SavedSignature[]>('signatures', []).filter((s) => s.id !== id)); },
  async createDocument(req: CreateRequest): Promise<CreateResult> {
    try {
      if (req.kind === 'blank') {
        const side = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 72 && v <= 14400;
        if (!Number.isInteger(req.count) || req.count < 1 || req.count > MAX_BLANK_PAGES) throw new Error(`Choose from 1 to ${MAX_BLANK_PAGES} pages.`);
        if (!Array.isArray(req.size) || req.size.length !== 2 || !side(req.size[0]) || !side(req.size[1])) throw new Error('That page size is not supported.');
        const { createBlankPdf } = await import('@docedit/core');
        return { ok: true, file: { path: null, name: 'Untitled.pdf', bytes: await createBlankPdf(req.count, [req.size[0], req.size[1]]) } };
      }
      if (req.kind === 'images') {
        const images = req.paths.map((p) => { const b = picked.get(p); if (!b) throw new Error('An image was not chosen in this session.'); return b; });
        return { ok: true, file: { path: null, name: 'Images.pdf', bytes: await run('imagesToPdf', images, req.options as never) } };
      }
      const res = await run('textToPdf', req.text, { ...req.options, font: await bundledFont() } as never);
      return { ok: true, file: { path: null, name: req.name || 'Text.pdf', bytes: res.pdf }, missingCharacters: res.missingCharacters };
    } catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err) }; }
  },
  async printPages(req) {
    try {
      const r = await native<{ ok: boolean; cancelled?: boolean; message?: string }>('print', {
        title: req.title, fit: req.fit, orientation: req.orientation,
        pages: req.pages.map((p) => ({ png: toBase64(p.png), widthPt: p.widthPt, heightPt: p.heightPt })),
      });
      if (r.ok) return { ok: true };
      return r.cancelled ? { ok: false, cancelled: true } : { ok: false, message: r.message ?? 'Printing failed.' };
    } catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err) }; }
  },
  async recoverySave(snap: RecoverySnapshot) {
    const old = await idbGet<RecoveryRecord>(rkey(snap.id));
    const sources = [...(old?.sources ?? []).slice(0, snap.firstNewSource), ...snap.newSources];
    const { newSources: _n, firstNewSource: _f, ...manifest } = snap;
    await idbPut(rkey(snap.id), { manifest: { ...manifest, updatedAt: Date.now() }, sources } satisfies RecoveryRecord);
  },
  async recoveryClear(id) { await idbDelete(rkey(id)); },
  async getSettings() { return settingsNow(); },
  async scannerPresent() { return false; }, // scanning is not offered on iOS
  onScannerPresent() { return () => {}; },
  async scanDevices() { return unavailable('Scanning'); },
  async scan() { return unavailable('Scanning'); },
  async scanClear() { /* nothing to clear */ },
  async saveExport(req) {
    try {
      if (req.files.length === 1) {
        const f = req.files[0]!;
        const r = await native<{ ok: boolean; cancelled?: boolean; token?: string; message?: string }>('saveFile', { name: f.name, base64: toBase64(f.bytes) });
        return r.ok ? { ok: true, paths: [iosPath(r.token ?? f.name)] } : r.cancelled ? { ok: false, cancelled: true } : { ok: false, cancelled: false, message: r.message ?? 'The file could not be saved.' };
      }
      const r = await native<{ ok: boolean; cancelled?: boolean; files?: string[]; message?: string }>('saveFolder', { files: req.files.map((f) => ({ name: f.name, base64: toBase64(f.bytes) })) });
      return r.ok ? { ok: true, paths: r.files ?? [] } : r.cancelled ? { ok: false, cancelled: true } : { ok: false, cancelled: false, message: r.message ?? 'The files could not be saved.' };
    } catch (err) { return { ok: false, cancelled: false, message: err instanceof Error ? err.message : String(err) }; }
  },
  async setSettings(patch) {
    const next = { ...settingsNow(), ...patch };
    if (!next.rememberRecent) lsSet('recent', []); // turning it off forgets the list
    lsSet('settings', next);
    settingsHandlers.forEach((h) => h(next));
    return next;
  },
  onSettings(handler) { settingsHandlers.add(handler); return () => { settingsHandlers.delete(handler); }; },
  async recentList() { return recentNow(); },
  async recentOpen(path) {
    const token = tokenOf(path);
    try {
      if (!recentNow().some((r) => r.path === path) || !token) throw new Error('That file is not on the recent list.');
      const opened = toOpened(await native<NativeFile>('readFile', { token }));
      noteRecent(opened);
      return opened;
    } catch (err) {
      setRecent(recentNow().filter((r) => r.path !== path)); // gone, or from an earlier run of the app: off the list
      throw new Error(`That file can no longer be opened from the recent list. Open it again from Files. (${err instanceof Error ? err.message : String(err)})`);
    }
  },
  async recentRemove(path) { setRecent(recentNow().filter((r) => r.path !== path)); },
  async recentClear() { setRecent([]); },
  onRecent(handler) { recentHandlers.add(handler); return () => { recentHandlers.delete(handler); }; },
  async recoveryList(): Promise<RecoverySummary[]> {
    const out: RecoverySummary[] = [];
    for (const k of await idbKeys()) {
      const rec = await idbGet<RecoveryRecord>(String(k));
      if (rec) out.push({ id: rec.manifest.id, title: rec.manifest.title, path: rec.manifest.path, updatedAt: rec.manifest.updatedAt, pageCount: rec.manifest.pages.length });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async recoveryLoad(id): Promise<RecoveredDocument> {
    const rec = await idbGet<RecoveryRecord>(rkey(id));
    if (!rec) throw new Error('That recovered document is no longer available.');
    const m = rec.manifest;
    return { id: m.id, title: m.title, path: m.path, pages: m.pages, edits: m.edits, outline: m.outline, sources: rec.sources, originalChanged: false };
  },
};

/** Debug aid (the Swift side calls it with `-SelfTest 1`): exercises the document worker end to end. */
async function selfTest(): Promise<string> {
  const { createBlankPdf } = await import('@docedit/core');
  const src = await createBlankPdf(3, [612, 792]);
  const out = await api.previewEdits({ sources: [src], slots: [{ source: 0, page: 2 }, { source: 0, page: 0, rotate: 90 }], edits: [] });
  if (!out.ok) return `FAIL layout: ${out.message}`;
  const info = (await run('getInfo', out.bytes)) as { pageCount: number };
  const prot = await run('protectPdf', out.bytes, { userPassword: 'x' } as never);
  const dec = await api.decrypt(prot, 'x');
  if (!(info.pageCount === 2 && dec.ok)) return `FAIL pages=${info.pageCount} decrypted=${dec.ok}`;
  // Redaction end to end with the pdf.js rasterizer (canvas) in this web view, then the app's own byte-level checks.
  const secret = '123-45-6789';
  const text = await run('textToPdf', `Name: Jane Doe\nSSN: ${secret}\nEnd of record`, { pageSize: [612, 792], margin: 54, fontSize: 14, font: await bundledFont() } as never);
  // core's text search uses its own (legacy) pdf.js copy, which needs its worker file named once
  const legacy = await import('pdfjs-dist/legacy/build/pdf.mjs');
  legacy.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  const { findRedactionMarks } = await import('@docedit/core');
  const { redact } = await import('../../../desktop/src/renderer/redaction.js');
  const marks = await findRedactionMarks(text.pdf, secret);
  if (!marks.length) return 'FAIL redaction: no marks found';
  const res = await redact(text.pdf, marks, [secret], 150, () => {});
  const failed = res.checks.filter((c) => !c.ok).map((c) => c.label);
  return res.bytes && !failed.length
    ? `PASS pages=${info.pageCount} decrypted=${dec.ok} redaction=ok checks=${res.checks.length} bytes=${res.bytes.length}`
    : `FAIL redaction: ${failed.join('; ') || 'no output'}`;
}

export function installBridge() {
  Object.defineProperty(window, 'docedit', { value: api, configurable: false });
  Object.defineProperty(window, '__oakqueill', { value: { deliverOpened, emitMenu, hasNative, selfTest }, configurable: false });
}
