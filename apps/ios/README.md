# Oakqueill for iOS (iPhone and iPad)

A small SwiftUI app that runs the desktop renderer in a `WKWebView`. Nothing here is a second implementation of the
editor: the page is the desktop React UI (`apps/desktop/src/renderer`) built with an iOS bridge in front.

```
apps/ios/
  web/          @docedit/ios-web   Vite build: bridge.ts (window.docedit), coreWorker.ts (document Web Worker), ios.css
  Oakqueill/    Swift sources, Info.plist, assets; Web/ is the generated page bundle (not committed)
  Oakqueill.xcodeproj
```

## How it fits together
- `web/src/bridge.ts` implements `window.docedit` (`apps/desktop/src/shared/api.ts`). PDF work runs in a module Web Worker
  (`coreWorker.ts`, same operations as the desktop's document worker, 2-minute job limit). Settings and signatures live
  in `localStorage`, crash-recovery snapshots in IndexedDB.
- `NativeBridge.swift` does only what needs the system: document pickers, saving (in place with security-scoped access,
  or through the export picker), folders, printing, and opening web/email links after showing the address.
- `WebHost.swift` serves the bundle from the app through an `oakqueill://app/` URL scheme (ES modules and workers do not
  load from `file://`) and refuses any other navigation. PDFs handed to the app (Files, share sheet, "Open in") arrive as
  `onOpenURL` events.

## Build and run in the simulator
```bash
npm install
npm run ios:sim        # builds the web bundle, then the app (no code signing)
```
Then install `apps/ios/build/Build/Products/Debug-iphonesimulator/Oakqueill.app` with `xcrun simctl install`, or open
`apps/ios/Oakqueill.xcodeproj` in Xcode (run `npm run ios:web` first so `Oakqueill/Web` exists).

Debug builds accept launch arguments for testing: `-OpenFile /path/to.pdf` opens a file at start, `-SelfTest YES` runs
the worker and redaction end to end (reorder, rotate, encrypt, decrypt, then redact a secret and run the app's four byte-level checks) and logs `OAKQUEILL-SELFTEST PASS ...`.

## Not available on iOS (yet)
Scanning (Windows only), Word/Office conversion (needs LibreOffice), signing with a `.p12`
certificate. Those features are hidden or answer with a clear message. Redaction runs in the page with the pdf.js rasterizer (verified in the simulator by the self-test)
and should still be tried on a real device and with large pages before you rely on it.

## Releasing
Running on a device and TestFlight/App Store need an Apple Developer account (team, signing, privacy manifest).
Bundle ID is `app.docedit.ios`, minimum iOS 17.
