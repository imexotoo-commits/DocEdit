# Redaction ("blacking out" text so it is really gone)

The word is **redaction**. A redaction must *remove* the underlying content, not draw a black rectangle over it. A rectangle only hides the text visually; anyone can select, copy or extract it. The test `proves a cosmetic black box is NOT redaction` demonstrates exactly that.

## Workflow (what the UI must offer)
1. **Mark**: user drags boxes, or searches text/regex (names, ID numbers, e-mail patterns) → `findRedactionMarks`.
2. **Review**: show every mark on the page as a pending (e.g. red outlined) box; user can remove or add marks. Nothing is destroyed yet.
3. **Apply**: `applyRedactions(pdf, marks, rasterizer, { dpi })` returns a NEW PDF. Warn the user: this cannot be undone in the saved file (keep the original).
4. **Verify**: `verifyRedaction(out, secrets)` searches the result again; the UI should show "0 matches remain".
   `applyRedactions` refuses a mark with no part on the visible page (outside the crop box, zero or negative size),
   since it would hide nothing. The CLI (`docedit redact`) checks every mark's coverage with `checkRedactionCoverage`
   and searches the result for `--text` / `--regex` before it writes anything; on any failure it writes nothing and
   exits with an error. Outputs are written to a temporary file and renamed into place, so a failure leaves an
   existing file as it was.
5. **Sanitize**: Document > Remove Hidden Information (metadata, attachments, comments, scripts, form data, thumbnails, earlier revisions; hidden layers are reported).

## In the desktop app
Mark with the **Redact** tool (drag boxes) or from Search (**Mark all for redaction**, including built-in patterns for e-mail addresses, phone numbers, US SSNs, card numbers, IBANs and numeric dates). Marks are pending, shown as red dashed boxes, listed under Changes, undoable, and never applied by Save (Save warns when marks exist). **Apply redactions** produces a new copy (never over the original) and verifies it before writing; if any check fails nothing is saved:
1. text under every mark (and the search terms used) is not extractable on any page;
2. those strings are not in the file, searched in the raw bytes and in every inflated stream (Latin-1 and UTF-16BE);
3. redacted pages have no text at all;
4. every marked area is dark when the output is rendered (located through the original page's view, because a redacted page becomes an unrotated picture page).
The app renders with pdf.js in the window (`PdfJsRasterizer`), so the packaged app needs no native canvas module.

## What the foundation does (strategy A: rasterize affected pages)
For every page with at least one mark: render the page to pixels, paint the marked areas, replace the page by that picture **in a new document**. Pages without marks are copied unchanged. Then `pruneUnreachable` deletes every object not reachable from the catalog.

Why a *new* document and why pruning: pdf-lib writes every object in its context, even ones detached from the page tree, so editing in place leaves the old content stream in the file. A test searches the raw output bytes for the secret and for the `/Link` annotation that pointed at the redacted page.

Guarantees (each covered by `packages/core/test/redact.test.ts`):
- the text is not extractable from the output;
- the secret string is not in the output bytes;
- the marked area is black in the output, also on rotated pages;
- unmarked pages stay real text;
- internal links on kept pages are dropped (they can reference redacted pages).

Known trade-offs of strategy A:
- Redacted pages lose **all** text, not only the marked words (the page is a picture). Search/copy/accessibility on those pages is gone. Run OCR afterwards if searchable text is needed (ROADMAP).
- File size grows (a page picture at 200 dpi is roughly 0.3-2 MB as Flate). Switch to JPEG/JBIG2 for big files later.
- Annotations, form fields, links and bookmarks on redacted pages are dropped. Document outline and metadata of the source are not carried over.
- Marks that cover text only partially still blank the whole rectangle (that is what the user drew).
- Hidden text in unmarked pages is untouched by design.

## Strategy B (better, for the app build): content-stream redaction
Parse each page's content stream, find text-showing operators (`Tj`, `TJ`, `'`, `"`) and image draws (`Do`), compute glyph boxes with font metrics and the current transformation matrix, **delete or replace the glyphs/pixels that intersect a mark**, draw the box, and keep everything else as vector text. Result: only the marked content is lost, file stays small, other text stays searchable. Work required: a content-stream tokenizer/serializer, font width tables (simple fonts, Type0/CID with `/W`), handling `Tc/Tw/Tz/TL/Ts`, form XObjects (recurse), inline images, clipping, patterns, Type3 fonts, and image masking (pixel clear for partially covered images). Keep strategy A as the always-correct fallback and as the oracle in tests (compare extracted text and rendered pixels between A and B).

## Test checklist for any new redaction code
Secret absent from: extracted text (pdf.js), raw bytes, decompressed streams, XMP/Info, annotations, outlines, attachments, thumbnails, and form field values. Also test: rotated pages, pages with `/CropBox`, nested form XObjects, text drawn with each font type, images, scanned (image-only) pages, and a PDF with an incremental-update history (old revision still in the file → must be dropped).

## Testing note
A plain byte search proves nothing about compressed content. Tests use `deepText` (raw bytes plus every inflated stream) for every "not in the file" assertion; the app's redaction check does the same.
