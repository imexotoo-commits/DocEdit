// Builds the extension into dist/ (load it with "Load unpacked"); with --zip also release/oakqueill-viewer-<version>.zip.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const dist = join(root, 'dist');

const bundled = new Set();
const out = await vite({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
for (const o of [out].flat()) for (const chunk of o.output ?? []) for (const id of Object.keys(chunk.modules ?? {})) bundled.add(id.replace(/^\0/, ''));
const bg = await esbuild({ entryPoints: ['src/background.ts'], outfile: 'dist/background.js', bundle: true, format: 'esm', target: 'chrome128', logLevel: 'warning', metafile: true });
for (const input of Object.keys(bg.metafile.inputs)) bundled.add(join(root, input));

// pdf.js character maps and standard fonts next to the viewer page
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
for (const d of ['cmaps', 'standard_fonts']) cpSync(join(pdfjsDir, d), join(dist, 'pdfjs', d), { recursive: true });
bundled.add(join(pdfjsDir, 'build', 'pdf.worker.min.mjs'));

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = pkg.version;
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
cpSync('icons', join(dist, 'icons'), { recursive: true });
cpSync(join(root, '..', '..', 'LICENSE'), join(dist, 'LICENSE.txt'));
writeFileSync(join(dist, 'THIRD-PARTY-NOTICES.txt'), notices(bundled));
console.log('browser extension build ok');

if (process.argv.includes('--zip')) {
  const { zip } = await import('../../desktop/src/renderer/export/zip.ts');
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(dist);
  const bytes = await zip(files.map((f) => ({ name: relative(dist, f).split(sep).join('/'), data: new Uint8Array(readFileSync(f)) })));
  mkdirSync('release', { recursive: true });
  const target = join('release', `oakqueill-viewer-${pkg.version}.zip`);
  if (existsSync(target)) rmSync(target);
  writeFileSync(target, bytes);
  console.log(`packed ${target}`);
}

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
