import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecoveryStore } from '../src/main/recovery.js';

const root = () => mkdtempSync(join(tmpdir(), 'docedit-recovery-test-'));
const bytes = (s: string) => new TextEncoder().encode(s);
const DEAD = 999_999;

describe('recovery store', () => {
  it('stores sources once and the page list on each change, then recovers them after a crash', async () => {
    const dir = root();
    const original = join(dir, 'original.pdf');
    writeFileSync(original, '%PDF original');
    const crashed = new RecoveryStore(join(dir, 'r'), DEAD, () => false);
    await crashed.save({ id: 'sess-abc123', title: 'original.pdf', path: original, pages: [{ id: 'a' }], newSources: [bytes('%PDF one')], firstNewSource: 0 });
    // second snapshot: one more source appended, more pages
    await crashed.save({ id: 'sess-abc123', title: 'original.pdf', path: original, pages: [{ id: 'a' }, { id: 'b' }], newSources: [bytes('%PDF two')], firstNewSource: 1 });
    // re-sending an already stored source is harmless
    await crashed.save({ id: 'sess-abc123', title: 'original.pdf', path: original, pages: [{ id: 'b' }], newSources: [bytes('ignored')], firstNewSource: 0 });

    const next = new RecoveryStore(join(dir, 'r'), 4242, (pid) => pid === 4242);
    const orphans = await next.orphans();
    expect(orphans).toEqual([expect.objectContaining({ id: 'sess-abc123', title: 'original.pdf', pageCount: 1 })]);
    const rec = await next.load('sess-abc123');
    expect(rec.sources.map((s) => new TextDecoder().decode(s))).toEqual(['%PDF one', '%PDF two']);
    expect(rec.manifest.pages).toEqual([{ id: 'b' }]);
    expect(rec.originalChanged).toBe(false);
    // once loaded, the session belongs to the running process and is no longer an orphan
    expect(await next.orphans()).toEqual([]);
    await next.discard('sess-abc123');
    expect(readdirSync(join(dir, 'r'))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not offer sessions of a process that is still running', async () => {
    const dir = root();
    const a = new RecoveryStore(dir, 111, () => true);
    await a.save({ id: 'live-session', title: 't', path: null, pages: [], newSources: [], firstNewSource: 0 });
    expect(await new RecoveryStore(dir, 222, () => true).orphans()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('notices when the original file changed after the snapshot', async () => {
    const dir = root();
    const original = join(dir, 'o.pdf');
    writeFileSync(original, '%PDF v1');
    await new RecoveryStore(join(dir, 'r'), DEAD).save({ id: 'changed-1', title: 'o', path: original, pages: [], newSources: [bytes('%PDF v1')], firstNewSource: 0 });
    writeFileSync(original, '%PDF v2 is longer');
    const t = statSync(original).mtime; utimesSync(original, t, new Date(t.getTime() + 5000));
    expect((await new RecoveryStore(join(dir, 'r'), 1, () => false).load('changed-1')).originalChanged).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('cleans up half-written sessions and rejects bad ids and gaps', async () => {
    const dir = root();
    const s = new RecoveryStore(dir, 1, () => false);
    await s.save({ id: 'good-one', title: 't', path: null, pages: [], newSources: [], firstNewSource: 0 });
    rmSync(join(dir, 'good-one', 'manifest.json'));
    expect(await s.orphans()).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
    await expect(s.save({ id: '../escape', title: 't', path: null, pages: [], newSources: [], firstNewSource: 0 })).rejects.toThrow(/Bad recovery id/);
    await expect(s.save({ id: 'gap-test', title: 't', path: null, pages: [], newSources: [bytes('x')], firstNewSource: 2 })).rejects.toThrow(/missing sources/);
    rmSync(dir, { recursive: true, force: true });
  });
});
