/**
 * Office documents -> PDF through an installed LibreOffice, using its public command line
 * (`soffice --headless --convert-to pdf`). Plain Node (no Electron imports) so it can be unit-tested.
 *
 * Isolation: the input is copied into a private temporary folder, LibreOffice runs with a fresh
 * throw-away user profile in that folder (so the user's own macros, extensions and settings are not
 * loaded) whose settings disable macro execution and untrusted links, and the folder is deleted afterwards.
 * The process is killed (with its children) on timeout or cancel.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OFFICE_EXTENSIONS = ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp'] as const;

export interface Converter { command: string; prefixArgs: string[] }

/** Where LibreOffice usually lives; DOCEDIT_SOFFICE overrides. Returns null when none is found. */
export async function findLibreOffice(env = process.env, platform = process.platform): Promise<Converter | null> {
  const candidates: string[] = [];
  if (env.DOCEDIT_SOFFICE) candidates.push(env.DOCEDIT_SOFFICE);
  if (platform === 'win32') {
    for (const base of [env['ProgramFiles'], env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)']) {
      if (base) candidates.push(join(base, 'LibreOffice', 'program', 'soffice.exe'));
    }
  } else if (platform === 'darwin') {
    candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else {
    for (const dir of (env.PATH ?? '').split(':')) if (dir) candidates.push(join(dir, 'soffice'), join(dir, 'libreoffice'));
    candidates.push('/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice');
  }
  for (const c of candidates) {
    try { await access(c, platform === 'win32' ? constants.F_OK : constants.X_OK); return { command: c, prefixArgs: [] }; } catch { /* next */ }
  }
  return null;
}

/** LibreOffice configuration for the throw-away profile (registrymodifications.xcu format). */
const PROFILE_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="FirstRun" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
`;

export class ConversionError extends Error {
  constructor(message: string, readonly reason: 'timeout' | 'cancelled' | 'failed' | 'unsupported') { super(message); }
}

export interface ConvertOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function convertToPdf(conv: Converter, inputPath: string, opts: ConvertOptions = {}): Promise<Uint8Array> {
  const ext = extname(inputPath).slice(1).toLowerCase();
  if (!(OFFICE_EXTENSIONS as readonly string[]).includes(ext)) throw new ConversionError(`“${basename(inputPath)}” is not a supported office document.`, 'unsupported');
  await retryLeftovers();
  const work = await mkdtemp(join(tmpdir(), 'docedit-convert-'));
  try {
    const inDir = join(work, 'in'), outDir = join(work, 'out'), profile = join(work, 'profile');
    await Promise.all([mkdir(inDir), mkdir(outDir), mkdir(join(profile, 'user'), { recursive: true })]);
    await writeFile(join(profile, 'user', 'registrymodifications.xcu'), PROFILE_SETTINGS, 'utf8');
    // a neutral file name avoids surprises with unusual characters on the command line
    const input = join(inDir, `document.${ext}`);
    await copyFile(inputPath, input);
    const args = [
      ...conv.prefixArgs,
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless', '--invisible', '--nologo', '--nodefault', '--nolockcheck', '--norestore', '--nofirststartwizard',
      '--convert-to', 'pdf', '--outdir', outDir, input,
    ];
    await run(conv.command, args, work, opts);
    const produced = (await readdir(outDir)).find((f) => f.toLowerCase().endsWith('.pdf'));
    if (!produced) throw new ConversionError('LibreOffice finished without producing a PDF. The file may be damaged, password-protected or of a kind it cannot read.', 'failed');
    const bytes = new Uint8Array(await readFile(join(outDir, produced)));
    if (!Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-')) throw new ConversionError('The converter produced something that is not a PDF.', 'failed');
    return bytes;
  } finally {
    // the converter has fully exited by now (run() waits for that), so its working folder can go
    await removeWork(work);
  }
}

/** Work folders that could not be removed yet (they hold a copy of a document): retried later. */
const leftovers = new Set<string>();

async function removeWork(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); leftovers.delete(dir); }
  catch (err) {
    leftovers.add(dir);
    // observable, without the document's name or contents: the folder name is random
    console.warn(`Could not remove a conversion work folder yet (${(err as NodeJS.ErrnoException).code ?? 'error'}); it will be retried.`);
  }
}

/** Try again to remove work folders left behind; also called when the app quits. */
export async function retryLeftovers(): Promise<void> {
  for (const d of [...leftovers]) await removeWork(d);
}

function run(command: string, args: string[], cwd: string, { timeoutMs = 120_000, signal }: ConvertOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ConversionError('Conversion cancelled.', 'cancelled')); return; }
    let child: ChildProcess;
    try {
      child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: { ...process.env, SAL_USE_VCLPLUGIN: 'svp' } });
    } catch (e) { reject(new ConversionError(`Could not start LibreOffice: ${(e as Error).message}`, 'failed')); return; }
    let stderr = '';
    child.stderr?.on('data', (d) => { if (stderr.length < 4000) stderr += String(d); });
    let settled = false;
    const finish = (err?: ConversionError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (!err) { resolve(); return; }
      // stop the whole process tree and wait until it is gone before reporting, so the caller can remove the
      // work folder (Windows keeps a folder that a running process uses); the original error is what is reported
      void stopTree(child).finally(() => reject(err));
    };
    const timer = setTimeout(() => finish(new ConversionError(`Conversion took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`, 'timeout')), timeoutMs);
    const onAbort = () => finish(new ConversionError('Conversion cancelled.', 'cancelled'));
    signal?.addEventListener('abort', onAbort);
    child.on('error', (e) => finish(new ConversionError(`Could not start LibreOffice: ${e.message}`, 'failed')));
    child.on('exit', (code) => {
      if (code === 0) finish();
      else finish(new ConversionError(`LibreOffice could not convert the file (exit code ${code}).${stderr.trim() ? ' ' + stderr.trim().slice(0, 300) : ''}`, 'failed'));
    });
  });
}

/** soffice starts helper processes: stop all of them, and resolve once the process has closed (or after 15 s). */
async function stopTree(child: ChildProcess): Promise<void> {
  const gone = () => child.exitCode !== null || child.signalCode !== null;
  const closed = new Promise<void>((done) => { if (gone() && !child.stderr?.readable) done(); else child.once('close', () => done()); });
  if (!gone() && child.pid) {
    if (process.platform === 'win32') {
      await new Promise<void>((done) => {
        const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        k.once('exit', () => done()); k.once('error', () => done());
      });
    } else child.kill('SIGKILL');
  }
  await Promise.race([closed, new Promise<void>((done) => setTimeout(done, 15_000))]);
}
