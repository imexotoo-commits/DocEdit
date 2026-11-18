import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The viewer page. The background worker is bundled by scripts/build.mjs with esbuild.
export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: { input: { viewer: resolve(here, 'src/viewer.html') } }, target: 'chrome128', sourcemap: false, chunkSizeWarningLimit: 4000 },
});
