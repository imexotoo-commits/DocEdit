# Oakqueill PDF Viewer (browser extension)

Opens PDFs in Chrome and Microsoft Edge with an Oakqueill viewer instead of the browser's own. It is a viewer, not
the editor: page navigation, zoom (in, out, fit width, fit page), rotate view, find, page thumbnails, links, print and
save a copy. Password-protected PDFs ask for the password, which is used only to show the file.

It is built from the desktop app's own pieces (`apps/desktop/src/renderer`: page viewer, page rendering, search,
icons, styles) and lives in `apps/browser`.

## Install for testing

1. `npm run build -w @docedit/browser`
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, choose **Load unpacked**, and pick
   `apps/browser/dist`.
3. To open PDFs from your own disk (`file://`), open the extension's **Details** and turn on **Allow access to file
   URLs**.

`npm run dist -w @docedit/browser` also writes `apps/browser/release/oakqueill-viewer-<version>.zip`, the file the
Chrome Web Store and Edge Add-ons take. Publishing there needs a developer account on each store (Chrome charges a
one-time registration fee; Edge is free) and goes through their review.

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

Chrome and Edge (version 128 or later) on Windows share this extension, which lives on the `Win11` branch. The macOS
browsers get their own build on the `macOS` branch. Firefox needs its own packaging (it intercepts PDFs a different way)
and is not done yet.
