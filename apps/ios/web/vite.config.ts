import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// The renderer is the desktop app's, built here with the iOS bridge in front. Output goes where the Xcode project
// bundles it (a folder reference), and the app serves it to the web view through its own URL scheme.
const out = resolve(here, '../Oakqueill/Web');

export default defineConfig({
  root: here,
  base: './',
  plugins: [
    react(),
    {
      // pdf.js needs its character maps and standard fonts next to the page
      name: 'copy-pdfjs-data',
      closeBundle() {
        const dir = dirname(require.resolve('pdfjs-dist/package.json'));
        for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
          mkdirSync(join(out, 'pdfjs'), { recursive: true });
          cpSync(join(dir, d), join(out, 'pdfjs', d), { recursive: true, filter: (src) => !/quickjs/i.test(src) }); // not the script engine: PDF scripts never run
        }
      },
    },
  ],
  worker: { format: 'es' },
  build: { outDir: out, emptyOutDir: true, target: 'safari17', sourcemap: false, chunkSizeWarningLimit: 4000 },
});
