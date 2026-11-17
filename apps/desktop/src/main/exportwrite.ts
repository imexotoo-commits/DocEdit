/**
 * Writing exported files without harming what is already on disk.
 * Replacing goes through a temporary file renamed over the target (a failure leaves the old file as it was).
 * "Keep both" never overwrites: each file is created exclusively, and a name taken meanwhile moves on to the next
 * free number. A failure part-way through a batch stops there and says which files were written.
 */
import { existsSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileSafely } from './files.js';

/** Create a new file; fails with EEXIST if the name is taken. A half-written file of ours is removed. */
export async function writeNewFile(target: string, bytes: Uint8Array): Promise<void> {
  const fh = await open(target, 'wx');
  try { await fh.writeFile(bytes); await fh.sync(); await fh.close(); }
  catch (err) { await fh.close().catch(() => {}); await unlink(target).catch(() => {}); throw err; }
}

export interface WriteIo { replace(target: string, bytes: Uint8Array): Promise<void>; create(target: string, bytes: Uint8Array): Promise<void>; exists(path: string): boolean }
const realIo: WriteIo = { replace: writeFileSafely, create: writeNewFile, exists: existsSync };

/** "page-1.png", "page-1 (2).png", "page-1 (3).png", ... */
const numbered = (name: string, k: number) => (k < 2 ? name : name.replace(/(\.[^.]+)?$/, (ext) => ` (${k})${ext}`));

/**
 * Creates one file without ever replacing another: the wanted name, or the next free "name (2).ext", "name (3).ext"...
 * A name that appears between the choice and the write (another save, a sync client) just moves on to the next number.
 * `taken` holds the names this batch already used, compared the way Windows does (case-insensitive).
 */
export async function writeUniqueFile(folder: string, name: string, bytes: Uint8Array, taken = new Set<string>(), create: WriteIo['create'] = writeNewFile): Promise<string> {
  for (let k = 1; k <= 1000; k++) {
    const candidate = numbered(name, k);
    if (taken.has(candidate.toLowerCase())) continue;
    try {
      await create(join(folder, candidate), bytes);
      taken.add(candidate.toLowerCase());
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Could not find a free name for “${name}”.`);
}

export interface BatchResult { written: string[]; error?: { file: string; message: string } }

export async function writeBatch(folder: string, files: Array<{ name: string; bytes: Uint8Array }>, mode: 'replace' | 'keep-both', io: WriteIo = realIo): Promise<BatchResult> {
  const written: string[] = [];
  const reserved = new Set<string>(); // names used by this batch, compared as Windows does (case-insensitive)
  const key = (n: string) => n.toLowerCase();
  for (const f of files) {
    let k = 1;
    const free = () => { while (reserved.has(key(numbered(f.name, k))) || (mode === 'keep-both' && io.exists(join(folder, numbered(f.name, k))))) k++; return numbered(f.name, k); };
    let name = free();
    try {
      if (mode === 'replace') await io.replace(join(folder, name), f.bytes);
      else {
        for (let tries = 0; ; tries++) {
          try { await io.create(join(folder, name), f.bytes); break; }
          catch (err) {
            // taken between the check and the write: the next free number, never the existing file
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || tries > 50) throw err;
            k++; name = free();
          }
        }
      }
      reserved.add(key(name));
      written.push(join(folder, name));
    } catch (err) {
      return { written, error: { file: name, message: err instanceof Error ? err.message : String(err) } };
    }
  }
  return { written };
}
