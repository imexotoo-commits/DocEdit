#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { writeSafely } from './write.js';
import { parseArgs } from 'node:util';
import * as core from '@docedit/core';
import { NodeRasterizer } from '@docedit/core/node';

const HELP = `docedit: PDF tools (foundation CLI over @docedit/core)

  docedit info <in.pdf>
  docedit text <in.pdf> [--page N]
  docedit merge <a.pdf[:pages]> <b.pdf[:pages]> ... -o out.pdf
  docedit extract <in.pdf> --pages "1-3,7" -o out.pdf          (also reorders: "3,1,2")
  docedit delete <in.pdf> --pages "2,4" -o out.pdf
  docedit split <in.pdf> --every N | --ranges "1-3,4-6" --out-prefix part
  docedit rotate <in.pdf> --pages "all" --degrees 90 -o out.pdf
  docedit meta <in.pdf> [--title T] [--author A] [--subject S] [--keywords "a,b"] [-o out.pdf]
  docedit watermark <in.pdf> --text DRAFT [--pages all] -o out.pdf
  docedit number <in.pdf> [--format "Page {n} of {total}"] [--position bottom-center] -o out.pdf
  docedit sign-visual <in.pdf> --page 1 --rect "x,y,w,h" (--image sig.png | --name "Jane Doe") [--caption T] -o out.pdf
  docedit fields <in.pdf>
  docedit fill <in.pdf> --set name=Jane --set agree=true [--flatten] -o out.pdf
  docedit redact <in.pdf> (--text WORD | --regex "\\d{3}-\\d{2}-\\d{4}" | --box "page,x,y,w,h") [--dpi 200] [--dry-run] -o out.pdf

Page selections are 1-based: "1,3,5-7", "8-", "-3", "2-last", "all". Boxes are PDF points, origin bottom-left.`;

const bytes = async (p: string) => new Uint8Array(await readFile(p));
const out = async (p: string | undefined, data: Uint8Array) => { if (!p) die('missing -o <output.pdf>'); await writeSafely(p, data); console.error(`wrote ${p} (${data.length} bytes)`); };
function die(msg: string): never { console.error(`docedit: ${msg}`); process.exit(2); }

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') { console.log(HELP); return; }
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: {
      o: { type: 'string', short: 'o' }, pages: { type: 'string' }, page: { type: 'string' }, degrees: { type: 'string' }, every: { type: 'string' }, ranges: { type: 'string' },
      'out-prefix': { type: 'string' }, title: { type: 'string' }, author: { type: 'string' }, subject: { type: 'string' }, keywords: { type: 'string' },
      text: { type: 'string' }, regex: { type: 'string' }, box: { type: 'string', multiple: true }, format: { type: 'string' }, position: { type: 'string' },
      rect: { type: 'string' }, image: { type: 'string' }, name: { type: 'string' }, caption: { type: 'string' }, set: { type: 'string', multiple: true },
      flatten: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, dpi: { type: 'string' },
    },
  });
  const input = positionals[0];
  if (!input) die(`${cmd}: missing input file\n\n${HELP}`);
  const pdf = cmd === 'merge' ? new Uint8Array() : await bytes(input);

  switch (cmd) {
    case 'info': console.log(JSON.stringify(await core.getInfo(pdf), null, 2)); break;
    case 'text': {
      const t = await core.extractText(pdf);
      if (values.page) console.log(t[Number(values.page) - 1] ?? ''); else t.forEach((s, i) => console.log(`--- page ${i + 1} ---\n${s}`));
      break;
    }
    case 'merge': {
      const parts = await Promise.all(positionals.map(async (p) => {
        const m = p.match(/^(.*\.pdf):(.+)$/i);
        return m ? { pdf: await bytes(m[1]!), pages: m[2]! } : { pdf: await bytes(p) };
      }));
      await out(values.o, await core.mergePdfs(parts)); break;
    }
    case 'extract': await out(values.o, await core.selectPages(pdf, values.pages ?? die('--pages required'))); break;
    case 'delete': await out(values.o, await core.deletePages(pdf, values.pages ?? die('--pages required'))); break;
    case 'split': {
      const chunks = values.every ? Number(values.every) : (values.ranges ?? die('--every or --ranges required')).split(',');
      const prefix = values['out-prefix'] ?? 'part';
      const parts = await core.splitPdf(pdf, chunks);
      const done: string[] = [];
      for (const [i, p] of parts.entries()) {
        const name = `${prefix}-${i + 1}.pdf`;
        try { await out(name, p); done.push(name); }
        catch (e) { die(`could not write ${name}: ${e instanceof Error ? e.message : String(e)}${done.length ? ` (already written: ${done.join(', ')})` : ''}`); }
      }
      break;
    }
    case 'rotate': await out(values.o, await core.rotatePages(pdf, values.pages ?? 'all', Number(values.degrees ?? die('--degrees required')))); break;
    case 'meta': {
      const { title, author, subject, keywords } = values;
      if (title === undefined && author === undefined && subject === undefined && keywords === undefined) { console.log(JSON.stringify((await core.getInfo(pdf)).metadata, null, 2)); break; }
      await out(values.o, await core.setMetadata(pdf, { title, author, subject, keywords: keywords?.split(',').map((s) => s.trim()) }));
      break;
    }
    case 'watermark': await out(values.o, await core.addTextWatermark(pdf, { text: values.text ?? die('--text required'), pages: values.pages })); break;
    case 'number': await out(values.o, await core.addPageNumbers(pdf, { format: values.format, position: values.position as core.PageNumberOptions['position'], pages: values.pages })); break;
    case 'sign-visual': {
      const [x, y, width, height] = (values.rect ?? die('--rect "x,y,w,h" required')).split(',').map(Number) as [number, number, number, number];
      const img = values.image ? { bytes: await bytes(values.image), format: (values.image.toLowerCase().endsWith('.png') ? 'png' : 'jpg') as 'png' | 'jpg' } : undefined;
      await out(values.o, await core.addVisualSignature(pdf, { page: Number(values.page ?? 1) - 1, rect: { x, y, width, height }, image: img, typedName: values.name, caption: values.caption }));
      break;
    }
    case 'fields': console.log(JSON.stringify(await core.listFormFields(pdf), null, 2)); break;
    case 'fill': {
      const v: Record<string, string | boolean> = {};
      for (const kv of values.set ?? []) { const i = kv.indexOf('='); const k = kv.slice(0, i), val = kv.slice(i + 1); v[k] = val === 'true' ? true : val === 'false' ? false : val; }
      await out(values.o, await core.fillFormFields(pdf, v, { flatten: values.flatten }));
      break;
    }
    case 'redact': {
      const marks: core.RedactionMark[] = [];
      if (values.text) marks.push(...await core.findRedactionMarks(pdf, values.text));
      if (values.regex) marks.push(...await core.findRedactionMarks(pdf, new RegExp(values.regex)));
      for (const b of values.box ?? []) { const [p, x, y, w, h] = b.split(',').map(Number) as [number, number, number, number, number]; marks.push({ page: p - 1, rect: { x, y, width: w, height: h } }); }
      if (marks.length === 0) die('nothing to redact: no matches and no --box');
      console.error(`${marks.length} area(s) on page(s) ${[...new Set(marks.map((m) => m.page + 1))].join(', ')}`);
      if (values['dry-run']) { console.log(JSON.stringify(marks, null, 2)); break; }
      if (!values.o) die('missing -o <output.pdf>');
      const ras = new NodeRasterizer();
      try {
        const result = await core.applyRedactions(pdf, marks, ras, { dpi: values.dpi ? Number(values.dpi) : undefined, secrets: values.text ? [values.text] : [] });
        // checked before anything is written, as the desktop app does: every marked area is opaque in the result,
        // and the searched text is no longer findable
        const coverage = await core.checkRedactionCoverage(pdf, result, marks, ras);
        if (coverage.length) die(`redaction not written: ${coverage.length} marked area(s) are not fully covered (${coverage.map((c) => `page ${c.page + 1}: ${c.reason}`).join('; ')})`);
        const left = [
          ...(values.text ? await core.verifyRedaction(result, [values.text]) : []),
          ...(values.regex ? (await core.findText(result, new RegExp(values.regex))).map((m) => ({ page: m.page })) : []),
        ];
        if (left.length) die(`redaction not written: the text is still found on page(s) ${[...new Set(left.map((l) => l.page + 1))].join(', ')}`);
        await out(values.o, result);
      } finally { await ras.close(); }
      break;
    }
    default: die(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  if (e instanceof core.DocEditError) { console.error(`docedit: ${e.message}`); process.exit(1); }
  console.error(e); process.exit(1);
});
