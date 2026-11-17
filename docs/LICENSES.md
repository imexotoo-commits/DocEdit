# Licences and dependencies

**Project licence: MIT** (decided by the project owner on 2026-11-12; see `LICENSE`). Every dependency must therefore be permissive (MIT, BSD, Apache-2.0, ISC, 0BSD, Zlib, OFL for fonts or similar); copyleft (GPL/AGPL/LGPL) code cannot be used. All dependencies listed below are permissive.

## Direct dependencies (checked 2026-11-12 from each package's own metadata)
| Package | Version | Licence | Use |
|---|---|---|---|
| @cantoo/pdf-lib | 2.11.1 | MIT | read/write/modify PDF structure, encryption (maintained fork of pdf-lib 1.17.1, which it replaced on 2026-11-12). Pulls tslib (0BSD), culori, fflate, node-html-better-parser (MIT). |
| pdfjs-dist | 4.10.38 | Apache-2.0 | text extraction, rendering (Node legacy build) |
| @napi-rs/canvas | 0.1.x | MIT | canvas for Node rendering (optional dependency; only `@docedit/core/node`) |
| @cantoo/fontkit | 2.0.12 | MIT | font parsing/subsetting (replaced @pdf-lib/fontkit, whose subsetting failed with the fork). Pulls brotli, dfa, fflate, restructure (MIT). |
| dejavu-fonts-ttf | 2.37.3 | Bitstream Vera licence + public domain (DejaVu changes) | DejaVu Sans bundled with the app for text-to-PDF; licence text shipped next to the font (`dist/main/fonts/DejaVu-LICENSE.txt`). Not renamed or modified apart from subsetting on embed. |
| pkijs, asn1js | 4.0.1, 4.0.0 | BSD-3-Clause | CMS signatures and certificate checks (core). Pull bytestreamjs (BSD-3-Clause), @noble/hashes, @peculiar/utils (MIT). |
| node-forge | 1.4.3 | BSD-3-Clause (chosen from its BSD-3-Clause OR GPL-2.0 dual licence) | reading .p12/.pfx signing keys in the app's main process |
| react, react-dom | 19.3.1 | MIT | desktop app UI (`apps/desktop`) |
| electron | 45.3.1 | MIT | desktop app shell (dev dependency until packaging is set up; bundles Chromium, whose notices ship in its LICENSES.chromium.html) |
| esbuild, @vitejs/plugin-react, @types/react, @types/react-dom | dev | MIT | desktop app build only |
| electron-builder | 26.18.0 (dev) | MIT | packaging (Windows installer and portable .exe); not shipped. Its tooling depended on `minimatch` versions with a moderate denial-of-service advisory (GHSA-g3hv-75wg-m249); the root `package.json` overrides those to the patched 11.x line, and `npm audit` (including build tools) is clean. Remove the override once electron-builder ships patched versions itself. |
| typescript, vitest, vite, @types/node | dev | Apache-2.0 / MIT | build and test only |

`npm audit`: 0 known vulnerabilities (2026-11-12). pdf.js older than 4.2.67 had a script-execution bug (CVE-2024-4367); we pin >=4.10 and also pass `isEvalSupported: false`.

## Risks and rules
- **pdf-lib was effectively unmaintained** (last release 2021) and could not read or write encrypted files, so the core now uses the maintained fork `@cantoo/pdf-lib` (AES-256 by default; all existing tests pass unchanged). It still cannot rewrite content streams. Everything that touches it remains behind our own functions. Further candidates if needed: PDFium (BSD-3-Clause/Apache-2.0, strong renderer and editor, C++), qpdf (Apache-2.0, great for repair, linearize, decrypt, object-stream rewrite).
- **Do not use**: MuPDF, Ghostscript, iText (AGPL); poppler, xpdf (GPL); Adobe SDKs. Pdfium and qpdf are the permissive choices if we need native power.
- Fonts: only fonts with a redistributable licence (OFL, Apache, Bitstream Vera/DejaVu). The 14 standard PDF fonts are referenced by name, not embedded.
- Shipped notices: the build writes `THIRD-PARTY-NOTICES.txt` (into the app's `resources` folder) from the packages that actually end up in the bundles; Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html` sit next to the program. (The earlier gap, `@pdf-lib/fontkit` shipping pre-bundled dependencies without their notices, is gone: `@cantoo/fontkit` declares its dependencies, so they are collected.)
- LibreOffice is **not** a dependency: the app runs an installation the user already has, through its public command line, as a separate program. Nothing of it is shipped or linked.
- Any new dependency: licence + maintenance + audit check, then a line in this table and in `PROVENANCE.md`.
