# Architecture

```
DocEdit/
  packages/
    core/   @docedit/core   headless library: bytes in, bytes out. No UI, no global state.
      src/pages.ts          merge / split / select / delete / rotate / crop / blank
      src/document.ts       load, info, metadata, error mapping
      src/stamp.ts          watermark, page numbers, image placement
      src/sign.ts           visual signature (done) + Signer/signPdf/verify (designed)
      src/forms.ts          list / fill / flatten AcroForm fields
      src/text.ts           extract text, find text with rectangles (pdf.js)
      src/redact.ts         marks, applyRedactions, verifyRedaction, pruneUnreachable
      src/render.ts         Rasterizer interface (the only thing redaction needs from a renderer)
      src/node/             NodeRasterizer (pdf.js + @napi-rs/canvas), imported as @docedit/core/node
    cli/    @docedit/cli    `docedit` command; thin wrapper, no logic of its own
  apps/
    desktop/ @docedit/desktop Electron app (see "Application layer" below)
  docs/                     this folder
```

## Principles
1. **Core is a pure library.** Every operation is `async (pdf: Uint8Array, ...) => Uint8Array`. No file paths, no `fs`, no `process` in the core except one guarded font-path lookup in `text.ts`. The app, the CLI and tests are all just callers. This keeps it testable and lets the same code run in Node, Electron's main process, or a Web Worker.
2. **Rendering is injected.** Core never imports a canvas. `Rasterizer` is a 2-method interface; Node and the app each provide one.
3. **One writer boundary.** All structural reads/writes go through pdf-lib today (see LICENSES.md for why that is a risk). Keep pdf-lib types out of the public API (our exported types are plain objects and `Uint8Array`) so the writer can be swapped for PDFium/qpdf without touching callers.
4. **Coordinates are PDF user space** (origin bottom-left, 1/72 inch, ignoring `/Rotate`). Conversion to screen pixels is the viewer's job; `RasterPage.transform` carries the exact matrix when pixels are involved. Tests cover a rotated page.
5. **Safe by default.** No PDF JavaScript is ever executed; pdf.js runs with `isEvalSupported: false`; redaction destroys data instead of hiding it; errors are typed (`DocEditError.code`).
6. **Security-sensitive features must be proven by tests that look at the output bytes**, not just at the API result (see `redact.test.ts`).

## Application layer (`apps/desktop`)
```
src/main/      Electron main process: windows, native menu and dialogs, file reads, safe saves.
               coreworker.ts is the document worker, a utilityProcess that does the heavy PDF work
               (save layout, protect, decrypt, inspect, clean, form fields, signature checks, image and
               text to PDF). corework.ts sends jobs there with a time limit (2 minutes), so a huge or
               hostile file cannot freeze the windows; a stuck or crashed worker is replaced.
               (temporary file + fsync + rename), calls @docedit/core (arrangePages on save)
src/preload/   the only bridge: a small typed API exposed as window.docedit (shared/api.ts)
src/renderer/  React UI, sandboxed, no Node: pdf.js viewer + text layer, thumbnails/organizer,
               editing model (model.ts, pure and unit-tested in apps/desktop/test)
```
Electron was chosen over Tauri because the core and its Node rasterizer run unchanged in the main process.
The renderer runs with context isolation, sandbox, a strict CSP, no navigation and no new windows.
Still planned: a worker for heavy core operations, and an annotation overlay.
Editing model for the app: keep the document as bytes plus an **ordered list of pending operations**
(annotations, form values, marks, stamps, page edits). The viewer draws pending operations as overlays; *Save* applies them through `@docedit/core` in one pass. That gives undo/redo for free (pop an operation), cheap autosave (persist the operation list), and keeps the core stateless.

## Testing
- `npm test` (vitest). PDFs for tests are generated in code (`packages/core/test/helpers.ts`); no binary fixtures are committed.
- `npm run check` = typecheck + tests. CI runs it on every push (`.github/workflows/ci.yml`).
- When a bug is found in a real-world PDF, reduce it, generate a minimal reproduction in code, add it as a test.
