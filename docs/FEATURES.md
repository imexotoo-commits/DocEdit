# Feature catalogue (written in our own words, from user needs)

Status: ✅ foundation implements it and tests it · 🟡 partial · 📐 designed in docs, not coded · ⬜ not started.
Priority: P0 must-have for a first usable app, P1 next, P2 later.

## Read and navigate
| Feature | Status | Pri | Notes |
|---|---|---|---|
| Open, render pages (zoom, fit width/page, rotate view) | ✅ | P0 | Desktop app: open from dialog, drag and drop or command line; continuous pages rendered as they come into view; zoom steps, Ctrl+wheel, fit width/page; selectable text layer; clear errors for damaged and password-protected files. |
| Links | ✅ | P0 | Internal links jump to their page; web/mail links open only after a confirmation showing the full address; other link actions are never offered. |
| Print (page range, fit/actual size, orientation) | ✅ | P0 | Pages rendered at 150 dpi and printed through the system dialog; landscape pages are turned onto portrait paper in "match each page" mode. |
| Page thumbnails, outline/bookmarks, go to page | ✅ | P0 | Thumbnails, bookmark tree (editable: add, rename, move, nest, delete; follows page reorders and deletions), page labels shown and accepted in the page box. |
| Text search with highlights, copy text | ✅ | P0 | Search tab: match case, results with page and excerpt, highlights aligned on rotated and cropped pages, notice for pages without text. Hit boxes are approximate for unusual fonts. |
| Open password-protected files | ✅ | P0 | Password prompt (wrong-password message), decrypted in memory only; crash recovery off for protected documents; Save re-encrypts. |
| View PDFs in the browser (Chrome, Edge) | ✅ | P1 | `apps/browser` extension: PDFs open in an Oakqueill viewer (pages, zoom, fit, rotate view, find, thumbnails, links, print, save, password). Built from the desktop viewer pieces. Firefox and Safari ⬜. See `docs/BROWSER_EXTENSION.md`. |
| Right-click menus | ✅ | P0 | Text boxes (cut, copy, paste, select all), page text (copy, highlight, underline, strike, mark for redaction), anywhere on a page (note, bookmark), page list (rotate, duplicate, blank page, save as PDF, bookmark, delete), pending changes (edit text, delete). |
| Settings | ✅ | P0 | Theme (match Windows, light, dark), zoom and tool tab for newly opened documents, redaction into a copy or into the open document, crash recovery on or off. Saved in the profile folder. |
| Continuous / single / two-page view | ⬜ | P1 | |
| Tabs / recent files | ✅ | P1 | Several documents in one window as tabs (Ctrl+T new, Ctrl+Tab / Ctrl+Shift+Tab to switch, Ctrl+W or middle-click to close). Opening a file uses a new tab when the current one shows a document, and switches to the tab of a file that is already open, so nothing is replaced. One running copy: a PDF opened from Explorer joins the open window as a tab. Closing the window asks once and can save every unsaved tab. Recent files (last 10) under File › Open Recent, on the start screen and in the Windows jump list; a setting turns this off and clears the list. |

## Organize pages
| Merge several PDFs (with page selection) | ✅ | P0 | `mergePdfs` |
| Split by size or ranges | ✅ | P0 | `splitPdf` |
| Extract, reorder, duplicate pages | ✅ | P0 | `selectPages` |
| Delete pages | ✅ | P0 | `deletePages` |
| Rotate pages | ✅ | P0 | `rotatePages` |
| Insert blank page; insert pages from another file | ✅ | P0 | `insertBlankPage`, `arrangePages` (any order of pages from several files, blanks, rotation, in one pass); both in the app |
| Crop pages | 🟡 | P1 | `cropPages` only sets the visible box (NOT a redaction; content stays in the file) |
| Headers/footers, page numbers, Bates numbering | ✅ | P0 | `applyEdits` furniture: six positions, {page} {total} {date} {bates}, placed relative to the displayed page (rotation/crop aware), Unicode via embedded font; dialog with a preview rendered by the real code. Page-label editing ⬜. |
| Crash recovery of unsaved edits | ✅ | P0 | Snapshots in a private app-data folder while changes are unsaved; offered at next start. |
| Drag-and-drop page organizer UI | ✅ | P0 | App: multi-select, drag to reorder, drop PDFs to insert, rotate/duplicate/delete/blank, keyboard (arrows, Ctrl+arrows to move, R/Shift+R, Delete), undo/redo, Save/Save As through a temporary file. Saving page edits does not keep bookmarks or form fields yet; the app warns first. |

## Edit
| Add text, shapes, images to a page | ✅ | P0 | As annotations (text box, rectangle, ellipse, freehand) and `placeImage`; editing existing page content is phase 4. |
| Edit existing text in place | ⬜ | P1 | Hard: needs a content-stream text model. Start with "replace whole text run, same font". |
| Edit/replace/move images | ⬜ | P2 | |
| Watermark / background | ✅ | P0 | Text watermark with opacity and angle, fitted to each page (image watermark ⬜). |
| Links (add/edit) | 🟡 | P0 | Add links to a page or a web/mail address; pending links can be removed. Editing links already in a file ⬜. |
| Compress / optimise | 🟡 | P1 | object streams on save; image downsampling ⬜ |
| Document properties (title, author, keywords) | ✅ | P0 | Properties dialog showing exactly what will be saved. |
| Attachments, layers | ⬜ | P2 | |

## Review and annotate
| Highlight, underline, strike-through, sticky note, free text, ink/draw, shapes, stamps | ✅ | P0 | Standard annotation dictionaries with appearance streams, verified by reading back with pdf.js and rendering. Created annotations can be selected, edited and deleted before saving; editing annotations already in a file ⬜. Rubber stamps ⬜. |
| Comments list, reply threads | 🟡 | P1 | Changes tab lists every pending edit; replies ⬜. |
| Measure / callouts | ⬜ | P2 | |

## Forms
| Detect and fill form fields (text, checkbox, radio, dropdown, list) | ✅ | P0 | Form tab in reading order, values shown over the fields, kept editable when the page layout is unchanged; XFA reported as unsupported. |
| Flatten form | ✅ | P0 | `flattenForm`; app: Save flattened copy. |
| Create form fields (designer) | ⬜ | P1 | |
| JavaScript in forms | ⬜ | never (security) | Do not execute PDF JavaScript. |
| Export/import form data (FDF/XFDF/JSON/CSV) | ⬜ | P2 | |

## Sign
| Visual signature (drawn image or typed name) | ✅ | P0 | Draw, type or import; reusable signatures kept locally; labelled as visual (no cryptography). |
| Fill and sign: saved signature and initials, ticks, crosses, dots, boxes, lines | ✅ | P0 | Sign & Protect tab: the saved signature and initials are placed with one click and deleted with ×; marks are drawn into the page content (upright on rotated pages), like ink on paper. |
| Cryptographic digital signature (certificate based, PAdES) | 🟡 | P0 | Sign with a .p12/.pfx (RSA), invisible or visible, saved as a new signed copy; PAdES B-B style. Timestamps, smart cards and OS certificate stores ⬜. See `docs/SIGNING.md`. |
| Verify signatures, show validity, detect later changes | ✅ | P0 | Signatures tab: integrity, certificate validity, trust (user-chosen trusted certificates), changes after signing. Revocation checks ⬜. |
| Timestamp (RFC 3161), long-term validation | 📐 | P2 | |
| Request signatures / signing workflow | ⬜ | P2 | server component; out of scope |

## Protect
| **Redact** (permanently remove text/images/areas) | ✅ | P0 | App: mark by drawing, selected text, search or personal-data patterns; review; apply into a verified new copy, or (Settings) into the open document as an unsaved change that cannot be undone (fails closed either way). Strategy B (keep unmarked text on redacted pages) ⬜. See `docs/REDACTION.md`. |
| Remove hidden data (metadata, comments, attachments, scripts) before sharing | ✅ | P0 | `inspectDocument` / `sanitizeDocument` and the Sanitize dialog: metadata/XMP, attachments, comments, scripts and risky actions, form fields (flattened), thumbnails and private app data, earlier revisions (always dropped). Hidden layers are reported but not removed (redact instead). Output re-inspected before saving; new copy only. |
| Password-protect / permissions (encrypt) | ✅ | P0 | `protectPdf` (AES-256) / `decryptPdf`; Password dialog: set, change, remove, restrictions; redacted and sanitized copies keep the protection. |
| Compare two PDFs | ⬜ | P2 | |

## Create and convert
| Create PDF from images / blank pages / text | ✅ | P0 | `createBlankPdf`, `imagesToPdf` (JPEG/PNG, EXIF orientation, paper/margins/fit), `textToPdf` (wrapping, embedded DejaVu Sans; characters it cannot show, e.g. CJK, are reported). New dialog in the app. |
| Create PDF from Office documents | 🟡 | P0 | Uses an installed LibreOffice (isolated profile, macros off, timeout, cancel). Tested against a stand-in executable only; real-LibreOffice testing of tables, page breaks, images, print areas, slides and non-Latin fonts is still to do. Without LibreOffice the app explains the manual export route. |
| Create PDF from HTML / virtual printer | ⬜ | P2 | separate projects |
| Export to Word, text, images | ✅ | P1 | Export dialog: .docx rebuilt from the page text (paragraphs, headings, page breaks; pages without text as pictures; layout, columns and tables approximated), .txt, PNG/JPEG per page. Own ZIP/.docx writer, no dependency. |
| Scan to PDF | 🟡 | P1 | Windows scanning (WIA), offered (start screen and File › New) only when Windows sees a scanner, checked in the background after start-up and when the app comes back to the front: scanners and multifunction printers Windows sees, flatbed or feeder, colour/greyscale/black and white, 150–600 dpi, pages collected then made into a PDF. Device listing tested; real scans to be tested on hardware. |
| OCR scanned pages (searchable text layer) | ⬜ | P1 | candidates: Tesseract (Apache-2.0) |
| PDF/A, PDF/UA (accessibility) checks and tagging | ⬜ | P2 | |

## Platform
| Desktop app (Windows, macOS, Linux), offline, no account, no telemetry by default | 🟡 | P0 | `apps/desktop` (Electron, sandboxed renderer, no network use). Windows installer and portable .exe via `npm run dist -w @docedit/desktop` (unsigned). macOS dmg and zip via `npm run dist:mac -w @docedit/desktop` (ad-hoc signed, not notarized; Finder open-with and Dock drop work). Linux package ⬜. |
| iPhone and iPad app | 🟡 | P1 | `apps/ios`: SwiftUI shell running the desktop renderer in a web view, the core in a Web Worker, system pickers/print/links in Swift. Verified in the simulator (open, render, worker and redaction self-test). Scan, Office conversion and certificate signing are not on iOS. Device and TestFlight builds need an Apple Developer account. See `apps/ios/README.md`. |
| Command line and scripting | ✅ | P1 | `docedit` CLI |
| Batch processing | 🟡 | P2 | CLI can be scripted |
