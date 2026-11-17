# Product roadmap

Build a local-first desktop PDF reader and editor for reading, creating, organizing, reviewing, protecting, and publishing documents. The foundation ships a headless TypeScript library and CLI. The desktop app is planned. Use the workflows below as the implementation brief.

## Clean-room scope and sources

Follow [CLEAN_ROOM.md](CLEAN_ROOM.md). The feature names describe ordinary user tasks. Derive PDF interoperability from [ISO 32000-2](https://www.iso.org/standard/75839.html), the [PDF Association standards catalog](https://pdfa.org/sponsored-standards/), and approved library documentation. Write original code, interface layouts, icons, help, and fixtures. Record implementation sources in [PROVENANCE.md](PROVENANCE.md) and dependencies in [LICENSES.md](LICENSES.md). Keep the project license decision on the release checklist.

In the US, copyright distinguishes functional ideas, processes, and methods of operation from their particular expression. That supports independently designing ordinary workflows such as merging pages, redacting content, and creating PDFs from office documents. See [17 U.S.C. § 102(b)](https://www.copyright.gov/title17/92chap1.html).

Patent clearance is open for every proposed implementation. A feature name, independent development, or use of a published standard does not establish freedom to operate. Once concrete approaches and launch markets are chosen, have qualified counsel review relevant in-force claims, legal status, and any standards-related licensing terms. Start with [USPTO Patent Public Search](https://www.uspto.gov/patents/search/patent-public-search) for US records. Record the approach, jurisdictions, and review outcome for release. This roadmap identifies candidates for independent implementation and makes no patent clearance finding.

## Foundation and work order

Core and CLI already cover page operations, metadata, stamps, image placement, visual signatures, basic AcroForms, text search, and raster redaction. Cryptographic signing and verification are stubs. Password-protected files are unsupported. See [HANDOFF_CODEX.md](HANDOFF_CODEX.md) for the initial review, especially coordinate handling and redaction. Run the existing checks before extending the core.

Deliver phases 1 and 2 as the first usable desktop release. Enable applied redaction only after its verification criteria pass. Keep the byte-oriented headless core and put file access, platform integration, and UI in the app. Use an ordered operation history with stable page identities across reorders. Render and convert in cancellable background jobs, write saves through a temporary file, and leave the source intact on failure.

## Phase 1 — Read, create, and organize

| Feature | Behavior and acceptance criteria |
| --- | --- |
| Open and read | Open PDFs from the file picker or drag and drop. Show a page canvas, thumbnails, outline, page labels, zoom, fit width/page, and a page number control. Render visible pages first. Support keyboard navigation, selectable text, safe links, and printing with page range, orientation, and scaling. Verify mixed sizes and rotations. Present a clear error for damaged or unsupported files. |
| Find and copy | Search selectable text, show page and excerpt, highlight each occurrence, and navigate between hits. Support case-sensitive search and text selection. Check that hits align after zoom, rotation, and cropping. Identify pages with no searchable text and surface OCR once available. |
| Merge PDFs | Add files, preview them, choose per-file page ranges, reorder files or individual pages, and save one PDF. Preserve page sizes and rotations. Remap valid links and outlines where supported. Detect colliding form field names and disclose features the merge cannot preserve. Verify exact output order and render representative pages in another reader. |
| Organize pages | Reorder, duplicate, rotate, crop, delete, and insert blank pages or pages from another PDF. Support keyboard controls as well as dragging. Split by ranges or fixed page count and extract selections into a new file. Distinguish crop, which changes visible bounds, from removal of content. Verify page order, destination mapping, and source preservation. |
| Create from images or text | Create blank PDFs and combine ordered JPEG/PNG images into pages. Respect image orientation and offer page size, margins, fit, and preview. Paginate plain text with embedded fonts and Unicode coverage. Verify portrait and landscape inputs, multipage output, and text extraction. |
| Create from Word and other Office files | Start with DOCX, then add XLSX, PPTX, ODT, ODS, and ODP after testing the converter. Use a local, documented export provider, such as an installed LibreOffice executable via its public command-line interface after source and dependency review. Offer manual import of a PDF exported from Word when no provider is available. Detect capabilities, convert in an isolated job with a timeout, and preview page count and layout before saving. Disable macros and external resource access, clean temporary data, and surface missing fonts or layout differences when detectable. Test tables, page breaks, hyperlinks, embedded images, spreadsheet print areas, slide sizes, and non-Latin fonts. See [Word PDF export](https://support.microsoft.com/en-us/word/export-word-document-as-pdf) and [LibreOffice PDF export parameters](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html). |
| Save and recover | Provide undo/redo, dirty-state indicators, Save, Save As, and crash recovery for ordinary edits. Warn when an edit would invalidate a digital signature. Protect recovery data and remove it when discarded. Test disk-full and interrupted writes with an intact original and a recoverable edit session. |

## Phase 2 — Review, fill, and prepare documents

| Feature | Behavior and acceptance criteria |
| --- | --- |
| Annotations | Support highlight, underline, strikeout, sticky note, free text, shapes, ink, and stamps. Let users select, edit, and delete their annotations. Save standard annotation dictionaries and appearances. Verify round-trip geometry and appearance in a second reader. |
| Bookmarks, links, and metadata | Create and edit nested bookmarks and links to internal pages or external URLs. Edit document properties with a clear preview of saved values. Remap internal destinations after page edits and require a deliberate action before opening external URLs. |
| Stamps and page furniture | Place images, watermarks, headers, footers, page numbers, and Bates numbers on selected pages. Preview positioning, opacity, and numbering on mixed page sizes. Embed fonts for supported Unicode text and verify that numbering remains sequential. |
| Forms | Fill text fields, checkboxes, radio buttons, dropdowns, and lists. Keep values and appearances in sync and support keyboard navigation. Add basic AcroForm field creation and editing after fill works. Export a flattened copy on request and identify unsupported form types, including XFA. Verify editable and flattened outputs in another reader. |
| Visual signatures | Draw, type, or import a signature image, then place and resize it on a page. Label it as a visual signature and save it as document content. Keep reusable signature assets local and user-controlled. |

## Phase 3 — Redact, sanitize, and protect

| Feature | Behavior and acceptance criteria |
| --- | --- |
| Permanent redaction | Mark regions manually or from text search, review every mark on the rendered page, then apply to a new copy. Clearly show pending versus applied marks. Start with rasterizing affected pages and disclose the loss of searchable text and accessibility structure on those pages. Check that sensitive content cannot be recovered through text extraction, old revisions, underlying image data, annotations, form values, or other retained objects. Fail closed on unsupported inputs or failed verification. Include rotated/cropped pages, unusual origins, image-only pages, and cross-page duplicates in test fixtures. Scope the result to marked areas and distinguish whole-document cleanup. See [REDACTION.md](REDACTION.md). |
| Sanitize before sharing | Inspect categories such as metadata, attachments, comments, hidden layers, scripts/actions, and embedded form data. Let the user review selected removals and export a separate copy. Verify that removed objects and historical revisions are absent from the output. Explain any visible changes and any categories the sanitizer could not inspect. |
| Certificate signatures | Sign with a user-selected certificate and verify signed byte ranges, trust, timestamps when available, and post-signing changes. Use standard PDF/CMS and PAdES profiles where implemented. Show distinct results for integrity, trust, and subsequent edits. Keep private keys in their provider. Check known valid, tampered, expired, and untrusted fixtures. See [SIGNING.md](SIGNING.md). |
| Password protection | Support password-based open and encrypted Save As once the writer can handle supported standard security handlers. Treat credentials as transient and keep them out of logs and recovery files. Show an explicit result for wrong passwords and unsupported encryption. Verify output opens with the right password and that protected strings are inaccessible without it. |

## Phase 4 — Edit, scan, export, and validate

| Feature | Behavior and acceptance criteria |
| --- | --- |
| Scan and OCR | Import scanned images or PDFs, with platform scanner integration as available. Offer page ranges, rotation, deskew, language selection, and cancellable local recognition. Preserve visible page imagery and align an invisible searchable text layer. Avoid duplicate layers on pages with existing text. Test multilingual and rotated scans for search and selection alignment. |
| Edit existing page content | Begin with selected text runs and images the writer can identify and replace safely. Preview placement, font substitution, and wrapping. Keep unrelated objects stable and surface unsupported selections. Add object move, resize, and image replacement. Test text extraction and rendering after reopen. |
| Export | Export chosen pages to PNG/JPEG and selectable text to UTF-8. Add CSV for reviewed tables and editable DOCX conversion later. Preserve logical reading order where available and describe editable conversion as best-effort reconstruction. Test columns, tables, scans, and mixed fonts. |
| Optimize | Estimate size changes, provide image quality and resolution options, and save an optimized copy. Report before/after sizes and preserve text, links, and forms for presets that promise preservation. Include signed-document handling in the preview. |
| Compare and batch | Compare two versions using page alignment, visual differences, and text changes where available. Let the user navigate changes and export a report. Batch supported operations with an output preview, collision handling, cancellation, and a per-file success or failure summary. |
| Accessibility and archival | Keep the desktop interface keyboard accessible throughout. Add document inspection for tags, language, headings, reading order, alt text, and table structure. Offer tagged export and PDF/A validation for specific supported profiles. Require profile validation before claiming conformance and distinguish automated checks from items needing human review. |

## Acceptance for each release

- Exercise every new workflow through its normal desktop entry point. Add focused core tests with generated fixtures and CLI coverage where useful. Update [FEATURES.md](FEATURES.md) when status changes.
- Reopen saved files in an independent standards-based reader. Verify expected content, geometry, links, and form behavior for the operations that promise to preserve them.
- Test memory limits, cancellation, damaged documents, and platform failure paths. Keep document bytes local by default and run document parsing and conversion with resource limits.
- Inspect output bytes for security-sensitive changes. Include negative controls and verify failure paths prevent a misleading success state.
- Track existing constraints as work items. The writer rewrites files and can invalidate signatures. Built-in stamp fonts have limited character coverage. Text hit boxes are approximate for unusual text, and whole-document memory use needs measurement before large-file support is promised.
