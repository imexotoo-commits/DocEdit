/**
 * Crash recovery store. While a document has unsaved changes the renderer sends snapshots here:
 * source PDFs are written once, the page list (small) on every change. A clean save, close or
 * discard removes the session. Sessions left behind by a process that is no longer running are
 * offered for recovery at the next start.
 *
 * Files live under the user's private app-data folder; on systems with POSIX permissions the folder
 * is 0700 and files 0600. Plain Node, no Electron imports, so it can be unit-tested.
 */
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RecoveryManifest {
  version: 1;
  id: string;
  pid: number;
  title: string;
  /** the file the document was opened from, if any */
  path: string | null;
  /** size and modification time of `path` when the document was opened, to warn if it changed since */
  pathStamp: { size: number; mtimeMs: number } | null;
  sourceCount: number;
  /** the renderer's page list, pending edits and bookmark tree, stored as-is */
  pages: unknown[];
  edits?: unknown[];
  outline?: unknown;
  updatedAt: number;
}

export interface RecoverySummary { id: string; title: string; path: string | null; updatedAt: number; pageCount: number }

const ID = /^[a-zA-Z0-9_-]{6,64}$/;
const isPosix = process.platform !== 'win32';

export class RecoveryStore {
  constructor(private readonly root: string, private readonly pid = process.pid, private readonly isAlive = processAlive) {}

  private dir(id: string) {
    if (!ID.test(id)) throw new Error('Bad recovery id');
    return join(this.root, id);
  }

  private async ensureDir(d: string) {
    await mkdir(d, { recursive: true, mode: 0o700 });
    if (isPosix) await chmod(d, 0o700).catch(() => {});
  }

  private async writePrivate(file: string, data: Uint8Array | string) {
    // write-then-rename so a crash mid-write never leaves a half manifest
    const tmp = `${file}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, file);
  }

  /** Save a snapshot. `newSources` are sources with index >= the count already stored for this session. */
  async save(snap: { id: string; title: string; path: string | null; pages: unknown[]; edits?: unknown[]; outline?: unknown; newSources: Uint8Array[]; firstNewSource: number }): Promise<void> {
    const d = this.dir(snap.id);
    await this.ensureDir(this.root);
    await this.ensureDir(d);
    const prev = await this.manifest(snap.id).catch(() => null);
    let count = prev?.sourceCount ?? 0;
    if (snap.firstNewSource > count) throw new Error('Recovery snapshot is missing sources');
    for (const [k, bytes] of snap.newSources.entries()) {
      const index = snap.firstNewSource + k;
      if (index < count) continue; // already stored
      await this.writePrivate(join(d, `source-${index}.pdf`), bytes);
      count = index + 1;
    }
    let pathStamp = prev?.pathStamp ?? null;
    if (!prev && snap.path) pathStamp = await stat(snap.path).then((s) => ({ size: s.size, mtimeMs: s.mtimeMs }), () => null);
    const manifest: RecoveryManifest = {
      version: 1, id: snap.id, pid: this.pid, title: snap.title, path: snap.path, pathStamp,
      sourceCount: count, pages: snap.pages, edits: snap.edits ?? [], outline: snap.outline ?? null, updatedAt: Date.now(),
    };
    await this.writePrivate(join(d, 'manifest.json'), JSON.stringify(manifest));
  }

  async manifest(id: string): Promise<RecoveryManifest> {
    const m = JSON.parse(await readFile(join(this.dir(id), 'manifest.json'), 'utf8')) as RecoveryManifest;
    if (m.version !== 1 || m.id !== id) throw new Error('Unreadable recovery data');
    return m;
  }

  /** Sessions whose owning process has gone away (crashed or killed). */
  async orphans(): Promise<RecoverySummary[]> {
    const names = await readdir(this.root).catch(() => [] as string[]);
    const out: RecoverySummary[] = [];
    for (const id of names) {
      if (!ID.test(id)) continue;
      const m = await this.manifest(id).catch(() => null);
      if (!m) { await this.discard(id).catch(() => {}); continue; } // half-written session from a crash during the first save
      if (m.pid === this.pid || this.isAlive(m.pid)) continue;
      out.push({ id, title: m.title, path: m.path, updatedAt: m.updatedAt, pageCount: m.pages.length });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<{ manifest: RecoveryManifest; sources: Uint8Array[]; originalChanged: boolean }> {
    const manifest = await this.manifest(id);
    const sources: Uint8Array[] = [];
    for (let i = 0; i < manifest.sourceCount; i++) sources.push(new Uint8Array(await readFile(join(this.dir(id), `source-${i}.pdf`))));
    let originalChanged = false;
    if (manifest.path && manifest.pathStamp) {
      const s = await stat(manifest.path).catch(() => null);
      originalChanged = !s || s.size !== manifest.pathStamp.size || Math.abs(s.mtimeMs - manifest.pathStamp.mtimeMs) > 1;
    }
    // the recovering process now owns the session
    await this.writePrivate(join(this.dir(id), 'manifest.json'), JSON.stringify({ ...manifest, pid: this.pid }));
    return { manifest, sources, originalChanged };
  }

  async discard(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
  }
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
