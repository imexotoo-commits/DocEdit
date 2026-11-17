# Provenance log

One line per external source relied on. Keep it honest and short. Format: `date | who | what was used | where from | licence/status`.

2026-11-12 | Claude (foundation) | PDF coordinate system, page boxes, /Rotate, annotation and AcroForm structure | ISO 32000 (from general knowledge of the public standard) | public standard
2026-11-12 | Claude | pdf-lib 1.17.1 API (load, copyPages, drawText, forms, embed images, context/flateStream) | npm package docs and its type definitions | MIT
2026-11-12 | Claude | pdf.js (pdfjs-dist 4.10.38) getDocument/getTextContent/getViewport/render | npm package docs and type definitions | Apache-2.0
2026-11-12 | Claude | @napi-rs/canvas for Node pixel rendering | npm package | MIT
2026-11-12 | Claude | Redaction approach "render, burn black boxes into pixels, replace the page", plus pruning of unreachable objects | own design, motivated by the fact that pdf-lib writes detached objects (see tests) | own work
2026-11-12 | Claude | Signature design (PAdES-B-B, ByteRange, CMS detached) | public standards ETSI EN 319 142, RFC 5652 (design notes only, nothing implemented) | public standard
2026-11-12 | Claude | `arrangePages` (single-pass page layout from several sources) | own design over pdf-lib copyPages/setRotation (MIT) | own work
2026-11-12 | Claude | Electron 45 API: BrowserWindow, contextBridge, ipcMain/ipcRenderer, webUtils.getPathForFile, dialog, Menu, session permission handler; security recommendations (context isolation, sandbox, deny navigation) | Electron public docs and type definitions | MIT
2026-11-12 | Claude | pdf.js browser build: getDocument options, PDFPageProxy.render, TextLayer, worker setup; `web/pdf_viewer.css` imported unmodified for text-layer positioning | pdfjs-dist 4.10.38 docs, type definitions and package files | Apache-2.0
2026-11-12 | Claude | React 19 hooks, Vite build config | React and Vite public docs | MIT
2026-11-12 | Claude | Desktop UI layout, wording, colours, keyboard shortcuts, editing model (page list with stable ids + history) | own design | own work
2026-11-12 | Claude | Search highlight geometry (text item transform and advance width -> rectangles; user space -> screen for /Rotate and crop box) | ISO 32000 text and page coordinate model; pdf.js getTextContent item fields from its type definitions | own work over public standard
2026-11-12 | Claude | Page labels, outline and link destinations via pdf.js getPageLabels/getOutline/getDestination/getPageIndex/getAnnotations | pdfjs-dist 4.10 type definitions | Apache-2.0
2026-11-12 | Claude | Printing: Electron webContents.print/printToPDF, CSS paged media (@page size, break-after) | Electron docs; W3C CSS Paged Media | MIT; W3C
2026-11-12 | Claude | JPEG EXIF orientation: APP1 "Exif" segment, TIFF header, IFD0 tag 0x0112 and the meaning of values 1-8 | Exif 2.3 (CIPA DC-008) and TIFF 6.0, public specifications | public standard
2026-11-12 | Claude | Image placement via cm/Do operators, clipping with re W n | ISO 32000 graphics operators | public standard
2026-11-12 | Claude | Text layout for textToPdf (greedy word wrap, form-feed page breaks), embedding with @pdf-lib/fontkit | own work; @pdf-lib/fontkit README | MIT
2026-11-12 | Claude | LibreOffice conversion: soffice --headless --convert-to pdf, -env:UserInstallation, registrymodifications.xcu item format, Security/Scripting settings (DisableMacrosExecution, MacroSecurityLevel, BlockUntrustedRefererLinks) | LibreOffice public help (command-line parameters, PDF export) and its published configuration schema | MPL-2.0 documentation; program invoked, not included
2026-11-12 | Claude | Crash recovery design (snapshot store, orphan detection by owning process) | own work | own work
2026-11-12 | Claude | Annotation dictionaries and appearance streams (Highlight, Underline, StrikeOut QuadPoints order, Text, FreeText DA, Square, Circle, Ink InkList, BS, CA, NM, M, T), ExtGState blend mode Multiply | ISO 32000 §12.5 and §11.3.5 | public standard
2026-11-12 | Claude | Outline item dictionaries (Title, Parent, First/Last, Prev/Next, Count, Dest /XYZ), Link annotations with /Dest and URI actions | ISO 32000 §12.3.3, §12.5.6.5, §12.6.4.7 | public standard
2026-11-12 | Claude | Ellipse drawn with four Bezier curves (kappa 0.5522848) | standard geometric approximation, general knowledge | public domain
2026-11-12 | Claude | Displayed-frame mapping for page furniture (user space <-> displayed page for /Rotate and crop box) | own derivation from ISO 32000 §8.3 and §14.11.2 | own work
2026-11-12 | Claude | Form field data from pdf.js getFieldObjects; radio choices via pdf-lib PDFRadioGroup getOptions / widget on-values | pdfjs-dist and pdf-lib type definitions | Apache-2.0 / MIT
2026-11-12 | Claude | Switched to @cantoo/pdf-lib 2.11.1 and @cantoo/fontkit 2.0.12 (API and encryption options read from their README and type definitions) | npm packages | MIT
2026-11-12 | Claude | PDF signatures: signature field and dictionary, /ByteRange and /Contents, incremental update | ISO 32000-2 §12.8, ETSI EN 319 142-1 (PAdES baseline) | public standards
2026-11-12 | Claude | CMS SignedData and signed attributes (content-type, message-digest), ESS signing-certificate-v2 | RFC 5652, RFC 5035 | public standards
2026-11-12 | Claude | PKI.js / asn1js APIs (SignedData, Certificate, CryptoEngine) and node-forge PKCS#12 API | package READMEs and type definitions | BSD-3-Clause
2026-11-12 | Claude | OpenSSL `cms -verify` used only as an independent check in tests (not shipped) | OpenSSL CLI docs | Apache-2.0 tool, not a dependency
2026-11-12 | owner | App icon (oak leaf and quill with pen nib) | artwork supplied by the project owner, scaled to 1024 px for apps/desktop/build/icon.png | owner-provided
