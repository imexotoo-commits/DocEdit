// Security probe: starts the real (unpackaged) app with a throw-away profile and a hostile PDF, then attacks it from
// inside the page, the way malicious script running in the app window would. Run it after `npm run build -w @docedit/desktop`:
//
//   node apps/desktop/scripts/security-probe.mjs
//
// Every probe prints PASS or FAIL; the exit code is 1 when any probe fails. It never touches the network and writes
// only under a temporary folder (plus one forged path it checks is NOT created).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron');
const core = await import(new URL('../../../packages/core/dist/index.js', import.meta.url));

const tmp = mkdtempSync(join(tmpdir(), 'oakq-probe-'));
const profile = join(tmp, 'profile');
const savePath = join(tmp, 'saved-by-dialog.pdf');
const printedPath = join(tmp, 'printed.pdf');
const saveDir = join(tmp, 'save-dir');
const forged = join(tmpdir(), `oakq-probe-forged-${process.pid}.pdf`);
const PORT = 9300 + Math.floor(Math.random() * 500);

// ---- a hostile PDF: HTML and script in every text field a viewer might show ----
const XSS = '<img src=x onerror="window.__xss=1">';
let pdf = await core.createBlankPdf(2, [612, 792]);
pdf = await core.setMetadata(pdf, { title: XSS, author: XSS, subject: XSS, keywords: [XSS] });
pdf = await core.applyEdits(pdf, [
  { type: 'outline', entries: [{ title: XSS, page: 0, children: [{ title: `</script><script>window.__xss=2</script>`, page: 1 }] }] },
  { type: 'annotation', page: 0, author: XSS, annotation: { kind: 'note', at: { x: 50, y: 700 }, text: XSS } },
]);
const hostile = join(tmp, 'hostile.pdf');
writeFileSync(hostile, pdf);
const smallPdfB64 = Buffer.from(await core.createBlankPdf(1, [200, 200])).toString('base64');

// ---- start the app ----
let stderr = '';
const app = spawn(electronBin, ['.', hostile, `--remote-debugging-port=${PORT}`], {
  cwd: desktop, stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, DOCEDIT_TEST_USER_DATA: profile, DOCEDIT_TEST_SAVE_PATH: savePath, DOCEDIT_TEST_SAVE_DIR: saveDir, DOCEDIT_TEST_PRINT_TO_PDF: printedPath },
});
app.stderr.on('data', (d) => { stderr += d; });
let exited = false;
app.on('exit', () => { exited = true; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() { try { return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { return []; } }
let page;
for (let i = 0; i < 60 && !page; i++) { await sleep(500); page = (await targets()).find((t) => t.type === 'page' && t.url.includes('index.html')); }
if (!page) { console.error('The app window did not start.\n' + stderr.slice(-800)); app.kill(); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, f) => { ws.onopen = r; ws.onerror = f; });
let id = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); waiting.delete(d.id); };
const cdp = (method, params) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
/** Run an async function body in the page; resolves to its JSON value, or { threw } for an exception. */
async function inPage(body, timeoutMs = 8000) {
  const expression = `(async () => { try { return { value: await (async () => { ${body} })() }; } catch (e) { return { threw: String(e && e.message || e) }; } })()`;
  const res = await Promise.race([cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), sleep(timeoutMs).then(() => ({ timedOut: true }))]);
  if (res.timedOut) return { timedOut: true };
  return res.result?.result?.value ?? { threw: JSON.stringify(res.result?.exceptionDetails ?? res) };
}

process.on('exit', () => { try { app.kill(); } catch {} });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const rejected = (r) => 'threw' in r || r.timedOut || r.value?.ok === false;

await sleep(2500); // let the hostile PDF load

// ---- 1. the page cannot reach Node or Electron ----
const iso = await inPage(`return [typeof require, typeof process, typeof module, typeof ipcRenderer, typeof Buffer, typeof electron, typeof __dirname]`);
check('page has no Node or Electron globals', iso.value?.every((t) => t === 'undefined'), JSON.stringify(iso.value));

const preloadSrc = readFileSync(join(desktop, 'src/preload/preload.ts'), 'utf8');
const exposed = [...preloadSrc.matchAll(/^  (\w+):/gm)].map((m) => m[1]).sort();
const surface = await inPage(`return Object.keys(window.docedit).sort()`);
check('the bridge exposes exactly the declared functions', JSON.stringify(surface.value) === JSON.stringify(exposed), `${surface.value?.length} functions`);

// ---- 2. code injection and outbound access are blocked ----
const csp = (await inPage(`return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`)).value ?? '';
const scriptSrc = (csp.match(/script-src([^;]*)/)?.[1] ?? '').trim();
check("the content security policy allows scripts only from the app itself (no 'unsafe-eval', no 'unsafe-inline')", scriptSrc === "'self'" && !/unsafe/.test(csp.replace(/style-src[^;]*/, '')), csp.slice(0, 90));
const inj = await inPage(`window.__x = 0; const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.head.append(s); await new Promise(r => setTimeout(r, 200)); const ran = window.__x; s.remove(); return ran`);
check('an injected inline script does not run', inj.value === 0, JSON.stringify(inj));
const remote = await inPage(`let v = null; document.addEventListener('securitypolicyviolation', e => { v = e.violatedDirective; }); try { await fetch('http://127.0.0.1:9/'); return { fetched: true, v }; } catch (e) { await new Promise(r => setTimeout(r, 100)); return { fetched: false, v }; }`);
check('a request to another origin is blocked by the policy (connect-src)', remote.value?.fetched === false && !!remote.value?.v, JSON.stringify(remote.value));
const fileFetch = await inPage(`try { const r = await fetch('file:///etc/hosts'); return { read: true, text: (await r.text()).slice(0, 20) }; } catch (e) { return { read: false }; }`);
check('the page cannot read local files with fetch(file://)', fileFetch.value?.read === false, JSON.stringify(fileFetch.value));
const xhr = await inPage(`return await new Promise(r => { const x = new XMLHttpRequest(); x.onload = () => r({ read: true, text: x.responseText.slice(0, 20) }); x.onerror = () => r({ read: false }); try { x.open('GET', 'file:///etc/hosts'); x.send(); } catch (e) { r({ read: false }); } })`);
check('the page cannot read local files with XMLHttpRequest', xhr.value?.read === false, JSON.stringify(xhr.value));
const frame = await inPage(`const f = document.createElement('iframe'); f.src = 'file:///etc/hosts'; document.body.append(f); await new Promise(r => setTimeout(r, 600)); let text = ''; try { text = f.contentDocument?.body?.innerText ?? ''; } catch {} f.remove(); return text.length`);
check('a file:// iframe cannot be read by the page', frame.value === 0 || frame.value === undefined, JSON.stringify(frame));

// ---- 3. navigation and new windows ----
const before = (await targets()).length;
await inPage(`window.open('https://example.com', '_blank'); return 1`);
await sleep(600);
check('window.open creates no new window', (await targets()).length === before);
const url0 = (await inPage(`return location.href`)).value;
await inPage(`setTimeout(() => { location.href = 'https://example.com/'; }, 0); return 1`);
await sleep(800);
const url1 = (await inPage(`return location.href`)).value;
check('the page cannot navigate away', url0 === url1, url1);

// ---- 4. device permissions ----
const perm = await inPage(`const out = {}; try { out.n = await Notification.requestPermission(); } catch (e) { out.n = 'threw'; } try { await navigator.mediaDevices.getUserMedia({ audio: true }); out.m = 'granted'; } catch (e) { out.m = 'denied'; } out.g = await new Promise(r => navigator.geolocation ? navigator.geolocation.getCurrentPosition(() => r('granted'), () => r('denied'), { timeout: 3000 }) : r('none')); return out`, 12000);
check('notifications, microphone and location are denied', perm.value?.n !== 'granted' && perm.value?.m === 'denied' && perm.value?.g !== 'granted', JSON.stringify(perm));

// ---- 5. forged paths are refused (the main process decides, not the page) ----
const cases = [
  ['openWritten with a path never written', `window.docedit.openWritten('/etc/hosts')`],
  ['readTextFile of a file never chosen', `window.docedit.readTextFile('/etc/hosts')`],
  ['readImage of a file never chosen', `window.docedit.readImage('/etc/hosts')`],
  ['convertOffice of a file never chosen', `window.docedit.convertOffice('/etc/hosts')`],
  ['certSign with a key file never chosen', `window.docedit.certSign({ pdf: new Uint8Array([1]), p12Path: '/etc/hosts', password: 'x', page: 0 })`],
  ['recentOpen with a path that is not on the recent list', `window.docedit.recentOpen('/etc/hosts')`],
  ['recentOpen with a ../ path', `window.docedit.recentOpen('../../../../etc/hosts')`],
  ['openDropped with a path string instead of a File', `window.docedit.openDropped('/etc/hosts')`],
  ['openDropped with a File that has no path', `window.docedit.openDropped(new File(['%PDF-1.4'], 'x.pdf'))`],
  ['recoveryLoad with ../ in the id', `window.docedit.recoveryLoad('../../../etc')`],
  ['recoveryClear with ../ in the id', `window.docedit.recoveryClear('../../x')`],
  ['signaturesDelete with ../ in the id', `window.docedit.signaturesDelete('../../x')`],
  ['recoverySave with ../ in the id', `window.docedit.recoverySave({ id: '../../evil-recovery', title: 't', path: null, pages: [], newSources: [], firstNewSource: 0 })`],
];
for (const [name, call] of cases) check(`refused: ${name}`, rejected(await inPage(`return await ${call}`)));
const saveForged = await inPage(`const b = Uint8Array.from(atob('${smallPdfB64}'), c => c.charCodeAt(0)); const r = await window.docedit.save({ sources: [b], slots: [{ source: 0, page: 0 }], path: ${JSON.stringify(forged)}, suggestedName: 'a.pdf' }); return r.ok ? r.file.path : r`);
check('save to a path the session never opened goes through the Save dialog, not to that path', !existsSync(forged) && saveForged.value === savePath, JSON.stringify(saveForged).slice(0, 120));
const escaped = readdirSync(tmp).filter((n) => /evil|recovery|etc/.test(n));
check('no file was created outside the profile by crafted ids', escaped.length === 0, escaped.join(','));

// ---- 6. settings cannot be used to aim the app at other folders ----
const set = await inPage(`const s = await window.docedit.setSettings({ remarkableFolder: '/etc', theme: '<script>', redaction: 'weird', recovery: 'yes', rememberRecent: 'maybe', __proto__: { polluted: 1 } }); const g = await window.docedit.getSettings(); return { s, g, p: ({}).polluted }`);
const sv = set.value;
check('settings reject a folder, unknown theme and values of the wrong type', sv && sv.g.remarkableFolder === undefined && typeof sv.g.rememberRecent === 'boolean' && ['system', 'light', 'dark'].includes(sv.g.theme) && ['copy', 'in-place'].includes(sv.g.redaction) && typeof sv.g.recovery === 'boolean' && sv.p === undefined, JSON.stringify(sv?.g));

// ---- 7. hostile PDF content is shown as text, never run ----
const dom = await inPage(`await new Promise(r => setTimeout(r, 500)); return { xss: window.__xss ?? null, imgs: document.querySelectorAll('img[src="x"], img[onerror], script:not([src])').length, opened: document.body.innerText.length > 0 }`);
check('HTML in the document title, outline and notes is not interpreted', dom.value && dom.value.xss === null && dom.value.imgs === 0, JSON.stringify(dom.value));

// ---- 7b. the protections must not break what the app needs: printing loads a temporary page from outside the app folder ----
const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const printed = await inPage(`const png = Uint8Array.from(atob('${png1x1}'), c => c.charCodeAt(0)); return await window.docedit.printPages({ title: 'probe', pages: [{ png, widthPt: 200, heightPt: 200 }], fit: true, orientation: 'auto' })`, 20000);
const printedBytes = existsSync(printedPath) ? readFileSync(printedPath) : Buffer.alloc(0);
check('printing still works (the print page and its image are allowed through the file guard)', printed.value?.ok === true && printedBytes.length > 800 && printedBytes.subarray(0, 5).toString() === '%PDF-' && printedBytes.includes('/Subtype /Image'), JSON.stringify(printed).slice(0, 100) + ` pdf=${printedBytes.length}B image=${printedBytes.includes('/Subtype /Image')}`);

// ---- 8. malformed calls must not crash or hang the main process ----
const garbage = ['undefined', 'null', "'x'", '42', '{}', '[]', '({ bytes: new Uint8Array(4) })', "({ files: [], kind: 'png' })", "[{ name: '../../x', bytes: new Uint8Array(2) }]", "new Uint8Array(0)"];
const methods = ['decrypt', 'inspect', 'sanitize', 'previewEdits', 'setDocumentState', 'verifySignatures', 'listFormFields', 'readImage', 'readTextFile', 'signaturesSave', 'signaturesDelete', 'createDocument', 'recoverySave', 'recoveryClear', 'recoveryLoad', 'setSettings', 'editCommand', 'closeWindowAfterSave', 'certSign', 'officeConverter', 'recentList', 'recentOpen', 'recentRemove', 'recentClear', 'scannerPresent', 'scanDevices', 'saveCopy', 'saveExport', 'openWritten', 'cancelConvert', 'scanClear', 'getSettings', 'recoveryList', 'signaturesList'];
let calls = 0;
const culprits = [];
// "Error occurred in handler for" is Electron logging a call that was rejected back to the page: harmless. Only an uncaught
// exception (the blocking error dialog) or an unhandled rejection in the main process counts.
const errorRe = /(Uncaught Exception|UnhandledPromiseRejection|A JavaScript error occurred in the main process)/;
for (const m of methods) {
  for (const a of garbage) {
    const seen = stderr.length;
    await inPage(`try { await Promise.race([window.docedit.${m}(${a}, ${a}), new Promise(r => setTimeout(r, 400))]); } catch (e) {} return 1`, 1200); calls++;
    await sleep(15);
    if (errorRe.test(stderr.slice(seen))) { culprits.push(`${m}(${a})`); break; } // first bad input per method is enough
  }
}
const alive = await inPage(`return typeof window.docedit.getSettings`);
const windowsLeft = (await targets()).filter((t) => t.type === 'page').length;
const errorLines = stderr.split('\n').filter((l) => /Error|^\s+at /.test(l)).slice(0, 12);
check(`the main process survives ${calls} malformed calls without an uncaught error`, !exited && alive.value === 'function' && culprits.length === 0, culprits.length ? `first failing inputs: ${culprits.join('; ')}` : `exited=${exited} alive=${JSON.stringify(alive)} windowsLeft=${windowsLeft}`);
if (culprits.length) console.log('  main-process error output:\n    ' + errorLines.join('\n    '));

// ---- done ----\n
ws.close(); app.kill();
await sleep(500);
rmSync(tmp, { recursive: true, force: true }); rmSync(forged, { force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} probes passed${failed.length ? `; FAILED: ${failed.map((f) => f.name).join(' | ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
