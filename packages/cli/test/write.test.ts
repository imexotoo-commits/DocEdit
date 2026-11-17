import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSafely } from '../src/write.js';

describe('CLI output writes', () => {
  it('replaces an existing file only after a complete write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'docedit-cli-'));
    try {
      const target = join(dir, 'out.pdf');
      writeFileSync(target, 'previous');
      await writeSafely(target, new TextEncoder().encode('new contents'));
      expect(readFileSync(target, 'utf8')).toBe('new contents');
      expect(readdirSync(dir)).toEqual(['out.pdf']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves the existing file and no temporary file when the write fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'docedit-cli-'));
    try {
      const target = join(dir, 'out.pdf');
      writeFileSync(target, 'previous');
      // not bytes: the write fails after the temporary file was opened
      await expect(writeSafely(target, { length: 3 } as unknown as Uint8Array)).rejects.toThrow();
      expect(readFileSync(target, 'utf8')).toBe('previous');
      expect(readdirSync(dir)).toEqual(['out.pdf']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
