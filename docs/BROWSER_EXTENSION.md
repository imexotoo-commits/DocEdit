# Oakqueill PDF Viewer (browser extension)

Opens PDFs in your browser with an Oakqueill viewer instead of the browser's own. It is a viewer, not the editor: page
navigation, zoom (in, out, fit width, fit page), rotate view, find, page thumbnails, links, print and save a copy.
Password-protected PDFs ask for the password, which is used only to show the file.

It runs in **Chrome, Edge, Brave, Opera, Vivaldi and Arc** (all Chromium browsers share one package), in **Firefox** and in
**Safari**. The viewer page is the same everywhere; each browser has its own manifest and its own small background script,
because each has a different way of noticing that a page is a PDF (see below).

It is built from the desktop app's own pieces (`apps/desktop/src/renderer`: page viewer, page rendering, search,
icons, styles) and lives in `apps/browser`.

## Build

```
npm install
npm run build -w @docedit/browser                         # Chromium browsers  -> apps/browser/dist
npm run build:firefox -w @docedit/browser                 # Firefox            -> apps/browser/dist-firefox
npm run build:all -w @docedit/browser                     # Chromium, Firefox and the files Safari's converter takes
npm run safari -w @docedit/browser                        # the Safari app and extension (needs Xcode)
npm run dist -w @docedit/browser                          # also writes release/oakqueill-viewer-<version>[-firefox].zip
```
(In the macOS repository the same commands are `npm run ext:build`, `ext:lint`, `ext:safari` and `ext:dist`.)

## Install for testing

**Chrome, Edge, Brave, Opera, Vivaldi, Arc.** Open the browser's extensions page (`chrome://extensions`,
`edge://extensions`, `brave://extensions`, `opera://extensions`, `vivaldi://extensions`; Arc uses `arc://extensions`), turn on
**Developer mode**, choose **Load unpacked** and pick `apps/browser/dist`. To open PDFs from your own disk (`file://`), open
the extension's **Details** and turn on **Allow access to file URLs**. (Current Google Chrome ignores the
`--load-extension` command-line option, so the page above is the way to load it.)

**Firefox.** Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…** and pick
`apps/browser/dist-firefox/manifest.json`. A temporary add-on is removed when Firefox quits; a permanent install needs the
add-on to be signed by Mozilla (see Publishing). When Firefox asks about access to all sites, allow it: the viewer needs it
to see that a page is a PDF.

**Safari.** Run `npm run safari -w @docedit/browser`. It has Apple's `safari-web-extension-converter` wrap the extension in
an Xcode project (`apps/browser/safari`, generated each time, not committed) and builds it, unsigned. Then:
1. Open the built **Oakqueill PDF Viewer.app** once (the path is printed at the end).
2. In Safari: **Settings → Advanced → Show features for web developers**, then the **Develop** menu → **Allow Unsigned
   Extensions** (asked again each time Safari restarts, for unsigned builds only).
3. **Settings → Extensions**: tick **Oakqueill PDF Viewer** and set **Always Allow on Every Website**.

## Testing

- **Unit tests** (`npm test`): which responses and addresses each browser takes over (`intercept.test.ts`), and the manifest each
  browser gets (`manifest.test.ts`).
- **Mozilla's checker:** `npm run lint:firefox -w @docedit/browser` runs `web-ext lint` on the Firefox build (no errors; the
  warnings are pdf.js and React patterns, see Publishing).
- **End to end, in real browsers:** `npm run e2e -w @docedit/browser` serves PDFs from a local server with different headers,
  loads the extension and checks which ones the viewer takes over and renders. Point `CHROME_PATH` at a Chrome that still loads
  extensions from the command line (Chrome for Testing, Chromium, Edge, Brave; current Google Chrome does not) and
  `FIREFOX_PATH` at Firefox, e.g. both from `npx @puppeteer/browsers install chrome@stable` and `firefox@stable`.
  On the Chromium package in Chrome 158 all seven checks pass: PDFs served as `application/pdf` (with or without a `.pdf`
  address or a charset) and as plain bytes at a `.pdf` address are taken over and drawn; plain bytes at another address, a
  download (`Content-Disposition: attachment`) and an HTML page are left alone. The Firefox package could not be run end to
  end on the Mac this was developed on (Firefox 160 would not start under automation there), so its blocking listener is
  covered by the unit tests and `web-ext lint` only; run `npm run e2e` with `FIREFOX_PATH` on another machine to check it.
- **Safari:** the Xcode project builds (`npm run safari`). Turning the extension on and opening a `.pdf` address in Safari has
  to be done by hand (steps above); Safari offers no way to do that from a script.

## Which browser catches which PDFs

| Browser | How a PDF is noticed | Catches |
|---|---|---|
| Chrome, Edge, Brave, Opera, Vivaldi, Arc | request rules (`declarativeNetRequest`) on the response's `Content-Type` | web PDFs however the address looks; local files with file access allowed |
| Firefox (128 or later) | a blocking `webRequest` listener that reads only the response headers | web PDFs however the address looks; not local files (Firefox's own viewer opens those) |
| Safari | Safari gives extensions no response headers and no blocking listeners, so the address is used | web addresses whose path ends in `.pdf`; PDFs served from other addresses, and local files, stay with Safari's own viewer |

Everything else below (what is never taken over, the 300 MB limit, printing, privacy) is the same in every browser. "Open
in the browser's own viewer" is remembered with a request rule in the Chromium browsers and in session storage in
Firefox and Safari; in all of them it lasts for that tab until the browser closes.

## Publishing

`npm run dist -w @docedit/browser` writes the files the stores take: `oakqueill-viewer-<version>.zip` (Chrome Web Store, Edge
Add-ons and Opera add-ons all take the same Chromium package) and `oakqueill-viewer-<version>-firefox.zip` (Firefox Add-ons).
Each store needs a developer account and goes through review (Chrome charges a one-time registration fee; Edge and Firefox are
free). Notes:
- **Firefox Add-ons** asks for the source of a bundled extension: submit this repository. `web-ext lint` (run by
  `npm run lint:firefox`) reports no errors; its warnings about `eval` and `innerHTML` come from pdf.js and React, and pdf.js
  runs with `eval` switched off. The add-on id in `scripts/manifest.mjs` is a generated GUID; change it if you want an
  address-style id.
- **Safari** is distributed as an app: open `apps/browser/safari/Oakqueill PDF Viewer/Oakqueill PDF Viewer.xcodeproj` in
  Xcode, choose your team under **Signing & Capabilities** for both targets, and archive for the Mac App Store or for
  notarized distribution. That needs the Apple Developer Program.
- The extension asks for access to all sites in every browser, for the reason given under Privacy.

## Offered by the Windows installer

Like Adobe Acrobat, the Oakqueill installer can add the viewer to the browsers itself, so users don't have to find it in
a store. It uses the browsers' "external extensions" registry keys: the installer writes only the extension's store ID
(`Software\Google\Chrome\Extensions\<id>` and `Software\Microsoft\Edge\Extensions\<id>`, each with the store's
`update_url`). The browser then downloads the extension from its own store and asks the user to turn it on the next time
it starts. Browsers don't allow silent installs, and they only accept extensions that are published in their store.

- The installer shows a **Browser viewer** page with **Add Oakqueill PDF Viewer to …** ticked by default. Unattended
  installs (`/S`) don't add it unless an earlier install did.
- The keys go under HKCU for a "just me" install and HKLM for an all-users install. On 64-bit Windows the browsers read
  the HKLM keys from the 32-bit view (`WOW6432Node`).
- Updates keep the earlier choice. Unticking the box on a reinstall removes the keys, and so does uninstalling. The
  browsers then remove the viewer too.

**To turn this on after publishing:** put the IDs the Chrome Web Store and Edge Add-ons assign into
`OAKQ_CHROME_EXTENSION_ID` and `OAKQ_EDGE_EXTENSION_ID` in `apps/desktop/build/installer.nsh`. The two stores assign
different IDs. While both are empty, the installer shows no page and writes nothing. If only one is filled in, only that
browser is offered. To make local "Load unpacked" builds use the same ID as the store, copy the public key from the
Chrome Web Store dashboard into `manifest.json` as `"key"`.

## Which PDFs it opens

- Pages the server sends as a PDF (`Content-Type: application/pdf`), or as plain bytes with an address ending in `.pdf`.
  This is done with the browser's request rules (`declarativeNetRequest`); the extension does not read the pages you
  browse.
- Local PDFs (`file://`), once file access is allowed.
- Not: files the server marks as downloads (`Content-Disposition: attachment`), PDFs embedded inside other pages, and
  PDFs from a form submission (POST), which stay with the browser.

The viewer loads the PDF again from the browser (usually from its cache), up to 300 MB: a larger file is refused as
soon as the server announces its size, or as soon as more than that has arrived, and the message offers the browser's
own viewer. Leaving the page stops the download. A PDF that can only be loaded once shows a
message with **Open in the browser's own viewer**; the same choice is in the ⋯ menu. It lets that one address through
to the browser's viewer in that tab for the rest of the browser session; other tabs still use Oakqueill.

The viewer page has to be reachable from websites for the browser's redirect to work, so it only loads a PDF it was
sent for: the background worker notes when the browser redirects a tab from a PDF's address to the viewer (or sends a
local file there), and that note ends as soon as the tab shows anything else. A viewer opened any other way (a link
or a script pointing straight at it, a bookmark, going back in history) loads nothing and asks **Open this PDF?**,
showing the address; agreeing simply visits the address, as clicking a link to it would. Inside another page's frame
the viewer loads nothing at all.

Printing renders each page as an image at 150 dpi (very large pages at less, at most 16 megapixels each). A job is
capped at about 120 letter-size pages; a longer document asks which pages to print. Preparing pages can be cancelled,
and every image is released when the job is cancelled, fails or the print dialog closes.

## Privacy

Nothing is sent anywhere: no account, no telemetry, no network requests other than loading the PDF you opened. The
extension asks for access to all sites because any site can serve a PDF; it uses that access only to load the PDF
being opened. It watches page redirects (`webRequest`) only to notice the ones into its own viewer, and keeps the one
address each tab may load in the browser's session storage, which is cleared when the browser closes.

## Other browsers

Browsers built on Chromium that are not listed (Opera GX, Yandex, Samsung, Whale and so on) take the Chromium package the same
way. Firefox derivatives (Zen, LibreWolf, Waterfox, Floorp) take the Firefox one. Orion and other WebKit browsers on a Mac
that support Safari web extensions can use the Safari one. Only Chrome and Safari were available to build and try on the Mac
this was developed on; Firefox is checked with Mozilla's `web-ext lint` and by unit tests of its PDF detection.
