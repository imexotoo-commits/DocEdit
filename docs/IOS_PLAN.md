# iOS plan (branch `platform/apple`)

Status: spike done and running in the iOS Simulator (see `apps/ios/README.md`): the desktop renderer in a WKWebView, the core in a Web Worker, file pickers/saving/printing/links in Swift. Remaining work is listed under "Work order".
macOS ships first (see README, "Build the macOS app").

## Why Electron cannot go to iOS
`apps/desktop` is Electron: a Node main process, a utility-process worker and a Chromium renderer. iOS has none of
those. What carries over is (a) `@docedit/core`, which is pure TypeScript, bytes in and bytes out, and (b) the React
renderer, which only touches the outside world through `window.docedit` (`apps/desktop/src/shared/api.ts`).

## Recommended approach: native shell, web engine inside
A small SwiftUI app hosts the existing renderer in a `WKWebView` and implements `window.docedit` in Swift. A bundled
JavaScript build of the core runs in a Web Worker inside that web view, so PDF work never touches the UI thread.

| Piece | iOS implementation |
| --- | --- |
| UI | `apps/desktop/src/renderer` reused, plus a touch layout (bigger hit targets, bottom toolbar, no hover menus, sheet-style dialogs, safe-area insets). |
| `window.docedit` bridge | `WKScriptMessageHandlerWithReply` in Swift, same typed surface as `shared/api.ts`. A new `apps/ios/bridge` package would hold the iOS side of the typings. |
| Core worker | Core bundled with esbuild into a worker script, loaded from the app bundle. Replaces the Electron `utilityProcess` (`coreworker.ts`, `corework.ts`). Keeps the 2-minute job limit. |
| Rasterizer (redaction) | Core's `Rasterizer` interface is the seam. Implement it with pdf.js and an `OffscreenCanvas` in the web view first. If memory is a problem on big pages, move it to a Swift implementation on PDFKit or CoreGraphics. |
| Files | `UIDocumentPickerViewController` and security-scoped bookmarks; open-in-place from Files; "Open in" and share sheet; atomic saves (write temp, then replace). |
| Printing | `UIPrintInteractionController`. |
| Signatures, settings, recovery | App sandbox `Application Support`, with `NSFileProtectionComplete` on signatures and recovery data. |
| Scan | `VNDocumentCameraViewController` (replaces the Windows-only scanner code). |
| Office conversion | Not available on iOS (no LibreOffice). Hide that feature; keep import of an already-exported PDF. |
| Cryptographic signing | Same status as desktop (designed, not built). Private keys would live in the Keychain / Secure Enclave. |

## Alternatives considered
- **Fully native (SwiftUI + PDFKit)**: best feel and size, but it rewrites the viewer, organizer, edit model and
  redaction UI, and PDFKit's annotation model would diverge from the core's. Possible later for the viewer only.
- **Capacitor / Tauri mobile**: adds a framework and its supply chain for a bridge we can write in about 300 lines of
  Swift. It also complicates the clean-room dependency log (`docs/LICENSES.md`).
- **Mac Catalyst**: a Mac build of an iPad app. Not needed, since Electron already covers the Mac.

## Work order
1. **Spike (small):** Xcode project in `apps/ios`, `WKWebView` loading the built renderer, a stub `window.docedit` that
   can open a PDF from Files and show it. Proves pdf.js, workers and CSP under `WKWebView`.
2. **Core in a worker:** bundle `@docedit/core` for the browser. `text.ts` has a guarded Node font-path lookup and the
   renderer build already warns that `node:path` and `node:module` are externalized. Remove or stub those for the web
   bundle. Run the existing core tests against the bundle in a browser-like environment.
3. **Bridge parity:** open, save (safe write), recovery, settings, signatures, print. Port the unit tests that cover
   `shared/api.ts` behavior.
4. **Touch layout:** phone and iPad size classes, gestures (pinch zoom, long-press menus), keyboard avoidance.
5. **Redaction on device:** run the byte-level redaction tests on-device or in the simulator; check memory on large
   pages. Keep redaction disabled on iOS until the verification tests pass there.
6. **Release plumbing:** bundle ID, privacy manifest, App Store or TestFlight signing (needs an Apple Developer
   account), file type declarations for `com.adobe.pdf` open-in-place.

## Decisions taken (autonomously, change if wrong)
- Universal app (iPhone + iPad), minimum iOS 17, simulator-only until an Apple Developer account exists.

## Decisions still needed
- Phone, iPad, or both for the first release? (Recommendation: iPad and iPhone from one universal target, iPad layout first.)
- Is an Apple Developer account available for TestFlight? Without one the app runs only in the simulator and on
  your own device via a free provisioning profile (7-day expiry).
- Minimum iOS version. (Recommendation: the current release minus one.)

## Clean-room notes
Apple frameworks (WebKit, PDFKit, VisionKit, UIKit) are platform APIs, not third-party PDF code. Record any new
dependency in `docs/LICENSES.md` and any new source in `docs/PROVENANCE.md` before merging.
