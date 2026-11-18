import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { writeBatch, writeNewFile, writeUniqueFile, type WriteIo } from '../src/main/exportwrite.js';
import { writeFileSafely } from '../src/main/files.js';

const bytes = (s: string) => new TextEncoder().encode(s);
const dir = () => mkdtempSync(join(tmpdir(), 'oakq-export-'));
/** Whether the temp folder's file system treats "A.png" and "a.png" as one file (Windows and macOS by default; not Linux). */
const caseInsensitiveFs = (() => { const d = dir(); writeFileSync(join(d, 'probe.txt'), ''); return existsSync(join(d, 'PROBE.TXT')); })();
/** Bytes that make the write itself fail part-way (after the file was opened). */
const poison = { get length() { throw new Error('disk full'); } } as unknown as Uint8Array;

describe('export writing keeps existing files safe', () => {
  it('a failed replace leaves the existing file as it was, and no temporary file behind', async () => {
    const d = dir(), target = join(d, 'report.docx');
    writeFileSync(target, 'the original');
    await expect(writeFileSafely(target, poison)).rejects.toThrow();
    expect(readFileSync(target, 'utf8')).toBe('the original');
    expect(readdirSync(d)).toEqual(['report.docx']);
  });

  it('a failed new file is removed, and creating never overwrites', async () => {
    const d = dir();
    await expect(writeNewFile(join(d, 'a.png'), poison)).rejects.toThrow();
    expect(existsSync(join(d, 'a.png'))).toBe(false);
    writeFileSync(join(d, 'b.png'), 'keep me');
    await expect(writeNewFile(join(d, 'b.png'), bytes('new'))).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(join(d, 'b.png'), 'utf8')).toBe('keep me');
  });

  it('keep both numbers past names on disk and in the batch, and never touches existing files', async () => {
    const d = dir();
    writeFileSync(join(d, 'page-1.png'), 'old 1');
    writeFileSync(join(d, 'page-1 (2).png'), 'old 1b');
    const res = await writeBatch(d, [{ name: 'page-1.png', bytes: bytes('new 1') }, { name: 'Page-1.png', bytes: bytes('new 1 again') }, { name: 'page-2.png', bytes: bytes('new 2') }], 'keep-both');
    expect(res.error).toBeUndefined();
    // "Page-1.png" is the same file as "page-1.png" on a case-insensitive file system, so it must be renumbered there;
    // on a case-sensitive one (Linux) it is a different, free name and nothing is overwritten by using it.
    expect(res.written.map((p) => basename(p))).toEqual(caseInsensitiveFs ? ['page-1 (3).png', 'Page-1 (4).png', 'page-2.png'] : ['page-1 (3).png', 'Page-1.png', 'page-2.png']);
    expect(readFileSync(join(d, 'page-1.png'), 'utf8')).toBe('old 1');
    expect(readFileSync(join(d, 'page-1 (2).png'), 'utf8')).toBe('old 1b');
  });

  it('a name taken between the check and the write moves on to the next number', async () => {
    const d = dir();
    let raced = false;
    const io: WriteIo = {
      exists: existsSync, replace: writeFileSafely,
      async create(target, b) { if (!raced) { raced = true; writeFileSync(target, 'someone else'); } return writeNewFile(target, b); },
    };
    const res = await writeBatch(d, [{ name: 'scan.png', bytes: bytes('mine') }], 'keep-both', io);
    expect(res.written.map((p) => basename(p))).toEqual(['scan (2).png']);
    expect(readFileSync(join(d, 'scan.png'), 'utf8')).toBe('someone else');
  });

  it('a failure after the first page stops and reports what was written', async () => {
    const d = dir();
    writeFileSync(join(d, 'doc-2.png'), 'old 2');
    const files = [{ name: 'doc-1.png', bytes: bytes('1') }, { name: 'doc-2.png', bytes: poison }, { name: 'doc-3.png', bytes: bytes('3') }];
    const res = await writeBatch(d, files, 'replace');
    expect(res.written.map((p) => basename(p))).toEqual(['doc-1.png']);
    expect(res.error?.file).toBe('doc-2.png');
    expect(readFileSync(join(d, 'doc-2.png'), 'utf8')).toBe('old 2'); // the replace that failed left it alone
    expect(existsSync(join(d, 'doc-3.png'))).toBe(false);
    expect(readdirSync(d).sort()).toEqual(['doc-1.png', 'doc-2.png']);
  });

  it('a unique file never replaces one that appears after the name was chosen (split, keep both)', async () => {
    const d = dir();
    let raced = false;
    const create: WriteIo['create'] = async (target, b) => { if (!raced) { raced = true; writeFileSync(target, 'created meanwhile'); } return writeNewFile(target, b); };
    const name = await writeUniqueFile(d, 'doc-1.pdf', bytes('mine'), new Set(), create);
    expect(name).toBe('doc-1 (2).pdf');
    expect(readFileSync(join(d, 'doc-1.pdf'), 'utf8')).toBe('created meanwhile');
    expect(readFileSync(join(d, 'doc-1 (2).pdf'), 'utf8')).toBe('mine');
  });

  it('unique files skip names this batch already used, whatever the letter case', async () => {
    const d = dir();
    const taken = new Set<string>();
    expect(await writeUniqueFile(d, 'b.pdf', bytes('1'), taken)).toBe('b.pdf');
    expect(await writeUniqueFile(d, 'B.pdf', bytes('2'), taken)).toBe('B (2).pdf'); // the batch compares names as Windows does
    expect(readFileSync(join(d, 'b.pdf'), 'utf8')).toBe('1');
  });

  it('unique files skip files already on disk', async () => {
    const d = dir();
    writeFileSync(join(d, 'a.pdf'), 'old');
    const taken = new Set<string>();
    expect(await writeUniqueFile(d, 'a.pdf', bytes('1'), taken)).toBe('a (2).pdf');
    // "A.pdf" is the same file as "a.pdf" on a case-insensitive file system (Windows, macOS) and a free name on a
    // case-sensitive one (Linux), where using it replaces nothing
    expect(await writeUniqueFile(d, 'A.pdf', bytes('2'), taken)).toBe(caseInsensitiveFs ? 'A (3).pdf' : 'A.pdf');
    expect(readFileSync(join(d, 'a.pdf'), 'utf8')).toBe('old');
  });

  it('a unique file reports a real error instead of hiding it behind more numbers', async () => {
    const d = dir();
    await expect(writeUniqueFile(join(d, 'missing-folder'), 'x.pdf', bytes('x'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
