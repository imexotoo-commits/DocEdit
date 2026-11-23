# DocEdit — Oakqueill PDF Editor (macOS)

Oakqueill PDF Editor is a clean-room PDF reader and editor: an open, no-subscription alternative to Acrobat-class tools. It reads, searches, prints, creates, organizes, annotates, fills forms, signs visually and redacts for real (the text is destroyed, not hidden, and the result is verified). A tested headless core library sits under every app.

Contributors: read [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md) first (rules for contributors), then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What works today is listed in [docs/FEATURES.md](docs/FEATURES.md). Licence: [MIT](LICENSE). Third-party components keep their own licences ([docs/LICENSES.md](docs/LICENSES.md)).

_Internal names (the `@docedit/*` packages, the `docedit` command and this repository) still use the working name DocEdit._

Each platform lives on its own branch with only the code it needs. The documents in `docs/` describe the whole project, so they can mention parts that are on other branches.

This is the **macOS** branch: the headless core (`packages/core`), the CLI (`packages/cli`) and the Electron desktop app (`apps/desktop`) with macOS packaging.

## Try it
```
npm install
npm run check
npm run build
node packages/cli/dist/main.js --help
npm run app            # desktop app
```

## Build the macOS app (dmg and zip)
```
npm install
npm run build -w @docedit/core
npm run dist:mac -w @docedit/desktop
```
Produces `apps/desktop/release/Oakqueill-<version>-mac-<arch>.dmg` and a zip (universal: Apple Silicon and Intel). Local and CI test builds are ad-hoc signed, not notarized, so on first launch right-click the app and choose Open (or allow it in System Settings, Privacy & Security). Notarized releases need an Apple Developer ID: see [docs/MACOS_RELEASE.md](docs/MACOS_RELEASE.md). Finder "Open With", double-click and dropping a PDF on the Dock icon open files in the app: a file opens in a new tab of the open window, so nothing you have open is replaced. Several documents can be open as tabs (Cmd+T, Cmd+W, Ctrl+Tab), and File › Open Recent and the Dock menu list the last ten files (a setting turns that off).
Settings, saved signatures and crash-recovery data live in `~/Library/Application Support/Oakqueill`.

## Browser extension (Chrome, Safari, Firefox, Opera and more)
`apps/browser` is **Oakqueill PDF Viewer**: PDFs open in an Oakqueill viewer in Chrome, Edge, Brave, Opera, Vivaldi and Arc (one package), in Firefox and in Safari. Build every version with `npm run ext:build`; the Safari app with `npm run ext:safari`. How to install it in each browser, and what each one can and cannot catch, is in [docs/BROWSER_EXTENSION.md](docs/BROWSER_EXTENSION.md).

## Other platforms
| Branch | What it is |
| --- | --- |
| [`Win11`](../../tree/Win11) | Windows 11 desktop app: core, CLI and the Electron app with the Windows installer and portable build, and signed releases through SignPath. |
| [`macOS`](../../tree/macOS) | macOS desktop app: core, CLI and the Electron app as a universal dmg and zip, with Developer ID signing and notarization. |
| [`iOS`](../../tree/iOS) | iPhone and iPad app: core, the shared renderer and a SwiftUI shell that runs it in a web view. |

## Docs
[FEATURES](docs/FEATURES.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [REDACTION](docs/REDACTION.md) · [SIGNING](docs/SIGNING.md) · [BROWSER_EXTENSION](docs/BROWSER_EXTENSION.md) · [MACOS_RELEASE](docs/MACOS_RELEASE.md) · [LICENSES](docs/LICENSES.md) · [PROVENANCE](docs/PROVENANCE.md)
