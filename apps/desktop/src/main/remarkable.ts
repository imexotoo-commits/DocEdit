/**
 * reMarkable exports: the PDFs the user saves from reMarkable (desktop or phone app, or a synced cloud folder such
 * as OneDrive, Google Drive or Dropbox) into one folder they choose. Only that folder is read; nothing of the
 * reMarkable app itself is touched.
 *
 * The page never names a file. Listing gives each PDF an opaque id, valid only for the window that asked and the
 * folder it was listed from; opening goes by that id. Every open resolves the real file (links and junctions
 * included), checks with the platform's own path rules that it lies inside the real folder, and checks again after
 * the file is open, so a path swapped in between is caught.
 */
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { OpenedFile } from '../shared/api.js';
import { MAX_FILE_BYTES } from './files.js';

export interface ExportedPdf { id: string; name: string; folder: string; modified: number; size: number }

/** Listed files per window: id -> where it was found. Replaced on every listing, cleared when the folder changes. */
const listed = new Map<number, { folder: string; files: Map<string, string> }>();

/** True when `child` is `root` itself or inside it, by the platform's path rules (case-insensitive on Windows). */
export function inside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function forgetListings(): void { listed.clear(); }

/** PDFs in the folder and its subfolders (two levels, as cloud folders tend to nest), newest first. Links are not followed. */
export async function listExports(windowId: number, folder: string | null): Promise<{ ok: true; files: ExportedPdf[] } | { ok: false; message: string }> {
  listed.delete(windowId);
  if (!folder) return { ok: false, message: 'No reMarkable folder chosen yet.' };
  let root: string;
  try { root = await realpath(resolve(folder)); if (!(await stat(root)).isDirectory()) throw new Error(); }
  catch { return { ok: false, message: 'The reMarkable folder cannot be found. It may have been moved, or its drive is not connected.' }; }
  const found: Array<ExportedPdf & { path: string }> = [];
  async function walk(dir: string, depth: number) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      // links and junctions could lead out of the folder: they are not listed, and not entered
      if (e.isSymbolicLink() || e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 2) await walk(p, depth + 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) {
        try { const s = await stat(p); found.push({ id: '', path: p, name: e.name, folder: relative(root, dir), modified: s.mtimeMs, size: s.size }); } catch { /* vanished meanwhile */ }
      }
      if (found.length > 2000) return;
    }
  }
  await walk(root, 0);
  found.sort((a, b) => b.modified - a.modified);
  const files = new Map<string, string>();
  const out = found.slice(0, 200).map(({ path, ...f }) => { const id = randomBytes(12).toString('hex'); files.set(id, path); return { ...f, id }; });
  listed.set(windowId, { folder: root, files });
  return { ok: true, files: out };
}

/** Open a listed file by its id, for the window that listed it, while the folder is still the chosen one. */
export async function openExport(windowId: number, folder: string | null, id: unknown): Promise<OpenedFile> {
  const refused = () => new Error('That file is not in the reMarkable folder (anymore). Refresh the list and try again.');
  const entry = listed.get(windowId);
  const path = typeof id === 'string' ? entry?.files.get(id) : undefined;
  if (!folder || !entry || !path) throw refused();
  let root: string, real: string;
  try { root = await realpath(resolve(folder)); real = await realpath(path); } catch { throw refused(); }
  if (root !== entry.folder || !inside(root, real)) throw refused(); // the folder changed, or the file now leads elsewhere
  const fh = await open(real, 'r').catch(() => { throw refused(); });
  try {
    const info = await fh.stat();
    if (!info.isFile()) throw refused();
    if (info.size > MAX_FILE_BYTES) throw new Error(`“${basename(real)}” is ${(info.size / 1048576).toFixed(0)} MB; files over ${MAX_FILE_BYTES / 1048576} MB are not supported yet.`);
    // the path may have been swapped between the check and the open: it must still resolve to the same file
    const again = await realpath(path).catch(() => '');
    const now = again ? await stat(again).catch(() => null) : null;
    if (again !== real || !now || now.ino !== info.ino || now.dev !== info.dev) throw refused();
    const bytes = new Uint8Array(await fh.readFile());
    if (!Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-')) throw new Error(`“${basename(real)}” is not a PDF file.`);
    return { path: real, name: basename(real), bytes };
  } finally { await fh.close().catch(() => {}); }
}
