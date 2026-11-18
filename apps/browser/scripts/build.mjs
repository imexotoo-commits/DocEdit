// Builds the extension for each browser family.
//
//   node scripts/build.mjs                       Chromium (Chrome, Edge, Brave, Opera, Vivaldi, Arc ...) into dist/
//   node scripts/build.mjs --target firefox      Firefox into dist-firefox/
//   node scripts/build.mjs --target safari       the web extension Safari's converter takes, into dist-safari/
//   node scripts/build.mjs --target all          all three
//   add --zip                                    also release/oakqueill-viewer-<version>[-firefox].zip (Chromium, Firefox)
//
// The viewer page is the same for every browser; what differs is the manifest and the background script (how a PDF is
// recognised: request rules, a blocking listener, or the address), see src/background.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { manifestFor } from './manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const args = process.argv.slice(2);
const wanted = args.includes('--target') ? args[args.indexOf('--target') + 1] : 'chromium';
const TARGETS = wanted === 'all' ? ['chromium', 'firefox', 'safari'] : [wanted];
for (const t of TARGETS) if (!['chromium', 'firefox', 'safari'].includes(t)) throw new Error(`Unknown target "${t}" (chromium, firefox, safari or all)`);

const outDir = (t) => join(root, t === 'chromium' ? 'dist' : `dist-${t}`);
/** esbuild target for the background script */
const ESBUILD_TARGET = { chromium: 'chrome128', firefox: 'firefox128', safari: 'safari17' };

const bundled = new Set();
const viewer = await vite({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
for (const o of [viewer].flat()) for (const chunk of o.output ?? []) for (const id of Object.keys(chunk.modules ?? {})) bundled.add(id.replace(/^\0/, ''));
const viewerFiles = join(root, 'dist-viewer-tmp');
rmSync(viewerFiles, { recursive: true, force: true });
cpSync(join(root, 'dist'), viewerFiles, { recursive: true }); // the viewer page, before any target adds its files to dist/

const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
const base = JSON.parse(readFileSync('manifest.json', 'utf8'));

for (const target of TARGETS) {
  const dist = outDir(target);
  if (target !== 'chromium') { rmSync(dist, { recursive: true, force: true }); cpSync(viewerFiles, dist, { recursive: true }); }
  const bg = await esbuild({ entryPoints: [`src/background/${target}.ts`], outfile: join(dist, 'background.js'), bundle: true, format: 'esm', target: ESBUILD_TARGET[target], logLevel: 'warning', metafile: true });
  for (const input of Object.keys(bg.metafile.inputs)) bundled.add(join(root, input));
  // pdf.js character maps and standard fonts next to the viewer page
  for (const d of ['cmaps', 'standard_fonts']) cpSync(join(pdfjsDir, d), join(dist, 'pdfjs', d), { recursive: true });
  bundled.add(join(pdfjsDir, 'build', 'pdf.worker.min.mjs'));
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifestFor(target, base, pkg.version), null, 2));
  cpSync('icons', join(dist, 'icons'), { recursive: true });
  cpSync(join(root, '..', '..', 'LICENSE'), join(dist, 'LICENSE.txt'));
  writeFileSync(join(dist, 'THIRD-PARTY-NOTICES.txt'), notices(bundled));
  console.log(`browser extension build ok: ${target} -> ${relative(root, dist)}/`);

  if (args.includes('--zip') && target !== 'safari') {
    const { zip } = await import('../../desktop/src/renderer/export/zip.ts');
    const files = [];
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
    walk(dist);
    const bytes = await zip(files.map((f) => ({ name: relative(dist, f).split(sep).join('/'), data: new Uint8Array(readFileSync(f)) })));
    mkdirSync('release', { recursive: true });
    const target_ = join('release', `oakqueill-viewer-${pkg.version}${target === 'chromium' ? '' : `-${target}`}.zip`);
    if (existsSync(target_)) rmSync(target_);
    writeFileSync(target_, bytes);
    console.log(`packed ${target_}`);
  }
}
rmSync(viewerFiles, { recursive: true, force: true });

/** Licence texts of every npm package that ended up in the extension. */
function notices(files) {
  const pkgs = new Map();
  for (const f of files) {
    const m = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(f);
    if (m) pkgs.set(m[1].replace(/\\/g, '/'), f.slice(0, m.index + m[0].length));
  }
  const sections = [...pkgs].sort().map(([name, dir]) => {
    const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const lic = readdirSync(dir).filter((n) => /^(licen[cs]e|copying|notice)/i.test(n));
    const text = lic.map((n) => readFileSync(join(dir, n), 'utf8').trim()).join('\n\n') || `(no licence file; package.json states: ${p.license ?? 'unknown'})`;
    return `${'='.repeat(78)}\n${name} ${p.version} — ${p.license ?? 'see text'}\n${'='.repeat(78)}\n${text}\n`;
  });
  return 'Oakqueill PDF Viewer includes the following third-party software. Their licences follow.\n\n' + sections.join('\n');
}
