import { app, BrowserWindow, dialog } from 'electron';
import { createBlankPdf, detectImage } from '@docedit/core';
import { core } from './corework.js';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateRequest, CreateResult, PickedFile } from '../shared/api.js';
import { ConversionError, convertToPdf, findLibreOffice, OFFICE_EXTENSIONS } from './convert.js';

const here = dirname(fileURLToPath(import.meta.url));
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
/** the New document dialog's own limit */
const MAX_BLANK_PAGES = 1000;
const MAX_TEXT_BYTES = 20 * 1024 * 1024;

/** Paths the user chose in a dialog this session; the renderer can only ask us to read these. */
const approved = new Set<string>();

export async function pickFiles(win: BrowserWindow | null, kind: 'images' | 'text' | 'office' | 'certificate'): Promise<PickedFile[] | null> {
  // Test hook for unpackaged builds: answer the file dialog with a fixed path.
  const testPick = !app.isPackaged ? process.env.DOCEDIT_TEST_PICK : undefined;
  if (testPick) { const info = await stat(testPick); approved.add(testPick); return [{ path: testPick, name: basename(testPick), size: info.size }]; }
  const opts: Electron.OpenDialogOptions = kind === 'certificate'
    ? { title: 'Choose a certificate', properties: ['openFile'], filters: [{ name: 'Certificates with private key', extensions: ['p12', 'pfx'] }] }
    : kind === 'office'
    ? { title: 'Choose an office document', properties: ['openFile'], filters: [{ name: 'Office documents', extensions: [...OFFICE_EXTENSIONS] }] }
    : kind === 'images'
    ? { title: 'Choose images', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images (JPEG, PNG)', extensions: ['jpg', 'jpeg', 'png'] }] }
    : { title: 'Choose a text file', properties: ['openFile'], filters: [{ name: 'Text', extensions: ['txt', 'text', 'md', 'csv', 'log'] }, { name: 'All files', extensions: ['*'] }] };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled) return null;
  const out: PickedFile[] = [];
  for (const path of res.filePaths) {
    const info = await stat(path);
    approved.add(path);
    out.push({ path, name: basename(path), size: info.size });
  }
  return out;
}

/** Reads a text file the user picked, as UTF-8 (a UTF-8 or UTF-16 byte order mark is honoured). */
export async function readTextFile(path: string): Promise<string> {
  if (!approved.has(path)) throw new Error('That file was not chosen in this session.');
  const info = await stat(path);
  if (info.size > MAX_TEXT_BYTES) throw new Error(`“${basename(path)}” is larger than ${MAX_TEXT_BYTES / 1048576} MB.`);
  const b = await readFile(path);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  return new TextDecoder('utf-8').decode(b.subarray(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0));
}

/** A picked JPEG/PNG, for signatures and stamps. */
export async function readImage(path: string): Promise<{ base64: string; format: 'png' | 'jpg' }> {
  if (!approved.has(path)) throw new Error('That file was not chosen in this session.');
  const info = await stat(path);
  if (info.size > 3 * 1024 * 1024) throw new Error('Choose an image smaller than 3 MB for a signature.');
  const b = await readFile(path);
  const kind = detectImage(new Uint8Array(b));
  if (!kind) throw new Error('Choose a JPEG or PNG image.');
  return { base64: b.toString('base64'), format: kind === 'png' ? 'png' : 'jpg' };
}

let fontBytes: Uint8Array | null = null;
export async function bundledFont(): Promise<Uint8Array> {
  fontBytes ??= new Uint8Array(await readFile(join(here, 'fonts', 'DejaVuSans.ttf')));
  return fontBytes;
}

export async function createDocument(req: CreateRequest): Promise<CreateResult> {
  try {
    if (req.kind === 'blank') {
      // checked here as well as in the dialog: the request comes from the page
      const side = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 72 && v <= 14400;
      if (!Number.isInteger(req.count) || req.count < 1 || req.count > MAX_BLANK_PAGES) throw new Error(`Choose from 1 to ${MAX_BLANK_PAGES} pages.`);
      if (!Array.isArray(req.size) || req.size.length !== 2 || !side(req.size[0]) || !side(req.size[1])) throw new Error('That page size is not supported.');
      const bytes = await createBlankPdf(req.count, [req.size[0], req.size[1]]);
      return { ok: true, file: { path: null, name: 'Untitled.pdf', bytes } };
    }
    if (req.kind === 'images') {
      const images: Uint8Array[] = [];
      for (const path of req.paths) {
        if (!approved.has(path)) throw new Error('An image was not chosen in this session.');
        const info = await stat(path);
        if (info.size > MAX_IMAGE_BYTES) throw new Error(`“${basename(path)}” is larger than ${MAX_IMAGE_BYTES / 1048576} MB.`);
        images.push(new Uint8Array(await readFile(path)));
      }
      const bytes = await core.imagesToPdf(images, req.options);
      return { ok: true, file: { path: null, name: 'Images.pdf', bytes } };
    }
    const res = await core.textToPdf(req.text, { ...req.options, font: await bundledFont() });
    return { ok: true, file: { path: null, name: req.name || 'Text.pdf', bytes: res.pdf }, missingCharacters: res.missingCharacters };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ---- office documents ----

const conversions = new Map<number, AbortController>();

export async function officeConverter(): Promise<{ available: boolean; path: string | null }> {
  const c = await findLibreOffice();
  return { available: !!c, path: c?.command ?? null };
}

/** One conversion per window at a time; a new one cancels the previous. */
export async function convertOffice(windowId: number, path: string): Promise<CreateResult> {
  if (!approved.has(path)) return { ok: false, message: 'That file was not chosen in this session.' };
  const conv = await findLibreOffice();
  if (!conv) return { ok: false, message: 'No office converter is installed. Install LibreOffice, or save the document as PDF from the program that made it and open that PDF.' };
  conversions.get(windowId)?.abort();
  const ac = new AbortController();
  conversions.set(windowId, ac);
  try {
    const bytes = await convertToPdf(conv, path, { signal: ac.signal });
    return { ok: true, file: { path: null, name: basename(path).replace(/\.[^.]+$/, '') + '.pdf', bytes } };
  } catch (err) {
    return { ok: false, message: err instanceof ConversionError || err instanceof Error ? err.message : String(err) };
  } finally {
    if (conversions.get(windowId) === ac) conversions.delete(windowId);
  }
}

export function cancelConversion(windowId: number) { conversions.get(windowId)?.abort(); }

/** A picked file's bytes (certificates for signing). */
export async function readApproved(path: string, maxBytes: number): Promise<Uint8Array> {
  if (!approved.has(path)) throw new Error('That file was not chosen in this session.');
  const info = await stat(path);
  if (info.size > maxBytes) throw new Error('That file is too large.');
  return new Uint8Array(await readFile(path));
}
