import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgetListings, inside, listExports, openExport } from '../src/main/remarkable.js';

const pdf = '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'oakq-rm-test-'));
  const folder = join(base, 'exports'), outside = join(base, 'private');
  mkdirSync(join(folder, 'Meetings'), { recursive: true }); mkdirSync(outside);
  writeFileSync(join(folder, 'Notes.pdf'), pdf);
  writeFileSync(join(folder, 'Meetings', 'Standup.pdf'), pdf);
  writeFileSync(join(outside, 'Secret.pdf'), pdf.replace('1.4', '1.7'));
  // a junction inside the folder that leads out of it (no admin rights needed on Windows)
  symlinkSync(outside, join(folder, 'Linked'), 'junction');
  return { base, folder, outside };
}

describe('reMarkable folder boundary', () => {
  it('lists and opens by id only, never by path, and only for the window that listed', async () => {
    const { folder, outside } = setup();
    const res = await listExports(1, folder);
    if (!res.ok) throw new Error(res.message);
    expect(res.files.map((f) => f.name).sort()).toEqual(['Notes.pdf', 'Standup.pdf']); // the junction is not followed
    const notes = res.files.find((f) => f.name === 'Notes.pdf')!;
    expect(Object.keys(notes)).not.toContain('path');
    expect((await openExport(1, folder, notes.id)).name).toBe('Notes.pdf');
    await expect(openExport(2, folder, notes.id)).rejects.toThrow(/not in the reMarkable folder/); // another window
    await expect(openExport(1, folder, join(folder, 'Notes.pdf'))).rejects.toThrow(/not in the reMarkable folder/); // a path is not an id
    await expect(openExport(1, folder, join(outside, 'Secret.pdf'))).rejects.toThrow(/not in the reMarkable folder/);
    await expect(openExport(1, folder, 'deadbeef')).rejects.toThrow(/not in the reMarkable folder/);
    forgetListings(); // the folder changed
    await expect(openExport(1, folder, notes.id)).rejects.toThrow(/not in the reMarkable folder/);
  });

  it('refuses a listed file whose folder was swapped for a link leading outside', async () => {
    const { base, folder, outside } = setup();
    const res = await listExports(7, folder);
    if (!res.ok) throw new Error(res.message);
    const standup = res.files.find((f) => f.name === 'Standup.pdf')!;
    // after listing, "Meetings" becomes a junction to the private folder, which has a Standup.pdf too
    renameSync(join(folder, 'Meetings'), join(base, 'moved'));
    copyFileSync(join(outside, 'Secret.pdf'), join(outside, 'Standup.pdf'));
    symlinkSync(outside, join(folder, 'Meetings'), 'junction');
    await expect(openExport(7, folder, standup.id)).rejects.toThrow(/not in the reMarkable folder/);
  });

  it('decides containment by the platform rules', () => {
    if (process.platform === 'win32') {
      expect(inside('C:\\Exports', 'c:\\exports\\a.pdf')).toBe(true); // Windows paths ignore case
      expect(inside('C:\\Exports', 'C:\\Exports2\\a.pdf')).toBe(false); // a prefix is not containment
      expect(inside('C:\\Exports', 'C:\\Exports\\..\\x.pdf')).toBe(false);
      expect(inside('C:\\Exports', 'D:\\Exports\\a.pdf')).toBe(false);
    } else {
      expect(inside('/data/Exports', '/data/exports/a.pdf')).toBe(false); // case matters here
      expect(inside('/data/Exports', '/data/Exports2/a.pdf')).toBe(false);
    }
    expect(inside(join('a', 'b'), join('a', 'b'))).toBe(false); // the folder itself is not a file in it
  });
});
