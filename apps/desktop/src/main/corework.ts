/**
 * Runs PDF work in the document worker (coreworker.ts) instead of the main process, which also draws every window.
 * Each job has a time limit: a worker that is still busy then is killed, that job fails with a plain message, and any
 * other jobs it held are sent again to a fresh worker. A worker that crashes (for example out of memory on a file that
 * expands enormously) fails only the jobs it held; the next job starts a new one.
 */
import { app, utilityProcess, type UtilityProcess } from 'electron';
import { DocEditError } from '@docedit/core';
import { join } from 'node:path';
import type { CoreOps } from './coreworker.js';

/** How long one job may take. Large documents take seconds; a file that hangs the parser never finishes. */
export const JOB_TIMEOUT_MS = 120_000;
/** test hook, unpackaged builds only: a shorter limit */
const timeoutMs = () => (!app.isPackaged && Number(process.env.DOCEDIT_TEST_JOB_TIMEOUT_MS)) || JOB_TIMEOUT_MS;

interface Pending { id: number; op: string; args: unknown[]; ok(v: unknown): void; fail(e: Error): void; timer?: NodeJS.Timeout; sent: number }

let here = '';
let child: UtilityProcess | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

export function registerCoreWorker(dir: string) { here = dir; }

function start(): UtilityProcess {
  const c = utilityProcess.fork(join(here, 'coreworker.js'), [], { serviceName: 'Oakqueill document worker', stdio: 'inherit' });
  c.on('message', (m: { id: number; ok: boolean; value?: unknown; error?: { message: string; code?: unknown; name?: string } }) => {
    const job = pending.get(m.id);
    if (!job) return;
    finish(job);
    if (m.ok) job.ok(m.value);
    else {
      const e = m.error ?? { message: 'The document could not be processed.' };
      // keep the library's error codes (the password and protection messages depend on them)
      job.fail(typeof e.code === 'string' ? Object.assign(new DocEditError(e.message, e.code), e.name ? { name: e.name } : {}) : new Error(e.message));
    }
  });
  c.on('exit', () => {
    if (child !== c) return;
    child = null;
    // a crash: whatever it was working on is lost
    for (const job of [...pending.values()]) {
      finish(job);
      job.fail(new Error('Oakqueill could not process this document: the document worker stopped (the file may be too large or damaged).'));
    }
  });
  return c;
}

function finish(job: Pending) { if (job.timer) clearTimeout(job.timer); pending.delete(job.id); }

function send(job: Pending) {
  try {
    child ??= start();
    job.sent++;
    job.timer = setTimeout(() => timedOut(job), timeoutMs());
    pending.set(job.id, job);
    child.postMessage({ id: job.id, op: job.op, args: job.args });
  } catch (err) {
    // starting the worker or handing it the job failed: this job ends here, so its caller is never left waiting
    finish(job);
    child = null;
    job.fail(new Error(`Oakqueill could not start the document worker: ${err instanceof Error ? err.message : String(err)}`));
  }
}

function timedOut(job: Pending) {
  finish(job);
  job.fail(new Error(`Oakqueill stopped working on this document after ${Math.round(timeoutMs() / 1000)} seconds. The file may be damaged or made to stall PDF readers.`));
  // the worker may be stuck for good: replace it, and give its other jobs one more try in the new one
  const others = [...pending.values()];
  for (const o of others) { if (o.timer) clearTimeout(o.timer); pending.delete(o.id); }
  const old = child;
  child = null;
  try { old?.kill(); } catch { /* already gone */ }
  for (const o of others) {
    if (o.sent < 2) send(o);
    else o.fail(new Error('Oakqueill could not finish this document because the document worker had to be restarted.'));
  }
}

function run<K extends keyof CoreOps>(op: K, ...args: Parameters<CoreOps[K]>): ReturnType<CoreOps[K]> {
  return new Promise((ok, fail) => send({ id: nextId++, op, args, ok, fail, sent: 0 })) as ReturnType<CoreOps[K]>;
}

/** The operations, with the library's own signatures, run in the worker. */
export const core: { [K in keyof CoreOps]: (...args: Parameters<CoreOps[K]>) => ReturnType<CoreOps[K]> } = {
  layout: (...a) => run('layout', ...a),
  sanitizeChecked: (...a) => run('sanitizeChecked', ...a),
  arrangePages: (...a) => run('arrangePages', ...a),
  decryptPdf: (...a) => run('decryptPdf', ...a),
  protectPdf: (...a) => run('protectPdf', ...a),
  getInfo: (...a) => run('getInfo', ...a),
  inspectDocument: (...a) => run('inspectDocument', ...a),
  listFormFields: (...a) => run('listFormFields', ...a),
  verifySignatures: (...a) => run('verifySignatures', ...a),
  imagesToPdf: (...a) => run('imagesToPdf', ...a),
  textToPdf: (...a) => run('textToPdf', ...a),
};

export function stopCoreWorker() { const c = child; child = null; c?.kill(); }
