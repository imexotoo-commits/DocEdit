import { describe, expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scan } from '../src/main/scan.js';

/** A stand-in for the PowerShell/WIA step: saves `pages` pages, then stops with `hresult` (or finishes). */
function scanner(pages: number, hresult?: string, message = 'WIA error') {
  const seen: { out?: string } = {};
  const run = async (_script: string, env: Record<string, string>) => {
    seen.out = env.OAKQ_OUT;
    const files = Array.from({ length: pages }, (_, i) => { const p = join(env.OAKQ_OUT!, `page-${i + 1}.png`); writeFileSync(p, 'png'); return p; });
    return JSON.stringify({ files, error: hresult ? message : null, hresult: hresult ?? null });
  };
  return { run, seen };
}
const req = (feeder: boolean) => ({ deviceId: 'dev-1', dpi: 300, mode: 'color' as const, feeder });

// scanning goes through Windows (WIA); elsewhere scan() declines up front
describe.skipIf(process.platform !== 'win32')('scanning: the end of the pages is not an error, and an error is not the end', () => {
  it('a feeder that runs out of paper after three pages is a finished scan', async () => {
    const res = await scan(req(true), scanner(3, '0x80210003', 'Paper empty').run);
    expect(res).toMatchObject({ ok: true });
    expect(res.ok && res.files.length).toBe(3);
  });

  it('a jam after the first page is reported, with that page offered separately', async () => {
    const res = await scan(req(true), scanner(1, '0x80210002', 'Paper jam').run);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/jammed/);
    expect(res.message).toMatch(/1 page was scanned before that/);
    expect(res.partial).toHaveLength(1);
    expect(existsSync(res.partial![0]!)).toBe(true); // kept until the user decides
  });

  it('an empty feeder at the start, a busy scanner and a flatbed failure are errors, and leave nothing behind', async () => {
    for (const [feeder, code, words] of [[true, '0x80210003', /feeder is empty/], [true, '0x80210006', /busy/], [false, '0x80210005', /offline/]] as const) {
      const s = scanner(0, code);
      const res = await scan(req(feeder), s.run);
      expect(res).toMatchObject({ ok: false });
      expect(!res.ok && res.message).toMatch(words);
      expect(existsSync(s.seen.out!), 'the job folder is removed').toBe(false);
    }
  });

  it('a cancelled flatbed scan says so and cleans up', async () => {
    const s = scanner(0);
    expect(await scan(req(false), s.run)).toEqual({ ok: false, message: 'Scanning was cancelled.' });
    expect(existsSync(s.seen.out!)).toBe(false);
  });
});
