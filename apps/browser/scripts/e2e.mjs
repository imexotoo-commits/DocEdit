// End-to-end test of the extension in real browsers. It serves PDFs from a local server with different headers, loads the
// extension into the browser, opens each address and checks whether the viewer took it over (and rendered it).
//
//   npm run build:all -w @docedit/browser
//   CHROME_PATH="/path/to/chrome" FIREFOX_PATH="/path/to/firefox" npm run e2e -w @docedit/browser
//
// CHROME_PATH needs a Chrome that still loads extensions from the command line (Chrome for Testing, Chromium, Edge, Brave ...;
// current branded Google Chrome does not). Either variable may be left out. Exit code 1 when any check fails.
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const browserDir = join(here, '..');
const puppeteer = (await import('puppeteer-core')).default;
const core = await import(new URL('../../../packages/core/dist/index.js', import.meta.url));

const pdf = Buffer.from(await core.createBlankPdf(2, [300, 400]));
const html = '<!doctype html><title>plain page</title><p>hello</p>';
const routes = {
  '/plain.pdf': { type: 'application/pdf', body: pdf },
  '/served-as-pdf': { type: 'application/pdf', body: pdf },
  '/with-charset.pdf': { type: 'application/pdf; charset=binary', body: pdf },
  '/bytes.pdf': { type: 'application/octet-stream', body: pdf },
  '/bytes-without-extension': { type: 'application/octet-stream', body: pdf },
  '/attachment.pdf': { type: 'application/pdf', body: pdf, extra: { 'Content-Disposition': 'attachment; filename="a.pdf"' } },
  '/page.html': { type: 'text/html', body: html },
};
const server = createServer((req, res) => {
  const r = routes[new URL(req.url, 'http://x').pathname];
  if (!r) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': r.type, 'Content-Length': r.body.length, ...(r.extra ?? {}) }).end(r.body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// what each browser is expected to take over (see docs/BROWSER_EXTENSION.md)
const EXPECT = {
  chromium: { '/plain.pdf': true, '/served-as-pdf': true, '/with-charset.pdf': true, '/bytes.pdf': true, '/bytes-without-extension': false, '/attachment.pdf': false, '/page.html': false },
  firefox: { '/plain.pdf': true, '/served-as-pdf': true, '/with-charset.pdf': true, '/bytes.pdf': true, '/bytes-without-extension': false, '/attachment.pdf': false, '/page.html': false },
};

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(label, browser, scheme, expect) {
  console.log(`\n== ${label}`);
  for (const [path, taken] of Object.entries(expect)) {
    const page = await browser.newPage();
    await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}); // a download aborts the navigation
    let url = page.url();
    for (let i = 0; i < 30 && taken && !url.startsWith(`${scheme}://`); i++) { await sleep(250); url = page.url(); }
    if (taken) {
      const ok = url.startsWith(`${scheme}://`) && url.includes('/viewer.html?file=') && url.includes(origin + path);
      let rendered = false;
      if (ok) for (let i = 0; i < 40 && !rendered; i++) { rendered = await page.evaluate(() => document.querySelectorAll('canvas').length > 0).catch(() => false); if (!rendered) await sleep(250); }
      check(`${path} is taken over and rendered`, ok && rendered, ok ? (rendered ? '' : 'viewer opened but drew no page') : url);
    } else {
      await sleep(700);
      url = page.url();
      check(`${path} is left to the browser`, !url.startsWith(`${scheme}://`), url);
    }
    await page.close().catch(() => {});
  }
}

if (process.env.CHROME_PATH) {
  const dist = join(browserDir, 'dist');
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, pipe: true, enableExtensions: [dist], args: ['--no-first-run', '--no-default-browser-check'] });
  await sleep(1500); // let the extension's background install its rules
  await run(`Chromium (${await browser.version()}) with the Chromium package`, browser, 'chrome-extension', EXPECT.chromium);
  await browser.close();
}
if (process.env.FIREFOX_PATH) {
  const profile = mkdtempSync(join(tmpdir(), 'oakq-ff-'));
  const browser = await puppeteer.launch({ browser: 'firefox', executablePath: process.env.FIREFOX_PATH, headless: !process.env.FIREFOX_HEADED, userDataDir: profile, timeout: 60000 });
  await browser.installExtension(join(browserDir, 'dist-firefox'));
  await sleep(1500);
  await run(`Firefox (${await browser.version()}) with the Firefox package`, browser, 'moz-extension', EXPECT.firefox);
  await browser.close();
}
server.close();
if (!process.env.CHROME_PATH && !process.env.FIREFOX_PATH) { console.log('Set CHROME_PATH and/or FIREFOX_PATH.'); process.exit(2); }
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
