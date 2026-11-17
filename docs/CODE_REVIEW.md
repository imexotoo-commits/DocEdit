# Desktop code review handoff

Reviewed `6cc8078` on `main`. This was a static review of save and export, certificate verification, and redaction. The app and test suite were not run. Check whether newer commits already address any finding before changing code. Follow [CLEAN_ROOM.md](CLEAN_ROOM.md) for implementation and fixtures.

## P1 — Preserve password protection on derivative exports

**Finding.** The editor holds decrypted PDF bytes. Normal Save passes protection to the writer. Extract and Flatten omit it, and Split writes arranged bytes directly. Users can produce readable copies of password-protected files without a warning.

**Suggested change.** Pass the existing protection settings through Extract, Split, and Flatten. Reuse the normal writer's encryption path and apply protection before writing each output. If the product supports an unencrypted export, make it an explicit choice. Keep credentials out of logs and recovery snapshots.

**Regression check.** Open a password-protected fixture, exercise each desktop export, and confirm every output rejects a missing or incorrect password and opens with the expected password. Exercise cancellation and encryption failure.

App.tsx · App.tsx · App.tsx · main.ts

## P1 — Require revision coverage for a document-level signature verdict

**Finding.** The verifier computes `coversRevision` separately from CMS integrity. The panel ignores coverage and can show a trusted signature and no later changes without establishing that the verified bytes cover a complete PDF revision.

**Suggested change.** Validate the signed byte ranges against the signature value and the signed PDF revision. Require established coverage for a document-level success. Present CMS integrity, revision coverage, certificate trust, and later revisions as separate results. Report indeterminate coverage explicitly.

**Regression check.** Cover a valid signature, a valid earlier signature followed by a legitimate incremental update, malformed byte ranges, and a report with valid CMS integrity but unestablished revision coverage. Confirm the last case cannot produce the trusted document-level headline.

signature.ts · SignaturesPanel.tsx

## P2 — Carry pending content edits into Extract and Split

**Finding.** These commands use source bytes and current page slots. They omit pending edits, so notes, form values, and other visible edits can disappear from exported PDFs.

**Suggested change.** Reuse the Save materialization path before selecting export pages, or resolve applicable edits against each output's page layout. Define how links to excluded pages and forms are handled. Warn about unapplied redaction marks before export. Coordinate this change with the protection fix so any intermediate plaintext stays in memory.

**Regression check.** Add a note and fill a field, reorder pages, and export a subset through both commands before saving. Reopen the outputs and confirm the edits appear on the intended pages. Check link behavior and the unapplied-redaction warning.

App.tsx · App.tsx · main.ts

## P2 — Verify the full redaction region

**Finding.** The coverage check samples one center pixel per mark and ignores alpha. It can report full coverage for a partially covered region. An out-of-bounds transparent sample can also satisfy the RGB check. Manual marks have no search string to corroborate coverage.

**Suggested change.** Reject empty or off-page intersections, map marks through the actual raster transform, and validate the entire clipped interior against the expected opaque fill. Define edge rounding consistently with the burn operation. Keep extraction and output-byte checks as additional verification. Block export when a required check fails.

**Regression check.** Include an image-only page, a partially filled region with a dark center, an off-page mark, and rotated or cropped pages. Confirm failed verification prevents a successful export. Include a positive control whose marked area is fully burned in.

redaction.ts · [Redaction design](REDACTION.md)

## Resolution (2026-11-12, Claude)

All four findings were confirmed against `6cc8078` and fixed.

- **P1 protection on exports.** Extract, Split and Save flattened copy pass the document's protection to the writer; Split encrypts every part. Checked in the app with a protected form: every output is encrypted (AES-256), pdf.js refuses it without or with a wrong password, and it opens with the right one. Intermediate plaintext stays in memory; credentials are not logged or put in recovery data.
- **P1 signature coverage.** `verifySignatures` now reports `coverage` (`whole-file` / `earlier-revision` / `not-established`) and a document-level `status` (`valid` only with CMS integrity **and** established coverage, `indeterminate` otherwise). It also requires the byte-range gap to be the signature's own `/Contents`. The panel headline comes from `signatureHeadline(status, trusted)`, so an unconfirmed signature can never read as trusted. Tests: valid, earlier signature plus a later legitimate update, three malformed byte ranges, and a correctly signed range that stops short of `%%EOF` (indeterminate even with the signer trusted).
- **P2 pending edits in Extract/Split.** Both export from the document as it would be saved (pending edits, form values, page order), then select pages. Unapplied redaction marks trigger a warning. Links to left-out pages are removed; links to kept pages are remapped. This fixed a pre-existing bug: pdf-lib copied a separate orphan page for every internal link target, so internal links in any rebuilt document were dead. Checked in the app: footer, form value and new order appear in the exported files.
- **P2 redaction coverage.** New core `checkRedactionCoverage` locates each mark with the same rasterizer and rounding as the burn step, rejects marks off the page, and requires every interior pixel to be the opaque fill colour; the app uses it in place of the centre-pixel sample. Tests: rotated, cropped and image-only pages (positive control), a fake redaction that blacks out only the centre (fails), and an off-page mark (fails).

## Follow-up review (2026-11-14, Codex)

Reviewed `d83299c` against the previous review. This was a static review. The app and tests were not run.

### P1 — Validate the signed PDF revision before reporting coverage

**Finding.** The signature verifier treats an `%%EOF` suffix as evidence that a byte range ends at a complete revision. That check does not establish a valid cross-reference and trailer or bind the signature to the signed revision. Its result controls the document-level verdict.

**Suggested fix.** Validate the signed prefix as a complete PDF revision using its terminal `startxref`, cross-reference data, and trailer. Resolve the signature dictionary in that revision and verify that the excluded byte span belongs to its serialized `/Contents`. Preserve the distinction between CMS integrity and revision coverage. Where structural validation is unsupported or inconclusive, report coverage as indeterminate.

**Regression checks.** Cover valid whole-file and earlier-revision signatures, a signed prefix with an EOF marker but invalid revision structure, and a signature whose dictionary cannot be resolved in the signed revision.

Coverage decision · Revision check

### P2 — Preserve internal links that use named destinations

**Finding.** The page rebuild remaps destination arrays. Name and string destinations are copied without the source document's destination catalog, so their links can stop working even when the target page survives.

**Suggested fix.** Resolve named destinations in each source's destination name tree or legacy `/Dests` dictionary before copying. Normalize the resolved target to the existing remapping path and retain its view parameters. Remove links whose target is excluded from the output.

**Regression checks.** Cover direct `/Dest` and `/GoTo` action links with named destinations, including kept, reordered, and excluded targets.

Link remapping

### P2 — Prevent stale signature results after switching documents

**Finding.** Every async verification response updates the same renderer state. An earlier request that completes late can replace the current PDF's verdict or display its error on the wrong document.

**Suggested fix.** Associate each request with the current source and a monotonically increasing request ID. Invalidate it when the source changes or the view unmounts. Ignore stale successes and failures, including responses from superseded trust refreshes.

**Regression checks.** Open two signed PDFs and resolve their verification requests in reverse order. Then repeat with an unsigned second PDF and with a stale rejection. Check that the panel and notices reflect only the active document.

Renderer verification

### Resolution (2026-11-14)

All three findings were confirmed against `d83299c` and fixed.

- **P1 signed revision.** New core `checkSignedRevision` (`packages/core/src/revision.ts`) reads the signed bytes the way a reader opens a file: from their last `startxref`, through every cross-reference section (classic tables and cross-reference streams, `/Prev` chains and hybrid `/XRefStm`). It checks that every object listed starts where its entry says (number and generation) and that the trailer's `/Root` is present. It then resolves the signature dictionary in that revision: it must be a plain (type 1) object, and the excluded byte span must lie inside it, right after `/Contents`. A bare `%%EOF` no longer counts. Anything unparseable, inconsistent or unsupported gives `coverage: 'not-established'` (status `indeterminate`), with the reason in `coverageDetail`. CMS integrity is still reported separately. Tests: whole-file and earlier-revision signatures stay `valid`. Two tampered files are re-signed so their CMS is valid: one whose `startxref` still ends in `%%EOF` but points into an object, and one whose signed cross-reference marks the signature dictionary as free. Both are `indeterminate`.
- **P2 named destinations.** Before pages are copied, `resolveNamedLinks` turns links that name their target into explicit destinations. It covers `/Dest` and GoTo `/D`, strings looked up in the `/Names /Dests` name tree (nested, with `/Limits`) and names in the catalog `/Dests` dictionary, including `{ /D [...] }` values, and keeps the view parameters. Each link gets its own copy of the array. The existing remapping then follows reordered targets and drops links to pages left out. Test: three named links across both catalogs, reordered and with the target page excluded; the test fails without the fix.
- **P2 stale verification.** Signature checks go through `latestOnly()` (`apps/desktop/src/renderer/latest.ts`): only the most recently started check may set the panel or show an error. Changing the source or unmounting cancels the one in flight. Trust and untrust re-checks call the current verifier through a ref, so they check the document open at that moment, not the one open when the button was pressed. Unit test: two requests resolved in reverse order, a stale rejection, and a cancelled request.

## Defensive review (2026-11-14, Codex)

Reviewed `950fcf3`. Scope included the previous fixes and new filesystem, scanner, and export flows. Source review only. Runtime tests and suggested fixes are pending.

The previous three findings have corresponding changes: structural signature checks, named-destination resolution, and stale-verification cancellation. The first item below identifies a remaining limitation in the structural checks.

### P1 — Enforce the reMarkable import folder boundary on the resolved file

**Finding.** `openExport` authorizes paths with a lowercased string prefix and then opens the original path. This ignores the target of filesystem links and junctions and treats distinct directories as equivalent on case-sensitive filesystems. The open IPC accepts a path independently of the listing, so the listing's entry filters do not enforce that boundary. This is an IPC authorization issue. The review did not establish reachability from a PDF alone.

**Suggested fix.** Keep file selection in main using opaque IDs bound to the selected folder and requesting window. Canonicalize the folder and candidate, use platform-aware containment, and validate the actual opened file as a regular PDF within the authorized root. Account for path changes between validation and open. Invalidate selections when the folder changes.

Import authorization · IPC handler

### P2 — Preserve existing files when exports fail

**Finding.** Both export paths write directly to final destinations. If a write fails after the file is opened for replacement, an existing file can be truncated. A multi-page export can also leave completed pages on disk while returning a generic error that omits which files were written.

**Suggested fix.** Reuse the safe PDF writer for each export. Reserve batch names against both disk and the rest of the batch, honor Keep Both at write time, and report partial success with completed paths. Test a simulated write failure with an existing destination and another failure after the first page in a batch.

Single-file export · Batch export

### P2 — Distinguish the end of a scan from a feeder error

**Finding.** After the first page of a feeder scan, the PowerShell transfer loop handles every exception as end-of-input. A paper jam or device error midway through scanning can return an incomplete document as a successful scan. The JavaScript side already distinguishes empty feeder, jammed, and busy errors, but never sees the swallowed error.

**Suggested fix.** End successfully only for the documented empty-feeder result. Propagate other errors and explicitly identify partial pages if offering to keep them. Clean up failed scan jobs. Test normal feeder completion and a jam after the first page using a stubbed scanner response.

Feeder loop · Error handling

### P2 — Resolve signature coverage through the signed revision's object graph

**Finding.** The structural verifier checks that the root object number is listed, but does not resolve it to a catalog and confirm that the signature field is reachable from that revision's AcroForm. It also skips validation of compressed object entries and uses a text search to locate the end of the signature object. A structurally incomplete result can still be described as established revision coverage.

**Suggested fix.** Resolve the root with the expected generation and type through the signed revision's cross-reference data, validate the relevant object stream entries, and require reachability of the signature value from the revision's form tree. Bind the excluded bytes to the parsed signature dictionary's own value using token spans. Report indeterminate coverage for unsupported structures, and keep integrity and trust as separate verdicts.

Revision validation

## Windows runtime validation (2026-11-14, Codex)

Tested `7f4fc17` on Windows with Node 24.19.0 and Electron 45.3.1. The desktop build and typecheck passed. In a running Electron window with an isolated profile, cancelled the blank-document dialog, created a blank PDF, and saved it through the main process using the app's test destination. The native save dialog and physical scanner were outside this run.

The full suite passed 107 of 108 tests. The focused Office conversion suite passed 4 of 5 tests and independently reproduced the same failure.

### P2 — Windows Office conversion can leave temporary document copies behind

**Observed.** The test “stops a conversion that runs too long, or is cancelled” returned the expected errors but found two new conversion directories still present after the awaited calls returned. The same assertion failed in both runs. These directories contain the job workspace where conversion stages a copy of the source document. The test uses a fake converter. Real LibreOffice and the precise lifetime of the leftover directories were not verified.

**Suggested fix.** On Windows, await process-tree termination and the child closing before deleting the job directory. Preserve the original cancellation or timeout error and make cleanup failures observable without logging document names or contents. Confirm on a normal Windows runner that timeout and cancellation each leave no job directory when the call resolves. The existing test already checks the combined outcome. Add a Windows CI run so cleanup remains covered.

Windows conversion cleanup · Failing regression

### Resolution (2026-11-14)

All five findings were confirmed against `950fcf3` / `7f4fc17` and fixed.

- **P1 reMarkable folder boundary.** The page no longer names files. `listExports` gives each PDF a random id, valid only for the window that listed it and for the folder it came from; `remarkable-open` takes only that id. Changing or clearing the folder forgets all ids. Opening resolves the real folder and the real file (`realpath`, so links and junctions are followed), checks containment with `path.relative` (the platform's own rules: case-insensitive on Windows, exact elsewhere; a name prefix is not containment), opens the file, checks it is a regular file, then resolves the path again and requires the same file (`dev`/`ino`) before reading through the open handle. Listing skips links and junctions entirely. Tests (`apps/desktop/test/remarkable.test.ts`): open by id, raw paths and unknown ids refused, another window's id refused, stale id after a folder change refused, a junction inside the folder not listed, and a listed subfolder swapped for a junction to a private folder after listing refused.
- **P2 export writes.** Single exports go through `writeFileSafely` (temporary file, flush, rename). Batches go through `writeBatch` (`exportwrite.ts`). "Replace" uses the safe writer per file. "Keep both" creates each file exclusively (`wx`), reserves names against both the disk and the rest of the batch (compared case-insensitively), and moves on to the next number if a name is taken between the check and the write. A failure stops the batch and reports the file that failed and the files written before it. Tests (`exportwrite.test.ts`): a failed replace leaves the existing file and no temporary file, a failed create removes its partial file and never overwrites, numbering past names on disk and in the batch, a name taken at write time, and a failure after the first page.
- **P2 feeder errors.** The scan script no longer decides. It always reports the pages it saved and the error (message and HRESULT) it stopped on. In `scan()`, only `WIA_ERROR_PAPER_EMPTY` after at least one feeder page is a finished scan. Any other error is reported with the explained message. Pages saved before it are returned separately as `partial` and the Scan dialog asks whether to keep them. A failed job with nothing to keep has its folder removed. Tests (`scan.test.ts`, stubbed scanner): feeder runs out after three pages (success), jam after the first page (error plus one partial page), feeder empty at the start, busy, and flatbed offline (errors, job folder removed), and a cancelled flatbed scan.
- **P2 signature object graph.** `checkSignedRevision` now reads objects through the signed revision's own cross-reference, including compressed objects. Every type 2 entry is validated: its stream must be a type 1 `/ObjStm` of the revision, the index must be in range, and the object number at that index must match. The root must resolve to a `/Catalog` with the right generation. The signature must be reachable from that catalog's `/AcroForm /Fields` (through `/Kids`), either as the field's `/V` reference or as an inline `/V` of the field object. The excluded bytes are bound by tokens: a small tokenizer (comments, literal and hex strings, names, nested dictionaries and arrays, references) reads the signature dictionary and requires exactly one top-level `/Contents`, a hex string whose span equals the gap. This replaces the `endobj` search. Tests (`revision.test.ts`): a re-signed revision whose form does not list the field, with a later unsigned update adding it (indeterminate, "not part of the form"); the test fails without the reachability check. Tokenizer cases: nested `/Contents`, comments and escaped parentheses before it, duplicate keys, non-hex value, no value, not a dictionary.
- **P2 Windows conversion cleanup.** On timeout or cancellation, `run()` now stops the process tree (`taskkill /T /F` on Windows), waits for it to finish and for the child to close (at most 15 s), then rejects with the original error, so the work folder can be removed. A folder that still cannot be removed is logged without the document name (the folder name is random), kept, and retried on the next conversion and when the app quits. The conversion test now checks for leftovers right after the timeout and again after the cancellation. CI runs on `windows-latest` as well as `ubuntu-latest`. The scan tests are skipped off Windows, where scanning is not offered.

## Browser extension review (Codex)

Reviewed `206b13b` by reading the extension source, manifest and tests. Chrome and Edge runtime behavior was not verified.

### P1 — Bind credentialed PDF fetches to an authorized navigation

The viewer is web-accessible on all origins and takes its fetch destination directly from its URL. It fetches that destination with credentials and broad host permissions. This makes an extension-initiated request possible without confirming that the browser first identified a PDF navigation. The source review establishes the missing authorization check. Cookie behavior and cross-origin response exposure were not verified.

Use a main-frame navigation handoff bound to the originating tab and approved URL, or require an explicit user action for direct viewer launches. Keep the viewer top-level and scope credential use to authorized loads. Add a browser test confirming that direct or embedded viewer launches without an authorized handoff make no request.

Manifest · Viewer fetch

### P2 — Keep native-viewer fallback working across worker restarts

The session bypass rules persist across service worker restarts while the in-memory rule counter resets to 1000. A new bypass can collide with a rule already installed. The viewer silently does nothing when registration fails. The rule also applies to other tabs for the rest of the session.

Use tab-scoped session rules with deterministic replacement or IDs allocated against existing state. Retire stale rules and display a clear error if registration fails. Test repeated fallback after stopping and restarting the worker, and confirm that a separate tab retains its expected routing.

Bypass registration · Viewer fallback

### P2 — Handle invalid address encoding inside the parser

The percent-decoding step runs outside the exception handler. Invalid encoding throws during render and skips the intended missing-address error UI.

Move decoding into the guarded parser and return null for invalid input. Extend the parser tests to verify that malformed encoding reaches the normal error UI without a request.

Address parser

### P2 — Bound memory use and clean up failed print jobs

Printing holds a rendered image and object URL for every page until the dialog closes. Large page dimensions and long documents have no cumulative budget, and the error path leaves previously allocated URLs alive. A failed decode can also leak the URL created for that page before it is attached.

Bound per-page dimensions and total print work, offer a page range for larger jobs, and track all URLs as soon as they are created. Release them on failure, cancellation, or completion. Test a mid-job renderer failure and a print job above the configured budget.

Print pipeline

### Resolution (2026-11-14)

- **P1 authorized loads.** The viewer loads a PDF only with a grant from the background worker. A grant is made when `webRequest.onBeforeRedirect` sees the browser redirect a tab's main frame from an address to `viewer.html?file=<that address>`, or when the worker itself sends a tab to a local file. Grants are kept per tab in `chrome.storage.session` and end when that tab commits any other page. The viewer claims its grant with the address it shows; the worker checks that the sender is the viewer in the tab's main frame and that the addresses match (compared without the `#fragment`). Without a grant the viewer makes no request and asks **Open this PDF?**, showing the address; agreeing navigates the tab to that address, so the browser's own rules decide again. Inside a frame the viewer refuses to load. New `webRequest` and `storage` permissions are documented.
- **P2 native-viewer fallback.** Each tab has one session rule (`id = 1000 + tabId`, `condition.tabIds = [tabId]`) that is replaced, not added, and removed when the tab closes. If registration fails, the viewer shows the browser's error instead of doing nothing.
- **P2 address encoding.** Decoding moved into `sourceFromLocation`'s guarded block (now `apps/browser/src/address.ts`, shared with the worker); malformed encoding returns null and shows the normal "No PDF address" message.
- **P2 print memory.** Pages render at 150 dpi, capped at 16 megapixels and 8192 px per side. Each job is capped at 250 megapixels (about 118 letter pages); larger documents ask for a page range, suggesting the first range that fits and refusing ranges above the budget. One canvas is reused, every object URL is tracked as soon as it is created, and all are revoked on failure, on **Cancel**, or after the print dialog closes.
- **Tests.** Unit tests cover malformed encoding, page scale caps, the budget and range parsing. A headless Chrome 157 run (temporary profile, local test server) checked:
  - Direct, scripted, framed and after-navigating-away launches make no request.
  - Reload keeps working, and agreeing to open loads the PDF.
  - Server redirects and `#page=` still open.
  - A 200-page print asks for a range, refuses 1-200 and prints 1-3. A cancel half-way and a failure on page 3 leave no images and revoke every URL.
  - After the worker was stopped, a second tab with the same address still opened in Oakqueill. The fallback then worked in that tab and again, for a new address, in the first tab.

## Whole-app follow-up review (2026-11-14, Codex)

Reviewed `0a9da00` by inspecting the extension patches and selected desktop, core, CLI, and release paths. No runtime tests were run for this revision. The earlier extension findings have corresponding changes for navigation grants, tab-scoped bypass, malformed address handling, and print cleanup and budgeting.

### P1 — CLI redaction can write a copy with the marked content still visible

The core validates page bounds but can accept a rectangle entirely outside the rendered page. The burn loop then paints nothing. The CLI writes the result without using the coverage check called by the desktop app. A successful exit can therefore leave the content visible on the rasterized page.

Reject non-finite coordinates, invalid dimensions, and marks with no visible intersection in the core. Require CLI coverage verification before writing. Add regression checks for off-page coordinates and valid marks on rotated and cropped pages. Confirm failure leaves the output absent or preserves any existing destination.

Core redaction · CLI redaction

### P2 — Browser PDF loading has no response size limit

The viewer buffers the entire response before parsing, with no declared or observed byte cap. The new print limits apply after loading and do not constrain this allocation. A large PDF or an unexpectedly large response can exhaust the viewer tab's memory.

Cap the streamed response by bytes actually received, use the declared length for an early rejection when available, and abort on cancellation or when the budget is exceeded. Provide a recovery action. Test both an oversized declared response and an over-budget stream with no declared length.

Browser fetch

### P2 — CLI output writes can truncate an existing file on failure

The shared output helper writes directly to the final path. A write failure after opening the file can destroy the previously saved output, including the source if the user chose the same path. The desktop already uses a safer replacement strategy.

Stage the output in the destination directory and replace only after a successful write. For split, report completed paths when a later part fails. Test a simulated write failure against an existing destination.

CLI output helper

### Windows test results for the whole-app follow-up

Tested `704c5df` on Windows with Node 24.19.0 and Electron 45.3.1.

- `npm run check` passed typechecking and all 129 tests in 23 files. The previously failing Windows Office conversion timeout and cancellation cleanup test passed.
- `npm run build` passed for core, CLI, desktop and browser extension.
- In the running desktop app with an isolated profile, cancelled the blank-document dialog, created a one-page PDF and saved it using the test save destination. The CLI reopened it, merged two copies, and reported two pages in the output.

The browser extension was built and its unit tests ran. Chrome and Edge integration, the native save dialog, and the three latest review findings were outside this runtime run.

## Stress-test review (Claude)

Reviewed at `0a9da00` by running targeted probes and about 2,100 fuzzed operations against the built core library (`packages/core`), plus reading the Electron main process, preload and browser extension. The Electron GUI and the extension in Chrome were not run, so items marked "code reading" are not confirmed at runtime.

**Re-check (2026-11-14, before the fixes below):** the core library was rebuilt from the current source and the high-severity and signature probes were re-run. The `packages/core` and `apps` sources have no changes since `7c8a555`, and all findings below still reproduce. They are open.

### P1 — A crafted PDF can freeze the app

pdf-lib loops without a cap on cross-reference-stream `/W` widths, `/Index` and `/Size`. A 1.9 KB PDF with one form field and one unreferenced junk object after `%%EOF` (`/Type /XRef /W [1 99999999999 1]`) opens normally in pdf.js. `listFormFields` and `getInfo` never return (killed after 20 to 30 s). `/W [1 1000000000 1]` takes about 12 s, and huge `/Index` or `/Size` values take 12 to 13 s.

The desktop app calls `listFormFields` in the main process when pdf.js reports form fields (`App.tsx:764`, `main.ts:389`). Save, Sanitize, Inspect and preview also load through pdf-lib. The library hang is measured. The main-process freeze is inferred from the code.

Bound or pre-scan those values before pdf-lib sees them, or run core in a worker or utility process with a timeout.

### P1 — "Remove Hidden Information" leaves JavaScript and reports clean

`RISKY_ACTIONS` is checked only on the first `OpenAction` action and on annotations. JavaScript in a `/Next` chain on a GoTo `OpenAction` and in an outline item's `/A` survives sanitizing. Both payload strings were still in the output bytes. `inspectDocument` does not see either, so the fail-closed re-inspect in `main.ts` passes. pdf.js here does not run JavaScript. The risk is to recipients using Acrobat.

Walk `/Next` chains and the outline tree, scanning every action.

### P1 — Redaction leaves the secret in annotations and form values on pages with no mark

After redacting an SSN on page 1, a sticky note and a form field value on page 2 still held it (2 objects). `verifyRedaction` reported 0 remaining because it searches only page text. `docs/REDACTION.md` says the secret must be absent from annotations and form values.

Make the check cover annotations, form values and metadata, and strip or warn on unmarked pages.

### P2

- **Save fails for long names.** The temp name adds 27 characters (`files.ts`), so file names of about 229 characters or more fail with a confusing `ENOENT`. Lengths 230 to 255 were proven to fail and 200 is fine. Derive the temp name from a short random id instead.
- **One bad `/ByteRange` loses the whole signature report.** A non-number entry throws `TypeError: ...asNumber is not a function` (`signature.ts`) and `verifySignatures` returns nothing. Reproduced again. Validate each entry and report that signature as invalid.
- **Extension fallback id collision.** Resolved for the per-tab fallback in `0a9da00`. Not re-tested.
- **IPC trusts the renderer (code reading).** `docedit:save` accepts a renderer-supplied `path`. `docedit:trust-cert` adds a trust anchor with no native confirmation. `docedit:cert-sign` interpolates an unvalidated `rect` into a content stream. Sandbox, context isolation and CSP are otherwise sound, so this matters only if the renderer is compromised.
- **Backdated certificates (code reading).** Chain trust is evaluated at the signer-claimed `/M` time (`signature.ts`), so an expired certificate can be backdated.
- **`mailto:` links pass the gate with query strings** such as `attach=`. The URL is shown in the confirm dialog. Mail client behavior was not tested.

### P3

- About 180 of 2,100 fuzzed operations ended in raw internal errors such as `Cannot read properties of undefined (reading 'Pages')`. Two cases produced an unhandled promise rejection, and Electron's handling was not checked.
- `applyRedactions` returns success for a NaN rect or a fractional page index without redacting. The app's coverage check would catch it. `splitPdf` with `every` 0 throws a raw `RangeError`, and with -1 returns an empty list.
- All core work blocks the main process at about 0.7 ms per page, so an 8,000-page document stalls it for about 7 s.
- There are no caps on decompression or PNG size. A 400 MB inflate took 3.4 s and 480 MB of memory, and an 8000×8000 PNG took 3 s. `zip.ts` has no zip64 support (code reading).
- `docedit:create` page count is not validated at the IPC boundary. The UI caps it at 1000.

### Checked and fine

`npm audit` (0 vulnerabilities), typecheck, 125 tests, window navigation lock and CSP, the reMarkable folder boundary, export write safety, no crash recovery for password-protected documents, page-tree loops (clean `RangeError`), NaN edits (clean error) and the extension CSP (pdf.js 4.10 has no wasm).

### Not covered

Electron GUI run, the extension in Chrome, the scanner and LibreOffice conversion.

### Resolution (2026-11-14)

The three P1 findings and two P2 findings above were fixed. The earlier "still open" re-check applies to `0a9da00`, before these changes. All 136 tests pass (11 new in `packages/core/test/hardening.test.ts`) and typecheck is clean. The original repro files now behave as described below.

- **P1 freeze.** New `guard.ts` (`assertSafeStructure`) runs before every pdf-lib load in `loadDoc`, `isEncrypted`, `signPdf` and `verifySignatures`. It scans the bytes as text and refuses cross-reference `/W` field widths above 8, `/Size` above 8,388,608 and `/Index` ranges above that, with an `InvalidPdfError`. The 1.9 KB repro is now refused immediately (it hung past 20 s). The guard is a regex pass over 16 MB chunks, so it cannot loop. Side effect: a file like that now opens in the viewer but is refused for forms, saving and editing. Running core in a worker or utility process with a timeout is still worth doing for hangs this guard does not predict.
- **P1 hidden actions.** `riskyInChain` follows `/Next` (dictionary or array form, with a visit cap) and `walkOutline` visits every bookmark (loop-safe, capped at 100,000). `inspectDocument` now reports scripts behind an open action's `/Next` and in bookmarks. `sanitizeDocument` removes them, including `/AA` on bookmarks. Both payload strings are gone from the sanitized bytes and the re-inspect is clean.
- **P1 redaction leftovers.** `applyRedactions` takes `secrets`. On unmarked pages, any annotation or form widget whose text (contents, rich text, value, default value, title, subject, and the same keys on its field ancestors) contains a secret is removed. The desktop app and the CLI (`--text`) pass their secrets. `verifyRedaction` now also searches annotations and form values on every page and reports `where: 'annotation'`. Limit: text that appears only inside an appearance stream, with none of those keys set, is not detected, and `--regex` redactions in the CLI pass no secrets. `applyRedactions` also now rejects a fractional page index and a non-finite rectangle instead of silently skipping them.
- **P2 `/ByteRange`.** A non-numeric entry no longer throws. The signature is reported invalid with "The signed byte range is malformed." Non-integer entries are rejected the same way.
- **P2 long file names.** The temporary file in `writeFileSafely` is now `.<16 hex>.docedit-tmp`, independent of the target name, so names up to the file system limit save.

Still open: unvalidated IPC arguments, backdated certificate trust, `mailto:` query strings, raw internal errors from fuzzed input, main-process blocking on very large documents, and the missing decompression and image size caps.

### Resolution, second pass (2026-11-14)

Most of the remaining items were fixed. All 152 tests pass (13 new in `packages/core/test/limits.test.ts` and 3 in `apps/desktop/test/links.test.ts`) and typecheck is clean.

- **IPC: save path.** `docedit:save` saves in place only to a document the main process itself opened or saved in this session. That means files from the open dialog, a drop, the command line, a reopened copy or an earlier save. Any other path from the page brings up the save dialog, with that path filled in. Limit: a recovered document's path comes from the recovery file the page wrote, so the first save after recovery asks for the location once.
- **IPC: trusting a certificate.** `docedit:trust-cert` now asks the user itself, in the main process's prompt window. It reads the name, issuer, expiry and SHA-256 fingerprint from the certificate, and adds it only on **Trust certificate**. Removing trust needs no question. The renderer no longer shows its own confirmation.
- **IPC: signature box.** `signPdf` refuses a page that is not a whole number, and a box whose values are not plain finite numbers within ±14,400 points (or a negative size), before anything is written into the content stream.
- **IPC: new document.** `docedit:create` checks the page count (1 to 1,000, as in the dialog) and page size in the main process.
- **Backdated certificates.** Trust is now checked at the time of verification. A chain that is valid only at the signer's stated `/M` time reads as not trusted, and the reason is shown in the Signatures panel (`trustDetail`).
  - Found while testing: a self-signed certificate the user had chosen to trust was never reported as trusted. The chain engine accepts only CA certificates as anchors, and the app's own confirmation promised the opposite. The signer's own certificate in the trusted list now counts directly while it is valid.
- **`mailto:` links.** Only `to`, `cc`, `bcc`, `subject` and `body` are passed to the mail program. Other fields (`attach=` and similar) are removed, and the question says which ones were removed (`links.ts`).
- **Raw internal errors.**
  - `loadDoc` refuses a file with no page tree with `InvalidPdfError`, instead of failing later with `Cannot read properties of undefined (reading 'Pages')`.
  - `splitPdf` refuses a page count per file that is not a whole number of at least 1, and an empty range list.
  - Other fuzz-only errors were not re-run.
- **Image size.** PNGs over 80 megapixels are refused from their header, before decoding, wherever images are embedded: image-to-PDF, image edits, visual signatures and stamps. JPEGs are copied into the PDF without being decoded.

Still open: main-process blocking on very large documents (running core in a utility process with a timeout would also cover hangs the structure guard does not predict), decompression limits inside pdf-lib's stream decoding, and zip64 in `zip.ts`. The Electron GUI was not run for these changes; they are covered by unit tests and typecheck.

## Resolution: whole-app follow-up and remaining stress-test items (2026-11-14)

All three findings of the whole-app follow-up review and the remaining stress-test items were addressed. Typecheck is clean, all 165 tests pass, and every package builds.

- **P1 CLI redaction.** `applyRedactions` refuses marks with zero or negative size and marks with no part on the visible page, measured with the coverage check's own pixel mapping. This handles crop boxes and rotation. Before writing, `docedit redact` runs `checkRedactionCoverage` on every mark and searches the result for `--text` (`verifyRedaction`) and for `--regex`. On any failure it writes nothing and exits 1.
  - Tests: off-page, outside-the-crop-box, zero-width and negative-height marks; valid marks on cropped and rotated pages.
  - CLI run: an off-page `--box` exits 1 and the existing output is unchanged.
  - Found while doing this: the secret matching for annotations normalised with `/s+/g` (the letter s) instead of `/\s+/g`. Fixed.
- **P2 browser download size.** `readCapped` (`apps/browser/src/download.ts`) refuses a declared `Content-Length` over 300 MB before reading. It also stops a stream as soon as more than that has arrived, which covers a missing or understated length. Leaving the page aborts the download. The error offers the browser's own viewer. Tests cover a declared oversize, an undeclared overrun, an understated length, cancellation and a normal body.
- **P2 CLI output.** All CLI outputs go through `writeSafely`: a temporary file in the destination folder (`wx`, flushed), then a rename. A failure removes the temporary file and leaves an existing destination, including the input, untouched. `split` names the parts already written when a later part fails. Tests cover replacement and a failed write against an existing file.
- **Main-process blocking and parser hangs.** PDF work moved out of the main process into a document worker (`coreworker.ts`, an Electron utilityProcess):
  - The work covered: save and preview layout, split, protect, decrypt, inspect, clean (with its fail-closed re-inspect), form fields, signature checks, and images or text to PDF.
  - `corework.ts` gives each job 2 minutes. A stuck worker is killed and that job fails with a plain message. Other jobs it held are retried once in a fresh worker, and a crashed worker fails only its own jobs.
  - Signing stays in the main process, because its key cannot leave it, and is protected by the structure guard.
  - Run in the real Electron app (unpackaged, temporary profile, 3 s test limit):
    - Normal inspect, form-field, signature and save jobs worked.
    - IPC round trips stayed at 0 to 14 ms during a 1.4 s job.
    - A 5.6 s parser stall (a `/Size 8000000` cross-reference stream, under the guard's cap) was stopped at 3.0 s with the message, and the next job ran in a new worker.
    - The same run confirmed that a save request for a path the session never opened went through the save dialog.
- **Decompression.** There is still no byte cap inside pdf-lib's stream decoding. A file that expands enormously now costs only the worker: it is stopped by the time limit or crashes alone, and the app and its windows keep running.
- **ZIP.** The .docx writer refuses more than 65,535 parts or sizes over 4 GB with a clear error, instead of writing wrapped-around sizes. zip64 itself was not added, since Word does not open a .docx that large and the page cannot hold one.

Not run: the packaged installer build with the worker inside `app.asar`, the extension in Chrome with a real 300 MB file, and the Electron GUI by hand.

## Windows and macOS desktop review (Codex)

Reviewed Windows `e517528` and the macOS Electron app on `platform/apple` at `8055a56`. This was a static review of shared desktop flows and platform integration. The iOS app and browser extension are outside this review. No new runtime or package validation was performed.

### P1 — Opening from Finder can discard unsaved changes

The Apple branch delivers Finder and Dock opens to the renderer's `onOpenFile` callback. That callback replaces the current document directly. The in-app picker uses `confirmDiscard`, but the Finder path skips it, so opening another PDF while editing can discard work and clear its recovery state.

Route external opens through the same unsaved-changes guard as the picker. Test opening from Finder with an edited document, including cancelling the switch and retaining the recovery snapshot.

Finder handler · Renderer subscription

### P2 — Multiple Finder opens race to replace the same document

The main process drains all pending paths into concurrent reads. Each result triggers its own replacement in the same renderer. Completion order determines what stays open, and earlier documents can disappear without being seen.

Process open requests in order through a single replacement flow, or create a separate document window per file. Test selecting multiple PDFs in Finder and opening them while the app is closed and while another document is active.

Pending opens

### P2 — Split can overwrite a file created after the collision check

Split chooses available names before arranging and encrypting each part, then writes with a replacement helper. Another save or sync operation can create the chosen name in between. Even the Keep Both path can then replace it.

Reuse the batch export writer's exclusive-create mode unless the user explicitly selected Replace. Add a test where the destination appears after name selection.

Split writer · Exclusive-create helper

### P2 — Worker restart can strand pending requests if resubmission throws

The timeout handler clears timers and removes all pending jobs before resubmitting them. The resend loop has no error handling around worker startup or message dispatch. If either throws, the loop stops and remaining callers can stay busy indefinitely.

Make dispatch settle its own failed job and clear its bookkeeping. Test a timeout followed by a restart or dispatch failure and verify every pending promise settles.

Worker dispatch and timeout

### macOS release validation

The Apple workflow builds universal artifacts with an ad-hoc signing identity. Treat these as test builds. There is no Developer ID signing, notarization, or packaged launch test in this workflow. Before public distribution, validate the downloaded package and the document worker on Apple Silicon and Intel, and add a release job for signing and notarization.

Apple workflow · macOS package configuration

### Response to the Windows and macOS review

All four findings are fixed on `platform/apple`; the release validation item is covered by the new macOS release workflow.

- **P1, Finder opens discarding changes.** A PDF handed to the app by the system never replaces an open document. `openRouting.ts` picks a window that has no document and is not already promised another file; otherwise `main.ts` opens a new window for it. The unsaved-changes guard of the picker is not needed because nothing is replaced. Tested: `openRouting.test.ts`.
- **P2, several Finder opens racing.** Each file gets its own window (or the empty one) in order, claimed before any file is read, so completion order no longer decides what stays open. The claim is released when the document shows or the read fails. Tested at the routing level; not run by hand in Finder.
- **P2, Split overwriting a late file.** Without an explicit Replace each part is created exclusively (`writeUniqueFile`), and a name that appears after the check moves on to the next number. Replace still replaces. Tested: three cases in `exportwrite.test.ts`, including the destination appearing after name selection.
- **P2, worker restart stranding requests.** `send` now settles its own job if starting the worker or posting to it throws, and killing the old worker cannot abort the resend loop. Tested: `coreworker.restart.test.ts` fakes a stuck worker followed by one that cannot start; it times out (jobs never settle) on the previous code and passes now.
- **macOS release validation.** `.github/workflows/release-macos.yml` signs with a Developer ID, notarizes, staples and verifies; see `docs/MACOS_RELEASE.md`. The Apple workflow's builds remain test builds. It has not run, and the packaged launch on Intel was not tested.

Not run: Finder opens in the real app (several files at once, with an edited document open), and the release workflow.

