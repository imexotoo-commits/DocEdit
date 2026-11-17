// Builds the desktop app into dist/: renderer with Vite, main (ESM) and preload (CJS) with esbuild.
// Also writes dist/THIRD-PARTY-NOTICES.txt with the licence text of every package that ends up in the bundles.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const require = createRequire(import.meta.url);

/** absolute file paths of every module that went into a bundle */
const bundled = new Set();

const out = await vite({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
for (const o of [out].flat()) for (const chunk of o.output ?? []) for (const id of Object.keys(chunk.modules ?? {})) bundled.add(id.replace(/^\0/, ''));

// pdf.js needs its character maps and standard font data next to the page.
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
for (const d of ['cmaps', 'standard_fonts']) {
  mkdirSync(join(root, 'dist/renderer/pdfjs'), { recursive: true });
  cpSync(join(pdfjsDir, d), join(root, 'dist/renderer/pdfjs', d), { recursive: true });
}
bundled.add(join(pdfjsDir, 'build', 'pdf.worker.min.mjs'));

// The font used when creating PDFs from text (DejaVu Sans: Bitstream Vera licence + public domain).
const fontSrc = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf', 'DejaVuSans.ttf');
mkdirSync(join(root, 'dist/main/fonts'), { recursive: true });
cpSync(fontSrc, join(root, 'dist/main/fonts/DejaVuSans.ttf'));
cpSync(join(dirname(fontSrc), '..', 'LICENSE'), join(root, 'dist/main/fonts/DejaVu-LICENSE.txt'));
bundled.add(fontSrc);

const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: true, logLevel: 'warning', metafile: true };
const results = await Promise.all([
  esbuild({
    ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js', format: 'esm',
    // pdf.js text functions and the Node canvas are never used by the app's main process
    external: ['electron', 'pdfjs-dist', '@napi-rs/canvas'],
    // CommonJS dependencies (node-forge) call require() for Node built-ins; give the ESM bundle a real one
    banner: { js: "import { createRequire as __docedit_cr } from 'node:module'; const require = __docedit_cr(import.meta.url);" },
  }),
  // the document worker (a utilityProcess the main process starts for PDF work), bundled the same way
  esbuild({
    ...common, entryPoints: ['src/main/coreworker.ts'], outfile: 'dist/main/coreworker.js', format: 'esm',
    external: ['electron', 'pdfjs-dist', '@napi-rs/canvas'],
    banner: { js: "import { createRequire as __docedit_cr } from 'node:module'; const require = __docedit_cr(import.meta.url);" },
  }),
  esbuild({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.cjs', format: 'cjs', external: ['electron'] }),
  esbuild({ ...common, entryPoints: ['src/preload/prompt.ts'], outfile: 'dist/preload/prompt.cjs', format: 'cjs', external: ['electron'] }),
]);
for (const r of results) for (const input of Object.keys(r.metafile.inputs)) bundled.add(resolve(root, input));

writeFileSync(join(root, 'dist/THIRD-PARTY-NOTICES.txt'), notices(bundled));
console.log('desktop build ok');

/** One section per third-party package found in the bundles, with its licence file(s). */
function notices(files) {
  const pkgDirs = new Map();
  for (const f of files) {
    const parts = f.split(/[\\/]/);
    const i = parts.lastIndexOf('node_modules');
    if (i < 0) continue;
    const name = parts[i + 1]?.startsWith('@') ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1];
    if (!name) continue;
    pkgDirs.set(name, parts.slice(0, i + 1 + name.split('/').length).join(sep));
  }
  const sections = [...pkgDirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)) : [];
    const text = files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n') || `(no licence file in the package; package.json states: ${pkg.license ?? 'unknown'})`;
    return `${'='.repeat(78)}\n${name} ${pkg.version} — ${pkg.license ?? 'see text'}\n${'='.repeat(78)}\n${text}\n`;
  });
  return `Oakqueill includes the following third-party software. Their licences follow.\n` +
    `The Electron runtime's own notices (Electron and Chromium) are in LICENSE.electron.txt and LICENSES.chromium.html next to the program.\n\n` +
    sections.join('\n');
}
