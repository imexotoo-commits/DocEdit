/**
 * The document worker for iOS: a module Web Worker inside the web view. Same operations as the desktop's
 * coreworker.ts (a utilityProcess there), so a huge or hostile file cannot freeze the page. The page kills and
 * replaces the worker when a job takes too long.
 */
import { applyEdits, arrangePages, decryptPdf, getInfo, imagesToPdf, inspectDocument, listFormFields, protectPdf, sanitizeDocument, textToPdf, verifySignatures, type DocEdit, type HiddenCategory } from '@docedit/core';
import type { SaveSlot } from '../../../desktop/src/shared/api.js';

/** Pages laid out as the editor shows them, with edits applied (the save and preview path). Mirrors desktop. */
async function layout(sources: Uint8Array[], slots: SaveSlot[], edits: DocEdit[] = [], font?: Uint8Array): Promise<Uint8Array> {
  const first = sources[0];
  let unchanged = false;
  if (first && slots.every((s, i) => 'source' in s && s.source === 0 && s.page === i && !s.rotate && !s.crop)) {
    unchanged = (await getInfo(first)).pageCount === slots.length;
  }
  if (unchanged) return edits.length ? applyEdits(first!, edits, { font }) : first!;
  // Form edits act on the original; rebuilding the page tree drops the field tree (see the desktop worker).
  const formEdit = (e: DocEdit) => e.type === 'fill' || e.type === 'flatten';
  const early = edits.filter(formEdit);
  const srcs = early.length && first ? [await applyEdits(first, early, { font }), ...sources.slice(1)] : sources;
  const laid = await arrangePages(srcs, slots);
  const rest = edits.filter((e) => !formEdit(e));
  return rest.length ? applyEdits(laid, rest, { font }) : laid;
}

async function sanitizeChecked(pdf: Uint8Array, remove: HiddenCategory[]) {
  const bytes = await sanitizeDocument(pdf, remove);
  const remaining = await inspectDocument(bytes);
  return { bytes, remaining, left: [...new Set(remaining.filter((i) => remove.includes(i.category)).map((i) => i.category))] };
}

export const OPS = { layout, sanitizeChecked, arrangePages, decryptPdf, protectPdf, getInfo, inspectDocument, listFormFields, verifySignatures, imagesToPdf, textToPdf };
export type CoreOps = typeof OPS;

type Job = { id: number; op: string; args: unknown[] };
self.onmessage = (e: MessageEvent<Job>) => {
  const { id, op, args } = e.data;
  const fn = Object.hasOwn(OPS, op) ? (OPS as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[op] : undefined;
  if (!fn) { self.postMessage({ id, ok: false, error: { message: `Unknown operation ${op}` } }); return; }
  fn(...args).then(
    (value) => self.postMessage({ id, ok: true, value }),
    (err: unknown) => self.postMessage({ id, ok: false, error: { message: err instanceof Error ? err.message : String(err), code: (err as { code?: unknown })?.code, name: err instanceof Error ? err.name : undefined } }),
  );
};
