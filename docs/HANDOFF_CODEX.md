# Handoff: foundation → Codex review and build

You are asked to **review** this foundation and then **build on it** (clean room: read `docs/CLEAN_ROOM.md` first and follow it). The owner wants a PDF reader/editor that replaces paid Acrobat-class tools.

## Ground rules
- Do not use or look at any Adobe/other commercial product, its materials, or AGPL/GPL PDF code. Log new sources in `docs/PROVENANCE.md`, new dependencies in `docs/LICENSES.md`.
- Core stays headless and byte-in/byte-out (`docs/ARCHITECTURE.md`). The app is a separate package.
- Anything security-sensitive (redaction, signing, sanitize, encryption) must have tests that inspect the output *bytes* and fail if the secret is still recoverable.
- Do not weaken a test to make it pass; if a test is wrong, explain why in the PR.

## Commands
```
npm install
npm run check            # typecheck + tests (core, desktop editing model)
npm run build            # compile core + cli to dist/
node packages/cli/dist/main.js --help
npm run app              # build and launch the desktop app
```

## What is real vs designed
| Area | State |
|---|---|
| merge/split/select/delete/rotate/crop/blank/metadata | implemented + tested |
| watermark, page numbers, image placement | implemented + tested (Latin-1 fonts only) |
| visual signature | implemented + tested |
| form list/fill/flatten | implemented + tested (text, checkbox, dropdown covered; radio/list lightly) |
| text extract + find (with rectangles) | implemented + tested (horizontal text) |
| redaction (rasterize) + verify + prune | implemented + tested (incl. rotated page, link leak, raw bytes) |
| cryptographic signing/verify | implemented + tested (.p12/.pfx RSA, PAdES B-B style; timestamps and revocation not yet), see SIGNING.md |
| encryption/password open | implemented + tested (`decryptPdf`, `protectPdf` AES-256) |
| viewer / app | `apps/desktop`: roadmap phases 1-3 and parts of 4 (see FEATURES.md and ROADMAP.md); Windows installer + portable .exe via `npm run dist -w @docedit/desktop` |
| browser viewer | `apps/browser`: Chrome/Edge extension, see BROWSER_EXTENSION.md |

## Please review (in this order)
1. **Redaction correctness** (`src/redact.ts`, `test/redact.test.ts`): try to break it. Ideas: incremental-update PDFs with old revisions, form XObjects, Type3 fonts, pages with `/UserUnit`, huge pages (memory), pages with transparency groups, image-only pages, pages whose `/Contents` is an array. Verify nothing of a marked page survives anywhere in the bytes.
2. **Coordinate handling** (`text.ts` `itemRect`, `redact.ts` `burn`): rotated pages, non-zero MediaBox origin, `/CropBox` smaller than MediaBox, vertical text.
3. **API shape**: is `Uint8Array → Uint8Array` right for 500 MB files? Propose streaming or a document handle if not; keep pdf-lib types out of public APIs.
4. **pdf-lib risk** (LICENSES.md): evaluate replacing the writer behind `loadDoc`/`saveDoc` (e.g. the `@cantoo/pdf-lib` fork, or PDFium via WASM, or qpdf). Prototype on the existing tests.
5. **Clean-room hygiene**: anything in the repo that looks borrowed, product-specific wording, or unlogged sources.

## Then build (suggested order = ROADMAP phases)
1. `apps/desktop` shell + pdf.js viewer + page organizer using the core.
2. Pending-operations model + undo/redo + save.
3. Annotation tools, forms UI, visual signature pad.
4. Redaction UI (mark → review → apply → verify), then Strategy B.
5. Cryptographic signing (design in SIGNING.md) and encryption.

## Definition of done for each feature
Core function + unit tests (generated fixtures) + CLI command if useful + UI + doc update in `FEATURES.md` (status) + `PROVENANCE.md` line if any external source was used.
