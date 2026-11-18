import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type MenuItemConstructorOptions } from 'electron';
import { signPdf, DocEditError, type DocEdit, type HiddenCategory, type ProtectOptions } from '@docedit/core';
import { core, registerCoreWorker, stopCoreWorker } from './corework.js';
import { bundledFont } from './create.js';
import { ask, registerPrompts } from './prompt.js';
import { SettingsStore } from './settings.js';
import { clearScans, listScanners, scan } from './scan.js';
import { saveExport } from './exportfiles.js';
import { forgetListings, listExports, openExport } from './remarkable.js';
import { retryLeftovers } from './convert.js';
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MenuCommand, OpenedFile, SaveRequest, SaveResult } from '../shared/api.js';
import { writeUniqueFile } from './exportwrite.js';
import { onSafe } from './ipcSafe.js';
import { isInsideDir, parseDocumentState } from './fileGuard.js';
import { pickWindowForOpen } from './openRouting.js';
import { readPdfFile, writeFileSafely } from './files.js';
import { printPages } from './print.js';
import { cancelConversion, convertOffice, createDocument, officeConverter, pickFiles, readApproved, readImage, readTextFile } from './create.js';
import { safeMailto } from './links.js';
import { describeCertificate, signerFromPkcs12, TrustStore } from './certificates.js';
import { SignatureStore } from './signatures.js';
import type { CreateRequest, RecoverySnapshot, SaveSlot, SplitRequest, SplitResult } from '../shared/api.js';
import { RecoveryStore } from './recovery.js';
import type { PrintRequest } from '../shared/api.js';

const here = dirname(fileURLToPath(import.meta.url));
const windowState = new WeakMap<BrowserWindow, {
  dirty: boolean; forceClose: boolean; asking?: boolean;
  /** the window shows a document (reported by the page) */
  hasDoc?: boolean;
  /** the page has said it is ready to receive files */
  ready?: boolean;
  /** a file is on its way to this window, so another file must not take it */
  claimed?: boolean;
  /** files waiting for the page to be ready */
  queue?: string[];
}>();
/** files this app wrote in this session, which the renderer may reopen */
const written = new Set<string>();
/**
 * Documents the user opened or saved in this session (resolved, compared without case). Saving in place goes only to
 * one of these; any other path the page asks to save to gets the save dialog instead.
 */
const known = new Set<string>();
const keyOf = (p: string) => resolve(p).toLowerCase();
function remember<T extends { path: string | null }>(file: T): T { if (file.path) known.add(keyOf(file.path)); return file; }

let recovery: RecoveryStore;
let signatures: SignatureStore;
let trust: TrustStore;
let settings: SettingsStore;
/** recovery sessions written by each window; dropped when the window closes normally */
const recoveryByWindow = new Map<number, Set<string>>();

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 720, minHeight: 480,
    title: 'Oakqueill PDF Editor', backgroundColor: '#123f2f', show: false,
    webPreferences: {
      preload: join(here, '../preload/preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
    },
  });
  windowState.set(win, { dirty: false, forceClose: false });
  win.once('ready-to-show', () => win.show());

  // The page is local and static: never navigate away from it or open other windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', (e) => {
    const st = windowState.get(win);
    if (!st || st.forceClose || !st.dirty) return;
    e.preventDefault();
    if (st.asking) return; // already asking (a second click on the close button)
    st.asking = true;
    void ask(win, {
      title: 'Save changes before closing?', message: 'Your changes will be lost if you close without saving.', kind: 'warning',
      confirm: { label: 'Save' }, extra: { label: "Don't save", danger: true },
    }).then((a) => {
      st.asking = false;
      if (win.isDestroyed()) return;
      if (a === 'confirm') win.webContents.send('docedit:menu', 'save-then-close-window' satisfies MenuCommand);
      else if (a === 'extra') { st.forceClose = true; win.close(); }
    });
  });

  const wcId = win.webContents.id;
  win.on('closed', () => {
    // a normal close means the user saved or chose not to keep the changes
    for (const id of recoveryByWindow.get(wcId) ?? []) void recovery.discard(id).catch(() => {});
    recoveryByWindow.delete(wcId);
  });

  void win.loadFile(join(here, '../renderer/index.html'));
  return win;
}

function send(cmd: MenuCommand) {
  return () => BrowserWindow.getFocusedWindow()?.webContents.send('docedit:menu', cmd);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '&File',
      submenu: [
        {
          label: 'New',
          submenu: [
            { label: 'Blank Document…', accelerator: 'CmdOrCtrl+N', click: send('new-blank') },
            { label: 'From Images…', click: send('new-images') },
            { label: 'From Text…', click: send('new-text') },
            { label: 'From Office Document…', click: send('new-office') },
            { label: 'From Scanner…', click: send('new-scan') },
          ],
        },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Open from reMarkable…', click: send('remarkable') },
        { label: 'Insert Pages from File…', accelerator: 'CmdOrCtrl+I', click: send('insert-file') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
        { label: 'Export As…', click: send('export') },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: send('print') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { type: 'separator' },
        { label: 'Close Document', accelerator: 'CmdOrCtrl+W', click: send('close-document') },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: send('redo') },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: 'Find Next', accelerator: 'F3', click: send('find-next') },
        { label: 'Find Previous', accelerator: 'Shift+F3', click: send('find-prev') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&Pages',
      submenu: [
        // Single-key shortcuts are handled by the page list itself so they never fire while typing.
        { label: 'Rotate Left', accelerator: 'Shift+R', registerAccelerator: false, click: send('rotate-left') },
        { label: 'Rotate Right', accelerator: 'R', registerAccelerator: false, click: send('rotate-right') },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: send('duplicate-pages') },
        { label: 'Insert Blank Page After', accelerator: 'CmdOrCtrl+Shift+B', click: send('insert-blank') },
        { label: 'Crop…', accelerator: 'CmdOrCtrl+Shift+C', click: send('crop') },
        { type: 'separator' },
        { label: 'Extract Selected Pages…', accelerator: 'CmdOrCtrl+E', click: send('extract') },
        { label: 'Split Document…', click: send('split') },
        { type: 'separator' },
        { label: 'Delete', accelerator: 'Delete', registerAccelerator: false, click: send('delete-pages') },
      ],
    },
    {
      label: '&Document',
      submenu: [
        { label: 'Properties…', accelerator: 'CmdOrCtrl+Shift+P', click: send('properties') },
        { label: 'Headers, Footers and Watermark…', click: send('furniture') },
        { label: 'Remove Hidden Information…', click: send('sanitize') },
        { label: 'Password Protection…', click: send('protect') },
        { label: 'Sign with Certificate…', click: send('cert-sign') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: send('zoom-reset') },
        { label: 'Fit Width', accelerator: 'CmdOrCtrl+1', click: send('fit-width') },
        { label: 'Fit Page', accelerator: 'CmdOrCtrl+2', click: send('fit-page') },
        ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }, { role: 'reload' as const }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** The saved document: the first source untouched when the layout is unchanged, otherwise rebuilt; then the edits. */
/** Pages laid out as the editor shows them, with edits applied: done in the document worker (coreworker.ts). */
async function layoutBytes(sources: Uint8Array[], slots: SaveSlot[], edits: DocEdit[] = []): Promise<Uint8Array> {
  return core.layout(sources, slots, edits, edits.length ? await bundledFont() : undefined);
}

async function saveSplit(win: BrowserWindow | null, req: SplitRequest): Promise<SplitResult> {
  if (!req.parts.length) return { ok: false, cancelled: false, message: 'Nothing to save.' };
  const opts: Electron.OpenDialogOptions = { title: 'Choose a folder for the split files', properties: ['openDirectory', 'createDirectory'] };
  const testDir = !app.isPackaged ? process.env.DOCEDIT_TEST_SAVE_DIR : undefined; // test hook, unpackaged only
  const res = testDir ? { canceled: false, filePaths: [testDir] } : win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || !res.filePaths[0]) return { ok: false, cancelled: true };
  const folder = res.filePaths[0];
  const base = (req.baseName || 'document').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  const width = String(req.parts.length).length;
  const names = req.parts.map((_, i) => `${base}-${String(i + 1).padStart(width, '0')}.pdf`);
  const clashes = names.filter((n) => existsSync(join(folder, n)));
  let replace = false;
  if (clashes.length) {
    const answer = await ask(win, {
      title: `${clashes.length} file${clashes.length === 1 ? '' : 's'} with the same name already exist${clashes.length === 1 ? 's' : ''} in this folder`,
      message: 'Keep both by numbering the new files, or replace the existing ones?', kind: 'warning',
      detail: clashes.slice(0, 8).join('\n') + (clashes.length > 8 ? '\n…' : ''),
      confirm: { label: 'Keep both' }, extra: { label: 'Replace', danger: true },
    });
    if (answer === 'cancel') return { ok: false, cancelled: true };
    replace = answer === 'extra';
  }
  // Without an explicit Replace every part is created exclusively: a file that appears after the check is never overwritten.
  const taken = new Set<string>();
  const written: string[] = [];
  try {
    for (const [i, part] of req.parts.entries()) {
      const bytes = await core.arrangePages(req.sources, part);
      // parts of a protected document stay protected
      const out = req.protect ? await core.protectPdf(bytes, req.protect as ProtectOptions) : bytes;
      if (replace) { await writeFileSafely(join(folder, names[i]!), out); written.push(names[i]!); }
      else written.push(await writeUniqueFile(folder, names[i]!, out, taken));
    }
    return { ok: true, folder, files: written };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, cancelled: false, message: `${message}${written.length ? ` (${written.length} of ${req.parts.length} files were written before the error)` : ''}` };
  }
}

function registerIpc() {
  ipcMain.handle('docedit:open-dialog', async (e, multi: boolean): Promise<OpenedFile[] | null> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const opts: Electron.OpenDialogOptions = {
      title: multi ? 'Choose PDFs' : 'Open PDF',
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    return Promise.all(res.filePaths.map(async (p) => remember(await readPdfFile(p))));
  });

  ipcMain.handle('docedit:open-dropped', async (_e, path: unknown) => {
    if (typeof path !== 'string' || !path) throw new Error('That item is not a file on this computer.');
    return remember(await readPdfFile(path));
  });

  ipcMain.handle('docedit:save', async (e, req: SaveRequest): Promise<SaveResult> => {
    // in place only over a document this session opened or saved; any other path is asked for
    let target = typeof req.path === 'string' && known.has(keyOf(req.path)) ? req.path : null;
    if (!target) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts: Electron.SaveDialogOptions = { title: 'Save PDF', defaultPath: req.suggestedName, filters: [{ name: 'PDF document', extensions: ['pdf'] }] };
      if (typeof req.path === 'string' && req.path) opts.defaultPath = req.path;
      const testPath = !app.isPackaged ? process.env.DOCEDIT_TEST_SAVE_PATH : undefined; // test hook, unpackaged only
      const res = testPath ? { canceled: false, filePath: testPath } : win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
      target = res.filePath.toLowerCase().endsWith('.pdf') ? res.filePath : res.filePath + '.pdf';
    }
    try {
      const plain = await layoutBytes(req.sources, req.slots, (req.edits ?? []) as DocEdit[]);
      const bytes = req.protect ? await core.protectPdf(plain, req.protect as ProtectOptions) : plain;
      await writeFileSafely(target, bytes);
      known.add(keyOf(target));
      return { ok: true, file: { path: target, name: basename(target), bytes }, editBytes: plain };
    } catch (err) {
      const message = err instanceof DocEditError || err instanceof Error ? err.message : String(err);
      return { ok: false, cancelled: false, message };
    }
  });

  onSafe('docedit:document-state', (e, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const state = parseDocumentState(raw); // the page is not trusted to send the right shape
    const st = windowState.get(win);
    if (st) { st.dirty = state.dirty; st.hasDoc = !!state.title; if (st.hasDoc) st.claimed = false; }
    win.setTitle(`${state.dirty ? '• ' : ''}${state.title ? state.title + ' — ' : ''}Oakqueill PDF Editor`);
    win.setDocumentEdited(state.dirty);
  });

  ipcMain.handle('docedit:open-external', async (e, raw: unknown) => {
    if (typeof raw !== 'string') return false;
    let url: URL;
    try { url = new URL(raw.trim()); } catch { return false; }
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
      await ask(BrowserWindow.fromWebContents(e.sender), {
        title: 'This link was not opened', message: 'Oakqueill only opens web and email links. This one points to:', detail: raw,
        kind: 'info', confirm: { label: 'OK' }, cancel: null,
      });
      return false;
    }
    // decided here in the main process, never by the page: a document cannot open a link without this question
    const mail = url.protocol === 'mailto:';
    // an email link may name only recipients, a subject and a body: never files to attach
    const mailto = mail ? safeMailto(url) : null;
    const href = mailto?.href ?? url.href;
    const removed = mailto?.dropped.length ? ` Parts of the link that are not recipients, a subject or text (${mailto.dropped.join(', ')}) were removed.` : '';
    const answer = await ask(BrowserWindow.fromWebContents(e.sender), {
      title: mail ? 'Write an email from this link?' : 'Open this link in your browser?', detail: href, kind: 'question',
      message: mail ? `Your email program opens with this address.${removed}` : 'Check the address before you continue.',
      confirm: { label: mail ? 'Write email' : 'Open link' }, focusCancel: true,
    });
    if (answer !== 'confirm') return false;
    await shell.openExternal(href);
    return true;
  });

  ipcMain.handle('docedit:settings-get', () => settings.get());
  ipcMain.handle('docedit:remarkable-choose', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = { title: 'Choose the folder you save reMarkable exports to', properties: ['openDirectory', 'createDirectory'], defaultPath: settings.get().remarkableFolder ?? undefined };
    const testDir = !app.isPackaged ? process.env.DOCEDIT_TEST_SAVE_DIR : undefined; // test hook, unpackaged only
    const res = testDir ? { canceled: false, filePaths: [testDir] } : win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    forgetListings(); // ids from the old folder stop working
    return settings.setFolder(res.filePaths[0]);
  });
  ipcMain.handle('docedit:remarkable-list', (e) => listExports(e.sender.id, settings.get().remarkableFolder));
  ipcMain.handle('docedit:remarkable-open', (e, id: unknown) => openExport(e.sender.id, settings.get().remarkableFolder, id));
  ipcMain.handle('docedit:scan-devices', () => listScanners());
  ipcMain.handle('docedit:scan', (_e, req) => scan(req));
  ipcMain.handle('docedit:scan-clear', () => clearScans());
  ipcMain.handle('docedit:save-export', (e, req) => saveExport(BrowserWindow.fromWebContents(e.sender), req));
  ipcMain.handle('docedit:settings-set', (_e, patch: unknown) => settings.set(patch));

  onSafe('docedit:edit-command', (e, cmd: unknown) => {
    if (cmd === 'cut' || cmd === 'copy' || cmd === 'paste' || cmd === 'selectAll') e.sender[cmd]();
  });

  ipcMain.handle('docedit:preview-edits', async (_e, req: { sources: Uint8Array[]; slots: SaveSlot[]; edits: DocEdit[] }) => {
    try { return { ok: true, bytes: await layoutBytes(req.sources, req.slots, req.edits) }; }
    catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err) }; }
  });
  ipcMain.handle('docedit:decrypt', async (_e, pdf: Uint8Array, password: string) => {
    try { return { ok: true, bytes: await core.decryptPdf(pdf, String(password)) }; }
    catch (err) {
      const code = err instanceof DocEditError ? err.code : 'FAILED';
      const message = code === 'BAD_PASSWORD' ? 'The password is not correct.'
        : code === 'INVALID_PDF' ? 'This file uses a kind of protection Oakqueill cannot open (for example certificate-based encryption).'
        : err instanceof Error ? err.message : String(err);
      return { ok: false, code, message }; // the password itself is never logged or returned
    }
  });
  ipcMain.handle('docedit:inspect', (_e, pdf: Uint8Array) => core.inspectDocument(pdf));
  ipcMain.handle('docedit:sanitize', async (_e, pdf: Uint8Array, remove: HiddenCategory[]) => {
    try {
      // fail closed: anything chosen that is still found means the copy is not offered
      const { bytes, remaining, left } = await core.sanitizeChecked(pdf, remove);
      if (left.length) return { ok: false, message: `Cleaning did not fully work (${left.join(', ')} still found), so no copy was made.` };
      return { ok: true, bytes, remaining };
    } catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err) }; }
  });
  ipcMain.handle('docedit:save-copy', async (e, req: { bytes: Uint8Array; suggestedName: string; notOver: string[]; protect?: ProtectOptions | null }) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const opts: Electron.SaveDialogOptions = { title: 'Save copy', defaultPath: req.suggestedName, filters: [{ name: 'PDF document', extensions: ['pdf'] }] };
    // Test hook for unpackaged builds: answer the save dialog with a fixed path.
    const testPath = !app.isPackaged ? process.env.DOCEDIT_TEST_SAVE_PATH : undefined;
    const res = testPath ? { canceled: false, filePath: testPath } : win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    const target = res.filePath.toLowerCase().endsWith('.pdf') ? res.filePath : res.filePath + '.pdf';
    const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
    if (req.notOver.some((p) => p && same(p, target))) return { ok: false, cancelled: false, message: 'Choose a different file name: the copy must not replace the original document.' };
    try {
      // copies of a protected document stay protected
      await writeFileSafely(target, req.protect ? await core.protectPdf(req.bytes, req.protect) : req.bytes);
      written.add(resolve(target));
      known.add(keyOf(target));
      return { ok: true, path: target };
    }
    catch (err) { return { ok: false, cancelled: false, message: err instanceof Error ? err.message : String(err) }; }
  });
  ipcMain.handle('docedit:open-written', async (_e, path: string) => {
    if (!written.has(resolve(String(path)))) throw new Error('That file was not written in this session.');
    return remember(await readPdfFile(String(path)));
  });
  ipcMain.handle('docedit:save-split', (e, req: SplitRequest) => saveSplit(BrowserWindow.fromWebContents(e.sender), req));
  ipcMain.handle('docedit:print', (e, req: PrintRequest) => printPages(BrowserWindow.fromWebContents(e.sender), req));
  ipcMain.handle('docedit:pick-files', (e, kind: unknown) => pickFiles(BrowserWindow.fromWebContents(e.sender), kind === 'text' || kind === 'office' || kind === 'certificate' ? kind : 'images'));
  ipcMain.handle('docedit:cert-sign', async (_e, req: { pdf: Uint8Array; p12Path: string; password: string; reason?: string; location?: string; page: number; rect?: { x: number; y: number; width: number; height: number } }) => {
    try {
      const signer = await signerFromPkcs12(await readApproved(String(req.p12Path), 1024 * 1024), String(req.password ?? ''));
      const bytes = await signPdf(req.pdf, signer, { reason: req.reason || undefined, location: req.location || undefined, page: req.page, rect: req.rect });
      return { ok: true, bytes, signer: signer.subject };
    } catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err) }; } // the password is never echoed
  });
  ipcMain.handle('docedit:verify-signatures', async (_e, pdf: Uint8Array) => core.verifySignatures(pdf, { trusted: await trust.list() }));
  ipcMain.handle('docedit:trust-cert', async (e, der: unknown, yes: unknown): Promise<boolean> => {
    if (!(der instanceof Uint8Array) || der.length > 64 * 1024) throw new Error('That is not a certificate Oakqueill can read.');
    if (yes !== true) { await trust.remove(der); return true; }
    // a trust anchor is added only after the user says so here, with the details read by this process
    const c = describeCertificate(der);
    const answer = await ask(BrowserWindow.fromWebContents(e.sender), {
      title: 'Trust this signer?', kind: 'warning', focusCancel: true, confirm: { label: 'Trust certificate' },
      message: `Signatures made with the certificate of “${c.subject}”${c.selfSigned ? ' (self-signed)' : `, issued by ${c.issuer},`} will show as trusted. Only do this if you have confirmed with its owner that this certificate is theirs.`,
      detail: `Valid until ${c.validTo}\nSHA-256 ${c.fingerprint}`,
    });
    if (answer !== 'confirm') return false;
    await trust.add(der);
    return true;
  });
  ipcMain.handle('docedit:office-converter', () => officeConverter());
  ipcMain.handle('docedit:convert-office', (e, path: unknown) => convertOffice(e.sender.id, String(path)));
  onSafe('docedit:cancel-convert', (e) => cancelConversion(e.sender.id));
  ipcMain.handle('docedit:read-text', (_e, path: string) => readTextFile(String(path)));
  ipcMain.handle('docedit:list-fields', (_e, pdf: Uint8Array) => core.listFormFields(pdf));
  ipcMain.handle('docedit:read-image', (_e, path: string) => readImage(String(path)));
  ipcMain.handle('docedit:signatures-list', () => signatures.list());
  ipcMain.handle('docedit:signatures-save', (_e, sig) => signatures.save(sig));
  ipcMain.handle('docedit:signatures-delete', (_e, id: string) => signatures.remove(String(id)));
  ipcMain.handle('docedit:create', (_e, req: CreateRequest) => createDocument(req));

  ipcMain.handle('docedit:recovery-save', async (e, snap: RecoverySnapshot) => {
    const set = recoveryByWindow.get(e.sender.id) ?? new Set<string>();
    set.add(snap.id); recoveryByWindow.set(e.sender.id, set);
    await recovery.save(snap);
  });
  ipcMain.handle('docedit:recovery-clear', async (e, id: string) => {
    recoveryByWindow.get(e.sender.id)?.delete(id);
    await recovery.discard(String(id));
  });
  ipcMain.handle('docedit:recovery-list', () => recovery.orphans());
  ipcMain.handle('docedit:recovery-load', async (e, id: string) => {
    const { manifest, sources, originalChanged } = await recovery.load(String(id));
    const set = recoveryByWindow.get(e.sender.id) ?? new Set<string>();
    set.add(manifest.id); recoveryByWindow.set(e.sender.id, set);
    return { id: manifest.id, title: manifest.title, path: manifest.path, pages: manifest.pages, edits: manifest.edits, outline: manifest.outline, sources, originalChanged };
  });

  // A PDF passed on the command line (e.g. "Open with") opens in the first window once its page says it is ready.
  let firstReady = true;
  onSafe('docedit:ready', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const st = win && windowState.get(win);
    if (!win || !st) return;
    const arg = firstReady ? process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.pdf')) : undefined;
    firstReady = false;
    st.ready = true;
    if (arg) { st.claimed = true; (st.queue ??= []).unshift(arg); }
    flushWindow(win);
  });

  onSafe('docedit:close-after-save', (e, saved: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const st = win && windowState.get(win);
    // only a real "saved" closes the window without asking again; any other value (a truthy string, a number) must not
    if (win && st && saved === true) { st.forceClose = true; win.close(); }
  });
}

/**
 * The app was called DocEdit before it was named Oakqueill. Its data folder follows the product name, so on the
 * first start under the new name, saved signatures, trusted certificates and crash-recovery data are copied over.
 * The old folder is left in place.
 */
function carryOverOldAppData() {
  const now = app.getPath('userData');
  const old = join(dirname(now), 'DocEdit');
  if (old === now || !existsSync(old)) return;
  for (const part of ['signatures', 'trusted-certificates', 'recovery']) {
    const from = join(old, part), to = join(now, part);
    if (!existsSync(from) || existsSync(to)) continue;
    const partial = `${to}.partial`;
    try {
      rmSync(partial, { recursive: true, force: true });
      cpSync(from, partial, { recursive: true });
      renameSync(partial, to);
    } catch (e) {
      console.warn(`Could not copy ${part} from the old DocEdit folder; will try again next start.`, e);
    }
  }
}


// PDFs handed to the app by the system (macOS Finder "Open With", double-click, dropping on the Dock icon) arrive as
// 'open-file' events, possibly before the app or a window exists. A file never replaces a document that is open (that could
// discard unsaved changes): it goes to a window that has no document, or to a new window (see openRouting.ts).
const startupOpens: string[] = [];

function flushWindow(win: BrowserWindow) {
  const st = windowState.get(win);
  if (!st?.ready || win.isDestroyed()) return;
  const target = win.webContents;
  for (const path of (st.queue ?? []).splice(0)) {
    readPdfFile(resolve(path)).then(
      (file) => { if (!target.isDestroyed()) target.send('docedit:open-file', remember(file)); },
      (err: unknown) => {
        st.claimed = false; // nothing will show up, so the window is free again
        if (!target.isDestroyed()) target.send('docedit:open-file', { error: err instanceof Error ? err.message : String(err) });
      },
    );
  }
}

function openInWindow(path: string) {
  const slots = BrowserWindow.getAllWindows().flatMap((w) => { const st = windowState.get(w); return st && !w.isDestroyed() ? [{ id: w.id, hasDoc: !!st.hasDoc, claimed: !!st.claimed }] : []; });
  const id = pickWindowForOpen(slots);
  const win = (id !== null ? BrowserWindow.fromId(id) : null) ?? createWindow();
  const st = windowState.get(win)!;
  st.claimed = true;
  (st.queue ??= []).push(path);
  flushWindow(win); // a no-op until the page is ready
}

app.on('open-file', (event, path) => {
  event.preventDefault();
  if (!path.toLowerCase().endsWith('.pdf')) return;
  if (app.isReady()) openInWindow(path); else startupOpens.push(path);
});

// The app's name in the menus (About, Hide, Quit). Packaged builds already carry it; running from source would say "Electron".
app.setName('Oakqueill PDF Editor');

// The data folder is %APPDATA%\\Oakqueill (on macOS ~/Library/Application Support/Oakqueill) whatever the full product name is.
app.setPath('userData', join(app.getPath('appData'), 'Oakqueill'));

// Tests run against a throw-away profile folder (ignored in packaged builds).
if (!app.isPackaged && process.env.DOCEDIT_TEST_USER_DATA) app.setPath('userData', process.env.DOCEDIT_TEST_USER_DATA);

app.on('will-quit', () => { clearScans(); stopCoreWorker(); void retryLeftovers(); });

app.whenReady().then(() => {
  carryOverOldAppData();
  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  settings.onFolderChange = forgetListings;
  recovery = new RecoveryStore(join(app.getPath('userData'), 'recovery'));
  signatures = new SignatureStore(join(app.getPath('userData'), 'signatures'));
  trust = new TrustStore(join(app.getPath('userData'), 'trusted-certificates'));
  // The app needs no camera, microphone, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // The page may load files from the app's own folder only, never other local files (see fileGuard.ts).
  const rendererDir = join(here, '../renderer');
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, cb) => cb({ cancel: !isInsideDir(rendererDir, details.url) }));
  registerIpc();
  registerPrompts(here);
  registerCoreWorker(here);
  buildMenu();
  createWindow();
  for (const path of startupOpens.splice(0)) openInWindow(path); // the first goes to the window just made, the rest to their own
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Nothing in the app embeds another page: refuse <webview> outright.
app.on('web-contents-created', (_e, contents) => { contents.on('will-attach-webview', (e) => e.preventDefault()); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
