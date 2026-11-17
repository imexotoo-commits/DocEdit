import { app, BrowserWindow } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrintRequest, PrintResult } from '../shared/api.js';

/**
 * Prints page images through the system print dialog.
 * The renderer draws the chosen pages to PNG; here they go into a private temporary folder with a
 * minimal HTML file, which a hidden, sandboxed window loads and prints. The folder is removed afterwards.
 */
export async function printPages(parent: BrowserWindow | null, req: PrintRequest): Promise<PrintResult> {
  if (!Array.isArray(req.pages) || req.pages.length === 0) return { ok: false, message: 'Nothing to print.' };
  const dir = await mkdtemp(join(tmpdir(), 'docedit-print-'));
  let win: BrowserWindow | null = null;
  try {
    const parts: string[] = [];
    // One paper orientation per job keeps every sheet the same size. "auto" uses portrait paper and
    // turns landscape pages a quarter turn counter-clockwise so they fill it, the usual convention.
    const landscapePaper = req.orientation === 'landscape';
    for (const [i, p] of req.pages.entries()) {
      if (!(p.png instanceof Uint8Array) || !(p.widthPt > 0) || !(p.heightPt > 0)) throw new Error('Bad page image');
      await writeFile(join(dir, `p${i}.png`), p.png);
      const turn = req.orientation === 'auto' && p.widthPt > p.heightPt;
      const style = req.fit ? '' : ` style="width:${p.widthPt.toFixed(2)}pt;height:${p.heightPt.toFixed(2)}pt"`;
      parts.push(`<div class="sheet${turn ? ' turn' : ''}"><img src="p${i}.png"${style} alt=""></div>`);
    }
    const html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file:; style-src 'unsafe-inline'">
<title>${escapeHtml(req.title || 'Document')}</title><style>
@page { size: ${landscapePaper ? 'landscape' : 'portrait'}; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff }
.sheet { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; break-after: page }
.sheet:last-child { break-after: auto }
.sheet.turn img { transform: rotate(-90deg) }
${req.fit ? `.sheet img { max-width: 100vw; max-height: 100vh; object-fit: contain }
.sheet.turn img { max-width: 100vh; max-height: 100vw }` : ''}
</style></head><body>${parts.join('')}</body></html>`;
    const file = join(dir, 'print.html');
    await writeFile(file, html, 'utf8');

    win = new BrowserWindow({
      show: false, parent: parent ?? undefined,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    await win.loadURL(pathToFileURL(file).href);
    const w = win;
    // Test hook for unpackaged builds: print to a PDF file instead of the system dialog.
    const testOut = !app.isPackaged ? process.env.DOCEDIT_TEST_PRINT_TO_PDF : undefined;
    if (testOut) {
      await writeFile(testOut, await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } }));
      return { ok: true };
    }
    const result = await new Promise<PrintResult>((resolve) => {
      w.webContents.print(
        { silent: false, printBackground: true, landscape: landscapePaper, margins: { marginType: 'none' } },
        (success, reason) => resolve(success ? { ok: true } : reason === 'cancelled' ? { ok: false, cancelled: true } : { ok: false, message: reason || 'Printing failed.' }),
      );
    });
    return result;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
