import { describe, expect, it } from 'vitest';
import { latestOnly } from '../src/renderer/latest.js';

/** A request whose answer arrives when the test says so. */
function later<T>() { let ok!: (v: T) => void, fail!: (e: unknown) => void; const p = new Promise<T>((a, b) => { ok = a; fail = b; }); return { p, ok, fail }; }

describe('signature checks: only the latest may report', () => {
  it('ignores an earlier document’s result that arrives last, and stale errors', async () => {
    const latest = latestOnly();
    const shown: string[] = [];
    const run = (req: Promise<string>) => { const live = latest.start(); return req.then((r) => { if (live()) shown.push(r); }, (e) => { if (live()) shown.push(`error: ${e}`); }); };
    const a = later<string>(), b = later<string>();
    const done = [run(a.p), run(b.p)]; // document A opened, then document B
    b.ok('B verdict'); a.ok('A verdict'); // B answers first, A last
    await Promise.all(done);
    expect(shown).toEqual(['B verdict']);
    // a stale failure is ignored too
    const c = later<string>(), d = later<string>();
    const more = [run(c.p), run(d.p)];
    d.ok('D verdict'); c.fail('C broke');
    await Promise.all(more);
    expect(shown).toEqual(['B verdict', 'D verdict']);
  });
  it('drops an answer that arrives after the document was closed or switched', async () => {
    const latest = latestOnly();
    const live = latest.start();
    latest.cancel(); // the view went away / the source changed
    expect(live()).toBe(false);
  });
});
