import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_RECENT, RecentStore } from '../src/main/recent.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'oakq-recent-'));
  const file = join(dir, 'recent.json');
  const present = new Set<string>();
  const exists = (p: string) => present.has(p.toLowerCase());
  const doc = (n: string) => { const p = join(dir, `${n}.pdf`); present.add(p.toLowerCase()); return p; };
  return { dir, file, exists, doc, present, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('recent files', () => {
  it('keeps the newest first, each file once whatever its case, at most ten', () => {
    const s = setup();
    try {
      const store = new RecentStore(s.file, s.exists);
      const a = s.doc('a'), b = s.doc('b');
      store.add(a, 1); store.add(b, 2); store.add(a.toUpperCase(), 3);
      expect(store.list().map((r) => r.name.toLowerCase())).toEqual(['a.pdf', 'b.pdf']);
      for (let i = 0; i < 15; i++) store.add(s.doc(`n${i}`), 10 + i);
      expect(store.list()).toHaveLength(MAX_RECENT);
      expect(store.list()[0]!.name).toBe('n14.pdf');
    } finally { s.done(); }
  });

  it('survives a restart and leaves out files that are gone', () => {
    const s = setup();
    try {
      const a = s.doc('a'), b = s.doc('b');
      const first = new RecentStore(s.file, s.exists);
      first.add(a, 1); first.add(b, 2);
      s.present.delete(a.toLowerCase());
      const again = new RecentStore(s.file, s.exists);
      expect(again.list().map((r) => r.name)).toEqual(['b.pdf']);
      expect(again.list()[0]!.folder).toBe(s.dir);
    } finally { s.done(); }
  });

  it('removes, clears, reports changes and ignores a damaged or hostile file', () => {
    const s = setup();
    try {
      writeFileSync(s.file, JSON.stringify([{ path: 'relative.pdf' }, { path: 42 }, null, { path: s.doc('ok') }]));
      const store = new RecentStore(s.file, s.exists);
      expect(store.list().map((r) => r.name)).toEqual(['ok.pdf']);
      const seen: number[] = [];
      store.onChange = (l) => seen.push(l.length);
      store.remove(s.doc('ok'));
      store.add(s.doc('x'));
      store.clear();
      expect(seen).toEqual([0, 1, 0]);
      expect(JSON.parse(readFileSync(s.file, 'utf8'))).toEqual([]);
      writeFileSync(s.file, '{not json');
      expect(new RecentStore(s.file, s.exists).list()).toEqual([]);
    } finally { s.done(); }
  });
});
