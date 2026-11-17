import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { join } from 'node:path';
import type { AskAnswer, AskOptions } from '../shared/prompt.js';

/**
 * Questions the main process must decide itself (closing a window, opening a link, overwriting files) are drawn in a
 * small window of Oakqueill's own design instead of a Windows message box. The window gets only its question and a
 * way to answer: no access to the app's other functions, and nothing the document page can answer on its behalf.
 */
const open = new Map<number, { o: AskOptions; done(a: AskAnswer): void }>();
let here = '';

export function registerPrompts(dir: string) {
  here = dir;
  ipcMain.handle('docedit:prompt-options', (e) => open.get(e.sender.id)?.o ?? null);
  ipcMain.on('docedit:prompt-answer', (e, a: unknown) => {
    if (a === 'confirm' || a === 'cancel' || a === 'extra') open.get(e.sender.id)?.done(a);
  });
  ipcMain.on('docedit:prompt-ready', (e, height: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || !open.has(e.sender.id) || typeof height !== 'number') return;
    const want = Math.min(Math.max(Math.ceil(height), 120), 640);
    win.setContentSize(WIDTH, want);
    const parent = win.getParentWindow();
    if (parent) { // centred over the window that asks
      const p = parent.getBounds(), b = win.getBounds();
      win.setPosition(Math.round(p.x + (p.width - b.width) / 2), Math.round(p.y + Math.max(40, (p.height - b.height) / 3)));
    }
    win.show();
    // On macOS, attaching the window to its parent as a sheet makes it shorter than asked (by about the height of a
    // title bar), which cuts the buttons off. Asking for the size again once it is shown sticks; on other systems the
    // size is already right and this does nothing.
    if ((win.getContentSize()[1] ?? want) < want) win.setContentSize(WIDTH, want);
  });
}

const WIDTH = 460;

export function ask(parent: BrowserWindow | null, o: AskOptions): Promise<AskAnswer> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent: parent ?? undefined, modal: !!parent, width: WIDTH, height: 200, useContentSize: true,
      frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: !!parent,
      show: false, title: o.title, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b2320' : '#fffefb',
      webPreferences: { preload: join(here, '../preload/prompt.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    const id = win.webContents.id;
    let answered = false;
    const done = (a: AskAnswer) => {
      if (answered) return;
      answered = true;
      open.delete(id);
      resolve(a);
      if (!win.isDestroyed()) win.close();
    };
    open.set(id, { o, done });
    // closing it any other way (Alt+F4) is a cancel; a single-button message counts as acknowledged
    win.on('closed', () => done(o.cancel === null ? 'confirm' : 'cancel'));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void win.loadFile(join(here, '../renderer/prompt.html'));
  });
}
