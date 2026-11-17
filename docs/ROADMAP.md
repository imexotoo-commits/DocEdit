# Product roadmap

Oakqueill PDF Editor is a local-first desktop PDF reader and editor for reading, creating, organizing, reviewing, protecting and publishing documents. A headless TypeScript library (`packages/core`) and a CLI sit under every app. The Windows desktop app, with its installer, portable build and Chrome/Edge viewer extension, is on the `Win11` branch. macOS is on `macOS` and iPhone/iPad on `iOS`. This document is the plan; [FEATURES.md](FEATURES.md) is the detailed status of each feature.

_Status as of 2026-11-17._ ✅ done · 🟡 partly done · ⬜ not started.

## Clean-room scope and sources

Follow [CLEAN_ROOM.md](CLEAN_ROOM.md). The feature names describe ordinary user tasks. Derive PDF interoperability from [ISO 32000-2](https://www.iso.org/standard/75839.html), the [PDF Association standards catalog](https://pdfa.org/sponsored-standards/), and approved library documentation. Write original code, interface layouts, icons, help, and fixtures. Record implementation sources in [PROVENANCE.md](PROVENANCE.md) and dependencies in [LICENSES.md](LICENSES.md).

In the US, copyright distinguishes functional ideas, processes, and methods of operation from their particular expression. That supports independently designing ordinary workflows such as merging pages, redacting content, and creating PDFs from office documents. See [17 U.S.C. § 102(b)](https://www.copyright.gov/title17/92chap1.html).

Patent clearance is open for every proposed implementation. A feature name, independent development, or use of a published standard does not establish freedom to operate. Once concrete approaches and launch markets are chosen, have qualified counsel review relevant in-force claims, legal status, and any standards-related licensing terms. Start with [USPTO Patent Public Search](https://www.uspto.gov/patents/search/patent-public-search) for US records. Record the approach, jurisdictions, and review outcome for release. This roadmap identifies candidates for independent implementation and makes no patent clearance finding.

## Where things stand

Phases 1 to 3 are built in the desktop app, with core tests for each workflow, and parts of phase 4 are done (export, scan, page furniture). The project is MIT licensed. The app is hardened by three code reviews and a stress test ([CODE_REVIEW.md](CODE_REVIEW.md)):
- PDF work runs in a document worker with a time limit, so a huge or hostile file cannot freeze the windows.
- Saves go through a temporary file.
- The renderer is sandboxed, and links, trust decisions and file writes are decided in the main process.

What stands between this and a first public Windows release is mostly verification on real systems (see [Release 1](#release-1-first-signed-windows-release)), not new features.

The architecture rules still hold: a byte-oriented headless core, file access and platform integration in the app, an ordered edit history with stable page identities, cancellable background jobs for rendering and conversion, and saves that leave the source intact on failure.

## Release 1: first signed Windows release

| Item | Status | What is left |
| --- | --- | --- |
| Signed builds | 🟡 | The SignPath workflow (`.github/workflows/release.yml`) is written and the repository is public, but it has not run yet. Run it, then install the signed build on a clean Windows 11 machine and check that SmartScreen and the installer behave. |
| Packaged app check | ⬜ | Run the installed build by hand: the document worker inside `app.asar`, opening from Explorer, printing, crash recovery, and uninstalling. So far only the unpackaged app has been run. |
| Office conversion | 🟡 | Built around an installed LibreOffice (isolated profile, macros off, timeout, cancel), but tested only against a stand-in program. Test with real LibreOffice on tables, page breaks, images, spreadsheet print areas, slides and non-Latin fonts. |
| Scan to PDF | 🟡 | Windows scanning (WIA) lists devices. Do a real scan on hardware (flatbed and feeder). |
| Exports opened elsewhere | ⬜ | Open exported .docx files in Word. Reopen saved, redacted, signed and protected PDFs in another standards-based reader, as the release acceptance below requires. |
| Browser viewer in the stores | ⬜ | Publish the Chrome/Edge extension (`apps/browser`) to the Chrome Web Store and Edge Add-ons, then put the two store IDs into `apps/desktop/build/installer.nsh` so the installer offers it. See [BROWSER_EXTENSION.md](BROWSER_EXTENSION.md). Run it once in Edge. |
| Updates | ⬜ | Installed copies have no way to receive fixes. Add a signed update check (opt-in, no telemetry) or at least a "new version available" notice, before the first public release. |
| Legal | ⬜ | Patent review as described above. Confirm the third-party notices in the installer match the bundled packages. |

## Phase 1 — Read, create, and organize

| Feature | Status | What is left |
| --- | --- | --- |
| Open and read | ✅ | Done: open from the dialog, drag and drop, the command line and "Open with"; continuous pages; thumbnails, outline and page labels; zoom and fit; selectable text; safe links; printing with range, orientation and scaling; clear errors. Left: single-page and two-page views, document tabs, and recent files. |
| Find and copy | ✅ | Done: case-sensitive search with highlights that align on rotated and cropped pages, and a notice for pages without text. Left: OCR for those pages (phase 4). |
| Merge PDFs | 🟡 | Done: files and pages in any order. Left: keep bookmarks and form fields across a merge or a page rebuild (today the app warns that form fields are dropped), and detect form field names that collide. |
| Organize pages | ✅ | Reorder, duplicate, rotate, crop (visible area only), delete, blank pages, pages from another PDF, split and extract, with keyboard and drag. |
| Create from images or text | ✅ | Blank pages, JPEG/PNG with EXIF orientation, page size, margins and fit, and plain text with an embedded Unicode font. Characters the font lacks (for example CJK) are reported; a wider font is left to do. |
| Create from Office files | 🟡 | See Release 1. |
| Save and recover | ✅ | Undo/redo, dirty indicator, Save and Save As through a temporary file, crash recovery (off for protected documents), and a warning that saving invalidates signatures. |

## Phase 2 — Review, fill, and prepare documents

| Feature | Status | What is left |
| --- | --- | --- |
| Annotations | 🟡 | Done: highlight, underline, strikeout, note, free text, shapes and ink, as standard annotations with appearances. Left: editing or deleting annotations that are already in a file, comment replies, and rubber stamps. |
| Bookmarks, links and metadata | 🟡 | Done: an editable bookmark tree that follows page edits, new links to pages or addresses, and a properties dialog. Left: editing links already in a file. |
| Stamps and page furniture | 🟡 | Done: text watermark, headers, footers, page numbers and Bates numbers with a preview. Left: image watermark and editing page labels. |
| Forms | 🟡 | Done: fill text, checkbox, radio, dropdown and list fields in reading order, and flatten; XFA is reported as unsupported. Left: a field designer, and form data export and import (FDF/XFDF/JSON/CSV). PDF JavaScript stays off for good. |
| Visual signatures | ✅ | Draw, type or import, reusable signature and initials kept locally, and ticks and marks. |

## Phase 3 — Redact, sanitize, and protect

| Feature | Status | What is left |
| --- | --- | --- |
| Permanent redaction | ✅ | Done: rasterizing redaction into a verified new copy (or the open document, by setting), including annotations and form values. It fails closed and refuses marks that would hide nothing. The CLI verifies before writing. Left: strategy B (keep the unmarked text on redacted pages searchable; [REDACTION.md](REDACTION.md)). |
| Sanitize before sharing | 🟡 | Done: metadata, attachments, comments, scripts and actions (including `/Next` chains and bookmarks), form data, thumbnails and earlier revisions, re-inspected before saving. Left: removing hidden layers (today they are only reported). |
| Certificate signatures | 🟡 | Done: sign with a .p12/.pfx (RSA), and verify integrity, coverage, later changes and trust (checked at verification time, user-chosen trusted certificates). Left: RFC 3161 timestamps and long-term validation, revocation checks (OCSP/CRL), signing from the Windows certificate store and smart cards, and ECDSA keys. See [SIGNING.md](SIGNING.md). |
| Password protection | ✅ | Open with a password (in memory only), AES-256 protect, change or remove a password, and set permissions. Protected copies stay protected. |

## Phase 4 — Edit, scan, export, and validate

| Feature | Status | What is left |
| --- | --- | --- |
| Scan and OCR | 🟡 | Done: Windows scanning to PDF (see Release 1). Left: OCR with an invisible text layer (candidate: Tesseract, Apache-2.0), with language choice, deskew, rotation, cancellation, and no duplicate layer on pages that already have text. |
| Edit existing page content | ⬜ | Start with replacing a whole text run in the same font, then images: move, resize and replace. |
| Export | ✅ | .docx rebuilt from page text, .txt, and PNG/JPEG per page. Left: CSV for reviewed tables. |
| Optimize | 🟡 | Object streams on save. Left: image downsampling and quality presets, with before and after sizes and signed-document handling. |
| Compare and batch | ⬜ | Compare two versions (visual and text differences, report). A batch window; today the CLI can be scripted. |
| Accessibility and archival | ⬜ | The interface is keyboard accessible. Left: inspect tags, language, headings, reading order, alt text and tables; tagged export; PDF/A validation for specific profiles. |
| Attachments and layers | ⬜ | View and manage attachments and optional content layers. |

## Engineering work

| Item | Status | What is left |
| --- | --- | --- |
| Large files | ⬜ | Every operation holds the whole file in memory (`Uint8Array` in and out). Measure memory and time on large documents, and design a document handle or streaming API before large-file support is promised. |
| Decompression limit | 🟡 | A file that expands enormously now only costs the document worker (time limit, crash isolation). There is still no byte cap inside pdf-lib's stream decoding. |
| PDF writer | ⬜ | Evaluate the pdf-lib fork against alternatives (PDFium via WASM, qpdf) on the existing tests: coverage of damaged files, incremental saves, and memory. |
| Text hit boxes | 🟡 | Approximate for unusual fonts and vertical text. |
| Browser extension, other browsers | ⬜ | Firefox needs its own packaging. The macOS browsers are built on the `macOS` branch. |
| Linux package | ⬜ | The Electron app should run as is; packaging (AppImage or deb) and testing are left. |

## Acceptance for each release

- Exercise every new workflow through its normal desktop entry point. Add focused core tests with generated fixtures and CLI coverage where useful. Update [FEATURES.md](FEATURES.md) when status changes.
- Reopen saved files in an independent standards-based reader. Verify expected content, geometry, links, and form behavior for the operations that promise to preserve them.
- Test memory limits, cancellation, damaged documents, and platform failure paths. Keep document bytes local by default and run document parsing and conversion with resource limits.
- Inspect output bytes for security-sensitive changes. Include negative controls and verify failure paths prevent a misleading success state.
- Track existing constraints as work items: the writer rewrites files and can invalidate signatures; built-in stamp fonts have limited character coverage; text hit boxes are approximate for unusual text.
