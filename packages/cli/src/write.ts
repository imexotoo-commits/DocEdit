import { randomBytes } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Write the output next to its destination under a temporary name, flush it, then rename it over the destination. A
 * failure leaves any existing file (even the input, when -o names it) as it was.
 */
export async function writeSafely(path: string, data: Uint8Array): Promise<void> {
  const temp = join(dirname(path), `.${basename(path).slice(0, 40)}.${randomBytes(6).toString('hex')}.docedit-tmp`);
  try {
    const f = await open(temp, 'wx');
    try { await f.writeFile(data); await f.sync(); } finally { await f.close(); }
    await rename(temp, path);
  } catch (e) {
    await rm(temp, { force: true }).catch(() => {});
    throw e;
  }
}
