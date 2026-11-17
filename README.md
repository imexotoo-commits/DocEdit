# DocEdit — Oakqueill PDF Editor (Windows 11)

Oakqueill PDF Editor is a clean-room PDF reader and editor: an open, no-subscription alternative to Acrobat-class tools. It reads, searches, prints, creates, organizes, annotates, fills forms, signs visually and redacts for real (the text is destroyed, not hidden, and the result is verified). A tested headless core library sits under every app.

Read first: [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md) (rules for contributors), then [docs/HANDOFF_CODEX.md](docs/HANDOFF_CODEX.md) (state of the code and what to do next). Licence: [MIT](LICENSE). Third-party components keep their own licences ([docs/LICENSES.md](docs/LICENSES.md)).

_Internal names (the `@docedit/*` packages, the `docedit` command and this repository) still use the working name DocEdit._

Each platform lives on its own branch with only the code it needs. The documents in `docs/` describe the whole project, so they can mention parts that are on other branches.

This is the **Win11** branch: the headless core (`packages/core`), the CLI (`packages/cli`) and the Electron desktop app (`apps/desktop`) with Windows packaging, and the Oakqueill PDF Viewer extension for Chrome and Edge (`apps/browser`).

## Try it
```
npm install
npm run check
npm run build
node packages/cli/dist/main.js --help
npm run app            # desktop app
```

## Build the Windows installer and portable app
```
npm install
npm run build -w @docedit/core
npm run dist -w @docedit/desktop
```
Produces `apps/desktop/release/Oakqueill-Setup-<version>.exe` (installer: per-user, choose folder, Start menu and desktop shortcuts, offers Oakqueill for opening PDFs) and `Oakqueill-Portable-<version>.exe` (runs without installing). The executables built locally are not code-signed, so Windows SmartScreen warns on first run. Release builds are made and signed on GitHub through SignPath; see [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md).
Settings, saved signatures and crash-recovery data live in `%APPDATA%\Oakqueill`.

## Build the Chrome and Edge viewer extension
```
npm run build -w @docedit/browser     # apps/browser/dist, for "Load unpacked"
npm run dist -w @docedit/browser      # also the .zip the Chrome Web Store and Edge Add-ons take
```
The installer can add the published extension to Chrome and Edge; see [docs/BROWSER_EXTENSION.md](docs/BROWSER_EXTENSION.md).

Library use:
```ts
import { mergePdfs, findRedactionMarks, applyRedactions } from '@docedit/core';
import { NodeRasterizer } from '@docedit/core/node';
const ras = new NodeRasterizer();
const out = await applyRedactions(pdf, await findRedactionMarks(pdf, 'Jane Doe'), ras);
```

## Other platforms
| Branch | What it is |
| --- | --- |
| [`Win11`](../../tree/Win11) | Windows 11 desktop app: core, CLI and the Electron app with the Windows installer and portable build, signed releases through SignPath, and the Chrome/Edge viewer extension. |
| [`macOS`](../../tree/macOS) | macOS desktop app: core, CLI and the Electron app as a universal dmg and zip, with Developer ID signing and notarization. |
| [`iOS`](../../tree/iOS) | iPhone and iPad app: core, the shared renderer and a SwiftUI shell that runs it in a web view. |

## Docs
[FEATURES](docs/FEATURES.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [REDACTION](docs/REDACTION.md) · [SIGNING](docs/SIGNING.md) · [BROWSER_EXTENSION](docs/BROWSER_EXTENSION.md) · [ROADMAP](docs/ROADMAP.md) · [LICENSES](docs/LICENSES.md) · [PROVENANCE](docs/PROVENANCE.md)
