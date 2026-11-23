// Fuzz test for the document engine: corrupt valid PDFs in many ways and run the operations the app runs on a file it has just
// opened. A bad file may be refused with an error, but it must never hang the engine, exhaust memory or crash the process.
//
//   npm run build -w @docedit/core && node packages/core/scripts/fuzz.mjs [iterations] [seed]
//
// Each case runs in its own worker thread with a time limit and a memory limit, so a hang or runaway allocation is reported
// instead of freezing the test. Exit code 1 when any case hangs, runs out of memory or crashes its worker.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const CASE_TIMEOUT_MS = 20_000;
const MEMORY_MB = 768;

if (!isMainThread) {
  // ---- worker: run the operations on one mutated file ----
  const core = await import(new URL('../dist/index.js', import.meta.url));
  const bytes = new Uint8Array(workerData.bytes);
  const ops = {
    getInfo: () => core.getInfo(bytes),
    isEncrypted: () => core.isEncrypted(bytes),
    arrangePages: () => core.arrangePages([bytes], [{ source: 0, page: 0 }]),
    mergePdfs: () => core.mergePdfs([{ pdf: bytes }, { pdf: bytes }]),
    listFormFields: () => core.listFormFields(bytes),
    inspectDocument: () => core.inspectDocument(bytes),
    sanitizeDocument: () => core.sanitizeDocument(bytes, ['metadata', 'javascript', 'attachments']),
    extractText: () => core.extractText(bytes),
    applyEdits: () => core.applyEdits(bytes, [{ type: 'watermark', pages: [0], text: 'x' }]),
  };
  const out = {};
  for (const [name, fn] of Object.entries(ops)) {
    parentPort.postMessage({ progress: name });
    try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = e instanceof Error ? `error:${e.constructor.name}` : 'error:?'; }
  }
  parentPort.postMessage(out);
  process.exit(0);
}

// ---- main: build seeds, mutate, run ----
const core = await import(new URL('../dist/index.js', import.meta.url));
const iterations = Number(process.argv[2] ?? 300);
let seedState = Number(process.argv[3] ?? 20260117) >>> 0;
const rnd = () => { seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0; return seedState / 2 ** 32; };
const pick = (n) => Math.floor(rnd() * n);

let rich = await core.createBlankPdf(4, [612, 792]);
rich = await core.applyEdits(rich, [
  { type: 'outline', entries: [{ title: 'One', page: 0, children: [{ title: 'Two', page: 1 }] }, { title: 'Three', page: 2 }] },
  { type: 'annotation', page: 0, annotation: { kind: 'note', at: { x: 40, y: 700 }, text: 'a note' } },
  { type: 'link', page: 0, rect: { x: 10, y: 10, width: 50, height: 20 }, target: { url: 'https://example.com' } },
  { type: 'watermark', pages: [0, 1], text: 'DRAFT' },
]);
const seeds = [await core.createBlankPdf(1, [200, 200]), rich, await core.protectPdf(await core.createBlankPdf(2, [300, 300]), { userPassword: 'x' })];

function mutate(src) {
  let b = Uint8Array.from(src);
  const rounds = 1 + pick(4);
  for (let r = 0; r < rounds; r++) {
    switch (pick(8)) {
      case 0: for (let i = 0, n = 1 + pick(8); i < n; i++) b[pick(b.length)] = pick(256); break; // flip bytes
      case 1: b = b.slice(0, Math.max(8, pick(b.length))); break; // truncate
      case 2: { const at = pick(b.length), len = pick(Math.min(400, b.length - at)); b = Uint8Array.from([...b.slice(0, at), ...b.slice(at + len)]); break; } // delete a chunk
      case 3: { const at = pick(b.length), len = pick(Math.min(400, b.length - at)); b = Uint8Array.from([...b.slice(0, at), ...b.slice(at, at + len), ...b.slice(at, at + len), ...b.slice(at + len)]); break; } // duplicate a chunk
      case 4: { // blow up a number: counts, sizes, offsets, lengths
        const text = new TextDecoder('latin1').decode(b); const nums = [...text.matchAll(/\b\d{1,6}\b/g)];
        if (nums.length) { const m = nums[pick(nums.length)]; const big = ['99999999', '2147483647', '4294967296', '-1', '0'][pick(5)]; b = new TextEncoder().encode(text.slice(0, m.index) + big + text.slice(m.index + m[0].length)); const latin = new Uint8Array(text.length - m[0].length + big.length); for (let i = 0; i < latin.length; i++) latin[i] = b[i] ?? 0; b = latin; }
        break; }
      case 5: { // point a reference at itself or a wrong object (cycles)
        const text = new TextDecoder('latin1').decode(b); const refs = [...text.matchAll(/\b(\d{1,3}) 0 R\b/g)];
        if (refs.length >= 2) { const a = refs[pick(refs.length)], c = refs[pick(refs.length)]; const t2 = text.slice(0, a.index) + c[0] + text.slice(a.index + a[0].length); const o = new Uint8Array(t2.length); for (let i = 0; i < o.length; i++) o[i] = t2.charCodeAt(i) & 255; b = o; }
        break; }
      case 6: { const at = pick(b.length); const junk = Uint8Array.from({ length: 1 + pick(64) }, () => pick(256)); b = Uint8Array.from([...b.slice(0, at), ...junk, ...b.slice(at)]); break; } // insert junk
      default: { const text = new TextDecoder('latin1').decode(b); const k = ['/Kids', '/Parent', '/Pages', '/Root', '/Length', '/Filter', '/Type'][pick(7)]; const o = new Uint8Array(text.length); const t2 = text.replace(k, '/Kids'.padEnd(k.length, ' ').slice(0, k.length)); for (let i = 0; i < o.length; i++) o[i] = t2.charCodeAt(i) & 255; b = o; }
    }
  }
  return b;
}

function runCase(bytes) {
  return new Promise((resolve) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { bytes }, resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB } });
    let last = '';
    const timer = setTimeout(() => { w.terminate(); resolve({ verdict: 'hang', detail: `stuck in ${last}` }); }, CASE_TIMEOUT_MS);
    w.on('message', (m) => { if (m.progress) { last = m.progress; return; } clearTimeout(timer); resolve({ verdict: 'done', ops: m }); });
    w.once('error', (e) => { clearTimeout(timer); resolve({ verdict: /heap|memory|allocation/i.test(String(e?.message ?? e)) ? 'out-of-memory' : 'crash', detail: String(e?.message ?? e).slice(0, 120) }); });
    w.once('exit', (code) => { clearTimeout(timer); if (code !== 0) resolve({ verdict: 'crash', detail: `exit ${code}` }); });
  });
}

const tally = { done: 0, hang: 0, 'out-of-memory': 0, crash: 0 };
const opResults = {};
const bad = [];
for (let i = 0; i < iterations; i++) {
  const src = seeds[i % seeds.length];
  const bytes = mutate(src);
  const r = await runCase(bytes);
  tally[r.verdict]++;
  if (r.verdict === 'done') for (const [op, v] of Object.entries(r.ops)) { (opResults[op] ??= { ok: 0, error: 0 })[v === 'ok' ? 'ok' : 'error']++; }
  else { bad.push({ i, verdict: r.verdict, detail: r.detail, size: bytes.length }); if (process.env.FUZZ_SAVE) (await import('node:fs')).writeFileSync(`${process.env.FUZZ_SAVE}/case-${i}.pdf`, bytes); }
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${iterations} cases ...`);
}
console.log(`\n${iterations} mutated files: ${tally.done} handled cleanly, ${tally.hang} hung, ${tally['out-of-memory']} ran out of memory, ${tally.crash} crashed`);
for (const [op, v] of Object.entries(opResults)) console.log(`  ${op.padEnd(18)} ok ${String(v.ok).padStart(4)}   refused with an error ${String(v.error).padStart(4)}`);
if (bad.length) { console.log('\nProblem cases (rerun with the same seed to reproduce):'); for (const b of bad.slice(0, 10)) console.log(`  case ${b.i}: ${b.verdict} ${b.detail ?? ''} (${b.size} bytes)`); process.exit(1); }
