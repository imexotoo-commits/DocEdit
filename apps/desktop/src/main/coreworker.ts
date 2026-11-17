/**
 * The document worker: a separate process (Electron utilityProcess) that does the heavy PDF work, so a large document
 * or a file built to hang a PDF parser cannot freeze the app's windows. It has no access to the windows or to Electron's
 * APIs and runs only the operations listed below. The main process kills it when a job takes too long.
 */
import { applyEdits, arrangePages, decryptPdf, getInfo, imagesToPdf, inspectDocument, listFormFields, protectPdf, sanitizeDocument, textToPdf, verifySignatures, type DocEdit, type HiddenCategory } from '@docedit/core';
import type { SaveSlot } from '../shared/api.js';

/** Pages laid out as the editor shows them, with edits applied (the save and preview path). */
async function layout(sources: Uint8Array[], slots: SaveSlot[], edits: DocEdit[] = [], font?: Uint8Array): Promise<Uint8Array> {
  const first = sources[0];
  let unchanged = false;
  if (first && slots.every((s, i) => 'source' in s && s.source === 0 && s.page === i && !s.rotate && !s.crop)) {
    unchanged = (await getInfo(first)).pageCount === slots.length; // keeps bookmarks, forms and everything else
  }
  if (unchanged) return edits.length ? applyEdits(first!, edits, { font }) : first!;
  // Rebuilding the page tree drops the form's field tree (the widgets come along without it). Anything that works on
  // the form (filling it in, flattening it) must therefore happen in the original first; after the rebuild there is no
  // form left for it to act on, and a flatten would silently leave every field live.
  const formEdit = (e: DocEdit) => e.type === 'fill' || e.type === 'flatten';
  const early = edits.filter(formEdit);
  const srcs = early.length && first ? [await applyEdits(first, early, { font }), ...sources.slice(1)] : sources;
  const laid = await arrangePages(srcs, slots);
  const rest = edits.filter((e) => !formEdit(e));
  return rest.length ? applyEdits(laid, rest, { font }) : laid;
}

/** Clean a copy, then inspect the result: anything chosen that is still found means no copy (fail closed). */
async function sanitizeChecked(pdf: Uint8Array, remove: HiddenCategory[]) {
  const bytes = await sanitizeDocument(pdf, remove);
  const remaining = await inspectDocument(bytes);
  return { bytes, remaining, left: [...new Set(remaining.filter((i) => remove.includes(i.category)).map((i) => i.category))] };
}

export const OPS = { layout, sanitizeChecked, arrangePages, decryptPdf, protectPdf, getInfo, inspectDocument, listFormFields, verifySignatures, imagesToPdf, textToPdf };
export type CoreOps = typeof OPS;

type Job = { id: number; op: string; args: unknown[] };
const port = process.parentPort;
port?.on('message', (e: { data: Job }) => {
  const { id, op, args } = e.data;
  const fn = Object.hasOwn(OPS, op) ? (OPS as Record<string, (...a: unknown[]) => Promise<unknown>>)[op] : undefined;
  if (!fn) { port.postMessage({ id, ok: false, error: { message: `Unknown operation ${op}` } }); return; }
  fn(...args).then(
    (value) => port.postMessage({ id, ok: true, value }),
    (err: unknown) => port.postMessage({ id, ok: false, error: { message: err instanceof Error ? err.message : String(err), code: (err as { code?: unknown })?.code, name: err instanceof Error ? err.name : undefined } }),
  );
});
