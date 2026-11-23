# Clean-room policy

This project builds its own PDF reader/editor from public standards and public library documentation. It does **not** copy, decompile, disassemble, trace, or otherwise derive from Adobe Acrobat, Acrobat Reader or any other commercial PDF product. This file is the rulebook for everyone (people and AI assistants) who writes code here. It is a working agreement, not legal advice; have a lawyer review it before the product ships commercially.

## What "clean room" means here
1. **Inputs are limited to an allow-list** (below). Anything not on it must be added to `docs/PROVENANCE.md` with a reason before it is used.
2. **Features are described by what users need, in our own words** (`docs/FEATURES.md`), never by how a specific product does it or looks.
3. **Design and code are ours.** Names, icons, layouts, menu wording, colours, sounds, sample files, error text and keyboard-shortcut *sets* are invented here, not borrowed.

## Allowed sources
- The PDF specification: ISO 32000-1 / ISO 32000-2 (the PDF Association publishes 32000-2 free of charge), and the public PDF/A, PDF/UA, PAdES (ETSI EN 319 142) and CMS (RFC 5652) standards.
- Documentation and source of permissively licensed libraries we depend on (pdf-lib MIT, pdf.js Apache-2.0, and others listed in `docs/LICENSES.md`), used under their licences.
- General knowledge that any developer has about what PDF tools *do* (merge, split, sign, redact, fill forms) described at feature level.
- Our own tests and our own sample files (generated in code or created by us).
- Public accessibility guidance (WCAG) and operating-system UI guidelines.

## Forbidden
- Any Adobe (or other vendor) binary, installer, SDK under NDA, leaked source, decompiled or traced output, private documentation.
- Copying UI assets, icons, strings, help text, tutorials, templates, sample PDFs or fonts from a commercial product, including screenshots used as a pixel reference.
- Looking at a commercial product's behaviour *in order to replicate its exact implementation* (undocumented file quirks, proprietary extensions, private APIs). Behaviour that the PDF standard defines is fair game; reproducing a vendor's private extensions is not.
- Using a vendor's trademarks as product or feature names (do not call a feature by a vendor's brand name; generic words such as "redact", "merge", "sign" are fine).
- Code from AGPL/GPL projects (MuPDF, Ghostscript, iText, poppler, xpdf...) (the project is MIT-licensed, so copyleft code is excluded). Do not even read their source to "get ideas": use the specification instead.

## Process for contributors
- Add a line to `docs/PROVENANCE.md` for every non-trivial algorithm or external document you rely on (what, where from, licence).
- Before a pull request: re-read this file; confirm nothing above was violated; tick the box in the PR template (`.github/pull_request_template.md`).
- If you are unsure whether something is allowed, do not use it; ask the project owner.
- Reviewers (people and AI review tools) check the PR against this file as well as for correctness.

## A note on how this foundation was written
The foundation (everything in this repository at the first commit) was written by an AI coding assistant (Claude) working from the PDF standard, the public APIs of pdf-lib and pdf.js, and general feature-level knowledge of what PDF editors do. No Adobe materials were consulted or available to it. Like any general-purpose assistant it has seen public descriptions of commercial products during training, which is why the rules above are about process and provenance, and why `PROVENANCE.md` exists: independent reviewers can check that the code stands on the allowed sources.
