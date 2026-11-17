/**
 * Reusable visual signatures, kept only on this computer in the user's app-data folder
 * (one small JSON file each; 0600 where permissions exist). Nothing is uploaded anywhere.
 */
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SavedSignature } from '../shared/api.js';

const ID = /^[a-f0-9]{16}$/;

export class SignatureStore {
  constructor(private readonly dir: string) {}

  async list(): Promise<SavedSignature[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const out: SavedSignature[] = [];
    for (const n of names) {
      if (!n.endsWith('.json') || !ID.test(n.slice(0, -5))) continue;
      try { out.push(JSON.parse(await readFile(join(this.dir, n), 'utf8')) as SavedSignature); } catch { /* skip unreadable */ }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  async save(sig: Omit<SavedSignature, 'id' | 'createdAt'>): Promise<SavedSignature> {
    if (!sig.image && !sig.typedName) throw new Error('Empty signature');
    if (sig.image && (!/^[A-Za-z0-9+/=]+$/.test(sig.image.base64) || sig.image.base64.length > 4_000_000)) throw new Error('Bad signature image');
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    // only the known fields are stored
    const full: SavedSignature = { id: randomBytes(8).toString('hex'), createdAt: Date.now(), name: String(sig.name || 'Signature').slice(0, 80), kind: sig.kind === 'initials' ? 'initials' : 'signature',
      ...(sig.image ? { image: { base64: sig.image.base64, format: sig.image.format === 'jpg' ? 'jpg' : 'png' } } : {}), ...(sig.typedName ? { typedName: String(sig.typedName).slice(0, 120) } : {}) };
    const file = join(this.dir, `${full.id}.json`);
    await writeFile(file, JSON.stringify(full), { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(file, 0o600).catch(() => {});
    return full;
  }

  async remove(id: string): Promise<void> {
    if (!ID.test(id)) throw new Error('Bad signature id');
    await rm(join(this.dir, `${id}.json`), { force: true });
  }
}
