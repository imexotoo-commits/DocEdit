# DocEdit — Oakqueill PDF Editor

Oakqueill PDF Editor is a clean-room PDF reader and editor: an open, no-subscription alternative to Acrobat-class tools. It reads, searches, prints, creates, organizes, annotates, fills forms, signs visually and redacts for real (the text is destroyed, not hidden, and the result is verified). A tested headless core library sits under every app.

Read first: [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md) (rules for contributors), then [docs/HANDOFF_CODEX.md](docs/HANDOFF_CODEX.md) (state of the code and what to do next). Licence: [MIT](LICENSE). Third-party components keep their own licences ([docs/LICENSES.md](docs/LICENSES.md)).

_Internal names (the `@docedit/*` packages, the `docedit` command and this repository) still use the working name DocEdit._

Each platform lives on its own branch with only the code it needs. The documents in `docs/` describe the whole project, so they can mention parts that are on other branches.

## Branches

| Branch | What it is |
| --- | --- |
| [`Win11`](../../tree/Win11) | Windows 11 desktop app: core, CLI and the Electron app with the Windows installer and portable build, and signed releases through SignPath. |
| [`macOS`](../../tree/macOS) | macOS desktop app: core, CLI and the Electron app as a universal dmg and zip, with Developer ID signing and notarization. |
| [`iOS`](../../tree/iOS) | iPhone and iPad app: core, the shared renderer and a SwiftUI shell that runs it in a web view. |

This branch only holds this overview. Check out a platform branch to build the app:

```
git clone --branch Win11 https://github.com/imexotoo-commits/DocEdit.git   # or macOS, or iOS
```
