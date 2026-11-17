import { afterEach, describe, expect, it, vi } from 'vitest';

// The worker process is replaced by a fake: the first one never answers, the next one cannot be started.
const forks: Array<() => unknown> = [];
vi.mock('electron', () => ({
  app: { isPackaged: false },
  utilityProcess: { fork: () => { const f = forks.shift(); if (!f) throw new Error('no more workers'); return f(); } },
}));

const fakeChild = () => ({ on: () => undefined, postMessage: () => undefined, kill: () => undefined });

describe('document worker restart', () => {
  afterEach(() => { forks.length = 0; delete process.env.DOCEDIT_TEST_JOB_TIMEOUT_MS; vi.resetModules(); });

  it('settles every waiting job even when the replacement worker cannot be started', async () => {
    process.env.DOCEDIT_TEST_JOB_TIMEOUT_MS = '60';
    forks.push(fakeChild, () => { throw new Error('spawn failed'); });
    const { core, registerCoreWorker, stopCoreWorker } = await import('../src/main/corework.js');
    registerCoreWorker('/nowhere');
    const pdf = new Uint8Array([1]);
    // two jobs in the stuck worker; the first one times out, the second is resent to a worker that cannot start
    const results = await Promise.allSettled([core.getInfo(pdf), core.getInfo(pdf)]);
    stopCoreWorker();
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(String((results[0] as PromiseRejectedResult).reason.message)).toMatch(/stopped working/);
    expect(String((results[1] as PromiseRejectedResult).reason.message)).toMatch(/could not start the document worker/);
  }, 5000);
});
