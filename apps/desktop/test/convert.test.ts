import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertToPdf, findLibreOffice, type Converter } from '../src/main/convert.js';

const fake: Converter = { command: process.execPath, prefixArgs: [fileURLToPath(new URL('./fixtures/fake-soffice.mjs', import.meta.url))] };
const dir = mkdtempSync(join(tmpdir(), 'docedit-convert-test-'));
const log = join(dir, 'log.json');
const doc = join(dir, 'Quarterly report (final).docx');
writeFileSync(doc, 'fake docx content');
const leftovers = () => readdirSync(tmpdir()).filter((f) => f.startsWith('docedit-convert-') && !f.startsWith('docedit-convert-test-'));
const before = new Set(leftovers());

afterEach(() => { delete process.env.FAKE_SOFFICE_MODE; process.env.FAKE_SOFFICE_LOG = log; });
process.env.FAKE_SOFFICE_LOG = log;

describe('office conversion', () => {
  it('converts a copy in an isolated profile with macros disabled, and cleans up', async () => {
    const pdf = await convertToPdf(fake, doc);
    expect(Buffer.from(pdf).toString('latin1')).toContain('%PDF-1.7');
    const rec = JSON.parse(readFileSync(log, 'utf8'));
    expect(rec.inputContent).toBe('fake docx content');
    expect(rec.args).toEqual(expect.arrayContaining(['--headless', '--convert-to', 'pdf', '--norestore']));
    expect(rec.args.at(-1)).toMatch(/document\.docx$/);                 // neutral name, not the user's path
    expect(rec.args.at(-1)).not.toContain(dir);
    expect(rec.settings).toContain('DisableMacrosExecution');
    expect(rec.settings).toContain('BlockUntrustedRefererLinks');
    expect(existsSync(doc)).toBe(true);                                  // original untouched
    expect(leftovers().filter((f) => !before.has(f))).toEqual([]);      // temp folder removed
  });

  it('reports failures, missing output and non-PDF output', async () => {
    process.env.FAKE_SOFFICE_MODE = 'fail';
    await expect(convertToPdf(fake, doc)).rejects.toMatchObject({ reason: 'failed', message: expect.stringContaining('could not be loaded') });
    process.env.FAKE_SOFFICE_MODE = 'nothing';
    await expect(convertToPdf(fake, doc)).rejects.toMatchObject({ reason: 'failed', message: expect.stringContaining('without producing') });
  });

  it('stops a conversion that runs too long, or is cancelled', async () => {
    process.env.FAKE_SOFFICE_MODE = 'hang';
    await expect(convertToPdf(fake, doc, { timeoutMs: 800 })).rejects.toMatchObject({ reason: 'timeout' });
    // gone as soon as the call returns, not some time later (Windows keeps folders a running process uses)
    expect(leftovers().filter((f) => !before.has(f))).toEqual([]);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    await expect(convertToPdf(fake, doc, { signal: ac.signal })).rejects.toMatchObject({ reason: 'cancelled' });
    expect(leftovers().filter((f) => !before.has(f))).toEqual([]);
  });

  it('refuses files that are not office documents', async () => {
    const exe = join(dir, 'tool.exe'); writeFileSync(exe, 'MZ');
    await expect(convertToPdf(fake, exe)).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('finds LibreOffice from the override variable and returns null when absent', async () => {
    expect(await findLibreOffice({ DOCEDIT_SOFFICE: process.execPath }, 'win32')).toEqual({ command: process.execPath, prefixArgs: [] });
    expect(await findLibreOffice({ ProgramFiles: join(dir, 'nowhere') }, 'win32')).toBeNull();
  });
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
