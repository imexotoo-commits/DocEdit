/**
 * Recently opened documents, kept in recent.json in the profile folder: newest first, at most MAX, each path once
 * (compared without case, as Windows does). Files that no longer exist are left out of the list shown. Only paths in
 * this list can be opened through it, so the page cannot use it to read other files.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

export interface RecentFile { path: string; name: string; folder: string; openedAt: number }

export const MAX_RECENT = 10;

export class RecentStore {
  private items: Array<{ path: string; openedAt: number }> = [];
  /** called after every change, with the list as shown */
  onChange?: (list: RecentFile[]) => void;

  constructor(private readonly file: string, private readonly exists: (p: string) => boolean = existsSync) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (Array.isArray(raw)) {
        this.items = raw.flatMap((r) => (r && typeof r.path === 'string' && isAbsolute(r.path) && r.path.length < 2000
          ? [{ path: r.path, openedAt: Number.isFinite(r.openedAt) ? Number(r.openedAt) : 0 }] : [])).slice(0, MAX_RECENT);
      }
    } catch { /* first start or unreadable: empty */ }
  }

  /** The list, newest first, without files that have gone. */
  list(): RecentFile[] {
    return this.items.filter((i) => this.exists(i.path)).map((i) => ({ path: i.path, name: basename(i.path), folder: dirname(i.path), openedAt: i.openedAt }));
  }

  has(path: string): boolean { const k = key(path); return this.items.some((i) => key(i.path) === k); }

  add(path: string, now = Date.now()): void {
    const k = key(path);
    this.items = [{ path: resolve(path), openedAt: now }, ...this.items.filter((i) => key(i.path) !== k)].slice(0, MAX_RECENT);
    this.write();
  }

  remove(path: string): void {
    const k = key(path);
    const next = this.items.filter((i) => key(i.path) !== k);
    if (next.length === this.items.length) return;
    this.items = next;
    this.write();
  }

  clear(): void {
    if (!this.items.length) return;
    this.items = [];
    this.write();
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.items, null, 2));
      renameSync(this.file + '.tmp', this.file);
    } catch (e) { console.warn('Could not save the recent files list', e); }
    this.onChange?.(this.list());
  }
}

const key = (p: string) => resolve(p).toLowerCase();
