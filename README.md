# DocEdit — Oakqueill PDF Editor (iOS)

Oakqueill PDF Editor is a clean-room PDF reader and editor: an open, no-subscription alternative to Acrobat-class tools. It reads, searches, prints, creates, organizes, annotates, fills forms, signs visually and redacts for real (the text is destroyed, not hidden, and the result is verified). A tested headless core library sits under every app.

Read first: [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md) (rules for contributors), then [docs/HANDOFF_CODEX.md](docs/HANDOFF_CODEX.md) (state of the code and what to do next). Licence: [MIT](LICENSE). Third-party components keep their own licences ([docs/LICENSES.md](docs/LICENSES.md)).

_Internal names (the `@docedit/*` packages, the `docedit` command and this repository) still use the working name DocEdit._

Each platform lives on its own branch with only the code it needs. The documents in `docs/` describe the whole project, so they can mention parts that are on other branches.

This is the **iOS** branch: the headless core (`packages/core`), the desktop app's renderer and shared types (`apps/desktop/src/renderer`, `apps/desktop/src/shared`, kept at the same paths so they stay in step with the desktop branches) and the iPhone and iPad app (`apps/ios`): a SwiftUI shell that runs the renderer in a web view, with the core in a Web Worker. See [apps/ios/README.md](apps/ios/README.md) and [docs/IOS_PLAN.md](docs/IOS_PLAN.md).

## Build and run in the simulator
```
npm install
npm run check
npm run ios:sim        # builds the web bundle, then the app (no code signing)
```
Then install `apps/ios/build/Build/Products/Debug-iphonesimulator/Oakqueill.app` with `xcrun simctl install`, or open `apps/ios/Oakqueill.xcodeproj` in Xcode (run `npm run ios:web` first so `apps/ios/Oakqueill/Web` exists). Running on a device or TestFlight needs an Apple Developer account.

## Other platforms
| Branch | What it is |
| --- | --- |
| [`Win11`](../../tree/Win11) | Windows 11 desktop app: core, CLI and the Electron app with the Windows installer and portable build, and signed releases through SignPath. |
| [`macOS`](../../tree/macOS) | macOS desktop app: core, CLI and the Electron app as a universal dmg and zip, with Developer ID signing and notarization. |
| [`iOS`](../../tree/iOS) | iPhone and iPad app: core, the shared renderer and a SwiftUI shell that runs it in a web view. |

## Docs
[FEATURES](docs/FEATURES.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [REDACTION](docs/REDACTION.md) · [SIGNING](docs/SIGNING.md) · [ROADMAP](docs/ROADMAP.md) · [LICENSES](docs/LICENSES.md) · [PROVENANCE](docs/PROVENANCE.md)
