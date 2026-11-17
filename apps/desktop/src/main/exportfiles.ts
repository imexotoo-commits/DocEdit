import { app, BrowserWindow, dialog } from 'electron';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ask } from './prompt.js';
import { writeBatch } from './exportwrite.js';
import { writeFileSafely } from './files.js';

export interface ExportRequest { files: Array<{ name: string; bytes: Uint8Array }>; kind: 'docx' | 'txt' | 'png' | 'jpg' }
export type ExportResult = { ok: true; paths: string[] } | { ok: false; cancelled: true } | { ok: false; cancelled: false; message: string; /** files written before the failure */ paths?: string[] };

const FILTERS: Record<ExportRequest['kind'], Electron.FileFilter> = {
  docx: { name: 'Word document', extensions: ['docx'] },
  txt: { name: 'Text file', extensions: ['txt'] },
  png: { name: 'PNG image', extensions: ['png'] },
  jpg: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
};

/** Never trust a name from the page: a plain file name, no folders, no reserved characters. */
const safeName = (n: string) => basename(String(n)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'export';

/** One file: the Save dialog. Several (page images): a folder, with a question when names are taken. */
export async function saveExport(win: BrowserWindow | null, req: ExportRequest): Promise<ExportResult> {
  if (!req.files.length || !FILTERS[req.kind]) return { ok: false, cancelled: false, message: 'Nothing to export.' };
  const ext = FILTERS[req.kind].extensions[0]!;
  try {
    if (req.files.length === 1) {
      const opts: Electron.SaveDialogOptions = { title: 'Export', defaultPath: safeName(req.files[0]!.name), filters: [FILTERS[req.kind]] };
      const testPath = !app.isPackaged ? process.env.DOCEDIT_TEST_SAVE_PATH : undefined; // test hook, unpackaged only
      const res = testPath ? { canceled: false, filePath: testPath.replace(/\.pdf$/i, `.${ext}`) } : win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
      const target = FILTERS[req.kind].extensions.some((e) => res.filePath!.toLowerCase().endsWith(`.${e}`)) ? res.filePath : `${res.filePath}.${ext}`;
      await writeFileSafely(target, req.files[0]!.bytes); // a failure leaves an existing file as it was
      return { ok: true, paths: [target] };
    }
    const testDir = !app.isPackaged ? process.env.DOCEDIT_TEST_SAVE_DIR : undefined;
    const opts: Electron.OpenDialogOptions = { title: 'Choose a folder for the page images', properties: ['openDirectory', 'createDirectory'] };
    const res = testDir ? { canceled: false, filePaths: [testDir] } : win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return { ok: false, cancelled: true };
    const folder = res.filePaths[0];
    const files = req.files.map((f) => ({ name: safeName(f.name), bytes: f.bytes }));
    const taken = files.map((f) => f.name).filter((n) => existsSync(join(folder, n)));
    let mode: 'replace' | 'keep-both' = 'keep-both';
    if (taken.length) {
      const answer = await ask(win, {
        title: `${taken.length} file${taken.length === 1 ? '' : 's'} with the same name already exist${taken.length === 1 ? 's' : ''} in this folder`,
        message: 'Keep both by numbering the new files, or replace the existing ones?', kind: 'warning',
        detail: taken.slice(0, 8).join('\n') + (taken.length > 8 ? '\n…' : ''), confirm: { label: 'Keep both' }, extra: { label: 'Replace', danger: true },
      });
      if (answer === 'cancel') return { ok: false, cancelled: true };
      if (answer === 'extra') mode = 'replace';
    }
    const batch = await writeBatch(folder, files, mode);
    if (batch.error) {
      const n = batch.written.length;
      return { ok: false, cancelled: false, paths: batch.written,
        message: `Could not write ${batch.error.file}: ${batch.error.message}. ${n ? `${n} of ${files.length} file${files.length === 1 ? ' was' : 's were'} written before that: ${batch.written.map((p) => basename(p)).join(', ')}.` : 'No files were written.'}` };
    }
    return { ok: true, paths: batch.written };
  } catch (err) {
    return { ok: false, cancelled: false, message: err instanceof Error ? err.message : String(err) };
  }
}
