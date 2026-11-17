import { open, rename, stat, unlink, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { OpenedFile } from '../shared/api.js';

/** Files above this size are refused until large-file memory use has been measured (see ROADMAP). */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

export async function readPdfFile(path: string): Promise<OpenedFile> {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) throw new Error(`Cannot open “${basename(path)}”: it is not a file.`);
  if (info.size > MAX_FILE_BYTES) throw new Error(`“${basename(path)}” is ${(info.size / 1048576).toFixed(0)} MB; files over ${MAX_FILE_BYTES / 1048576} MB are not supported yet.`);
  const bytes = new Uint8Array(await readFile(path));
  // The header may follow some junk bytes; the standard allows readers to look a little way in.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) throw new Error(`“${basename(path)}” is not a PDF file.`);
  return { path, name: basename(path), bytes };
}

/**
 * Write via a temporary file in the same folder, flush it to disk, then rename it over the target.
 * If anything fails (disk full, permissions, file locked by another program) the original file is untouched
 * and the temporary file is removed.
 */
export async function writeFileSafely(target: string, bytes: Uint8Array): Promise<void> {
  const tmp = join(dirname(target), `.${randomBytes(8).toString('hex')}.docedit-tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tmp, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tmp, target);
  } catch (err) {
    await handle?.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
